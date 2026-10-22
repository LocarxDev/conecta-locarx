// Etapa 2: conexão do WhatsApp da loja e recebimento das mensagens (webhook da Evolution).
import { Router } from 'express';
import { config } from '../config.js';
import { comContexto, comoSistema, contextoDoUsuario } from '../banco/conexao.js';
import { evolution, lerMensagemEvolution } from '../servicos/canais/evolution.js';
import { iguais } from '../servicos/seguranca.js';
import { rota, erro, exigirPerfil, registrar } from '../http.js';

export const canal = Router();
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

async function gravarStatus(lojaId, status, numero) {
  await comoSistema(async (c) => {
    await c.query(`UPDATE canais SET status = $2, numero = coalesce($3, numero), atualizado_em = now() WHERE loja_id = $1`, [lojaId, status, numero || null]);
    await c.query(`UPDATE lojas SET whatsapp = $2 WHERE id = $1`, [lojaId, status === 'conectado' ? 'conectado' : 'desconectado']);
  });
}

const publico = (cn) => ({ status: cn?.status || 'desconectado', numero: cn?.numero || null, provedor: cn?.provedor || 'evolution', atualizadoEm: cn?.atualizado_em || null });

// ---------- situação ----------
canal.get('/canal', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  const cn = await comContexto(ctx(req), (c) => lerCanal(c, req.usuario.loja_id));
  res.json({ ...publico(cn), configurado: !!config.evolution });
}));

// ---------- conectar: cria a instância (se preciso) e devolve o QR code ----------
canal.post('/canal/conectar', exigirPerfil('dono'), rota(async (req, res) => {
  exigirEvolution();
  const lojaId = req.usuario.loja_id;
  let cn = await comContexto(ctx(req), (c) => lerCanal(c, lojaId));
  if (!cn) {
    cn = await comContexto(ctx(req), async (c) => {
      const novo = (await c.query(
        `INSERT INTO canais (loja_id, provedor, instancia, status) VALUES ($1, 'evolution', $2, 'conectando') RETURNING *`,
        [lojaId, nomeInstancia(lojaId)])).rows[0];
      await registrar(c, req, 'whatsapp_conectar');
      return novo;
    });
  }
  const p = provedores[cn.provedor];
  try {
    await p.criar(cn.instancia);
    const r = await p.qr(cn.instancia);
    if (r.conectado) { await gravarStatus(lojaId, 'conectado'); return res.json({ status: 'conectado' }); }
    await gravarStatus(lojaId, 'conectando');
    res.json({ status: 'conectando', qr: r.qr, codigo: r.codigo });
  } catch (e) {
    console.error('[whatsapp] conectar:', e.message, JSON.stringify(e.resposta || '').slice(0, 300));
    throw erro(502, 'Não foi possível falar com o servidor do WhatsApp agora. Tente de novo em instantes.');
  }
}));

// ---------- QR atualizado / situação ao vivo (a tela consulta a cada poucos segundos) ----------
canal.get('/canal/qr', exigirPerfil('dono'), rota(async (req, res) => {
  exigirEvolution();
  const lojaId = req.usuario.loja_id;
  const cn = await comContexto(ctx(req), (c) => lerCanal(c, lojaId));
  if (!cn) throw erro(404, 'Clique em "Conectar WhatsApp" para começar.');
  if (cn.status === 'conectado') return res.json({ status: 'conectado', numero: cn.numero });
  try {
    const p = provedores[cn.provedor];
    const estado = await p.estado(cn.instancia);
    if (estado === 'conectado') { await gravarStatus(lojaId, 'conectado'); return res.json({ status: 'conectado' }); }
    const r = await p.qr(cn.instancia);
    if (r.conectado) { await gravarStatus(lojaId, 'conectado'); return res.json({ status: 'conectado' }); }
    res.json({ status: 'conectando', qr: r.qr, codigo: r.codigo });
  } catch (e) {
    console.error('[whatsapp] qr:', e.message);
    throw erro(502, 'Não foi possível buscar o QR code agora. Tente de novo em instantes.');
  }
}));

canal.post('/canal/desconectar', exigirPerfil('dono'), rota(async (req, res) => {
  exigirEvolution();
  const lojaId = req.usuario.loja_id;
  const cn = await comContexto(ctx(req), (c) => lerCanal(c, lojaId));
  if (cn) {
    await provedores[cn.provedor].desconectar(cn.instancia).catch((e) => console.error('[whatsapp] desconectar:', e.message));
    await gravarStatus(lojaId, 'desconectado');
    await comContexto(ctx(req), (c) => registrar(c, req, 'whatsapp_desconectar'));
  }
  res.json({ status: 'desconectado' });
}));

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
    if (evento === 'connection.update') {
      const s = corpo.data?.state;
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

async function registrarRecebida(lojaId, m) {
  await comoSistema(async (c) => {
    if (m.externoId) {
      const ja = (await c.query('SELECT 1 FROM mensagens WHERE loja_id = $1 AND externo_id = $2', [lojaId, m.externoId])).rowCount;
      if (ja) return; // repetida ou eco de mensagem enviada pelo próprio Conecta
    }
    const contato = (await c.query(
      `INSERT INTO contatos (loja_id, telefone, nome) VALUES ($1, $2, $3)
       ON CONFLICT (loja_id, telefone) DO UPDATE SET nome = coalesce(contatos.nome, EXCLUDED.nome)
       RETURNING id`, [lojaId, m.telefone, m.nome])).rows[0];
    const entrada = !m.deMim;
    const conversa = (await c.query(
      `INSERT INTO conversas (loja_id, contato_id, estado, nao_lidas, ultima_previa, ultima_mensagem_em, ultima_do_cliente)
       VALUES ($1, $2, 'aguardando', $3, $4, $5, $6)
       ON CONFLICT (loja_id, contato_id) DO UPDATE SET
         nao_lidas = conversas.nao_lidas + $3,
         estado = CASE WHEN $7 AND conversas.estado = 'encerrada' THEN 'aguardando' ELSE conversas.estado END,
         atendente_id = CASE WHEN $7 AND conversas.estado = 'encerrada' THEN NULL ELSE conversas.atendente_id END,
         ultima_previa = EXCLUDED.ultima_previa, ultima_mensagem_em = EXCLUDED.ultima_mensagem_em,
         ultima_do_cliente = coalesce(EXCLUDED.ultima_do_cliente, conversas.ultima_do_cliente),
         atualizada_em = now()
       RETURNING id`,
      [lojaId, contato.id, entrada ? 1 : 0, previaDe(m.tipo, m.texto), m.quando, entrada ? m.quando : null, entrada])).rows[0];
    await c.query(
      `INSERT INTO mensagens (conversa_id, loja_id, direcao, autor, tipo, texto, midia, externo_id, criada_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (loja_id, externo_id) WHERE externo_id IS NOT NULL DO NOTHING`,
      [conversa.id, lojaId, entrada ? 'entrada' : 'saida', entrada ? 'cliente' : 'atendente', m.tipo, m.texto, m.midia, m.externoId]);
  });
}
