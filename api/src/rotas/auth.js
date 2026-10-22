// Login, verificação em 2 etapas, sessão, sair, esqueci a senha e criar senha pelo link.
import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { comoSistema } from '../banco/conexao.js';
import { conferirSenha, hashSenha, problemasSenha, novoToken, hashToken, decifrar, codigo2faValido } from '../servicos/seguranca.js';
import { emailRedefinicao } from '../servicos/email.js';
import {
  rota, erro, validar, zEmail, COOKIE_SESSAO, COOKIE_VERIFICACAO, opcoesCookie, ipDe, navegadorDe,
  exigirLogin, exigirCsrf, usuarioPublico, registrar,
} from '../http.js';

export const auth = Router();

const MAX_FALHAS = 5;
const BLOQUEIO_MIN = 15;
const MENSAGEM_LOGIN = 'E-mail ou senha incorretos.';

const limiteLogin = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { mensagem: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.' } });
const limiteEmail = rateLimit({ windowMs: 60 * 60_000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false, message: { mensagem: 'Muitos pedidos. Aguarde uma hora e tente de novo.' } });

async function criarSessao(c, req, res, usuario) {
  const token = novoToken();
  const csrf = novoToken();
  await c.query(
    `INSERT INTO sessoes (usuario_id, token_hash, tipo, csrf, expira_em, ip, navegador)
     VALUES ($1, $2, 'sessao', $3, now() + make_interval(days => $4), $5, $6)`,
    [usuario.id, hashToken(token), csrf, config.sessaoMaximaDias, ipDe(req), navegadorDe(req)],
  );
  await c.query('UPDATE usuarios SET ultimo_acesso = now(), falhas_login = 0, bloqueado_ate = NULL WHERE id = $1', [usuario.id]);
  // limpeza: sessões vencidas deste usuário
  await c.query('DELETE FROM sessoes WHERE usuario_id = $1 AND expira_em < now()', [usuario.id]);
  res.cookie(COOKIE_SESSAO, token, opcoesCookie(config.sessaoMaximaDias * 86_400_000));
  return csrf;
}

async function usuarioComLoja(c, id) {
  const { rows } = await c.query(
    `SELECT u.*, l.nome AS loja_nome, l.cidade AS loja_cidade, l.uf AS loja_uf
       FROM usuarios u LEFT JOIN lojas l ON l.id = u.loja_id WHERE u.id = $1`, [id]);
  return rows[0];
}

// ---------- entrar ----------
auth.post('/entrar', limiteLogin, rota(async (req, res) => {
  const d = validar(z.object({ email: zEmail, senha: z.string().min(1, 'Informe sua senha.').max(200) }), req.body);
  const resposta = await comoSistema(async (c) => {
    const { rows } = await c.query(
      `SELECT u.*, l.ativa AS loja_ativa FROM usuarios u LEFT JOIN lojas l ON l.id = u.loja_id WHERE u.email = $1`, [d.email]);
    const u = rows[0];
    if (u?.bloqueado_ate && new Date(u.bloqueado_ate) > new Date()) {
      throw erro(429, `Acesso bloqueado por tentativas erradas. Tente de novo em ${BLOQUEIO_MIN} minutos ou use "Esqueci minha senha".`);
    }
    const ok = await conferirSenha(u?.senha_hash, d.senha);
    if (!u || !ok) {
      if (u) {
        await c.query(
          `UPDATE usuarios SET falhas_login = falhas_login + 1,
             bloqueado_ate = CASE WHEN falhas_login + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE NULL END
           WHERE id = $1`, [u.id, MAX_FALHAS, BLOQUEIO_MIN]);
        await registrar(c, req, 'login_falhou', { usuarioId: u.id, lojaId: u.loja_id });
      }
      return { falhou: true }; // devolve em vez de lançar, para a contagem de falhas ser gravada
    }
    if (u.status !== 'ativo' || (u.loja_id && !u.loja_ativa)) throw erro(403, 'Este acesso está desativado. Fale com o responsável da sua loja.');

    if (u.totp_ativo) {
      const token = novoToken();
      await c.query(
        `INSERT INTO sessoes (usuario_id, token_hash, tipo, csrf, expira_em, ip, navegador)
         VALUES ($1, $2, 'verificacao', $3, now() + interval '5 minutes', $4, $5)`,
        [u.id, hashToken(token), novoToken(), ipDe(req), navegadorDe(req)]);
      res.cookie(COOKIE_VERIFICACAO, token, opcoesCookie(5 * 60_000));
      return { precisa2fa: true };
    }
    const csrf = await criarSessao(c, req, res, u);
    await registrar(c, req, 'login', { usuarioId: u.id, lojaId: u.loja_id });
    return { usuario: usuarioPublico(await usuarioComLoja(c, u.id)), csrf };
  });
  if (resposta.falhou) throw erro(401, MENSAGEM_LOGIN);
  res.json(resposta);
}));

// ---------- verificação em 2 etapas ----------
auth.post('/2fa', limiteLogin, rota(async (req, res) => {
  const { codigo } = validar(z.object({ codigo: z.string().regex(/^\d{6}$/, 'Digite os 6 números do código.') }), req.body);
  const token = req.cookies?.[COOKIE_VERIFICACAO];
  if (!token) throw erro(401, 'O tempo para digitar o código acabou. Entre novamente.');
  const resposta = await comoSistema(async (c) => {
    const { rows } = await c.query(
      `SELECT s.id AS sessao_id, s.tentativas, u.* FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.token_hash = $1 AND s.tipo = 'verificacao' AND s.expira_em > now()`, [hashToken(token)]);
    const v = rows[0];
    if (!v || v.status !== 'ativo') throw erro(401, 'O tempo para digitar o código acabou. Entre novamente.');
    if (!v.totp_ativo || !codigo2faValido(decifrar(v.totp_cifrado), codigo)) {
      if (v.tentativas + 1 >= 5) {
        await c.query('DELETE FROM sessoes WHERE id = $1', [v.sessao_id]);
        await registrar(c, req, '2fa_bloqueado', { usuarioId: v.id, lojaId: v.loja_id });
        return { expirou: true };
      }
      await c.query('UPDATE sessoes SET tentativas = tentativas + 1 WHERE id = $1', [v.sessao_id]);
      return { errou: true };
    }
    await c.query('DELETE FROM sessoes WHERE id = $1', [v.sessao_id]);
    const csrf = await criarSessao(c, req, res, v);
    await registrar(c, req, 'login', { usuarioId: v.id, lojaId: v.loja_id, detalhes: { duasEtapas: true } });
    return { usuario: usuarioPublico(await usuarioComLoja(c, v.id)), csrf };
  });
  if (resposta.expirou) { res.clearCookie(COOKIE_VERIFICACAO, opcoesCookie()); throw erro(401, 'Muitos códigos errados. Entre novamente.'); }
  if (resposta.errou) throw erro(400, 'Código incorreto. Confira o app autenticador e tente de novo.');
  res.clearCookie(COOKIE_VERIFICACAO, opcoesCookie());
  res.json(resposta);
}));

// ---------- quem está logado (chamado ao abrir/recarregar a página) ----------
auth.get('/sessao', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.usuario) return res.json({ usuario: null });
  res.json({ usuario: usuarioPublico(req.usuario), csrf: req.sessao.csrf });
});

// ---------- sair ----------
auth.post('/sair', exigirLogin, exigirCsrf, rota(async (req, res) => {
  await comoSistema(async (c) => {
    await c.query('DELETE FROM sessoes WHERE id = $1', [req.sessao.id]);
    await c.query('UPDATE usuarios SET disponivel = false WHERE id = $1', [req.usuario.id]); // saiu: sai da roleta
  });
  res.clearCookie(COOKIE_SESSAO, opcoesCookie());
  res.status(204).end();
}));

auth.post('/sair-de-todos', exigirLogin, exigirCsrf, rota(async (req, res) => {
  await comoSistema(async (c) => {
    await c.query('DELETE FROM sessoes WHERE usuario_id = $1', [req.usuario.id]);
    await c.query('UPDATE usuarios SET disponivel = false WHERE id = $1', [req.usuario.id]);
    await registrar(c, req, 'sair_de_todos');
  });
  res.clearCookie(COOKIE_SESSAO, opcoesCookie());
  res.status(204).end();
}));

// ---------- esqueci minha senha (resposta sempre igual: não revela quem tem conta) ----------
auth.post('/esqueci-senha', limiteEmail, rota(async (req, res) => {
  const { email } = validar(z.object({ email: zEmail }), req.body);
  const envio = await comoSistema(async (c) => {
    const { rows } = await c.query(
      `SELECT u.id, u.nome, u.email, u.loja_id FROM usuarios u LEFT JOIN lojas l ON l.id = u.loja_id
        WHERE u.email = $1 AND u.status = 'ativo' AND (u.loja_id IS NULL OR l.ativa)`, [email]);
    const u = rows[0];
    if (!u) return null;
    await c.query(`UPDATE tokens_senha SET usado_em = now() WHERE usuario_id = $1 AND usado_em IS NULL`, [u.id]);
    const token = novoToken();
    await c.query(`INSERT INTO tokens_senha (usuario_id, token_hash, tipo, expira_em) VALUES ($1, $2, 'redefinicao', now() + interval '1 hour')`, [u.id, hashToken(token)]);
    await registrar(c, req, 'pediu_nova_senha', { usuarioId: u.id, lojaId: u.loja_id });
    return { u, link: `${config.appUrl}/#/definir-senha?token=${token}` };
  });
  if (envio) await emailRedefinicao({ para: envio.u.email, nome: envio.u.nome, link: envio.link }).catch((e) => console.error('[email]', e.message));
  res.json({ ok: true });
}));

// ---------- criar senha pelo link (convite ou redefinição) ----------
auth.post('/definir-senha', limiteLogin, rota(async (req, res) => {
  const d = validar(z.object({ token: z.string().min(20).max(100), senha: z.string().max(200) }), req.body);
  const falta = problemasSenha(d.senha);
  if (falta.length) throw erro(422, 'Senha fraca.', { senha: 'A senha precisa ' + falta.join(' e ') + '.' });
  const hash = await hashSenha(d.senha);
  await comoSistema(async (c) => {
    const { rows } = await c.query(
      `SELECT t.id, t.tipo, u.id AS usuario_id, u.status, u.loja_id FROM tokens_senha t JOIN usuarios u ON u.id = t.usuario_id
        WHERE t.token_hash = $1 AND t.usado_em IS NULL AND t.expira_em > now()`, [hashToken(d.token)]);
    const t = rows[0];
    if (!t || t.status === 'inativo') throw erro(400, 'Este link expirou ou já foi usado. Peça um novo.');
    await c.query('UPDATE tokens_senha SET usado_em = now() WHERE id = $1', [t.id]);
    await c.query(
      `UPDATE usuarios SET senha_hash = $2, status = 'ativo', falhas_login = 0, bloqueado_ate = NULL WHERE id = $1`, [t.usuario_id, hash]);
    await c.query('DELETE FROM sessoes WHERE usuario_id = $1', [t.usuario_id]);
    await registrar(c, req, t.tipo === 'convite' ? 'aceitou_convite' : 'redefiniu_senha', { usuarioId: t.usuario_id, lojaId: t.loja_id });
  });
  res.json({ ok: true });
}));
