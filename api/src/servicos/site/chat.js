// Chat do site da LocarX — serviço principal.
//
// Fluxo:
//  1) o widget abre uma sessão (token aleatório; só o hash fica no banco). Sem cadastro.
//  2) antes de confirmar o WhatsApp a conversa fica em site_sessoes/site_mensagens (nada entra no CRM) e a Lia só consulta.
//  3) quando o visitante quer reservar ou falar com atendente: nome + WhatsApp → código de 6 dígitos pelo WhatsApp da loja.
//  4) código correto → vira contato + conversa no CRM (canal 'site'), as mensagens são importadas e o motor normal continua.
import crypto from 'node:crypto';
import { config } from '../../config.js';
import { comoSistema } from '../../banco/conexao.js';
import { erro } from '../../http.js';
import { evolution } from '../canais/evolution.js';
import { registrarRecebida } from '../../rotas/whatsapp.js';
import { agendar } from '../ia/assistente.js';
import { registrarEvento } from '../crm/funis.js';
import { filiaisComPortal } from '../locarx/filiais.js';
import { telefoneBr, telefoneMascarado, primeiroNome, mascarar } from './texto.js';

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const iguais = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const HORAS_CONFIRMACAO = 6;           // depois disso sem atividade, o visitante confirma o número de novo para continuar reservando
const MAX_TENTATIVAS = 5;
const VALIDADE_CODIGO_MIN = 10;
const ESPERA_REENVIO_S = 45;
const MAX_CODIGOS_SESSAO = 4;
const MAX_CODIGOS_TELEFONE_HORA = 4;
const MAX_CODIGOS_IP_HORA = 8;
const MAX_MSG_CLIENTE_HORA = 80;

export const siteLigado = () => !!config.site;

// ---------- lojas que atendem pelo chat ----------
export async function lojasDoSite(c) {
  return (await c.query(`SELECT id, nome, cidade, uf, tipo, branch_id FROM lojas WHERE ativa AND site_chat ORDER BY cidade, tipo DESC, nome`)).rows;
}
export async function lojaPadrao(c) { return (await lojasDoSite(c))[0] || null; }

async function lojaPublica(c, l) {
  let endereco = null, horario = null;
  try {
    const f = (await filiaisComPortal(c, l.id)).find((x) => x.principal) || null;
    endereco = f?.portal?.endereco || null;
    horario = f?.portal?.horarios ? String(f.portal.horarios).split('\n')[0] : null;
  } catch { /* sem dados do portal: o cartão mostra só nome e cidade */ }
  return { id: l.id, nome: l.nome, cidade: l.cidade, uf: l.uf, tipo: l.tipo, endereco, horario };
}
export async function cartoesDeLojas(c, cidade) {
  const todas = await lojasDoSite(c);
  const q = semAcento(cidade);
  const doRamo = q ? todas.filter((l) => semAcento(l.cidade).includes(q) || q.includes(semAcento(l.cidade))) : todas;
  return Promise.all(doRamo.slice(0, 12).map((l) => lojaPublica(c, l)));
}
export function cidadesDoSite(lojas) {
  const m = new Map();
  for (const l of lojas) { const k = `${l.cidade}|${l.uf}`; m.set(k, { cidade: l.cidade, uf: l.uf, lojas: (m.get(k)?.lojas || 0) + 1 }); }
  return [...m.values()];
}

// ---------- sessão ----------
export function tokenDaRequisicao(req) {
  const h = String(req.get('authorization') || '');
  const t = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  return /^[A-Za-z0-9_-]{40,60}$/.test(t) ? t : null;
}

export async function obterSessao(req) {
  const token = tokenDaRequisicao(req);
  if (!token) return null;
  return comoSistema(async (c) => {
    const s = (await c.query('SELECT * FROM site_sessoes WHERE token_hash = $1 AND expira_em > now()', [sha(token)])).rows[0] || null;
    if (s && Date.now() - new Date(s.ultimo_uso) > 5 * 60_000) {
      await c.query(`UPDATE site_sessoes SET ultimo_uso = now(), expira_em = now() + make_interval(days => $2) WHERE id = $1`, [s.id, config.site.diasSessao]);
    }
    return s;
  });
}

async function mensagemDeBoasVindas(c) {
  const loja = await lojaPadrao(c);
  const a = loja ? (await c.query('SELECT nome, ativo FROM assistentes WHERE loja_id = $1', [loja.id])).rows[0] : null;
  const nome = a?.nome && a.nome !== 'Assistente LocarX' ? a.nome : 'Lia';
  const cidades = cidadesDoSite(await lojasDoSite(c));
  return { texto: `Oi! Eu sou a ${nome}, assistente virtual da LocarX 🚗\nEm qual cidade você quer retirar o carro?`, ui: [{ tipo: 'cidades', cidades }] };
}

export async function criarSessao({ ip, origem, navegador }) {
  const token = crypto.randomBytes(32).toString('base64url');
  return comoSistema(async (c) => {
    const recentes = (await c.query(`SELECT count(*)::int AS n FROM site_sessoes WHERE ip = $1 AND criada_em > now() - interval '1 hour'`, [ip])).rows[0].n;
    if (recentes >= 40) throw erro(429, 'Muitas conversas iniciadas deste endereço. Tente novamente mais tarde.');
    const lojas = await lojasDoSite(c);
    if (!lojas.length) throw erro(503, 'O chat está indisponível no momento.');
    const s = (await c.query(
      `INSERT INTO site_sessoes (token_hash, ip, origem, navegador, expira_em) VALUES ($1, $2, $3, $4, now() + make_interval(days => $5)) RETURNING id`,
      [sha(token), ip, String(origem || '').slice(0, 200), String(navegador || '').slice(0, 300), config.site.diasSessao])).rows[0];
    const b = await mensagemDeBoasVindas(c);
    await c.query(`INSERT INTO site_mensagens (sessao_id, papel, texto, ui) VALUES ($1, 'assistente', $2, $3)`, [s.id, b.texto, JSON.stringify(b.ui)]);
    return token;
  });
}

// ---------- o que o widget pode ver ----------
const PLACAR = { imagem: '📎 Imagem enviada pela equipe (veja também no seu WhatsApp)', documento: '📎 Documento enviado pela equipe (veja no seu WhatsApp)', audio: '🎤 Áudio enviado pela equipe (veja no seu WhatsApp)', video: '📎 Vídeo enviado pela equipe (veja no seu WhatsApp)', outro: '📎 Mensagem da equipe (veja no seu WhatsApp)' };
const MICROS = `(extract(epoch from %s) * 1000000)::bigint`;

export async function estadoPublico(c, s) {
  const loja = s.loja_id ? (await c.query('SELECT id, nome, cidade, uf FROM lojas WHERE id = $1', [s.loja_id])).rows[0] : null;
  let conversa = null;
  if (s.conversa_id) conversa = (await c.query(`SELECT cv.estado, cv.ultima_do_cliente, cv.bot_respondeu_em, u.nome AS atendente FROM conversas cv LEFT JOIN usuarios u ON u.id = cv.atendente_id WHERE cv.id = $1`, [s.conversa_id])).rows[0] || null;
  const verificada = !!s.conversa_id;
  const precisaConfirmar = verificada && (!s.confirmada_ate || new Date(s.confirmada_ate) < new Date());
  const digitando = verificada
    ? !!conversa && conversa.estado === 'assistente' && !!conversa.ultima_do_cliente && (!conversa.bot_respondeu_em || conversa.ultima_do_cliente > conversa.bot_respondeu_em)
    : !!s.pendente_desde && (!s.respondida_em || s.respondida_em < s.pendente_desde);
  return {
    verificada, precisaConfirmar,
    nome: primeiroNome(s.nome) || null,
    telefone: s.telefone ? telefoneMascarado(s.telefone) : null,
    loja: loja ? { id: loja.id, nome: loja.nome, cidade: loja.cidade, uf: loja.uf } : null,
    atendimento: conversa?.estado === 'humano' ? { atendente: primeiroNome(conversa.atendente) || 'Atendente' } : conversa?.estado === 'aguardando' ? { aguardando: true } : null,
    digitando,
  };
}

// o que o cliente vê no balão dele: os cliques em botões e componentes viram frases normais (a IA e a equipe leem o texto técnico)
export function amigavel(texto) {
  const t = String(texto || '');
  let m = t.match(/^\[Datas escolhidas: (.+?)\](?: \(data_retirada.*\))?$/);
  if (m) return `📅 ${m[1].replace(/;/g, ' ·').replace(/(\d{2}\/\d{2})\/\d{4}/g, '$1')}`;
  m = t.match(/^\[Escolhi o grupo (.+?) \(fleet_id \d+\)\]$/);
  if (m) return `Quero o ${m[1]}`;
  return t;
}

function publicaMensagem(m, { de, nome = null, mascara }) {
  return { id: m.id, de, nome, texto: mascara ? mascarar(amigavel(m.texto)) : (m.texto || ''), ui: m.ui || null, em: m.criada_em, cursor: String(m.cursor) };
}

// depois: cursor (microssegundos) da última mensagem que o widget já tem; sem cursor devolve o histórico recente
export async function listarMensagens(c, s, depois) {
  const num = Number(depois);
  const base = Number.isFinite(num) && num > 0 ? Math.floor(num - 3_000_000) : null;   // 3 s de folga; o widget descarta repetidas pelo id
  if (s.conversa_id) {
    const linhas = (await c.query(
      `SELECT * FROM (SELECT m.id, m.autor, m.tipo, m.texto, m.ui, m.criada_em, ${MICROS.replace('%s', 'm.criada_em')} AS cursor, u.nome AS autor_nome
          FROM mensagens m LEFT JOIN usuarios u ON u.id = m.autor_id
         WHERE m.conversa_id = $1 AND m.direcao <> 'interna' AND m.criada_em >= $2
           AND ($3::bigint IS NULL OR m.criada_em > to_timestamp($3::double precision / 1000000.0))
         ORDER BY m.criada_em DESC LIMIT 80) x ORDER BY criada_em`, [s.conversa_id, s.criada_em, base])).rows;
    return linhas.map((m) => publicaMensagem({ ...m, texto: m.tipo === 'texto' ? m.texto : (m.texto || PLACAR[m.tipo] || PLACAR.outro) },
      { de: m.autor === 'cliente' ? 'cliente' : m.autor === 'atendente' ? 'atendente' : 'assistente', nome: m.autor === 'atendente' ? primeiroNome(m.autor_nome) : null, mascara: m.autor === 'cliente' }));
  }
  const linhas = (await c.query(
    `SELECT * FROM (SELECT m.id, m.papel, m.texto, m.ui, m.criada_em, ${MICROS.replace('%s', 'm.criada_em')} AS cursor FROM site_mensagens m
       WHERE m.sessao_id = $1 AND ($2::bigint IS NULL OR m.criada_em > to_timestamp($2::double precision / 1000000.0))
       ORDER BY m.criada_em DESC LIMIT 80) x ORDER BY criada_em`, [s.id, base])).rows;
  return linhas.map((m) => publicaMensagem(m, { de: m.papel, mascara: m.papel === 'cliente' }));
}

export async function marcarPresenca(s) {
  await comoSistema((c) => c.query('UPDATE site_sessoes SET ultimo_poll = now() WHERE id = $1', [s.id]));
}

// ---------- mensagem do visitante ----------
const dataBr = (iso) => iso.split('-').reverse().join('/');
function textoDaAcao(acao, s, opcoesDaConversa) {
  if (!acao || typeof acao !== 'object') return null;
  if (acao.tipo === 'datas') {
    const r = acao.retirada || {}, d = acao.devolucao || {};
    const okData = (x) => /^\d{4}-\d{2}-\d{2}$/.test(x?.data || '') && /^([01]\d|2[0-3]):[0-5]\d$/.test(x?.hora || '') && !Number.isNaN(Date.parse(x.data));
    if (!okData(r) || !okData(d)) throw erro(422, 'Escolha as datas e os horários.');
    return `[Datas escolhidas: retirada ${dataBr(r.data)} às ${r.hora}; devolução ${dataBr(d.data)} às ${d.hora}] (data_retirada ${r.data} ${r.hora}; data_devolucao ${d.data} ${d.hora})`;
  }
  if (acao.tipo === 'carro') {
    const g = (opcoesDaConversa?.grupos || []).find((x) => String(x.fleet_id) === String(acao.fleetId));
    if (!g) throw erro(422, 'Essa opção não está mais disponível. Peça para ver as opções de novo.');
    return `[Escolhi o grupo ${g.letra} – ${String(g.grupo).replace(/^\s*[A-Z0-9]{1,3}\s*[-–.]\s*/i, '')} (fleet_id ${g.fleet_id})]`;
  }
  if (acao.tipo === 'mais_opcoes') return 'Quero ver mais opções de carros.';
  if (acao.tipo === 'atendente') return 'Quero falar com um atendente.';
  return null;
}

function limpar(t) { return String(t ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+\n/g, '\n').trim().slice(0, 1000); }

const timersSite = new Map();
export function agendarSite(sessaoId, ms = 1200) {
  clearTimeout(timersSite.get(sessaoId));
  timersSite.set(sessaoId, setTimeout(async () => {
    timersSite.delete(sessaoId);
    try { const { processarSite } = await import('./motor.js'); await processarSite(sessaoId); } catch (e) { console.error('[site] motor:', e.message); }
  }, ms));
}

export async function receberMensagem(s, { texto, acao }) {
  // (1) conversa já confirmada: segue pelo CRM e pelo motor normal
  if (s.conversa_id) {
    if (!s.confirmada_ate || new Date(s.confirmada_ate) < new Date()) throw erro(428, 'Para continuar, confirme seu número de WhatsApp.', { precisaConfirmar: 'sim' });
    const opcoes = (await comoSistema((c) => c.query('SELECT opcoes FROM conversas WHERE id = $1', [s.conversa_id]))).rows[0]?.opcoes;
    if (acao?.tipo === 'loja' || acao?.tipo === 'cidade') throw erro(422, 'Esta conversa já está ligada a uma loja. Para outra loja, inicie uma nova conversa.');
    const t = textoDaAcao(acao, s, opcoes) || limpar(texto);
    if (!t) throw erro(422, 'Escreva a mensagem.');
    const cv = (await comoSistema((c) => c.query('SELECT loja_id FROM conversas WHERE id = $1', [s.conversa_id]))).rows[0];
    if (!cv) throw erro(404, 'Conversa não encontrada.');
    await comoSistema((c) => c.query(`UPDATE site_sessoes SET confirmada_ate = now() + make_interval(hours => $2), ultimo_uso = now() WHERE id = $1`, [s.id, HORAS_CONFIRMACAO]));
    await registrarRecebida(cv.loja_id, { telefone: s.telefone, nome: s.nome, tipo: 'texto', texto: t, midia: null, externoId: null, deMim: false }, { canal: 'site' });
    return { ok: true };
  }

  // (2) antes da confirmação
  return comoSistema(async (c) => {
    const n = (await c.query(`SELECT count(*)::int AS n FROM site_mensagens WHERE sessao_id = $1 AND papel = 'cliente' AND criada_em > now() - interval '1 hour'`, [s.id])).rows[0].n;
    if (n >= MAX_MSG_CLIENTE_HORA) throw erro(429, 'Você enviou muitas mensagens em pouco tempo. Aguarde um pouco.');
    const inserir = (papel, t, ui = null) => c.query(`INSERT INTO site_mensagens (sessao_id, papel, texto, ui) VALUES ($1, $2, $3, $4)`, [s.id, papel, t, ui ? JSON.stringify(ui) : null]);

    // cidade e loja: sem IA (rápido, grátis e sem erro)
    if (acao?.tipo === 'cidade') {
      const cidade = limpar(acao.cidade).slice(0, 80);
      const lojas = await cartoesDeLojas(c, cidade);
      await inserir('cliente', `Quero retirar em ${cidade}.`);
      if (!lojas.length) {
        const cidades = cidadesDoSite(await lojasDoSite(c));
        await inserir('assistente', `Ainda não atendemos ${cidade} por este chat. ${cidades.length ? 'Estas são as cidades disponíveis:' : ''}`.trim(), cidades.length ? [{ tipo: 'cidades', cidades }] : null);
      } else {
        await inserir('assistente', lojas.length > 1 ? `Em ${lojas[0].cidade} temos ${lojas.length} lojas. Em qual você prefere retirar?` : `Em ${lojas[0].cidade} temos esta loja. Posso seguir com ela?`, [{ tipo: 'lojas', cidade, lojas }]);
      }
      await c.query(`UPDATE site_sessoes SET respondida_em = now(), pendente_desde = NULL, ultimo_uso = now() WHERE id = $1`, [s.id]);
      return { ok: true };
    }
    if (acao?.tipo === 'loja') {
      const l = (await lojasDoSite(c)).find((x) => x.id === acao.lojaId);
      if (!l) throw erro(422, 'Essa loja não está disponível no chat.');
      await c.query(`UPDATE site_sessoes SET loja_id = $2, opcoes = CASE WHEN loja_id IS DISTINCT FROM $2 THEN NULL ELSE opcoes END, cotacao = CASE WHEN loja_id IS DISTINCT FROM $2 THEN NULL ELSE cotacao END, respondida_em = now(), pendente_desde = NULL, ultimo_uso = now() WHERE id = $1`, [s.id, l.id]);
      await inserir('cliente', `Quero retirar na ${l.nome}.`);
      await inserir('assistente', `Ótimo, retirada na ${l.nome}! Quais as datas e horários de retirada e devolução?`, [{ tipo: 'datas' }]);
      return { ok: true };
    }

    const opcoes = s.opcoes;
    const t = textoDaAcao(acao, s, opcoes) || limpar(texto);
    if (!t) throw erro(422, 'Escreva a mensagem.');
    await inserir('cliente', t);
    await c.query(`UPDATE site_sessoes SET pendente_desde = now(), ultimo_uso = now() WHERE id = $1`, [s.id]);
    agendarSite(s.id);
    return { ok: true };
  });
}

// ---------- cadastro e código de confirmação ----------
async function verificarDesafio(token, ip) {
  if (!config.site.turnstileSecret) return true;
  if (!token) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: config.site.turnstileSecret, response: String(token).slice(0, 2100), remoteip: ip || '' }), signal: AbortSignal.timeout(8000),
    });
    return !!(await r.json()).success;
  } catch { return false; }
}

async function usoDoDia(c, tipo, somar = 0) {
  const r = (await c.query(
    `INSERT INTO site_uso (dia, tipo, total) VALUES ((now() AT TIME ZONE 'America/Bahia')::date, $1, $2)
     ON CONFLICT (dia, tipo) DO UPDATE SET total = site_uso.total + $2 RETURNING total`, [tipo, somar])).rows[0];
  return r.total;
}
export const registrarUsoIa = (c) => usoDoDia(c, 'ia', 1);
export async function iaDoDiaEsgotada(c) {
  const r = (await c.query(`SELECT total FROM site_uso WHERE dia = (now() AT TIME ZONE 'America/Bahia')::date AND tipo = 'ia'`)).rows[0];
  return (r?.total || 0) >= config.site.limiteIaDia;
}

export async function enviarCodigo(s, { nome, telefone, reenviar, desafio, ip }) {
  const r = await comoSistema(async (c) => (await c.query('SELECT * FROM site_sessoes WHERE id = $1', [s.id])).rows[0]);
  let tel, nomeFinal;
  // conversa já confirmada: o número é o verificado; nunca troca o telefone da sessão sem o código do número novo
  if (reenviar || r.conversa_id) {
    if (!r.telefone) throw erro(422, 'Informe seu nome e WhatsApp.');
    tel = r.telefone; nomeFinal = r.nome;
  } else {
    const campos = {};
    nomeFinal = limpar(nome).replace(/\s+/g, ' ').slice(0, 120);
    if (nomeFinal.length < 2 || !/\p{L}/u.test(nomeFinal)) campos.nome = 'Informe seu nome.';
    tel = telefoneBr(telefone);
    if (!tel) campos.telefone = 'Informe um WhatsApp válido, com DDD.';
    if (Object.keys(campos).length) throw erro(422, 'Confira os campos destacados.', campos);
  }
  if (!(await verificarDesafio(desafio, ip))) throw erro(403, 'Não foi possível validar que você não é um robô. Recarregue a página e tente de novo.');

  const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const info = await comoSistema(async (c) => {
    const agora = (await c.query('SELECT * FROM site_sessoes WHERE id = $1 FOR UPDATE', [s.id])).rows[0];
    if (!s.conversa_id) {
      const falou = (await c.query(`SELECT 1 FROM site_mensagens WHERE sessao_id = $1 AND papel = 'cliente' LIMIT 1`, [s.id])).rowCount;
      if (!falou) throw erro(409, 'Converse um pouco com a assistente antes de se cadastrar.');
    }
    if (agora.codigo_enviado_em && Date.now() - new Date(agora.codigo_enviado_em) < ESPERA_REENVIO_S * 1000) throw erro(429, `Aguarde ${ESPERA_REENVIO_S} segundos para pedir outro código.`);
    if (agora.codigos_enviados >= MAX_CODIGOS_SESSAO && !s.conversa_id) throw erro(429, 'Você já pediu vários códigos. Tente novamente mais tarde ou fale com a loja pelo WhatsApp.');
    const porTel = (await c.query(`SELECT coalesce(sum(codigos_enviados), 0)::int AS n FROM site_sessoes WHERE telefone = $1 AND codigo_enviado_em > now() - interval '1 hour'`, [tel])).rows[0].n;
    if (porTel >= MAX_CODIGOS_TELEFONE_HORA) throw erro(429, 'Já enviamos códigos para este número há pouco. Aguarde e tente de novo mais tarde.');
    const porIp = (await c.query(`SELECT coalesce(sum(codigos_enviados), 0)::int AS n FROM site_sessoes WHERE ip = $1 AND codigo_enviado_em > now() - interval '1 hour'`, [agora.ip])).rows[0].n;
    if (porIp >= MAX_CODIGOS_IP_HORA) throw erro(429, 'Muitos códigos solicitados deste endereço. Tente novamente mais tarde.');
    if ((await usoDoDia(c, 'codigo', 0)) >= config.site.limiteCodigosDia) throw erro(503, 'Não conseguimos enviar o código agora. Tente mais tarde ou fale com a loja pelo WhatsApp.');
    const loja = agora.loja_id ? { id: agora.loja_id } : await lojaPadrao(c);
    const canal = loja ? (await c.query('SELECT * FROM canais WHERE loja_id = $1', [loja.id])).rows[0] : null;
    if (!canal || canal.status !== 'conectado') throw erro(503, 'Não conseguimos enviar o código agora. Tente mais tarde.');
    await c.query(
      `UPDATE site_sessoes SET nome = $2, telefone = $3, loja_id = coalesce(loja_id, $4), codigo_hash = $5, codigo_expira = now() + make_interval(mins => $6), codigo_tentativas = 0,
              codigos_enviados = codigos_enviados + 1, codigo_enviado_em = now() WHERE id = $1`,
      [s.id, nomeFinal, tel, loja.id, sha(`${s.id}:${codigo}`), VALIDADE_CODIGO_MIN]);
    await usoDoDia(c, 'codigo', 1);
    return { canal };
  });
  try {
    await evolution.enviarTexto(info.canal.instancia, tel, `*${codigo}* é o seu código de confirmação LocarX. Ele vale por ${VALIDADE_CODIGO_MIN} minutos. Se não foi você, ignore esta mensagem — nunca compartilhe o código.`);
  } catch (e) {
    console.error('[site] envio do código:', e.message);
    throw erro(502, 'Não conseguimos enviar o código para esse número. Confira o WhatsApp (com DDD) e tente de novo.');
  }
  return { ok: true, telefone: telefoneMascarado(tel), expiraEmMin: VALIDADE_CODIGO_MIN, reenvioEmS: ESPERA_REENVIO_S };
}

export async function verificarCodigo(s, codigoDigitado) {
  const cod = String(codigoDigitado || '').replace(/\D/g, '');
  if (cod.length !== 6) throw erro(422, 'Digite os 6 dígitos do código.');
  const r = await comoSistema(async (c) => {
    const a = (await c.query('SELECT * FROM site_sessoes WHERE id = $1 FOR UPDATE', [s.id])).rows[0];
    if (!a.codigo_hash || !a.codigo_expira) throw erro(409, 'Peça um código novo.');
    if (new Date(a.codigo_expira) < new Date()) throw erro(410, 'O código venceu. Peça um novo.');
    if (a.codigo_tentativas >= MAX_TENTATIVAS) throw erro(429, 'Muitas tentativas. Peça um código novo.');
    if (!iguais(a.codigo_hash, sha(`${s.id}:${cod}`))) {
      // o erro só é lançado depois do commit: dentro da transação o contador de tentativas seria desfeito
      await c.query('UPDATE site_sessoes SET codigo_tentativas = codigo_tentativas + 1 WHERE id = $1', [s.id]);
      return { errado: true };
    }
    await c.query(`UPDATE site_sessoes SET codigo_hash = NULL, codigo_expira = NULL, codigo_tentativas = 0, verificada_em = coalesce(verificada_em, now()), confirmada_ate = now() + make_interval(hours => $2) WHERE id = $1`, [s.id, HORAS_CONFIRMACAO]);
    return a;
  });
  if (r.errado) throw erro(422, 'Código incorreto. Confira a mensagem no seu WhatsApp.', { codigo: 'Código incorreto.' });
  if (r.conversa_id) return { ok: true, reconfirmada: true };     // só estendeu a confirmação
  try { await transformarEmConversa(r); }
  catch (e) {
    // não perde o código: o visitante pode tentar de novo com o mesmo
    await comoSistema((c) => c.query(`UPDATE site_sessoes SET codigo_hash = $2, codigo_expira = $3, verificada_em = NULL WHERE id = $1`, [s.id, r.codigo_hash, r.codigo_expira]));
    throw e;
  }
  return { ok: true };
}

// Confirmado: cria (ou reaproveita) contato + conversa, importa o que foi dito até aqui e entrega ao motor normal.
async function transformarEmConversa(s) {
  const lojaId = s.loja_id;
  const reg = await registrarRecebida(lojaId, { telefone: s.telefone, nome: s.nome, tipo: 'texto', texto: 'Confirmei meu WhatsApp. Pode continuar!', midia: null, externoId: null, deMim: false }, { canal: 'site', semAgendar: true });
  if (!reg) throw erro(500, 'Não foi possível registrar a conversa. Tente de novo.');
  const estado = await comoSistema(async (c) => {
    const msgs = (await c.query('SELECT id, papel, texto, ui, criada_em FROM site_mensagens WHERE sessao_id = $1 ORDER BY criada_em', [s.id])).rows;
    for (const m of msgs) {
      await c.query(
        `INSERT INTO mensagens (id, conversa_id, loja_id, direcao, autor, tipo, texto, ui, criada_em) VALUES ($8, $1, $2, $3, $4, 'texto', $5, $6, $7)`,
        [reg.conversaId, lojaId, m.papel === 'cliente' ? 'entrada' : 'saida', m.papel === 'cliente' ? 'cliente' : 'assistente', m.texto, m.ui ? JSON.stringify(m.ui) : null, m.criada_em, m.id]);
    }
    await c.query(`INSERT INTO mensagens (conversa_id, loja_id, direcao, autor, tipo, texto) VALUES ($1, $2, 'interna', 'sistema', 'evento', 'Cliente veio pelo chat do site (WhatsApp confirmado por código)')`, [reg.conversaId, lojaId]);
    // o que a Lia já apurou (opções mostradas, cotação) segue para a conversa real
    await c.query(
      `UPDATE conversas SET site_sessao_id = $2, canal = 'site',
              opcoes = coalesce($3::jsonb, opcoes), cotacao = coalesce($4::jsonb, cotacao), atualizada_em = now() WHERE id = $1`,
      [reg.conversaId, s.id, s.opcoes, s.cotacao]);
    await c.query(`UPDATE site_sessoes SET contato_id = $2, conversa_id = $3 WHERE id = $1`, [s.id, reg.contatoId, reg.conversaId]);
    await c.query('DELETE FROM site_mensagens WHERE sessao_id = $1', [s.id]);
    if (s.cotacao?.total != null || s.opcoes?.grupos?.length) {
      await registrarEvento(c, { lojaId, contatoId: reg.contatoId, conversaId: reg.conversaId, evento: 'cotacao', valor: s.cotacao?.total ?? null });
    }
    return (await c.query('SELECT estado FROM conversas WHERE id = $1', [reg.conversaId])).rows[0]?.estado;
  });
  if (estado === 'assistente') agendar(reg.conversaId, 800);
}

// "Nova conversa": a sessão deixa de valer; a conversa que já está no CRM continua lá
export async function encerrarSessao(s) {
  await comoSistema((c) => c.query(`UPDATE site_sessoes SET expira_em = now(), codigo_hash = NULL WHERE id = $1`, [s.id]));
}

// limpeza: sessões vencidas (e, por cascata, as mensagens que nunca viraram conversa)
export function iniciarLimpezaSite() {
  setInterval(() => comoSistema(async (c) => {
    await c.query(`DELETE FROM site_sessoes WHERE expira_em < now() - interval '1 day'`);
    await c.query(`DELETE FROM site_uso WHERE dia < (now() AT TIME ZONE 'America/Bahia')::date - 60`);
  }).catch((e) => console.error('[site] limpeza:', e.message)), 6 * 3_600_000).unref();
  // respostas pendentes (servidor reiniciou durante a espera)
  setInterval(() => comoSistema(async (c) => {
    const p = (await c.query(`SELECT id FROM site_sessoes WHERE conversa_id IS NULL AND pendente_desde IS NOT NULL AND (respondida_em IS NULL OR respondida_em < pendente_desde)
                               AND pendente_desde < now() - interval '15 seconds' AND pendente_desde > now() - interval '10 minutes' LIMIT 30`)).rows;
    p.forEach((x) => { if (!timersSite.has(x.id)) agendarSite(x.id, 100); });
  }).catch((e) => console.error('[site] varredura:', e.message)), 20_000).unref();
}
