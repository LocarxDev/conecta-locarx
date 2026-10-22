// Equipe das lojas: listar, convidar, editar, ativar/desativar, reenviar convite e excluir.
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { comContexto, contextoDoUsuario } from '../banco/conexao.js';
import { novoToken, hashToken } from '../servicos/seguranca.js';
import { emailConvite } from '../servicos/email.js';
import { rota, erro, validar, zEmail, zNome, zUuid, exigirPerfil, usuarioPublico, registrar } from '../http.js';

export const usuarios = Router();
export const equipeAdmin = Router();
export const equipeLoja = Router();

const ctx = (req) => contextoDoUsuario(req.usuario);
const uuidOu404 = (id, msg = 'Pessoa não encontrada.') => { if (!zUuid.safeParse(id).success) throw erro(404, msg); return id; };

async function gerarConvite(c, usuarioId) {
  await c.query(`UPDATE tokens_senha SET usado_em = now() WHERE usuario_id = $1 AND usado_em IS NULL`, [usuarioId]);
  const token = novoToken();
  await c.query(`INSERT INTO tokens_senha (usuario_id, token_hash, tipo, expira_em) VALUES ($1, $2, 'convite', now() + interval '72 hours')`, [usuarioId, hashToken(token)]);
  return `${config.appUrl}/#/definir-senha?token=${token}`;
}

// Quem pode mexer em quem: administração em qualquer pessoa de loja; dono só nos atendentes da própria loja.
function podeGerir(eu, alvo) {
  if (!alvo || alvo.id === eu.id) return false;
  if (eu.perfil === 'admin') return !!alvo.loja_id;
  return eu.perfil === 'dono' && alvo.loja_id === eu.loja_id && alvo.perfil === 'atendente';
}

async function buscarAlvo(c, id) {
  return (await c.query('SELECT u.*, l.nome AS nome_loja FROM usuarios u LEFT JOIN lojas l ON l.id = u.loja_id WHERE u.id = $1', [id])).rows[0];
}

// ---------- listar ----------
equipeLoja.get('/usuarios', exigirPerfil('dono'), rota(async (req, res) => {
  const rows = await comContexto(ctx(req), async (c) => (await c.query('SELECT * FROM usuarios WHERE loja_id = $1 ORDER BY nome', [req.usuario.loja_id])).rows);
  res.json(rows.map(usuarioPublico));
}));

equipeAdmin.get('/lojas/:id/usuarios', exigirPerfil('admin', 'matriz'), rota(async (req, res) => {
  const id = uuidOu404(req.params.id, 'Loja não encontrada.');
  const rows = await comContexto(ctx(req), async (c) => (await c.query('SELECT * FROM usuarios WHERE loja_id = $1 ORDER BY nome', [id])).rows);
  res.json(rows.map(usuarioPublico));
}));

// ---------- convidar ----------
usuarios.post('/convites', exigirPerfil('admin', 'dono'), rota(async (req, res) => {
  const d = validar(z.object({
    nome: zNome, email: zEmail,
    perfil: z.enum(['atendente', 'dono']).default('atendente'),
    lojaId: zUuid.nullish(),
  }), req.body);
  const eu = req.usuario;
  const lojaId = eu.perfil === 'dono' ? eu.loja_id : d.lojaId;
  if (!lojaId) throw erro(422, 'Escolha a loja.', { lojaId: 'Escolha a loja.' });
  if (eu.perfil === 'dono' && d.perfil !== 'atendente') throw erro(403, 'Só a administração convida o dono da loja.');

  const r = await comContexto(ctx(req), async (c) => {
    const loja = (await c.query('SELECT id, nome, ativa FROM lojas WHERE id = $1', [lojaId])).rows[0];
    if (!loja) throw erro(404, 'Loja não encontrada.');
    if (!loja.ativa) throw erro(400, 'Esta loja está desativada. Reative a loja antes de convidar pessoas.');
    // e-mail repetido na mesma loja (o dono não enxerga outras lojas; lá o índice único do banco barra)
    const existe = (await c.query('SELECT 1 FROM usuarios WHERE email = $1', [d.email])).rowCount;
    if (existe) return { repetido: true };
    const novo = (await c.query(
      `INSERT INTO usuarios (nome, email, perfil, loja_id, status) VALUES ($1, $2, $3, $4, 'convidado') RETURNING *`,
      [d.nome, d.email, d.perfil, lojaId])).rows[0];
    const link = await gerarConvite(c, novo.id);
    await registrar(c, req, 'convidou', { alvo: novo.id, lojaId, detalhes: { email: d.email, perfil: d.perfil } });
    return { novo, link, loja };
  }).catch((e) => { if (e.code === '23505') return { repetido: true }; throw e; });
  if (r.repetido) throw erro(422, 'Confira os campos destacados.', { email: 'Já existe um acesso com este e-mail.' });
  const enviado = await emailConvite({ para: r.novo.email, nome: r.novo.nome, link: r.link, loja: r.loja.nome }).catch(() => false);
  res.status(201).json({ ...usuarioPublico(r.novo), linkConvite: r.link, emailEnviado: enviado });
}));

// ---------- editar / ativar / desativar ----------
usuarios.patch('/:id', exigirPerfil('admin', 'dono'), rota(async (req, res) => {
  const id = uuidOu404(req.params.id);
  const d = validar(z.object({ nome: zNome.optional(), status: z.enum(['ativo', 'inativo']).optional() }), req.body);
  const atualizado = await comContexto(ctx(req), async (c) => {
    const alvo = await buscarAlvo(c, id);
    if (!podeGerir(req.usuario, alvo)) throw erro(alvo?.id === req.usuario.id ? 400 : 403, alvo?.id === req.usuario.id ? 'Altere seus próprios dados em Meu perfil.' : 'Você não pode alterar este acesso.');
    if (d.status === 'ativo' && alvo.status === 'convidado') throw erro(400, 'Esta pessoa ainda não aceitou o convite. Reenvie o convite.');
    const r = (await c.query(
      `UPDATE usuarios SET nome = coalesce($2, nome), status = CASE WHEN status = 'convidado' THEN status ELSE coalesce($3, status) END WHERE id = $1 RETURNING *`,
      [id, d.nome ?? null, d.status ?? null])).rows[0];
    if (d.status === 'inativo') await c.query('DELETE FROM sessoes WHERE usuario_id = $1', [id]);
    await registrar(c, req, d.status ? (d.status === 'inativo' ? 'desativou_usuario' : 'reativou_usuario') : 'editou_usuario', { alvo: id, lojaId: alvo.loja_id });
    return r;
  });
  res.json(usuarioPublico(atualizado));
}));

// ---------- reenviar convite ----------
usuarios.post('/:id/convite', exigirPerfil('admin', 'dono'), rota(async (req, res) => {
  const id = uuidOu404(req.params.id);
  const r = await comContexto(ctx(req), async (c) => {
    const alvo = await buscarAlvo(c, id);
    if (!podeGerir(req.usuario, alvo)) throw erro(403, 'Você não pode reenviar este convite.');
    if (alvo.status !== 'convidado') throw erro(400, 'Esta pessoa já criou a senha.');
    const link = await gerarConvite(c, id);
    await registrar(c, req, 'reenviou_convite', { alvo: id, lojaId: alvo.loja_id });
    return { alvo, link };
  });
  const enviado = await emailConvite({ para: r.alvo.email, nome: r.alvo.nome, link: r.link, loja: r.alvo.nome_loja }).catch(() => false);
  res.json({ linkConvite: r.link, emailEnviado: enviado });
}));

// ---------- excluir (só quem nunca acessou; quem tem histórico é desativado) ----------
usuarios.delete('/:id', exigirPerfil('admin', 'dono'), rota(async (req, res) => {
  const id = uuidOu404(req.params.id);
  await comContexto(ctx(req), async (c) => {
    const alvo = await buscarAlvo(c, id);
    if (!podeGerir(req.usuario, alvo)) throw erro(403, 'Você não pode excluir este acesso.');
    if (alvo.ultimo_acesso) throw erro(409, 'Este acesso já tem histórico de atendimento. Desative em vez de excluir, para manter os registros.');
    await c.query('DELETE FROM usuarios WHERE id = $1', [id]);
    await registrar(c, req, 'excluiu_usuario', { alvo: id, lojaId: alvo.loja_id, detalhes: { email: alvo.email } });
  });
  res.status(204).end();
}));
