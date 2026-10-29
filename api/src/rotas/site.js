// Rotas PÚBLICAS do chat do site (sem login do Conecta, sem cookies). O visitante usa um token de sessão no cabeçalho Authorization.
// Proteções: CORS só para os sites autorizados, limite de uso por IP e por rota, token aleatório (só o hash fica no banco),
// código de 6 dígitos com limite de tentativas, máscara de CPF/e-mail ao reabrir, chave de teste opcional.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { rota, erro, validar, ipDe, navegadorDe, zUuid } from '../http.js';
import { iguais } from '../servicos/seguranca.js';
import { comoSistema, comContexto, contextoDoUsuario } from '../banco/conexao.js';
import { exigirPerfil, registrar } from '../http.js';
import * as chat from '../servicos/site/chat.js';
import { fotoDoGrupo } from '../servicos/locarx/api-locarx.js';

export const site = Router();
export const siteAdmin = Router();

// ---------- CORS próprio (não usa cookies; só os sites autorizados) ----------
const origensDoSite = () => [...new Set([...(config.site?.origens || []), ...config.origensPermitidas])];
export function corsDoSite(req, res, next) {
  const origem = req.get('origin');
  if (origem && origensDoSite().includes(origem)) {
    res.set('Access-Control-Allow-Origin', origem);
    res.set('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'GET,POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Site-Chave');
      res.set('Access-Control-Max-Age', '600');
      return res.sendStatus(204);
    }
  } else if (req.method === 'OPTIONS') return res.sendStatus(403);
  next();
}

// o chat só existe se SITE_ORIGENS estiver configurado e a chamada vier de um site autorizado (navegador)
site.use((req, res, next) => {
  if (!config.site) return next(erro(404, 'Endereço não encontrado.'));
  if (req.method !== 'GET' || req.path === '/sessao') {
    const origem = req.get('origin');
    if (!origem || !origensDoSite().includes(origem)) return next(erro(403, 'Origem da requisição não permitida.'));
  }
  next();
});

const limite = (windowMs, max, mensagem) => rateLimit({ windowMs, limit: max, standardHeaders: 'draft-7', legacyHeaders: false, message: { mensagem }, keyGenerator: (req) => req.ip });
const limiteSessao = limite(3_600_000, 25, 'Muitas conversas iniciadas deste endereço. Tente novamente mais tarde.');
const limiteMensagem = limite(60_000, 30, 'Você está enviando mensagens rápido demais. Aguarde um instante.');
const limiteLeitura = limite(60_000, 150, 'Muitas consultas. Aguarde um instante.');
const limiteCodigo = limite(3_600_000, 10, 'Muitos códigos solicitados deste endereço. Tente novamente mais tarde.');
const limiteVerificar = limite(3_600_000, 30, 'Muitas tentativas. Tente novamente mais tarde.');

// foto do carro: o navegador pede por aqui (fleetId) e o servidor busca no portal LocarX, para o site não depender de domínio
// de imagem de terceiros (política de segurança da página) e para o endereço do portal não aparecer. O visitante só informa
// um número; o endereço da imagem vem sempre da API LocarX.
const limiteFoto = limite(60_000, 120, 'Muitas imagens pedidas. Aguarde um instante.');
const fotosEmCache = new Map();    // fleetId → { corpo, tipo, em }
const TIPOS_FOTO = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);
site.get('/foto/:fleetId', limiteFoto, async (req, res, next) => {
  try {
    const id = String(req.params.fleetId);
    if (!/^\d{1,9}$/.test(id)) return next(erro(404, 'Imagem não encontrada.'));
    let f = fotosEmCache.get(id);
    if (!f || Date.now() - f.em > 6 * 3_600_000) {
      const url = await fotoDoGrupo(id);
      if (!url) return next(erro(404, 'Imagem não encontrada.'));
      const r = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'follow', headers: { Accept: 'image/*' } });
      const tipo = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!r.ok || !TIPOS_FOTO.has(tipo)) return next(erro(404, 'Imagem não encontrada.'));
      const corpo = Buffer.from(await r.arrayBuffer());
      if (!corpo.length || corpo.length > 3_000_000) return next(erro(404, 'Imagem não encontrada.'));
      f = { corpo, tipo, em: Date.now() };
      if (fotosEmCache.size >= 80) fotosEmCache.delete(fotosEmCache.keys().next().value);
      fotosEmCache.set(id, f);
    }
    res.set({ 'Content-Type': f.tipo, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Content-Security-Policy': "default-src 'none'" });
    res.send(f.corpo);
  } catch (e) { next(e.name === 'TimeoutError' || e.name === 'TypeError' ? erro(404, 'Imagem não encontrada.') : e); }
});

// chave de teste: com SITE_CHAVE_TESTE definida, só quem a conhece abre uma sessão (ambiente de teste, protótipo "só meu")
function exigirChave(req, res, next) {
  const chave = process.env.SITE_CHAVE_TESTE?.trim();
  if (!chave) return next();
  if (!iguais(String(req.get('x-site-chave') || ''), chave)) return next(erro(403, 'Chat em teste: acesso restrito.'));
  next();
}

async function exigirSessao(req, res, next) {
  try {
    const s = await chat.obterSessao(req);
    if (!s) return next(erro(401, 'Sua conversa expirou. Comece uma nova.'));
    req.sessaoSite = s;
    next();
  } catch (e) { next(e); }
}

// abre (ou retoma) a sessão. Com token válido devolve o estado e o histórico; sem token (ou vencido) cria outra.
site.post('/sessao', limiteSessao, exigirChave, rota(async (req, res) => {
  let s = await chat.obterSessao(req);
  let token = null;
  if (!s) {
    token = await chat.criarSessao({ ip: ipDe(req), origem: req.get('origin'), navegador: navegadorDe(req) });
    s = await comoSistema(async (c) => (await c.query('SELECT * FROM site_sessoes WHERE token_hash = $1', [(await import('node:crypto')).createHash('sha256').update(token).digest('hex')])).rows[0]);
  }
  await chat.marcarPresenca(s);
  const dados = await comoSistema(async (c) => ({ estado: await chat.estadoPublico(c, s), mensagens: await chat.listarMensagens(c, s, null) }));
  res.json({ ...(token ? { token } : {}), novo: !!token, turnstile: config.site.turnstileSecret ? config.site.turnstileChave : null, ...dados });
}));

// novas mensagens desde o cursor + estado (o widget consulta a cada 2–3 s enquanto está aberto)
site.get('/mensagens', limiteLeitura, exigirSessao, rota(async (req, res) => {
  const s = req.sessaoSite;
  await chat.marcarPresenca(s);
  const dados = await comoSistema(async (c) => {
    const atual = (await c.query('SELECT * FROM site_sessoes WHERE id = $1', [s.id])).rows[0];
    return { estado: await chat.estadoPublico(c, atual), mensagens: await chat.listarMensagens(c, atual, req.query.depois) };
  });
  res.json(dados);
}));

const zMensagem = z.object({
  texto: z.string().max(2000).optional(),
  acao: z.object({
    tipo: z.enum(['cidade', 'loja', 'datas', 'carro', 'mais_opcoes', 'atendente']),
    cidade: z.string().max(80).optional(), lojaId: z.union([z.string().uuid(), z.string().regex(/^b\d{1,9}$/)]).optional(), fleetId: z.union([z.number(), z.string().max(20)]).optional(),
    retirada: z.object({ data: z.string().max(10), hora: z.string().max(5) }).optional(), devolucao: z.object({ data: z.string().max(10), hora: z.string().max(5) }).optional(),
  }).optional(),
});
site.post('/mensagem', limiteMensagem, exigirSessao, rota(async (req, res) => {
  const d = validar(zMensagem, req.body);
  res.status(202).json(await chat.receberMensagem(req.sessaoSite, d));
}));

const zCadastro = z.object({
  nome: z.string().max(120).optional(), telefone: z.string().max(30).optional(), reenviar: z.boolean().optional(), desafio: z.string().max(2100).optional(),
});
site.post('/cadastro', limiteCodigo, exigirSessao, rota(async (req, res) => {
  const d = validar(zCadastro, req.body);
  res.json(await chat.enviarCodigo(req.sessaoSite, { ...d, ip: ipDe(req) }));
}));

site.post('/verificar', limiteVerificar, exigirSessao, rota(async (req, res) => {
  const d = validar(z.object({ codigo: z.string().max(12) }), req.body);
  res.json(await chat.verificarCodigo(req.sessaoSite, d.codigo));
}));

site.post('/encerrar', limiteLeitura, exigirSessao, rota(async (req, res) => {
  await chat.encerrarSessao(req.sessaoSite);
  res.status(204).end();
}));

// ---------- administração: quais lojas atendem pelo chat do site ----------
siteAdmin.get('/site-chat', exigirPerfil('admin', 'matriz'), rota(async (req, res) => {
  const r = await comContexto(contextoDoUsuario(req.usuario), async (c) => (await c.query('SELECT id, nome, cidade, uf, tipo, site_chat, central FROM lojas ORDER BY cidade, nome')).rows);
  // números dos últimos 30 dias por loja (as tabelas do chat só abrem para o sistema; a lista de lojas acima já respeita quem pediu)
  const ids = r.map((l) => l.id);
  // se a contagem falhar (ex.: tabela ainda não migrada), a tela continua funcionando com zeros
  const uso = new Map(await comoSistema(async (c) => (await c.query(
    `SELECT l.id,
            (SELECT count(*)::int FROM site_sessoes s WHERE s.loja_id = l.id AND s.criada_em > now() - interval '30 days') AS conversas,
            (SELECT count(*)::int FROM site_sessoes s WHERE s.loja_id = l.id AND s.verificada_em IS NOT NULL AND s.criada_em > now() - interval '30 days') AS confirmaram,
            (SELECT count(*)::int FROM reservas rv JOIN conversas cv ON cv.id = rv.conversa_id WHERE rv.loja_id = l.id AND cv.canal = 'site' AND rv.criada_em > now() - interval '30 days') AS reservas
       FROM lojas l WHERE l.id = ANY($1::uuid[])`, [ids])).rows).catch((e) => { console.error('[site-chat] contagem:', e.message); return []; }).then((rows) => rows.map((x) => [x.id, x])));
  res.json({ ligado: !!config.site, protegido: !!process.env.SITE_CHAVE_TESTE?.trim(),
    lojas: r.map((l) => ({ id: l.id, nome: l.nome, cidade: l.cidade, uf: l.uf, tipo: l.tipo, ativo: !!l.site_chat, central: !!l.central, ultimos30dias: { conversas: uso.get(l.id)?.conversas || 0, confirmaram: uso.get(l.id)?.confirmaram || 0, reservas: uso.get(l.id)?.reservas || 0 } })) });
}));
siteAdmin.put('/lojas/:id/site-chat', exigirPerfil('admin'), rota(async (req, res) => {
  if (!zUuid.safeParse(req.params.id).success) throw erro(404, 'Loja não encontrada.');
  const { ativo } = validar(z.object({ ativo: z.boolean() }), req.body);
  const n = await comContexto(contextoDoUsuario(req.usuario), async (c) => (await c.query('UPDATE lojas SET site_chat = $2 WHERE id = $1', [req.params.id, ativo])).rowCount);
  if (!n) throw erro(404, 'Loja não encontrada.');
  res.json({ ok: true, ativo });
}));

// Central de Reservas: a loja marcada reserva em QUALQUER filial da rede LocarX (as demais lojas só são avisadas das reservas feitas para elas).
siteAdmin.put('/lojas/:id/central', exigirPerfil('admin'), rota(async (req, res) => {
  if (!zUuid.safeParse(req.params.id).success) throw erro(404, 'Loja não encontrada.');
  const { central } = validar(z.object({ central: z.boolean() }), req.body);
  const n = await comContexto(contextoDoUsuario(req.usuario), async (c) => {
    if (!central) {
      const l = (await c.query('SELECT branch_id FROM lojas WHERE id = $1', [req.params.id])).rows[0];
      if (l && l.branch_id == null) throw erro(422, 'Esta loja não tem filial própria. Edite a loja e informe a filial do portal antes de desligar a Central.');
    }
    const k = (await c.query('UPDATE lojas SET central = $2 WHERE id = $1', [req.params.id, central])).rowCount;
    if (k) await registrar(c, req, central ? 'ligou_central' : 'desligou_central', { alvo: req.params.id, lojaId: req.params.id });
    return k;
  });
  if (!n) throw erro(404, 'Loja não encontrada.');
  res.json({ ok: true, central });
}));
