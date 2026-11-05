// v14.8 — Assinatura do Conecta pelos franqueados (Pagar.me).
// Gestor: vê a situação, contrata (cartão/Pix/boleto), vê faturas, cancela. Administração: lista, isenta, confirma pagamento manual.
// Webhook da Pagar.me: POST /api/webhooks/pagarme (autenticação Basic cadastrada no painel).
import { Router } from 'express';
import { z } from 'zod';
import { comContexto, comoSistema, contextoDoUsuario } from '../banco/conexao.js';
import { rota, erro, validar, zUuid, exigirPerfil, registrar, lojaPublica } from '../http.js';
import * as assinatura from '../servicos/assinatura/index.js';
import { webhookAutorizado, simulado } from '../servicos/assinatura/pagarme.js';
import { PLANOS, FORMAS, dataISO } from '../servicos/assinatura/planos.js';

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

// gera um Pix novo para a fatura em aberto (código expirado ou loja suspensa)
assinaturaLoja.post('/assinatura/novo-pix', exigirPerfil('dono'), rota(async (req, res) => {
  const f = await comContexto(ctx(req), (c) => assinatura.novoPix(c, req.usuario.loja_id));
  res.json(assinatura.faturaPublica(f));
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
// v14.8.7 — visão geral das assinaturas da rede (tela Assinaturas do admin): todas as lojas, contagens, receita do mês e previsão
async function visaoGeral(c) {
  const lojas = (await c.query(
    `SELECT l.id, l.nome, l.cidade, l.uf, l.cnpj, l.central, l.ativa, a.id AS assinatura_id, a.plano, a.ciclo, a.forma, a.status, a.valor_centavos, a.cartao_final, a.inicio_em, a.proxima_cobranca, a.cancelada_em, a.observacao,
            (SELECT count(*)::int FROM faturas_assinatura f WHERE f.assinatura_id = a.id AND f.status IN ('pendente', 'vencida', 'falhou')) AS faturas_abertas,
            (SELECT min(f.vence_em) FROM faturas_assinatura f WHERE f.assinatura_id = a.id AND f.status IN ('pendente', 'vencida', 'falhou')) AS vence_aberta,
            (SELECT max(f.paga_em) FROM faturas_assinatura f WHERE f.assinatura_id = a.id AND f.status = 'paga') AS ultimo_pagamento
       FROM lojas l LEFT JOIN assinaturas a ON a.loja_id = l.id
      WHERE NOT l.central ORDER BY l.nome`)).rows;
  const mes = (await c.query(
    `SELECT coalesce(sum(valor_centavos), 0)::bigint AS pago, count(*)::int AS faturas FROM faturas_assinatura WHERE status = 'paga' AND paga_em >= date_trunc('month', now()) AND paga_em < date_trunc('month', now()) + interval '1 month'`)).rows[0];
  const mesAnterior = (await c.query(
    `SELECT coalesce(sum(valor_centavos), 0)::bigint AS pago FROM faturas_assinatura WHERE status = 'paga' AND paga_em >= date_trunc('month', now()) - interval '1 month' AND paga_em < date_trunc('month', now())`)).rows[0];
  const emAberto = (await c.query(`SELECT coalesce(sum(valor_centavos), 0)::bigint AS total, count(*)::int AS n FROM faturas_assinatura WHERE status IN ('pendente', 'vencida', 'falhou')`)).rows[0];
  const contagem = { ativa: 0, atrasada: 0, suspensa: 0, pendente: 0, isenta: 0, cancelada: 0, sem: 0 };
  let previsaoMensal = 0;
  for (const l of lojas) {
    const st = l.status || 'sem'; contagem[st] = (contagem[st] || 0) + 1;
    if (['ativa', 'atrasada', 'suspensa'].includes(st)) previsaoMensal += l.ciclo === 'anual' ? Math.round(l.valor_centavos / 12) : l.valor_centavos;
  }
  return {
    resumo: { contagem, lojas: lojas.length, pagantes: contagem.ativa + contagem.atrasada + contagem.suspensa, receitaMes: Number(mes.pago) / 100, faturasMes: mes.faturas, receitaMesAnterior: Number(mesAnterior.pago) / 100, previsaoMensal: previsaoMensal / 100, emAberto: Number(emAberto.total) / 100, faturasAbertas: emAberto.n },
    lojas: lojas.map((l) => ({
      lojaId: l.id, loja: l.nome, cidade: l.cidade, uf: l.uf, cnpj: l.cnpj, lojaAtiva: l.ativa,
      status: l.status || 'sem', plano: l.plano, planoNome: l.plano ? (PLANOS[l.plano]?.nome || l.plano) : null, ciclo: l.ciclo, forma: l.forma, formaNome: l.forma ? (FORMAS[l.forma] || l.forma) : null,
      valor: l.valor_centavos != null ? l.valor_centavos / 100 : null, cartaoFinal: l.cartao_final, inicioEm: l.inicio_em, proximaCobranca: l.proxima_cobranca ? dataISO(l.proxima_cobranca) : null, canceladaEm: l.cancelada_em, observacao: l.observacao,
      faturasAbertas: l.faturas_abertas || 0, venceAberta: l.vence_aberta ? dataISO(l.vence_aberta) : null, ultimoPagamento: l.ultimo_pagamento,
    })),
  };
}

assinaturaAdmin.get('/assinaturas', admin, rota(async (req, res) => {
  res.json(await comContexto(ctx(req), (c) => visaoGeral(c)));
}));

assinaturaAdmin.get('/assinaturas.csv', admin, rota(async (req, res) => {
  const v = await comContexto(ctx(req), (c) => visaoGeral(c));
  const esc = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const d = (x) => (x ? new Date(typeof x === 'string' && x.length === 10 ? x + 'T12:00:00Z' : x).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' }) : '');
  const linhas = [['loja', 'cidade', 'uf', 'cnpj', 'situacao', 'plano', 'ciclo', 'forma', 'valor', 'inicio', 'proxima_cobranca', 'faturas_abertas', 'vence_aberta', 'ultimo_pagamento', 'observacao'].join(';')];
  for (const l of v.lojas) linhas.push([l.loja, l.cidade, l.uf, l.cnpj || '', l.status, l.planoNome || '', l.ciclo || '', l.formaNome || '', l.valor != null ? l.valor.toFixed(2).replace('.', ',') : '', d(l.inicioEm), d(l.proximaCobranca), l.faturasAbertas, d(l.venceAberta), d(l.ultimoPagamento), l.observacao || ''].map(esc).join(';'));
  res.set('Content-Type', 'text/csv; charset=utf-8'); res.set('Content-Disposition', 'attachment; filename="assinaturas.csv"');
  res.send('\ufeff' + linhas.join('\r\n'));
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
