// Meu perfil: dados, senha e verificação em 2 etapas do próprio usuário.
import { Router } from 'express';
import { z } from 'zod';
import { comContexto, comoSistema, contextoDoUsuario } from '../banco/conexao.js';
import { distribuirPendentes } from '../servicos/crm/roleta.js';
import { conferirSenha, hashSenha, problemasSenha, cifrar, decifrar, novoSegredo2fa, codigo2faValido, qrDo2fa, formatarChave } from '../servicos/seguranca.js';
import { rota, erro, validar, zEmail, zNome, zUuid, usuarioPublico, registrar } from '../http.js';

export const eu = Router();
const ctx = (req) => contextoDoUsuario(req.usuario);
const OBRIGATORIO_2FA = ['admin', 'matriz', 'dono'];

async function euComLoja(c, id) {
  return (await c.query(
    `SELECT u.*, l.nome AS loja_nome, l.cidade AS loja_cidade, l.uf AS loja_uf, l.modulos AS loja_modulos,
            (SELECT count(*)::int FROM usuario_lojas ul JOIN lojas lx ON lx.id = ul.loja_id AND lx.ativa WHERE ul.usuario_id = u.id) AS qtd_lojas
       FROM usuarios u LEFT JOIN lojas l ON l.id = u.loja_id WHERE u.id = $1`, [id])).rows[0];
}

// Disponível / Em pausa (roleta de atendimento). Ao ficar disponível, recebe as conversas que estavam esperando.
eu.patch('/disponibilidade', rota(async (req, res) => {
  if (!['dono', 'atendente'].includes(req.usuario.perfil)) throw erro(403, 'Só a equipe da loja participa da roleta.');
  const { disponivel } = validar(z.object({ disponivel: z.boolean() }), req.body);
  await comContexto(ctx(req), (c) => c.query('UPDATE usuarios SET disponivel = $2, visto_em = now() WHERE id = $1', [req.usuario.id, disponivel]));
  if (disponivel) await comoSistema((c) => distribuirPendentes(c, req.usuario.loja_id));
  const u = await comContexto(ctx(req), (c) => euComLoja(c, req.usuario.id));
  res.json(usuarioPublico(u));
}));

// O dono (gestor) pode ficar fora da roleta: não recebe conversas sozinho, mas continua podendo "Assumir" qualquer uma.
eu.patch('/roleta', rota(async (req, res) => {
  if (req.usuario.perfil !== 'dono') throw erro(403, 'Só o dono da loja escolhe isso para si. Os atendentes são ajustados pelo dono em Equipe.');
  const { participa } = validar(z.object({ participa: z.boolean() }), req.body);
  await comContexto(ctx(req), async (c) => {
    await c.query('UPDATE usuarios SET na_roleta = $2 WHERE id = $1', [req.usuario.id, participa]);
    await registrar(c, req, participa ? 'entrou_na_roleta' : 'saiu_da_roleta');
  });
  if (participa && req.usuario.disponivel) await comoSistema((c) => distribuirPendentes(c, req.usuario.loja_id));
  const u = await comContexto(ctx(req), (c) => euComLoja(c, req.usuario.id));
  res.json(usuarioPublico(u));
}));

eu.patch('/', rota(async (req, res) => {
  const d = validar(z.object({ nome: zNome, email: zEmail, senhaAtual: z.string().max(200).optional() }), req.body);
  const trocouEmail = d.email !== req.usuario.email;
  if (trocouEmail && !(await conferirSenha(req.usuario.senha_hash, d.senhaAtual || ''))) {
    throw erro(422, 'Confira os campos destacados.', { senhaAtual: 'Para trocar o e-mail, confirme sua senha atual.' });
  }
  const u = await comContexto(ctx(req), async (c) => {
    await c.query('UPDATE usuarios SET nome = $2, email = $3 WHERE id = $1', [req.usuario.id, d.nome, d.email]);
    await registrar(c, req, trocouEmail ? 'trocou_email' : 'editou_perfil', { detalhes: trocouEmail ? { de: req.usuario.email, para: d.email } : null });
    return euComLoja(c, req.usuario.id);
  }).catch((e) => { if (e.code === '23505') throw erro(422, 'Confira os campos destacados.', { email: 'Este e-mail já é usado por outro acesso.' }); throw e; });
  res.json(usuarioPublico(u));
}));

eu.post('/senha', rota(async (req, res) => {
  const d = validar(z.object({ atual: z.string().max(200), nova: z.string().max(200) }), req.body);
  if (!(await conferirSenha(req.usuario.senha_hash, d.atual))) throw erro(422, 'Confira os campos destacados.', { atual: 'Senha atual incorreta.' });
  const falta = problemasSenha(d.nova);
  if (falta.length) throw erro(422, 'Confira os campos destacados.', { nova: 'A senha precisa ' + falta.join(' e ') + '.' });
  const hash = await hashSenha(d.nova);
  await comContexto(ctx(req), async (c) => {
    await c.query('UPDATE usuarios SET senha_hash = $2 WHERE id = $1', [req.usuario.id, hash]);
    // desconecta os outros aparelhos; este continua
    await c.query('DELETE FROM sessoes WHERE usuario_id = $1 AND id <> $2', [req.usuario.id, req.sessao.id]);
    await registrar(c, req, 'trocou_senha');
  });
  res.json({ ok: true });
}));

eu.post('/2fa/iniciar', rota(async (req, res) => {
  if (req.usuario.totp_ativo) throw erro(400, 'A verificação em 2 etapas já está ativada.');
  const segredo = novoSegredo2fa();
  await comContexto(ctx(req), (c) => c.query('UPDATE usuarios SET totp_pendente = $2 WHERE id = $1', [req.usuario.id, cifrar(segredo)]));
  res.set('Cache-Control', 'no-store');
  res.json({ chave: formatarChave(segredo), qr: await qrDo2fa(req.usuario.email, segredo) });
}));

eu.post('/2fa/ativar', rota(async (req, res) => {
  const { codigo } = validar(z.object({ codigo: z.string().regex(/^\d{6}$/, 'Digite os 6 números.') }), req.body);
  if (!req.usuario.totp_pendente) throw erro(400, 'Comece a ativação de novo.');
  if (!codigo2faValido(decifrar(req.usuario.totp_pendente), codigo)) throw erro(422, 'Confira o código.', { codigo: 'Código incorreto. Confira o app e tente de novo.' });
  const u = await comContexto(ctx(req), async (c) => {
    await c.query('UPDATE usuarios SET totp_cifrado = totp_pendente, totp_pendente = NULL, totp_ativo = true WHERE id = $1', [req.usuario.id]);
    await registrar(c, req, 'ativou_2fa');
    return euComLoja(c, req.usuario.id);
  });
  res.json(usuarioPublico(u));
}));

eu.post('/2fa/desativar', rota(async (req, res) => {
  if (OBRIGATORIO_2FA.includes(req.usuario.perfil)) throw erro(400, 'A verificação em 2 etapas é obrigatória para o seu tipo de acesso.');
  const u = await comContexto(ctx(req), async (c) => {
    await c.query('UPDATE usuarios SET totp_cifrado = NULL, totp_pendente = NULL, totp_ativo = false WHERE id = $1', [req.usuario.id]);
    await registrar(c, req, 'desativou_2fa');
    return euComLoja(c, req.usuario.id);
  });
  res.json(usuarioPublico(u));
}));

// ---------- várias lojas: listar e trocar a loja em uso na sessão ----------
eu.get('/lojas', rota(async (req, res) => {
  const rows = await comoSistema(async (c) => (await c.query(
    `SELECT l.id, l.nome, l.cidade, l.uf, ul.perfil FROM usuario_lojas ul JOIN lojas l ON l.id = ul.loja_id WHERE ul.usuario_id = $1 AND l.ativa ORDER BY l.nome`, [req.usuario.id])).rows);
  res.json({ atual: req.usuario.loja_id, lojas: rows });
}));
eu.post('/loja', rota(async (req, res) => {
  const { lojaId } = validar(z.object({ lojaId: zUuid }), req.body);
  const ok = await comoSistema(async (c) => {
    const v = (await c.query('SELECT ul.perfil FROM usuario_lojas ul JOIN lojas l ON l.id = ul.loja_id WHERE ul.usuario_id = $1 AND ul.loja_id = $2 AND l.ativa', [req.usuario.id, lojaId])).rows[0];
    if (!v) return false;
    await c.query('UPDATE sessoes SET loja_id = $2 WHERE id = $1', [req.sessao.id, lojaId]);
    return true;
  });
  if (!ok) throw erro(403, 'Você não tem acesso a essa loja.');
  await comContexto(ctx(req), (c) => registrar(c, req, 'trocou_loja', { lojaId }));
  res.json({ ok: true });
}));
