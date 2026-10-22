// Peças comuns das rotas: erros, sessão por cookie, CSRF, origem, perfis e formatos de resposta.
import { z } from 'zod';
import { config } from './config.js';
import { comoSistema } from './banco/conexao.js';
import { hashToken, iguais } from './servicos/seguranca.js';

export class ErroApp extends Error {
  constructor(status, mensagem, campos) { super(mensagem); this.status = status; this.campos = campos; }
}
export const erro = (status, mensagem, campos) => new ErroApp(status, mensagem, campos);

// Envolve rotas async para os erros caírem no tratador central
export const rota = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- validação ----------
export function validar(esquema, dados) {
  const r = esquema.safeParse(dados ?? {});
  if (r.success) return r.data;
  const campos = {};
  for (const p of r.error.issues) campos[p.path[0] ?? 'geral'] ||= p.message;
  throw erro(422, 'Confira os campos destacados.', campos);
}
export const zEmail = z.string({ required_error: 'Informe o e-mail.' }).trim().toLowerCase().max(254).email('Informe um e-mail válido.');
export const zNome = z.string({ required_error: 'Informe o nome.' }).trim().min(2, 'Informe o nome completo.').max(120, 'Nome muito longo.');
export const zUuid = z.string().uuid();

// ---------- cookies ----------
const prefixo = config.cookieSeguro ? '__Host-' : '';
export const COOKIE_SESSAO = `${prefixo}conecta`;
export const COOKIE_VERIFICACAO = `${prefixo}conecta-verificacao`;
export function opcoesCookie(maxAgeMs) {
  return { httpOnly: true, secure: config.cookieSeguro, sameSite: 'strict', path: '/', maxAge: maxAgeMs };
}

export const ipDe = (req) => req.ip || null;
export const navegadorDe = (req) => String(req.get('user-agent') || '').slice(0, 300);

// ---------- origem (bloqueia formulários e scripts de outros sites) ----------
export function verificarOrigem(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origem = req.get('origin');
  if (!origem || !config.origensPermitidas.includes(origem)) return next(erro(403, 'Origem da requisição não permitida.'));
  next();
}

// CORS: só os endereços oficiais do Conecta
export function cors(req, res, next) {
  const origem = req.get('origin');
  if (origem && config.origensPermitidas.includes(origem)) {
    res.set('Access-Control-Allow-Origin', origem);
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE');
      res.set('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
      res.set('Access-Control-Max-Age', '600');
      return res.sendStatus(204);
    }
  } else if (req.method === 'OPTIONS') {
    return res.sendStatus(403);
  }
  next();
}

// ---------- sessão ----------
export async function carregarSessao(req, res, next) {
  const token = req.cookies?.[COOKIE_SESSAO];
  if (!token || token.length > 100) return next();
  try {
    const achado = await comoSistema(async (c) => {
      const { rows } = await c.query(
        `SELECT s.id AS sessao_id, s.csrf, s.ultimo_uso, u.*, l.nome AS loja_nome, l.cidade AS loja_cidade, l.uf AS loja_uf, l.ativa AS loja_ativa
           FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id LEFT JOIN lojas l ON l.id = u.loja_id
          WHERE s.token_hash = $1 AND s.tipo = 'sessao' AND s.expira_em > now()
            AND s.ultimo_uso > now() - make_interval(hours => $2)`,
        [hashToken(token), config.sessaoInatividadeHoras],
      );
      const r = rows[0];
      if (!r) return null;
      if (r.status !== 'ativo' || (r.loja_id && !r.loja_ativa)) {
        await c.query('DELETE FROM sessoes WHERE id = $1', [r.sessao_id]);
        return null;
      }
      // "visto agora": a roleta só entrega conversas para quem está com o Conecta aberto
      if (['dono', 'atendente'].includes(r.perfil) && (!r.visto_em || Date.now() - new Date(r.visto_em) > 60_000)) {
        await c.query('UPDATE usuarios SET visto_em = now() WHERE id = $1', [r.id]);
      }
      if (Date.now() - new Date(r.ultimo_uso) > 5 * 60_000) {
        await c.query('UPDATE sessoes SET ultimo_uso = now() WHERE id = $1', [r.sessao_id]);
      }
      return r;
    });
    if (achado) {
      req.usuario = achado;
      req.sessao = { id: achado.sessao_id, csrf: achado.csrf };
    } else {
      res.clearCookie(COOKIE_SESSAO, opcoesCookie());
    }
    next();
  } catch (e) { next(e); }
}

export function exigirLogin(req, res, next) {
  if (!req.usuario) return next(erro(401, 'Sua sessão terminou. Entre novamente.'));
  next();
}

export function exigirCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const enviado = req.get('x-csrf-token');
  if (!req.sessao || !enviado || !iguais(enviado, req.sessao.csrf)) return next(erro(403, 'Sua página ficou desatualizada. Recarregue (F5) e tente de novo.'));
  next();
}

export const exigirPerfil = (...perfis) => (req, res, next) => {
  if (!perfis.includes(req.usuario?.perfil)) return next(erro(403, 'Você não tem acesso a esta área.'));
  next();
};

// ---------- formatos de resposta ----------
export function usuarioPublico(u) {
  return {
    id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, lojaId: u.loja_id, status: u.status,
    doisFatores: !!u.totp_ativo, ultimoAcesso: u.ultimo_acesso,
    ...(u.loja_id ? { disponivel: !!u.disponivel, naRoleta: u.na_roleta !== false } : {}),
    ...(u.loja_nome !== undefined ? { loja: u.loja_id ? { id: u.loja_id, nome: u.loja_nome, cidade: u.loja_cidade, uf: u.loja_uf } : null } : {}),
  };
}

export function lojaPublica(l) {
  return {
    id: l.id, nome: l.nome, cidade: l.cidade, uf: l.uf,
    filial: { branchId: l.branch_id, branchCode: l.branch_code, tipo: l.tipo },
    ativa: l.ativa, whatsapp: l.whatsapp, assistente: l.assistente, criadaEm: l.criada_em,
    ...(l.qtd_usuarios !== undefined ? { usuarios: Number(l.qtd_usuarios), dono: l.dono_nome || null } : {}),
  };
}

// ---------- auditoria ----------
export function registrar(cliente, req, acao, { alvo = null, lojaId = null, detalhes = null, usuarioId } = {}) {
  return cliente.query(
    'INSERT INTO auditoria (usuario_id, loja_id, acao, alvo, detalhes, ip) VALUES ($1, $2, $3, $4, $5, $6)',
    [usuarioId ?? req.usuario?.id ?? null, lojaId ?? req.usuario?.loja_id ?? null, acao, alvo, detalhes, ipDe(req)],
  );
}

// ---------- tratador central de erros ----------
// eslint-disable-next-line no-unused-vars
export function tratarErros(e, req, res, next) {
  if (e instanceof ErroApp) return res.status(e.status).json({ mensagem: e.message, ...(e.campos ? { campos: e.campos } : {}) });
  if (e.type === 'entity.too.large') return res.status(413).json({ mensagem: 'Dados grandes demais.' });
  if (e.type === 'entity.parse.failed') return res.status(400).json({ mensagem: 'Requisição inválida.' });
  if (e.code === '42501') return res.status(403).json({ mensagem: 'Você não tem permissão para isso.' });
  if (e.code === '23505') return res.status(409).json({ mensagem: 'Este registro já existe.' });
  if (e.code === '23503') return res.status(409).json({ mensagem: 'Este registro está ligado a outros dados e não pode ser removido.' });
  console.error('[erro]', req.method, req.path, e);
  res.status(500).json({ mensagem: 'Não foi possível concluir. Tente de novo em instantes.' });
}
