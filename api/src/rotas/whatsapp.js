// Etapa 2: conexão do WhatsApp da loja e recebimento das mensagens (webhook da Evolution).
import { Router } from 'express';
import { config } from '../config.js';
import { comContexto, comoSistema, contextoDoUsuario } from '../banco/conexao.js';
import { evolution, lerMensagemEvolution } from '../servicos/canais/evolution.js';
import { iguais } from '../servicos/seguranca.js';
import { emailAviso } from '../servicos/email.js';
import { enviarAoCliente } from '../servicos/canais/envio.js';
import { rota, erro, exigirPerfil, registrar, zUuid } from '../http.js';
import { estadoInicial, agendar, dentroDoHorario } from '../servicos/ia/assistente.js';
import { registrarEvento } from '../servicos/crm/funis.js';
import { distribuir } from '../servicos/crm/roleta.js';

export const canal = Router();
export const canalAdmin = Router();   // /api/admin — status do WhatsApp de todas as lojas
export const webhooks = Router();

const provedores = { evolution };
const ctx = (req) => contextoDoUsuario(req.usuario);
const nomeInstancia = (lojaId) => `conecta-${lojaId}`;

function exigirEvolution() {
  if (!config.evolution) throw erro(503, 'O WhatsApp ainda não foi configurado no servidor. Fale com a administração.');
}

async function lerCanal(c, lojaId) {
  return (await c.query('SELECT * FROM canais WHERE loja_id = $1', [lojaId])).rows[0] || null;
}

// Limites da trava anti-loop (mudanças de estado por minuto → instável por N minutos)
const LOOP_MUDANCAS = 5, LOOP_JANELA_MIN = 1, INSTAVEL_MIN = 2;

/** Grava o estado da instância. Só registra evento quando o estado muda; detecta loop e marca a instância como instável. */
async function gravarStatus(lojaId, status, numero) {
  const r = await comoSistema(async (c) => {
    // FOR UPDATE: avisos da Evolution chegam em paralelo; serializa para cada mudança de estado ser contada uma vez só
    const antes = (await c.query('SELECT status, instancia, instavel_ate FROM canais WHERE loja_id = $1 FOR UPDATE', [lojaId])).rows[0];
    await c.query(`UPDATE canais SET status = $2, numero = coalesce($3, numero), atualizado_em = now(),
                     ultima_queda_em = CASE WHEN $2 = 'desconectado' AND status = 'conectado' THEN now() ELSE ultima_queda_em END
                   WHERE loja_id = $1`, [lojaId, status, numero || null]);
    await c.query(`UPDATE lojas SET whatsapp = $2 WHERE id = $1`, [lojaId, status === 'conectado' ? 'conectado' : 'desconectado']);
    if (!antes || antes.status === status) return null;
    await c.query('INSERT INTO canais_eventos (loja_id, instancia, de, para) VALUES ($1, $2, $3, $4)', [lojaId, antes.instancia, antes.status, status]);
    await c.query("DELETE FROM canais_eventos WHERE criado_em < now() - interval '30 days'");   // retenção
    // conta só a instância atual: "Desconectar"/"Trocar número" passam a loja para uma instância nova e zeram a contagem
    const n = (await c.query(`SELECT count(*)::int AS n FROM canais_eventos WHERE loja_id = $1 AND instancia = $3 AND criado_em > now() - make_interval(mins => $2)`, [lojaId, LOOP_JANELA_MIN, antes.instancia])).rows[0].n;
    if (n > LOOP_MUDANCAS && !(antes.instavel_ate && new Date(antes.instavel_ate) > new Date())) {
      await c.query(`UPDATE canais SET instavel_ate = now() + make_interval(mins => $2) WHERE loja_id = $1`, [lojaId, INSTAVEL_MIN]);
      const loja = (await c.query('SELECT nome FROM lojas WHERE id = $1', [lojaId])).rows[0];
      const admins = (await c.query(`SELECT email, nome FROM usuarios WHERE perfil = 'admin' AND status = 'ativo'`)).rows;
      return { loop: true, loja: loja?.nome || lojaId, admins, mudancas: n };
    }
    return null;
  });
  if (r?.loop) {
    console.error(`[whatsapp] instância da loja ${r.loja} instável: ${r.mudancas} mudanças de estado em ${LOOP_JANELA_MIN} min; conexão bloqueada por ${INSTAVEL_MIN} min`);
    for (const a of r.admins) {
      emailAviso({ para: a.email, nome: a.nome, assunto: `WhatsApp instável: ${r.loja}`,
        texto: `O WhatsApp da loja ${r.loja} mudou de estado ${r.mudancas} vezes em ${LOOP_JANELA_MIN} minuto (loop de reconexão). O Conecta bloqueou Conectar/Reconectar por ${INSTAVEL_MIN} minutos. Confira em Status do WhatsApp; se continuar, use "Trocar número" e confira se o número está aberto em outro aparelho ou sistema.` })
        .catch((e) => console.error('[whatsapp] aviso:', e.message));
    }
  }
}

/** Instância marcada como instável: Conectar/Reconectar/QR ficam bloqueados até passar a janela. */
async function exigirEstavel(lojaId) {
  const cn = await comoSistema((c) => lerCanal(c, lojaId));
  if (cn?.instavel_ate && new Date(cn.instavel_ate) > new Date()) {
    const seg = Math.ceil((new Date(cn.instavel_ate) - Date.now()) / 1000);
    throw erro(409, `O WhatsApp desta loja está instável (ficou conectando e caindo várias vezes seguidas). Aguarde ${seg} s antes de tentar de novo. Se continuar, confira se o número está aberto em outro aparelho ou sistema e use "Trocar número".`);
  }
}

const publico = (cn) => ({ status: cn?.status || 'desconectado', numero: cn?.numero || null, provedor: cn?.provedor || 'evolution', atualizadoEm: cn?.atualizado_em || null, instavelAte: cn?.instavel_ate && new Date(cn.instavel_ate) > new Date() ? cn.instavel_ate : null, ultimaQuedaEm: cn?.ultima_queda_em || null });

// ---------- situação ----------
canal.get('/canal', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  const cn = await comContexto(ctx(req), (c) => lerCanal(c, req.usuario.loja_id));
  res.json({ ...publico(cn), configurado: !!config.evolution });
}));

// ---------- conectar: cria a instância (se preciso) e devolve o QR code ----------
// (as mesmas funções servem o dono da loja e a administração — por isso recebem o lojaId)
async function conectarLoja(req, lojaId) {
  exigirEvolution();
  await exigirEstavel(lojaId);
  let cn = await comoSistema((c) => lerCanal(c, lojaId));
  if (!cn) {
    cn = await comoSistema(async (c) => (await c.query(
      `INSERT INTO canais (loja_id, provedor, instancia, status) VALUES ($1, 'evolution', $2, 'conectando') RETURNING *`,
      [lojaId, nomeInstancia(lojaId)])).rows[0]);
    await comContexto(ctx(req), (c) => registrar(c, req, 'whatsapp_conectar', { lojaId }));
  }
  const p = provedores[cn.provedor];
  try {
    const criada = await p.criar(cn.instancia);
    if (criada) {
      // instância nova: o QR vem na própria criação (ou chega pelo webhook em instantes) — não chama connect agora
      ultimoConnect.set(cn.instancia, Date.now());
      guardarQr(cn.instancia, criada.qr, criada.codigo);
      await gravarStatus(lojaId, 'conectando');
      return { status: 'conectando', qr: criada.qr, codigo: criada.codigo };
    }
    if (!podeChamarConnect(cn.instancia)) {
      const g = qrCache.get(cn.instancia);
      return { status: 'conectando', qr: g?.qr || null, codigo: g?.codigo || null };
    }
    ultimoConnect.set(cn.instancia, Date.now());
    const r = await p.qr(cn.instancia);
    if (r.conectado) { qrCache.delete(cn.instancia); await gravarStatus(lojaId, 'conectado'); return { status: 'conectado' }; }
    guardarQr(cn.instancia, r.qr, r.codigo);
    await gravarStatus(lojaId, 'conectando');
    return { status: 'conectando', qr: r.qr, codigo: r.codigo };
  } catch (e) {
    console.error('[whatsapp] conectar:', e.message, JSON.stringify(e.resposta || '').slice(0, 300));
    throw erro(502, 'Não foi possível falar com o servidor do WhatsApp agora. Tente de novo em instantes.');
  }
}

// QR por instância (vem pelo webhook qrcode.updated ou da última chamada ao /instance/connect).
// Chamar /instance/connect repetidamente enquanto a Evolution ainda está conectando reinicia o socket dela e
// provoca a cascata "stream errored out" / 428 / 440 — então a tela só consulta o estado e reaproveita o QR guardado.
const qrCache = new Map();
const guardarQr = (instancia, qr, codigo = null) => { if (qr) qrCache.set(instancia, { qr, codigo, em: Date.now() }); };
const QR_VALIDO_MS = 90_000, INTERVALO_CONNECT_MS = 20_000;
// trava geral: no máximo um /instance/connect a cada 20 s por instância, venha de onde vier (várias abas, admin e dono juntos)
const ultimoConnect = new Map();
const podeChamarConnect = (instancia) => Date.now() - (ultimoConnect.get(instancia) || 0) >= INTERVALO_CONNECT_MS;
async function qrDaLoja(req, lojaId) {
  exigirEvolution();
  await exigirEstavel(lojaId);
  const cn = await comoSistema((c) => lerCanal(c, lojaId));
  if (!cn) throw erro(404, 'Clique em "Conectar WhatsApp" para começar.');
  if (cn.status === 'conectado') return { status: 'conectado', numero: cn.numero };
  try {
    const p = provedores[cn.provedor];
    const estado = await p.estado(cn.instancia);
    if (estado === 'conectado') { qrCache.delete(cn.instancia); await gravarStatus(lojaId, 'conectado'); return { status: 'conectado' }; }
    const g = qrCache.get(cn.instancia);
    const recente = g && Date.now() - g.em < QR_VALIDO_MS;
    // conectando (QR na tela ou pareamento em andamento): não mexe no socket; devolve o QR que já temos
    if (estado === 'conectando' && recente) return { status: 'conectando', qr: g.qr, codigo: g.codigo };
    if (estado === 'conectando' && g && Date.now() - g.em < QR_VALIDO_MS + INTERVALO_CONNECT_MS) return { status: 'conectando', qr: g.qr, codigo: g.codigo };
    // sem QR guardado: espera o webhook em vez de martelar o connect (cada connect reinicia o socket da Evolution)
    if (!podeChamarConnect(cn.instancia)) return { status: 'conectando', qr: g?.qr || null, codigo: g?.codigo || null };
    ultimoConnect.set(cn.instancia, Date.now());
    const r = await p.qr(cn.instancia);
    if (r.conectado) { qrCache.delete(cn.instancia); await gravarStatus(lojaId, 'conectado'); return { status: 'conectado' }; }
    guardarQr(cn.instancia, r.qr, r.codigo);
    if (!r.qr && g) return { status: 'conectando', qr: g.qr, codigo: g.codigo };
    return { status: 'conectando', qr: r.qr, codigo: r.codigo };
  } catch (e) {
    console.error('[whatsapp] qr:', e.message);
    throw erro(502, 'Não foi possível buscar o QR code agora. Tente de novo em instantes.');
  }
}

// Desconectar = apagar a instância na Evolution E passar a loja para uma instância nova (nome novo).
// Por que o nome novo: uma sessão presa (loop de reconexão) às vezes não sai da Evolution e continua mandando
// "conectado" pelo webhook — o Conecta voltava a mostrar o número antigo e o próximo "Conectar" religava o mesmo
// número sem QR. Com o nome novo, o webhook da instância antiga é ignorado (não acha canal) e o próximo QR é de
// uma instância limpa, que aceita qualquer número.
async function desconectarLoja(req, lojaId, acao = 'whatsapp_desconectar') {
  exigirEvolution();
  const cn = await comoSistema((c) => lerCanal(c, lojaId));
  if (!cn) return { status: 'desconectado' };
  const r = await provedores[cn.provedor].desconectar(cn.instancia)
    .catch((e) => ({ apagada: false, erro: e.message }));
  if (!r.apagada) console.error('[whatsapp] desconectar: instância antiga não saiu da Evolution:', cn.instancia, r.erro);
  qrCache.delete(cn.instancia);
  const nova = `${nomeInstancia(lojaId)}-${Date.now().toString(36)}`;
  await comoSistema((c) => c.query(
    // instância nova = começa estável (a trava era da instância antiga, que agora é ignorada)
    `UPDATE canais SET instancia = $2, status = 'desconectado', numero = NULL, instavel_ate = NULL, atualizado_em = now() WHERE loja_id = $1`, [lojaId, nova]));
  await gravarStatus(lojaId, 'desconectado');
  await comContexto(ctx(req), (c) => registrar(c, req, acao, {
    lojaId, detalhes: { numeroAnterior: cn.numero || null, instanciaAnterior: cn.instancia, apagadaNaEvolution: r.apagada },
  }));
  return {
    status: 'desconectado',
    ...(r.apagada ? {} : { aviso: 'O número foi desligado do Conecta, mas a sessão antiga não saiu do servidor do WhatsApp. Para garantir, no celular desse número abra WhatsApp → Dispositivos conectados e desconecte o aparelho.' }),
  };
}

// Trocar número: desconecta (como acima) e já devolve o QR de uma instância nova, para o celular do número novo ler.
async function trocarNumero(req, lojaId) {
  const d = await desconectarLoja(req, lojaId, 'whatsapp_trocar_numero');
  const r = await conectarLoja(req, lojaId);
  return { ...r, ...(d.aviso ? { aviso: d.aviso } : {}) };
}

canal.post('/canal/conectar', exigirPerfil('dono'), rota(async (req, res) => res.json(await conectarLoja(req, req.usuario.loja_id))));
canal.get('/canal/qr', exigirPerfil('dono'), rota(async (req, res) => res.json(await qrDaLoja(req, req.usuario.loja_id))));
canal.post('/canal/desconectar', exigirPerfil('dono'), rota(async (req, res) => res.json(await desconectarLoja(req, req.usuario.loja_id))));
canal.post('/canal/trocar-numero', exigirPerfil('dono'), rota(async (req, res) => res.json(await trocarNumero(req, req.usuario.loja_id))));

// =====================================================================
// Administração: status do WhatsApp de todas as lojas (Evolution no ar, instância por loja,
// número conectado, alertas). A matriz só vê; a administração também reconecta e desconecta.
// Nenhuma conversa é lida aqui: só situação e contagens.
// =====================================================================
const lojaValida = async (id) => {
  if (!zUuid.safeParse(id).success) throw erro(404, 'Loja não encontrada.');
  const l = await comoSistema(async (c) => (await c.query('SELECT id, ativa FROM lojas WHERE id = $1', [id])).rows[0]);
  if (!l) throw erro(404, 'Loja não encontrada.');
  return l.id;
};

canalAdmin.get('/whatsapp', exigirPerfil('admin', 'matriz'), rota(async (req, res) => {
  const aoVivo = req.query.aoVivo === '1' && !!config.evolution;
  const linhas = await comoSistema(async (c) => (await c.query(`
    SELECT l.id, l.nome, l.cidade, l.uf, l.ativa, l.branch_id,
           cn.status AS canal_status, cn.numero, cn.instancia, cn.provedor, cn.atualizado_em, cn.instavel_ate, cn.ultima_queda_em,
           ci.ig_username, ci.status AS ig_status,
           (SELECT count(*) FROM canais_eventos e WHERE e.loja_id = l.id AND e.de = 'conectado' AND e.para <> 'conectado' AND e.criado_em > now() - interval '24 hours')::int AS quedas_24h,
           (SELECT count(*) FROM canais_eventos e WHERE e.loja_id = l.id AND e.de = 'conectado' AND e.para <> 'conectado' AND e.criado_em > now() - interval '7 days')::int AS quedas_7d,
           coalesce(a.ativo, false) AS assistente_ativo, (a.chave_cifrada IS NOT NULL) AS assistente_com_chave,
           (SELECT count(*) FROM usuarios u WHERE u.loja_id = l.id AND u.status = 'ativo' AND u.visto_em > now() - interval '5 minutes')::int AS online,
           (SELECT count(*) FROM usuarios u WHERE u.loja_id = l.id AND u.status = 'ativo' AND u.perfil IN ('dono', 'atendente'))::int AS equipe,
           (SELECT count(*) FROM mensagens m WHERE m.loja_id = l.id AND m.direcao = 'entrada' AND m.criada_em > now() - interval '24 hours')::int AS recebidas_24h,
           (SELECT count(*) FROM mensagens m WHERE m.loja_id = l.id AND m.direcao = 'saida' AND m.criada_em > now() - interval '24 hours')::int AS enviadas_24h,
           (SELECT max(m.criada_em) FROM mensagens m WHERE m.loja_id = l.id) AS ultima_mensagem_em,
           (SELECT count(*) FROM conversas cv WHERE cv.loja_id = l.id AND cv.estado = 'aguardando')::int AS aguardando
      FROM lojas l LEFT JOIN canais cn ON cn.loja_id = l.id LEFT JOIN assistentes a ON a.loja_id = l.id LEFT JOIN canais_instagram ci ON ci.loja_id = l.id
     ORDER BY l.ativa DESC, l.nome`)).rows);
  const evolucao = config.evolution ? await evolution.saude() : { noAr: false, versao: null, naoConfigurada: true };
  const lojas = [];
  for (const l of linhas) {
    let estadoVivo = null;
    if (aoVivo && l.instancia && evolucao.noAr) {
      try { estadoVivo = await provedores[l.provedor].estado(l.instancia); } catch { estadoVivo = 'erro'; }
      // o que a Evolution diz vale mais que o que ficou gravado (ex.: caiu sem avisar)
      if (estadoVivo && estadoVivo !== 'erro' && estadoVivo !== l.canal_status) { await gravarStatus(l.id, estadoVivo); l.canal_status = estadoVivo; }
    }
    const status = l.canal_status || 'nunca';
    const alertas = [];
    const instavel = l.instavel_ate && new Date(l.instavel_ate) > new Date();
    if (instavel) alertas.push(`Instável: conectou e caiu várias vezes seguidas — conexão bloqueada até ${new Date(l.instavel_ate).toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', minute: '2-digit' })}`);
    if (l.ativa && (l.quedas_24h || 0) >= 3) alertas.push(`${l.quedas_24h} quedas nas últimas 24 h`);
    if (l.ativa && status !== 'conectado') alertas.push(status === 'nunca' ? 'WhatsApp nunca foi conectado' : 'WhatsApp desconectado');
    if (l.ativa && status === 'conectado' && l.assistente_ativo && !l.assistente_com_chave) alertas.push('Assistente ligado sem chave de IA');
    if (l.ativa && status === 'conectado' && !l.assistente_ativo && l.online === 0 && l.aguardando > 0) alertas.push(`${l.aguardando} conversa(s) aguardando e ninguém da equipe online`);
    if (estadoVivo === 'erro') alertas.push('A Evolution não respondeu sobre esta instância');
    lojas.push({
      id: l.id, nome: l.nome, cidade: l.cidade, uf: l.uf, ativa: l.ativa, filial: l.branch_id,
      status, numero: l.numero, instancia: l.instancia, atualizadoEm: l.atualizado_em, estadoVivo, instagram: l.ig_username ? { usuario: l.ig_username, status: l.ig_status } : null, instavelAte: instavel ? l.instavel_ate : null, quedas24h: l.quedas_24h || 0, quedas7d: l.quedas_7d || 0, ultimaQuedaEm: l.ultima_queda_em || null,
      assistente: l.assistente_ativo ? (l.assistente_com_chave ? 'ligado' : 'sem chave') : 'desligado',
      equipe: l.equipe, online: l.online, recebidas24h: l.recebidas_24h, enviadas24h: l.enviadas_24h, ultimaMensagemEm: l.ultima_mensagem_em, aguardando: l.aguardando,
      alertas,
    });
  }
  res.json({
    evolution: evolucao,
    totais: { lojas: lojas.filter((x) => x.ativa).length, conectadas: lojas.filter((x) => x.ativa && x.status === 'conectado').length, comAlerta: lojas.filter((x) => x.alertas.length).length },
    lojas,
  });
}));

canalAdmin.post('/whatsapp/:lojaId/conectar', exigirPerfil('admin'), rota(async (req, res) => res.json(await conectarLoja(req, await lojaValida(req.params.lojaId)))));
canalAdmin.get('/whatsapp/:lojaId/qr', exigirPerfil('admin'), rota(async (req, res) => res.json(await qrDaLoja(req, await lojaValida(req.params.lojaId)))));
canalAdmin.post('/whatsapp/:lojaId/desconectar', exigirPerfil('admin'), rota(async (req, res) => res.json(await desconectarLoja(req, await lojaValida(req.params.lojaId)))));
canalAdmin.post('/whatsapp/:lojaId/trocar-numero', exigirPerfil('admin'), rota(async (req, res) => res.json(await trocarNumero(req, await lojaValida(req.params.lojaId)))));

// =====================================================================
// Webhook da Evolution — sem login; protegido por segredo longo na URL
// (e, no Railway, pela rede interna: a Evolution não tem endereço público).
// =====================================================================
webhooks.post('/evolution/:segredo', rota(async (req, res) => {
  if (!config.evolution || !iguais(req.params.segredo, config.evolution.segredoWebhook)) return res.status(404).end();
  res.status(200).json({ ok: true }); // responde rápido; processa em seguida
  const corpo = req.body || {};
  const evento = String(corpo.event || '').toLowerCase().replace(/_/g, '.');
  const instancia = String(corpo.instance || '');
  try {
    const cn = await comoSistema(async (c) => (await c.query('SELECT * FROM canais WHERE instancia = $1', [instancia])).rows[0]);
    if (!cn) return;
    if (evento === 'qrcode.updated') {
      const q = corpo.data?.qrcode || corpo.data || {};
      const b64 = q.base64 || null;
      guardarQr(instancia, b64 && (String(b64).startsWith('data:') ? b64 : `data:image/png;base64,${b64}`), q.pairingCode || null);
      return;
    }
    if (evento === 'connection.update') {
      const s = corpo.data?.state;
      if (s === 'open') qrCache.delete(instancia);
      const status = s === 'open' ? 'conectado' : s === 'connecting' ? 'conectando' : 'desconectado';
      const numero = String(corpo.data?.wuid || corpo.sender || '').split('@')[0].replace(/\D/g, '') || null;
      await gravarStatus(cn.loja_id, status, status === 'conectado' ? numero : null);
      return;
    }
    if (evento === 'messages.upsert') {
      const lista = Array.isArray(corpo.data) ? corpo.data : (corpo.data?.messages || [corpo.data]);
      for (const item of lista) {
        const m = lerMensagemEvolution(item);
        if (m) await registrarRecebida(cn.loja_id, m);
      }
    }
  } catch (e) {
    console.error('[webhook] erro ao processar', evento, e.message);
  }
}));

const PREVIA = { imagem: 'Foto', audio: 'Áudio', video: 'Vídeo', documento: 'Documento', localizacao: 'Localização', figurinha: 'Figurinha', outro: 'Mensagem' };
export const previaDe = (tipo, texto) => (texto ? String(texto).slice(0, 140) : (PREVIA[tipo] || 'Mensagem'));

const PALAVRAS_SAIR = /^\s*(parar|sair|stop|cancelar mensagens|não quero mais mensagens|nao quero mais mensagens)\s*[.!]?\s*$/i;

// Registra uma mensagem do cliente (WhatsApp ou chat do site) no contato/conversa da loja.
// opcoes.canal: por onde o cliente falou agora ('whatsapp' | 'site'); opcoes.semAgendar: o chamador agenda o assistente depois.
export async function registrarRecebida(lojaId, m, opcoes = {}) {
  const canalNovo = opcoes.canal === 'site' ? 'site' : opcoes.canal === 'instagram' ? 'instagram' : 'whatsapp';
  const r = await comoSistema(async (c) => {
    if (m.externoId) {
      const ja = (await c.query('SELECT 1 FROM mensagens WHERE loja_id = $1 AND externo_id = $2', [lojaId, m.externoId])).rowCount;
      if (ja) return null; // repetida ou eco de mensagem enviada pelo próprio Conecta
    }
    const entrada = !m.deMim;
    // Instagram: o contato é identificado pelo perfil (ig_id); WhatsApp/site: pelo telefone
    const contato = canalNovo === 'instagram'
      ? (await c.query(
        `INSERT INTO contatos (loja_id, ig_id, ig_username, nome, optin_em) VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN now() END)
         ON CONFLICT (loja_id, ig_id) WHERE ig_id IS NOT NULL DO UPDATE SET nome = coalesce(contatos.nome, EXCLUDED.nome), ig_username = coalesce(EXCLUDED.ig_username, contatos.ig_username), optin_em = coalesce(contatos.optin_em, EXCLUDED.optin_em)
         RETURNING id, optout`, [lojaId, m.igId, m.igUsername || null, m.nome, entrada])).rows[0]
      : (await c.query(
        `INSERT INTO contatos (loja_id, telefone, nome, optin_em) VALUES ($1, $2, $3, CASE WHEN $4 THEN now() END)
         ON CONFLICT (loja_id, telefone) DO UPDATE SET nome = coalesce(contatos.nome, EXCLUDED.nome), optin_em = coalesce(contatos.optin_em, EXCLUDED.optin_em)
         RETURNING id, optout`, [lojaId, m.telefone, m.nome, entrada])).rows[0];
    const anterior = (await c.query('SELECT id, estado FROM conversas WHERE loja_id = $1 AND contato_id = $2', [lojaId, contato.id])).rows[0];
    // conversa nova ou reaberta: vai para o assistente (se estiver ligado e no horário) ou para a equipe
    const reabrir = entrada && (!anterior || anterior.estado === 'encerrada');
    const estadoNovo = reabrir ? await estadoInicial(c, lojaId) : null;
    const conversa = (await c.query(
      `INSERT INTO conversas (loja_id, contato_id, estado, nao_lidas, ultima_previa, ultima_mensagem_em, ultima_do_cliente, humano_respondeu_em, canal)
       VALUES ($1, $2, coalesce($6::text, 'aguardando'), $3, $4, now(), CASE WHEN $5::boolean THEN now() END, CASE WHEN $5::boolean THEN NULL ELSE now() END, $7)
       ON CONFLICT (loja_id, contato_id) DO UPDATE SET
         canal = CASE WHEN $5::boolean THEN $7 ELSE conversas.canal END,
         nao_lidas = conversas.nao_lidas + $3,
         estado = CASE WHEN $6::text IS NOT NULL THEN $6::text
                       WHEN NOT $5::boolean AND conversas.estado = 'assistente' THEN 'humano'
                       ELSE conversas.estado END,
         atendente_id = CASE WHEN $6::text IS NOT NULL THEN NULL ELSE conversas.atendente_id END,
         ultima_previa = EXCLUDED.ultima_previa, ultima_mensagem_em = now(),
         ultima_do_cliente = CASE WHEN $5::boolean THEN now() ELSE conversas.ultima_do_cliente END,
         humano_respondeu_em = CASE WHEN $5::boolean THEN conversas.humano_respondeu_em ELSE now() END,
         bot_respondeu_em = CASE WHEN $6::text IS NOT NULL THEN NULL ELSE conversas.bot_respondeu_em END,
         atualizada_em = now()
       RETURNING id, estado, canal, ausencia_enviada_em`,
      [lojaId, contato.id, entrada ? 1 : 0, previaDe(m.tipo, m.texto), entrada, estadoNovo, canalNovo])).rows[0];
    await c.query(
      `INSERT INTO mensagens (conversa_id, loja_id, direcao, autor, tipo, texto, midia, externo_id, criada_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (loja_id, externo_id) WHERE externo_id IS NOT NULL DO NOTHING`,
      [conversa.id, lojaId, entrada ? 'entrada' : 'saida', entrada ? 'cliente' : 'atendente', m.tipo, m.texto, m.midia, m.externoId]);
    // conversa nova ou reaberta: o cliente entra (ou continua) no funil principal da loja
    if (reabrir) await registrarEvento(c, { lojaId, contatoId: contato.id, conversaId: conversa.id, evento: null });
    // esperando alguém da equipe: a roleta entrega para a próxima pessoa disponível
    if (entrada && conversa.estado === 'aguardando' && await distribuir(c, conversa.id)) conversa.estado = 'humano';
    // cliente pediu para não receber mais mensagens ativas (lembretes, avisos)
    if (entrada && m.tipo === 'texto' && PALAVRAS_SAIR.test(m.texto || '') && !contato.optout) {
      await c.query('UPDATE contatos SET optout = true, atualizado_em = now() WHERE id = $1', [contato.id]);
      await c.query(`INSERT INTO mensagens (conversa_id, loja_id, direcao, autor, tipo, texto) VALUES ($1, $2, 'interna', 'sistema', 'evento', 'Cliente pediu para não receber mensagens automáticas')`, [conversa.id, lojaId]);
    }
    // fora do horário com "mensagem de ausência": manda uma vez a cada 12 h
    let ausencia = null;
    if (entrada && conversa.estado === 'aguardando') {
      const a = (await c.query('SELECT * FROM assistentes WHERE loja_id = $1', [lojaId])).rows[0];
      if (a?.ativo && a.fora_horario === 'mensagem' && a.msg_ausencia && !dentroDoHorario(a.horario)
          && (!conversa.ausencia_enviada_em || Date.now() - new Date(conversa.ausencia_enviada_em) > 12 * 3_600_000)) {
        await c.query('UPDATE conversas SET ausencia_enviada_em = now() WHERE id = $1', [conversa.id]);
        ausencia = a.msg_ausencia;
      }
    }
    return { conversa, ausencia, contatoId: contato.id };
  });
  if (!r) return null;
  if (r.conversa.estado === 'assistente' && !m.deMim && !opcoes.semAgendar) agendar(r.conversa.id, canalNovo === 'site' ? 1200 : undefined);
  if (r.ausencia) {
    if (canalNovo === 'site') {
      await comoSistema((c) => c.query(`INSERT INTO mensagens (conversa_id, loja_id, direcao, autor, tipo, texto) VALUES ($1, $2, 'saida', 'assistente', 'texto', $3)`, [r.conversa.id, lojaId, r.ausencia]));
    } else if (canalNovo === 'instagram') {
      await enviarAoCliente(r.conversa.id, r.ausencia).catch((e) => console.error('[ausencia ig]', e.message));
    } else {
      await enviarAusencia(lojaId, r.conversa.id, m.telefone, r.ausencia).catch((e) => console.error('[ausencia]', e.message));
    }
  }
  return { conversaId: r.conversa.id, contatoId: r.contatoId, estado: r.conversa.estado };
}

async function enviarAusencia(lojaId, conversaId, telefone, texto) {
  const canal = await comoSistema(async (c) => (await c.query('SELECT * FROM canais WHERE loja_id = $1', [lojaId])).rows[0]);
  if (!canal || canal.status !== 'conectado') return;
  const externoId = await provedores[canal.provedor].enviarTexto(canal.instancia, telefone, texto);
  await comoSistema((c) => c.query(`INSERT INTO mensagens (conversa_id, loja_id, direcao, autor, tipo, texto, externo_id) VALUES ($1, $2, 'saida', 'assistente', 'texto', $3, $4)`, [conversaId, lojaId, texto, externoId]));
}
