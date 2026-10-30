// Instagram das lojas (API oficial da Meta).
// - Loja (dono): situação, "Conectar Instagram" (gera o link de login da Meta), desconectar, ligar/desligar a Lia no Instagram.
// - Público: retorno do login (a Meta redireciona para cá) e webhook de mensagens (um só para todas as lojas).
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { comContexto, comoSistema, contextoDoUsuario } from '../banco/conexao.js';
import { rota, erro, validar, exigirPerfil, registrar } from '../http.js';
import * as ig from '../servicos/canais/instagram.js';
import { registrarRecebida } from './whatsapp.js';

export const instagramLoja = Router();      // /api/loja/instagram...
export const instagramPublico = Router();   // /api/instagram/retorno
export const webhookInstagram = Router();   // /api/webhooks/instagram
const ctx = (req) => contextoDoUsuario(req.usuario);
const dono = exigirPerfil('dono');

const exigirConfig = () => { if (!ig.instagramConfigurado()) throw erro(503, 'A integração com o Instagram ainda não está configurada no servidor (INSTAGRAM_APP_ID/SECRET).'); };
const publico = (r) => (r ? {
  conectado: r.status === 'conectado', status: r.status, usuario: r.ig_username || null, pagina: r.pagina_nome || null,
  assistente: !!r.assistente, erro: r.erro || null, conectadoEm: r.conectado_em, atualizadoEm: r.atualizado_em,
} : { conectado: false, status: 'desconectado', usuario: null, pagina: null, assistente: true, erro: null });

// origem do pedido (produção ou teste) para montar a URL de retorno certa
const origemDe = (req) => {
  const o = String(req.get('origin') || '').replace(/\/+$/, '');
  const permitidas = [config.appUrl, ...(config.origensPermitidas || [])].filter(Boolean);
  return permitidas.includes(o) ? o : config.appUrl;
};

// ---------- loja ----------
instagramLoja.get('/instagram', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  const r = await comContexto(ctx(req), async (c) => (await c.query('SELECT * FROM canais_instagram WHERE loja_id = $1', [req.usuario.loja_id])).rows[0]);
  res.json({ configurado: ig.instagramConfigurado(), ...publico(r) });
}));

instagramLoja.post('/instagram/conectar', dono, rota(async (req, res) => {
  exigirConfig();
  const origem = origemDe(req);
  const state = ig.gerarState({ lojaId: req.usuario.loja_id, usuarioId: req.usuario.id, origem });
  await comContexto(ctx(req), (c) => registrar(c, req, 'instagram_conectar_inicio', { lojaId: req.usuario.loja_id }));
  res.json({ url: ig.urlDeLogin({ state, origem }) });
}));

instagramLoja.post('/instagram/desconectar', dono, rota(async (req, res) => {
  await comContexto(ctx(req), async (c) => {
    await c.query('DELETE FROM canais_instagram WHERE loja_id = $1', [req.usuario.loja_id]);
    await registrar(c, req, 'instagram_desconectar', { lojaId: req.usuario.loja_id });
  });
  res.json({ ok: true });
}));

instagramLoja.put('/instagram/assistente', dono, rota(async (req, res) => {
  const d = validar(z.object({ ativo: z.boolean() }), req.body);
  const n = await comContexto(ctx(req), async (c) => {
    const r = await c.query('UPDATE canais_instagram SET assistente = $2, atualizado_em = now() WHERE loja_id = $1', [req.usuario.loja_id, d.ativo]);
    if (r.rowCount) await registrar(c, req, d.ativo ? 'instagram_assistente_ligou' : 'instagram_assistente_desligou', { lojaId: req.usuario.loja_id });
    return r.rowCount;
  });
  if (!n) throw erro(404, 'Instagram não conectado.');
  res.json({ ok: true, ativo: d.ativo });
}));

// ---------- retorno do login da Meta (público; sem cookies: a loja vem no state assinado) ----------
instagramPublico.get('/retorno', rota(async (req, res) => {
  const voltar = (origem, q) => { console.log(`[instagram] retorno: ${q.instagram}${q.motivo ? ' — ' + q.motivo : ''}${q.usuario ? ' @' + q.usuario : ''}`); return res.redirect(`${origem || config.appUrl}/#/whatsapp?${new URLSearchParams(q)}`); };
  if (!ig.instagramConfigurado()) return voltar(null, { instagram: 'erro', motivo: 'Integração não configurada no servidor.' });
  const st = ig.lerState(req.query.state);
  if (!st) { console.warn('[instagram] retorno com state inválido/vencido (o login precisa começar pelo botão Conectar Instagram do Conecta)'); return voltar(null, { instagram: 'erro', motivo: 'Pedido de conexão inválido ou vencido. Comece pelo botão "Conectar Instagram" dentro do Conecta.' }); }
  if (req.query.error) return voltar(st.origem, { instagram: 'erro', motivo: String(req.query.error_description || req.query.error_reason || 'A autorização foi cancelada.').slice(0, 200) });
  if (!req.query.code) return voltar(st.origem, { instagram: 'erro', motivo: 'A Meta não devolveu o código de autorização.' });
  let troca;
  try { troca = await ig.trocarCodigo({ code: String(req.query.code), origem: st.origem }); }
  catch (e) { console.error('[instagram] troca de código:', e.message); return voltar(st.origem, { instagram: 'erro', motivo: ig.explicarErro(e) }); }
  console.log(`[instagram] autorização recebida: ${troca.paginas.length} página(s) com Instagram`);
  if (!troca.paginas.length) return voltar(st.origem, { instagram: 'erro', motivo: 'Nenhuma conta profissional do Instagram vinculada a uma Página do Facebook foi encontrada nesta autorização. Confira no Instagram: Configurações → Conta → Mudar para conta profissional, e vincule a Página.' });
  // com mais de uma Página/conta, usa a primeira (o dono pode desconectar e autorizar só a certa)
  const p = troca.paginas[0];
  try { await ig.assinarPagina({ paginaId: p.paginaId, tokenPagina: p.tokenPagina }); }
  catch (e) { console.error('[instagram] assinar página:', e.message); return voltar(st.origem, { instagram: 'erro', motivo: `Não foi possível ativar as mensagens da Página: ${ig.explicarErro(e)}` }); }
  try {
    await comoSistema(async (c) => {
      const outra = (await c.query('SELECT loja_id FROM canais_instagram WHERE ig_user_id = $1 AND loja_id <> $2', [p.igUserId, st.lojaId])).rows[0];
      if (outra) throw erro(409, 'Esta conta do Instagram já está conectada em outra loja.');
      await c.query(
        `INSERT INTO canais_instagram (loja_id, ig_user_id, ig_username, pagina_id, pagina_nome, token_cifrado, status, erro, conectado_por, conectado_em, atualizado_em)
         VALUES ($1, $2, $3, $4, $5, $6, 'conectado', NULL, $7, now(), now())
         ON CONFLICT (loja_id) DO UPDATE SET ig_user_id = EXCLUDED.ig_user_id, ig_username = EXCLUDED.ig_username, pagina_id = EXCLUDED.pagina_id, pagina_nome = EXCLUDED.pagina_nome,
           token_cifrado = EXCLUDED.token_cifrado, status = 'conectado', erro = NULL, conectado_por = EXCLUDED.conectado_por, conectado_em = now(), atualizado_em = now()`,
        [st.lojaId, p.igUserId, p.igUsername, p.paginaId, p.paginaNome, ig.guardarToken(p.tokenPagina), st.usuarioId]);
      await c.query(`INSERT INTO auditoria (usuario_id, loja_id, acao, detalhes) VALUES ($1, $2, 'instagram_conectado', $3)`, [st.usuarioId, st.lojaId, JSON.stringify({ usuario: p.igUsername, pagina: p.paginaNome })]).catch(() => {});
    });
  } catch (e) { return voltar(st.origem, { instagram: 'erro', motivo: e.message }); }
  voltar(st.origem, { instagram: 'ok', usuario: p.igUsername || '' });
}));

// ---------- webhook (público; verificação por token e assinatura HMAC do corpo) ----------
webhookInstagram.get('/', (req, res) => {
  const vt = config.instagram?.verifyToken;
  if (vt && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === vt) return res.status(200).send(String(req.query['hub.challenge'] || ''));
  res.status(403).end();
});

webhookInstagram.post('/', rota(async (req, res) => {
  if (!ig.instagramConfigurado()) return res.status(404).end();
  const bruto = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
  if (!ig.verificarAssinatura(bruto, req.get('x-hub-signature-256'))) return res.status(401).end();
  res.status(200).send('EVENT_RECEIVED');   // responde rápido; processa em seguida
  let corpo; try { corpo = JSON.parse(bruto.toString('utf8')); } catch { return; }
  if (corpo.object !== 'instagram') return;
  for (const entrada of corpo.entry || []) {
    const igUserId = String(entrada.id || '');
    for (const ev of entrada.messaging || []) {
      try { await tratarEvento(igUserId, ev); } catch (e) { console.error('[instagram] evento:', e.message); }
    }
  }
}));

async function tratarEvento(igUserId, ev) {
  const m = ig.lerMensagem(ev);
  if (!m) return;
  const canal = await comoSistema(async (c) => (await c.query(`SELECT ci.*, l.ativa FROM canais_instagram ci JOIN lojas l ON l.id = ci.loja_id WHERE ci.ig_user_id = $1`, [igUserId])).rows[0]);
  if (!canal || !canal.ativa || canal.status !== 'conectado') return;
  // nome do perfil (só na primeira mensagem do contato)
  const existe = await comoSistema(async (c) => (await c.query('SELECT 1 FROM contatos WHERE loja_id = $1 AND ig_id = $2', [canal.loja_id, m.igId])).rowCount);
  if (!existe) {
    const perfil = await ig.perfilDoCliente(canal, m.igId);
    m.nome = perfil?.name || (perfil?.username ? `@${perfil.username}` : null);
    m.igUsername = perfil?.username || null;
  }
  await registrarRecebida(canal.loja_id, m, { canal: 'instagram' });
}
