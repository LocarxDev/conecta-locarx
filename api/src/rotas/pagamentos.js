// Pagamento Pix (AbacatePay): webhook (servidor-a-servidor) e rotas da loja (gerar/consultar/simular cobranças).
import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { comContexto, comoSistema, contextoDoUsuario } from '../banco/conexao.js';
import { rota, erro, validar, zUuid, exigirPerfil, registrar } from '../http.js';
import * as abacate from '../servicos/pagamentos/abacatepay.js';
import * as cobrancas from '../servicos/pagamentos/cobrancas.js';
import { cifrar } from '../servicos/seguranca.js';

export const VERSAO = '2026-10-26.4';   // aparece no painel Pix: diz qual API está no ar
export const webhookAbacatePay = Router();   // /api/webhooks/abacatepay  (corpo bruto, sem login)
export const pagamentosLoja = Router();      // /api/loja
export const pagamentosAdmin = Router();     // /api/admin

const ctx = (req) => contextoDoUsuario(req.usuario);

// =====================================================================
// Webhook: URL cadastrada no painel do AbacatePay = …/api/webhooks/abacatepay/<segredo>?webhookSecret=<segredo>
// Camadas: segredo no caminho + segredo na query + assinatura HMAC (se ABACATEPAY_PUBLIC_KEY configurada) + idempotência por id.
// Responde 2xx só depois de processar (o AbacatePay espera até 30 s e reenvia com o mesmo id em caso de falha).
// =====================================================================
webhookAbacatePay.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
webhookAbacatePay.post('/:segredo', rota(async (req, res) => {
  if (!config.abacatepay) return res.status(404).end();
  if (!abacate.segredoWebhookValido(req.params.segredo) || !abacate.segredoWebhookValido(req.query.webhookSecret)) return res.status(401).json({ erro: 'Unauthorized' });
  const bruto = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}), 'utf8');
  const assin = abacate.assinaturaValida(bruto, req.get('x-webhook-signature'));
  if (assin === false) return res.status(401).json({ erro: 'Assinatura inválida' });
  if (assin === null && !webhookAbacatePay.avisouSemChave) { webhookAbacatePay.avisouSemChave = true; console.warn('[abacatepay] ABACATEPAY_PUBLIC_KEY não configurada: assinatura HMAC do webhook não é conferida (só o segredo da URL).'); }
  let corpo;
  try { corpo = JSON.parse(bruto.toString('utf8')); } catch { return res.status(400).json({ erro: 'JSON inválido' }); }
  const ev = abacate.lerEvento(corpo);
  if (!ev.eventoId) return res.status(400).json({ erro: 'Sem id do evento' });

  // idempotência: o mesmo id pode chegar até 7 vezes
  const novo = await comoSistema(async (c) => (await c.query(
    `INSERT INTO webhook_eventos (provedor, evento_id, evento) VALUES ('abacatepay', $1, $2) ON CONFLICT DO NOTHING RETURNING evento_id`, [ev.eventoId, ev.evento])).rowCount);
  if (!novo) return res.status(200).json({ ok: true, repetido: true });

  const externoId = ev.cobranca?.externoId;
  const cobrancaId = ev.cobranca?.metadata?.cobrancaId || null;
  const cob = await comoSistema(async (c) => (await c.query(
    `SELECT * FROM cobrancas WHERE provedor = 'abacatepay' AND (externo_id = $1 OR id::text = $2) LIMIT 1`, [externoId || '', cobrancaId || ''])).rows[0]);
  if (!cob) { console.warn('[abacatepay] evento para cobrança desconhecida', ev.evento, externoId); return res.status(200).json({ ok: true, ignorado: true }); }
  await comoSistema((c) => c.query(`UPDATE webhook_eventos SET cobranca_id = $2 WHERE provedor = 'abacatepay' AND evento_id = $1`, [ev.eventoId, cob.id]));

  const status = String(ev.cobranca?.status || '').toUpperCase();
  if (ev.evento === 'transparent.completed' || ['PAID', 'COMPLETE', 'APPROVED'].includes(status)) {
    await cobrancas.confirmarPagamento(cob.id, { via: 'webhook', comprovanteUrl: ev.cobranca?.comprovanteUrl, pagaEm: ev.cobranca?.pagaEm, eventoId: ev.eventoId });
  } else if (ev.evento === 'transparent.refunded' || status === 'REFUNDED') {
    await comoSistema((c) => c.query(`UPDATE cobrancas SET status = 'estornada', atualizada_em = now() WHERE id = $1`, [cob.id]));
    await cobrancas.registrarEstorno(cob);
  } else if (ev.evento === 'transparent.disputed') {
    await comoSistema((c) => c.query(`UPDATE cobrancas SET erro = coalesce(erro, '') || ' Pagamento em disputa no provedor.', atualizada_em = now() WHERE id = $1`, [cob.id]));
  }
  res.status(200).json({ ok: true });
}));

// =====================================================================
// Loja: situação do Pix, gerar cobrança pela equipe, listar, verificar, simular (sandbox)
// =====================================================================
const limite = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { mensagem: 'Muitas operações seguidas. Aguarde um minuto.' } });

export function cobrancaPublica(c) {
  const d = c.detalhes || {};
  return {
    id: c.id, codigo: c.codigo, conta: c.conta || 'rede', status: c.status, valor: Number(c.valor), verificadaEm: c.verificada_em, origem: c.origem, expiraEm: c.expira_em, pagaEm: c.paga_em, criadaEm: c.criada_em, devMode: c.dev_mode,
    brCode: c.status === 'pendente' ? c.br_code : null, qrBase64: c.status === 'pendente' ? c.qr_base64 : null, comprovanteUrl: c.comprovante_url, erro: c.erro,
    conversaId: c.conversa_id, contatoId: c.contato_id, reservaId: c.reserva_id,
    grupo: d.cotacao?.grupo || null, periodo: d.cotacao ? { retirada: d.cotacao.retirada, devolucao: d.cotacao.devolucao } : null,
    cliente: d.cliente ? { nome: d.cliente.nome, cpfFinal: d.cliente.cpf_final } : null,
  };
}

pagamentosLoja.get('/pagamentos', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  const conta = await cobrancas.contaDaLoja(req.usuario.loja_id);
  res.json({ pix: conta.disponivel, conta: conta.conta, proprio: conta.proprio, chaveFinal: conta.chaveFinal, devMode: conta.devMode, redeTemChave: !!config.abacatepay?.chave, validadeMinutos: config.abacatepay?.validadeMinutos || null, varredura: cobrancas.varredura, versao: VERSAO });
}));

// ---------- conta própria da loja: cadastrar / testar / remover a chave do AbacatePay (só o dono; só se a administração ligou) ----------
pagamentosLoja.put('/pagamentos/chave', exigirPerfil('dono'), limite, rota(async (req, res) => {
  const { chave } = validar(z.object({ chave: z.string().trim().min(20, 'Cole a chave completa.').max(300) }), req.body);
  const r = await comContexto(ctx(req), async (c) => {
    const l = (await c.query('SELECT pix_proprio FROM lojas WHERE id = $1', [req.usuario.loja_id])).rows[0];
    if (!l?.pix_proprio) throw erro(403, 'O recebimento na conta própria precisa ser liberado pela administração da rede.');
    let teste;
    try { teste = await abacate.testarChave(chave); } catch (e) { throw erro(422, e.status === 401 || e.status === 403 ? 'O AbacatePay não aceitou esta chave. Confira se copiou a chave inteira.' : `Não foi possível validar a chave agora: ${String(e.message).slice(0, 120)}`, { chave: 'Chave recusada.' }); }
    await c.query('UPDATE lojas SET abacatepay_chave_cifrada = $2, abacatepay_chave_final = $3, abacatepay_dev = $4, abacatepay_testada_em = now() WHERE id = $1', [req.usuario.loja_id, cifrar(chave), chave.slice(-4), teste.devMode]);
    await registrar(c, req, 'cadastrou_chave_abacatepay', { lojaId: req.usuario.loja_id, detalhes: { final: chave.slice(-4), devMode: teste.devMode } });
    return teste;
  });
  const conta = await cobrancas.contaDaLoja(req.usuario.loja_id);
  res.json({ ok: true, devMode: r.devMode, conta: conta.conta, chaveFinal: conta.chaveFinal });
}));
pagamentosLoja.delete('/pagamentos/chave', exigirPerfil('dono'), rota(async (req, res) => {
  await comContexto(ctx(req), async (c) => {
    await c.query('UPDATE lojas SET abacatepay_chave_cifrada = NULL, abacatepay_chave_final = NULL, abacatepay_dev = NULL WHERE id = $1', [req.usuario.loja_id]);
    await registrar(c, req, 'removeu_chave_abacatepay', { lojaId: req.usuario.loja_id });
  });
  res.status(204).end();
}));

pagamentosLoja.get('/cobrancas', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  const q = validar(z.object({ conversa: zUuid.optional(), situacao: z.enum(['pendentes', 'todas']).default('todas') }), req.query);
  const params = [req.usuario.loja_id];
  let filtro = '';
  if (q.conversa) { params.push(q.conversa); filtro += ` AND conversa_id = $${params.length}`; }
  if (q.situacao === 'pendentes') filtro += ` AND status = 'pendente'`;
  const rows = await comContexto(ctx(req), async (c) => (await c.query(`SELECT * FROM cobrancas WHERE loja_id = $1 ${filtro} ORDER BY criada_em DESC LIMIT 200`, params)).rows);
  res.set('X-Conecta-Varredura', cobrancas.varredura.ativa ? 'ativa' : 'inativa');
  res.json(rows.map(cobrancaPublica));
}));

// verifica no provedor (e confirma se já pago)
pagamentosLoja.post('/cobrancas/:id/verificar', exigirPerfil('dono', 'atendente'), limite, rota(async (req, res) => {
  const id = zUuid.safeParse(req.params.id).success ? req.params.id : null;
  const cob = id && await comContexto(ctx(req), async (c) => (await c.query('SELECT id FROM cobrancas WHERE id = $1 AND loja_id = $2', [id, req.usuario.loja_id])).rows[0]);
  if (!cob) throw erro(404, 'Cobrança não encontrada.');
  let r;
  try { r = await cobrancas.verificarCobranca(cob.id); } catch (e) { throw erro(502, `Não foi possível consultar o AbacatePay: ${String(e.message).slice(0, 160)}`); }
  res.json(cobrancaPublica(r));
}));

// simula o pagamento — só funciona com chave de sandbox (devMode); em produção o AbacatePay recusa
pagamentosLoja.post('/cobrancas/:id/simular', exigirPerfil('dono', 'atendente'), limite, rota(async (req, res) => {
  const id = zUuid.safeParse(req.params.id).success ? req.params.id : null;
  const cob = id && await comContexto(ctx(req), async (c) => (await c.query('SELECT * FROM cobrancas WHERE id = $1 AND loja_id = $2', [id, req.usuario.loja_id])).rows[0]);
  if (!cob) throw erro(404, 'Cobrança não encontrada.');
  if (!cob.dev_mode) throw erro(409, 'Simulação só em ambiente de teste (chave de sandbox do AbacatePay).');
  if (cob.status !== 'pendente') throw erro(409, 'Esta cobrança não está pendente.');
  try { await abacate.simularPagamento(cob.externo_id, { chave: await cobrancas.chaveDaCobranca(cob) }); } catch (e) { throw erro(502, `O AbacatePay não aceitou a simulação: ${String(e.message).slice(0, 160)}`); }
  await comContexto(ctx(req), (c) => registrar(c, req, 'pix_simulado', { alvo: cob.id }));
  // o webhook deve chegar em seguida; se não chegar, a consulta confirma
  const r = await cobrancas.verificarCobranca(cob.id).catch(() => null);
  res.json(cobrancaPublica(r || cob));
}));

// =====================================================================
// Relatório de pagamentos online (conciliação do repasse franqueador → loja).
// Loja: dono vê o próprio; rede: administração e matriz veem por loja. Só números e códigos — sem CPF.
// =====================================================================
const zPeriodoRel = z.object({
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  loja: zUuid.optional(),
  filial: z.coerce.number().int().positive().optional(),
});
function periodoRelatorio(q) {
  const hoje = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
  const de = q.de || hoje.slice(0, 8) + '01';
  const ate = q.ate || hoje;
  if (ate < de) throw erro(422, 'Confira o período.', { ate: 'A data final precisa ser depois da inicial.' });
  return { de, ate };
}
const SQL_PAGOS = `
  SELECT c.id, c.codigo, c.conta, c.loja_id, l.nome AS loja_nome, c.valor, c.taxa, c.status, c.origem, c.paga_em, c.criada_em, c.dev_mode, c.externo_id, c.comprovante_url,
         r.codigo AS reserva_codigo, r.retirada, r.devolucao, r.grupo, r.branch_id, fi.nome AS filial_nome, ct.nome AS cliente_nome, u.nome AS usuario_nome
    FROM cobrancas c JOIN lojas l ON l.id = c.loja_id
    LEFT JOIN reservas r ON r.id = c.reserva_id LEFT JOIN filiais fi ON fi.branch_id = r.branch_id LEFT JOIN contatos ct ON ct.id = c.contato_id LEFT JOIN usuarios u ON u.id = c.usuario_id
   WHERE c.status IN ('paga', 'estornada') AND c.paga_em >= ($1::date)::timestamptz + interval '3 hours' AND c.paga_em < ($2::date + 1)::timestamptz + interval '3 hours'`;

function itemRelatorio(x) {
  return {
    id: x.id, codigo: x.codigo, conta: x.conta || 'rede', loja: { id: x.loja_id, nome: x.loja_nome }, pagaEm: x.paga_em, valor: Number(x.valor), taxa: x.taxa != null ? Number(x.taxa) : null, liquido: Number(x.valor) - Number(x.taxa || 0),
    status: x.status, origem: x.origem, por: x.usuario_nome || (x.origem === 'assistente' ? 'Assistente' : null), devMode: x.dev_mode, externoId: x.externo_id, comprovanteUrl: x.comprovante_url,
    reserva: x.reserva_codigo ? { codigo: x.reserva_codigo, retirada: x.retirada, devolucao: x.devolucao, grupo: x.grupo, filial: x.filial_nome || null, branchId: x.branch_id || null } : null, cliente: x.cliente_nome || null,
  };
}
// totais por filial (reservas sem filial — antigas — ficam em "Sem filial")
function porFilial(itens) {
  const m = new Map();
  for (const i of itens) { const k = i.reserva?.branchId || 0; const p = m.get(k) || { filial: { branchId: k || null, nome: i.reserva?.filial || (k ? `filial ${k}` : 'Sem filial') }, itens: [] }; p.itens.push(i); m.set(k, p); }
  return [...m.values()].map((p) => ({ filial: p.filial, ...totais(p.itens) })).sort((a, b) => b.liquido - a.liquido);
}
function totais(itens) {
  const pagas = itens.filter((i) => i.status === 'paga');
  const t = { quantidade: pagas.length, bruto: 0, taxas: 0, liquido: 0, estornadas: itens.filter((i) => i.status === 'estornada').length, valorEstornado: 0, aRepassar: 0, naContaDaLoja: 0 };
  for (const i of pagas) { t.bruto += i.valor; t.taxas += i.taxa || 0; t.liquido += i.liquido; if (i.conta === 'loja') t.naContaDaLoja += i.liquido; else t.aRepassar += i.liquido; }
  for (const i of itens.filter((x) => x.status === 'estornada')) t.valorEstornado += i.valor;
  return t;
}
const cel = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
const brl = (v) => (v == null ? '' : Number(v).toFixed(2).replace('.', ','));
const dataHoraBr = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Bahia' }) : '');
function csvRelatorio(itens, { comLoja }) {
  const cab = [...(comLoja ? ['Loja'] : []), 'Pago em', 'Código do pagamento', 'Reserva', 'Filial', 'Cliente', 'Grupo', 'Retirada', 'Devolução', 'Valor (R$)', 'Taxa (R$)', 'Líquido (R$)', 'Situação', 'Conta', 'Origem', 'Cobrança AbacatePay', 'Ambiente'];
  const linhas = [cab.map(cel).join(';')];
  for (const i of itens) linhas.push([...(comLoja ? [i.loja.nome] : []), dataHoraBr(i.pagaEm), i.codigo, i.reserva?.codigo, i.reserva?.filial, i.cliente, i.reserva?.grupo, dataHoraBr(i.reserva?.retirada), dataHoraBr(i.reserva?.devolucao), brl(i.valor), brl(i.taxa), brl(i.liquido), i.status, i.conta === 'loja' ? 'conta da loja' : 'conta da rede', i.por || i.origem, i.externoId, i.devMode ? 'teste' : 'produção'].map(cel).join(';'));
  const t = totais(itens);
  linhas.push(''); linhas.push(['TOTAL PAGO', '', '', '', '', '', '', '', t.quantidade + ' pagamento(s)', brl(t.bruto), brl(t.taxas), brl(t.liquido)].map(cel).join(';'));
  return '\ufeff' + linhas.join('\r\n');
}

pagamentosLoja.get('/pagamentos/relatorio', exigirPerfil('dono'), rota(async (req, res) => {
  const q = validar(zPeriodoRel, req.query); const { de, ate } = periodoRelatorio(q);
  const params = [de, ate, req.usuario.loja_id]; let filtro = '';
  if (q.filial) { params.push(q.filial); filtro = ` AND r.branch_id = $${params.length}`; }
  const rows = await comContexto(ctx(req), async (c) => (await c.query(`${SQL_PAGOS} AND c.loja_id = $3 ${filtro} ORDER BY c.paga_em DESC`, params)).rows);
  const itens = rows.map(itemRelatorio);
  const conta = await cobrancas.contaDaLoja(req.usuario.loja_id);
  res.json({ periodo: { de, ate }, totais: totais(itens), filiais: porFilial(itens), itens, pix: conta.disponivel, conta: conta.conta, proprio: conta.proprio });
}));

pagamentosLoja.get('/pagamentos/relatorio.csv', exigirPerfil('dono'), rota(async (req, res) => {
  const { de, ate } = periodoRelatorio(validar(zPeriodoRel, req.query));
  const q = validar(zPeriodoRel, req.query);
  const params = [de, ate, req.usuario.loja_id]; let filtro = '';
  if (q.filial) { params.push(q.filial); filtro = ` AND r.branch_id = $${params.length}`; }
  const rows = await comContexto(ctx(req), async (c) => { await registrar(c, req, 'exportou_pagamentos', { detalhes: { de, ate, filial: q.filial || null } }); return (await c.query(`${SQL_PAGOS} AND c.loja_id = $3 ${filtro} ORDER BY c.paga_em`, params)).rows; });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="pagamentos-pix-${de}-a-${ate}.csv"`);
  res.send(csvRelatorio(rows.map(itemRelatorio), { comLoja: false }));
}));

pagamentosAdmin.get('/pagamentos/relatorio', exigirPerfil('admin', 'matriz'), rota(async (req, res) => {
  const q = validar(zPeriodoRel, req.query); const { de, ate } = periodoRelatorio(q);
  const params = [de, ate]; let filtro = '';
  if (q.loja) { params.push(q.loja); filtro = ` AND c.loja_id = $${params.length}`; }
  const rows = await comContexto(ctx(req), async (c) => (await c.query(`${SQL_PAGOS} ${filtro} ORDER BY c.paga_em DESC`, params)).rows);
  const itens = rows.map(itemRelatorio);
  const porLoja = new Map();
  for (const i of itens) { const p = porLoja.get(i.loja.id) || { loja: i.loja, itens: [] }; p.itens.push(i); porLoja.set(i.loja.id, p); }
  res.json({ periodo: { de, ate }, totais: totais(itens), lojas: [...porLoja.values()].map((p) => ({ loja: p.loja, conta: p.itens.some((i) => i.conta === 'loja') ? (p.itens.every((i) => i.conta === 'loja') ? 'loja' : 'mista') : 'rede', ...totais(p.itens), filiais: porFilial(p.itens) })).sort((a, b) => b.liquido - a.liquido), itens, pix: cobrancas.pixDisponivel() });
}));

pagamentosAdmin.get('/pagamentos/relatorio.csv', exigirPerfil('admin', 'matriz'), rota(async (req, res) => {
  const q = validar(zPeriodoRel, req.query); const { de, ate } = periodoRelatorio(q);
  const params = [de, ate]; let filtro = '';
  if (q.loja) { params.push(q.loja); filtro = ` AND c.loja_id = $${params.length}`; }
  const rows = await comContexto(ctx(req), async (c) => { await registrar(c, req, 'exportou_pagamentos_rede', { detalhes: { de, ate, loja: q.loja || null } }); return (await c.query(`${SQL_PAGOS} ${filtro} ORDER BY l.nome, c.paga_em`, params)).rows; });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="repasses-pix-${de}-a-${ate}.csv"`);
  res.send(csvRelatorio(rows.map(itemRelatorio), { comLoja: true }));
}));

export const _relatorio = { itemRelatorio, totais, csvRelatorio, periodoRelatorio };
