// v14.12 — Adesão pela página pública (/adesao) e tela "Adesões" da administração.
// Público (sem login, montado antes do login): GET /api/publico/adesao (plano, chaves), POST /api/publico/adesao (dados + pagamento),
// GET /api/publico/adesao/:id?chave= (situação; a chave vem na criação). Limite por IP em tudo; Turnstile opcional no POST.
// Administração: GET /api/admin/adesoes, GET /:id, POST /:id/marcar-paga, POST /:id/vincular {lojaId}, POST /:id/cancelar.
import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { comContexto, comoSistema, contextoDoUsuario } from '../banco/conexao.js';
import { rota, erro, validar, zUuid, exigirPerfil, registrar } from '../http.js';
import * as adesao from '../servicos/assinatura/adesao.js';
import { emailConvite } from '../servicos/email.js';
import { gerarConvite } from './usuarios.js';

export const adesaoPublico = Router();   // /api/publico/adesao
export const adesaoAdmin = Router();     // /api/admin/adesoes
const ctx = (req) => contextoDoUsuario(req.usuario);

const limite = (windowMs, max, mensagem) => rateLimit({ windowMs, limit: max, standardHeaders: 'draft-7', legacyHeaders: false, message: { mensagem }, keyGenerator: (req) => req.ip });
const limiteLeitura = limite(60_000, 60, 'Muitas consultas. Aguarde um instante.');
const limiteCriar = limite(3_600_000, 8, 'Muitas tentativas de adesão deste endereço. Tente novamente mais tarde ou fale com a administração da rede.');
const limiteSituacao = limite(60_000, 120, 'Muitas consultas. Aguarde um instante.');

const zTexto = (min, max, msg) => z.string().trim().min(min, msg).max(max, `No máximo ${max} caracteres.`);
const esquemaAdesao = z.object({
  nomeLoja: zTexto(2, 120, 'Informe o nome da loja.'),
  cnpj: zTexto(14, 20, 'Informe o CNPJ.'),
  razaoSocial: zTexto(2, 160, 'Informe a razão social.'),
  endereco: zTexto(5, 240, 'Informe o endereço completo.'),
  cep: z.string().trim().regex(/^\d{5}-?\d{3}$/, 'CEP com 8 números.'),
  cidadeUf: z.string().trim().max(100).optional().default(''),
  whatsapp: z.string().trim().regex(/^\+?[\d\s()-]{10,20}$/, 'WhatsApp com DDD, ex.: (71) 99999-0000.'),
  gestorNome: zTexto(3, 120, 'Informe o nome do gestor.'),
  gestorEmail: z.string().trim().email('E-mail do gestor inválido.').max(160),
  atendenteNome: z.string().trim().max(120).optional().default(''),
  atendenteEmail: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.string().trim().email('E-mail do atendente inválido.').max(160).optional()),
  particularidades: z.string().trim().max(2000, 'No máximo 2000 caracteres.').optional().default(''),
  ciclo: z.enum(['mensal', 'anual']),
  forma: z.enum(['cartao', 'pix']),
  cardToken: z.string().trim().max(200).optional(),
  desafio: z.string().max(2200).optional(),
  aceite: z.literal(true, { errorMap: () => ({ message: 'Confirme que leu e concorda.' }) }),
}).refine((d) => d.forma !== 'cartao' || !!d.cardToken, { message: 'Informe os dados do cartão.', path: ['cartao'] })
  .refine((d) => !d.atendenteEmail || d.atendenteNome, { message: 'Informe o nome do atendente.', path: ['atendenteNome'] });

// ---------- público ----------
adesaoPublico.get('/', limiteLeitura, rota(async (req, res) => {
  res.json(adesao.dadosPublicos());
}));

adesaoPublico.post('/', limiteCriar, rota(async (req, res) => {
  const d = validar(esquemaAdesao, req.body);
  const r = await comoSistema((c) => adesao.criar(c, d, { ip: req.ip, desafio: d.desafio }));
  res.status(201).json({ adesao: adesao.adesaoPublica(r.adesao), chave: r.chave });
}));

adesaoPublico.get('/:id', limiteSituacao, rota(async (req, res) => {
  if (!zUuid.safeParse(req.params.id).success) throw erro(404, 'Adesão não encontrada.');
  const a = await comoSistema((c) => adesao.consultar(c, req.params.id, String(req.query.chave || '')));
  res.json({ adesao: adesao.adesaoPublica(a) });
}));

// ---------- administração ----------
const admin = exigirPerfil('admin', 'matriz');
const uuidOu404 = (id) => { if (!zUuid.safeParse(id).success) throw erro(404, 'Adesão não encontrada.'); return id; };

adesaoAdmin.get('/', admin, rota(async (req, res) => {
  const rows = await comContexto(ctx(req), async (c) => (await c.query(`SELECT a.*, l.nome AS loja_nome FROM adesoes a LEFT JOIN lojas l ON l.id = a.loja_id ORDER BY CASE a.status WHEN 'paga' THEN 0 WHEN 'aguardando' THEN 1 ELSE 2 END, a.criada_em DESC LIMIT 300`)).rows);
  const contagem = { paga: 0, aguardando: 0, loja_criada: 0, falhou: 0, expirada: 0, cancelada: 0 };
  for (const r of rows) contagem[r.status] = (contagem[r.status] || 0) + 1;
  res.json({ contagem, adesoes: rows.map((r) => ({ ...adesao.adesaoPublica(r, { completa: true }), lojaNome: r.loja_nome || null })), podeEditar: req.usuario.perfil === 'admin' });
}));

adesaoAdmin.get('/:id', admin, rota(async (req, res) => {
  const id = uuidOu404(req.params.id);
  const r = await comContexto(ctx(req), async (c) => (await c.query('SELECT a.*, l.nome AS loja_nome FROM adesoes a LEFT JOIN lojas l ON l.id = a.loja_id WHERE a.id = $1', [id])).rows[0]);
  if (!r) throw erro(404, 'Adesão não encontrada.');
  res.json({ ...adesao.adesaoPublica(r, { completa: true }), lojaNome: r.loja_nome || null });
}));

// pagamento caiu fora do webhook (ou conferido no painel da Pagar.me)
adesaoAdmin.post('/:id/marcar-paga', exigirPerfil('admin'), rota(async (req, res) => {
  const id = uuidOu404(req.params.id);
  const d = validar(z.object({ observacao: z.string().trim().max(300).optional() }), req.body);
  const r = await comContexto(ctx(req), async (c) => {
    const a = (await c.query('SELECT * FROM adesoes WHERE id = $1', [id])).rows[0];
    if (!a) throw erro(404, 'Adesão não encontrada.');
    if (!['aguardando', 'falhou', 'expirada'].includes(a.status)) throw erro(409, 'Esta adesão não está aguardando pagamento.');
    const atual = await adesao.marcarPaga(c, a, { detalhes: { manual: true, por: req.usuario.nome, observacao: d.observacao || null } });
    await registrar(c, req, 'marcou_adesao_paga', { alvo: id, detalhes: { cnpj: a.cnpj, observacao: d.observacao || null } });
    return atual;
  });
  res.json(adesao.adesaoPublica(r, { completa: true }));
}));

// liga a adesão paga a uma loja já criada: assinatura ativa + convites
adesaoAdmin.post('/:id/vincular', exigirPerfil('admin'), rota(async (req, res) => {
  const id = uuidOu404(req.params.id);
  const d = validar(z.object({ lojaId: zUuid }), req.body);
  const r = await comContexto(ctx(req), async (c) => {
    const out = await adesao.vincular(c, id, d.lojaId, { gerarConvite, emailConvite, por: req.usuario.id });
    await registrar(c, req, 'vinculou_adesao', { alvo: id, lojaId: d.lojaId, detalhes: { cnpj: out.adesao.cnpj, convites: out.convites.map((x) => `${x.perfil}:${x.email}`) } });
    return out;
  });
  res.json({ adesao: adesao.adesaoPublica(r.adesao, { completa: true }), convites: r.convites });
}));

adesaoAdmin.post('/:id/cancelar', exigirPerfil('admin'), rota(async (req, res) => {
  const id = uuidOu404(req.params.id);
  const d = validar(z.object({ motivo: z.string().trim().max(300).optional() }), req.body);
  const r = await comContexto(ctx(req), async (c) => {
    const a = (await c.query(`UPDATE adesoes SET status = 'cancelada', observacao = coalesce($2, observacao), atualizada_em = now() WHERE id = $1 AND status <> 'loja_criada' RETURNING *`, [id, d.motivo || null])).rows[0];
    if (!a) throw erro(409, 'Adesão não encontrada ou já virou loja.');
    await registrar(c, req, 'cancelou_adesao', { alvo: id, detalhes: { cnpj: a.cnpj, motivo: d.motivo || null } });
    return a;
  });
  res.json(adesao.adesaoPublica(r, { completa: true }));
}));
