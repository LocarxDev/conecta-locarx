// v14.8 — Assinatura do Conecta pelos franqueados (Pagar.me).
// Gestor: vê a situação, contrata (cartão/Pix/boleto), vê faturas, cancela. Administração: lista, isenta, confirma pagamento manual.
// Webhook da Pagar.me: POST /api/webhooks/pagarme (autenticação Basic cadastrada no painel).
import { Router } from 'express';
import { z } from 'zod';
import { comContexto, comoSistema, contextoDoUsuario } from '../banco/conexao.js';
import { rota, erro, validar, zUuid, exigirPerfil, registrar, lojaPublica } from '../http.js';
import * as assinatura from '../servicos/assinatura/index.js';
import { webhookAutorizado, simulado } from '../servicos/assinatura/pagarme.js';
import { PLANOS } from '../servicos/assinatura/planos.js';

export const assinaturaLoja = Router();    // /api/loja/assinatura
export const assinaturaAdmin = Router();   // /api/admin/assinaturas…
export const webhookPagarme = Router();    // /api/webhooks/pagarme
const ctx = (req) => contextoDoUsuario(req.usuario);

// ---------- loja ----------
assinaturaLoja.get('/assinatura', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  const s = await comContexto(ctx(req), (c) => assinatura.situacao(c, req.usuario.loja_id));
  res.json({ ...s, podeContratar: req.usuario.perfil === 'dono' || req.usuario.perfil === 'admin', loja: { id: req.usuario.loja_id, nome: req.usuario.loja_nome } });
}));

assinaturaLoja.post('/assinatura', exigirPerfil('dono'), rota(async (req, res) => {
  const d = validar(z.object({
    plano: z.enum(Object.keys(PLANOS)).default('basico'),
    ciclo: z.enum(['mensal', 'anual']).default('mensal'),
    forma: z.enum(['cartao', 'pix', 'boleto']),
    cardToken: z.string().trim().min(8).max(200).optional(),
  }), req.body);
  const r = await comContexto(ctx(req), async (c) => {
    const loja = (await c.query('SELECT * FROM lojas WHERE id = $1', [req.usuario.loja_id])).rows[0];
    if (!loja) throw erro(404, 'Loja não encontrada.');
    const r = await assinatura.contratar(c, { loja, usuario: req.usuario, ...d });
    await registrar(c, req, 'contratou_assinatura', { alvo: r.assinatura.id, lojaId: loja.id, detalhes: { plano: d.plano, ciclo: d.ciclo, forma: d.forma, simulado: simulado() } });
    return r;
  });
  res.status(201).json({ assinatura: assinatura.assinaturaPublica(r.assinatura), fatura: assinatura.faturaPublica(r.fatura) });
}));

assinaturaLoja.post('/assinatura/cancelar', exigirPerfil('dono'), rota(async (req, res) => {
  const { motivo } = validar(z.object({ motivo: z.string().trim().max(300).optional() }), req.body || {});
  const a = await comContexto(ctx(req), async (c) => {
    const a = await assinatura.cancelar(c, req.usuario.loja_id, { por: req.usuario.id, motivo: motivo || null });
    await registrar(c, req, 'cancelou_assinatura', { alvo: a.id, lojaId: a.loja_id, detalhes: { motivo: motivo || null } });
    return a;
  });
  res.json(assinatura.assinaturaPublica(a));
}));

// ---------- administração ----------
const admin = exigirPerfil('admin', 'matriz');
assinaturaAdmin.get('/assinaturas', admin, rota(async (req, res) => {
  const rows = await comContexto(ctx(req), async (c) => (await c.query(
    `SELECT a.*, l.nome AS loja_nome, l.cidade, l.uf, l.cnpj,
            (SELECT count(*)::int FROM faturas_assinatura f WHERE f.assinatura_id = a.id AND f.status IN ('pendente', 'vencida')) AS faturas_abertas
       FROM assinaturas a JOIN lojas l ON l.id = a.loja_id ORDER BY l.nome`)).rows);
  res.json(rows.map((a) => ({ ...assinatura.assinaturaPublica(a), loja: { nome: a.loja_nome, cidade: a.cidade, uf: a.uf, cnpj: a.cnpj }, faturasAbertas: a.faturas_abertas })));
}));

assinaturaAdmin.get('/lojas/:id/assinatura', admin, rota(async (req, res) => {
  const id = req.params.id; if (!zUuid.safeParse(id).success) throw erro(404, 'Loja não encontrada.');
  const s = await comContexto(ctx(req), (c) => assinatura.situacao(c, id));
  res.json(s);
}));

// isenta a loja (cortesia) ou tira a isenção
assinaturaAdmin.post('/lojas/:id/assinatura/isentar', exigirPerfil('admin'), rota(async (req, res) => {
  const id = req.params.id; if (!zUuid.safeParse(id).success) throw erro(404, 'Loja não encontrada.');
  const d = validar(z.object({ isenta: z.boolean(), plano: z.enum(Object.keys(PLANOS)).default('basico'), observacao: z.string().trim().max(300).optional() }), req.body);
  const a = await comContexto(ctx(req), async (c) => {
    const a = await assinatura.isentar(c, id, { isenta: d.isenta, plano: d.plano, observacao: d.observacao || null, por: req.usuario.id });
    await registrar(c, req, d.isenta ? 'isentou_assinatura' : 'tirou_isencao_assinatura', { alvo: id, lojaId: id, detalhes: { plano: d.plano, observacao: d.observacao || null } });
    return a;
  });
  res.json(assinatura.assinaturaPublica(a));
}));

// confirmação manual de uma fatura (pagou por fora, Pix caiu e o webhook não chegou…)
assinaturaAdmin.post('/assinaturas/faturas/:id/confirmar', exigirPerfil('admin'), rota(async (req, res) => {
  const id = req.params.id; if (!zUuid.safeParse(id).success) throw erro(404, 'Fatura não encontrada.');
  const { observacao } = validar(z.object({ observacao: z.string().trim().max(300).optional() }), req.body || {});
  const f = await comContexto(ctx(req), async (c) => {
    const f = (await c.query('SELECT * FROM faturas_assinatura WHERE id = $1', [id])).rows[0];
    if (!f) throw erro(404, 'Fatura não encontrada.');
    const r = await assinatura.confirmarFatura(c, f, { por: req.usuario.id, detalhes: { manual: true, observacao: observacao || null } });
    await registrar(c, req, 'confirmou_fatura_assinatura', { alvo: f.id, lojaId: f.loja_id, detalhes: { referencia: f.referencia, observacao: observacao || null } });
    return r;
  });
  res.json(assinatura.faturaPublica(f));
}));

// cancela a assinatura de uma loja (admin)
assinaturaAdmin.post('/lojas/:id/assinatura/cancelar', exigirPerfil('admin'), rota(async (req, res) => {
  const id = req.params.id; if (!zUuid.safeParse(id).success) throw erro(404, 'Loja não encontrada.');
  const { motivo } = validar(z.object({ motivo: z.string().trim().max(300).optional() }), req.body || {});
  const a = await comContexto(ctx(req), async (c) => {
    const a = await assinatura.cancelar(c, id, { por: req.usuario.id, motivo: motivo || null });
    await registrar(c, req, 'cancelou_assinatura', { alvo: a.id, lojaId: id, detalhes: { motivo: motivo || null, pelaAdministracao: true } });
    return a;
  });
  res.json(assinatura.assinaturaPublica(a));
}));

// ---------- webhook ----------
webhookPagarme.post('/', rota(async (req, res) => {
  if (!webhookAutorizado(req.headers.authorization)) throw erro(401, 'Não autorizado.');
  const evento = req.body;
  if (!evento || typeof evento !== 'object' || !evento.type) throw erro(400, 'Evento inválido.');
  const r = await assinatura.processarEvento(evento);
  res.json({ recebido: true, ...r });
}));
