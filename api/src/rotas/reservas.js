// Etapa 4: reservas da loja, teste da API LocarX e servidor MCP (LocarX Tools para outros sistemas).
import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { comContexto, comoSistema, contextoDoUsuario } from '../banco/conexao.js';
import * as locarx from '../servicos/locarx/api-locarx.js';
import { ferramentasDaLoja } from '../servicos/locarx/ferramentas.js';
import { iguais } from '../servicos/seguranca.js';
import { rota, erro, validar, zUuid, exigirPerfil } from '../http.js';

export const reservas = Router();     // /api/loja
export const locarxAdmin = Router();  // /api/admin
export const mcp = Router();          // /api/mcp

const ctx = (req) => contextoDoUsuario(req.usuario);

function reservaPublica(r) {
  return {
    id: r.id, codigo: r.codigo, status: r.status, retirada: r.retirada, devolucao: r.devolucao, grupo: r.grupo,
    valor: r.valor != null ? Number(r.valor) : null, origem: r.origem, criadaEm: r.criada_em,
    contato: r.contato_id ? { id: r.contato_id, nome: r.contato_nome, telefone: r.telefone } : null, conversaId: r.conversa_id,
  };
}

reservas.get('/reservas', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  const q = validar(z.object({ periodo: z.enum(['proximas', 'passadas', 'todas']).default('proximas'), busca: z.string().trim().max(60).optional() }), req.query);
  const params = [req.usuario.loja_id];
  let filtro = '';
  if (q.periodo === 'proximas') filtro += ` AND r.devolucao >= now() - interval '1 day'`;
  if (q.periodo === 'passadas') filtro += ` AND r.devolucao < now() - interval '1 day'`;
  if (q.busca) { params.push('%' + q.busca.replace(/[%_\\]/g, '\\$&') + '%'); filtro += ` AND (r.codigo ILIKE $${params.length} OR ct.nome ILIKE $${params.length} OR ct.telefone LIKE $${params.length})`; }
  const rows = await comContexto(ctx(req), async (c) => (await c.query(
    `SELECT r.*, ct.nome AS contato_nome, ct.telefone FROM reservas r LEFT JOIN contatos ct ON ct.id = r.contato_id
      WHERE r.loja_id = $1 ${filtro} ORDER BY r.retirada ${q.periodo === 'passadas' ? 'DESC' : 'ASC'} LIMIT 300`, params)).rows);
  res.json(rows.map(reservaPublica));
}));

// atualiza a situação consultando o portal LocarX
reservas.post('/reservas/:id/atualizar', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  if (!zUuid.safeParse(req.params.id).success) throw erro(404, 'Reserva não encontrada.');
  const r = await comContexto(ctx(req), async (c) => (await c.query('SELECT * FROM reservas WHERE id = $1 AND loja_id = $2', [req.params.id, req.usuario.loja_id])).rows[0]);
  if (!r?.codigo) throw erro(404, 'Reserva não encontrada.');
  let p;
  try { p = await locarx.buscarReserva(r.codigo); } catch (e) { throw erro(502, 'Não foi possível consultar o portal LocarX agora.'); }
  if (!p) throw erro(404, 'O portal LocarX não encontrou esta reserva.');
  const status = /CANCEL/i.test(p.status || '') ? 'cancelada' : /FINISH|CLOSED|CONCLU/i.test(p.status || '') ? 'concluida' : /OPEN|PICKED|RETIR|IN_PROGRESS/i.test(p.status || '') ? 'em andamento' : 'confirmada';
  const atual = await comContexto(ctx(req), async (c) => (await c.query(
    `UPDATE reservas SET status = $2, valor = coalesce($3, valor), grupo = coalesce($4, grupo), atualizada_em = now() WHERE id = $1 RETURNING *`,
    [r.id, status, p.valor, p.grupo])).rows[0]);
  res.json(reservaPublica(atual));
}));

// ---------- administração: filiais e diagnóstico da API LocarX ----------
locarxAdmin.get('/locarx/filiais', exigirPerfil('admin'), rota(async (req, res) => {
  try { res.json(await locarx.localidades()); } catch (e) { throw erro(e.status === 503 ? 503 : 502, e.status === 503 ? 'API LocarX não configurada no servidor (LOCARX_API_TOKEN).' : `A API LocarX respondeu com erro (${e.status || 'sem resposta'}).`); }
}));

locarxAdmin.get('/locarx/teste', exigirPerfil('admin'), rota(async (req, res) => {
  const { branchId } = validar(z.object({ branchId: z.coerce.number().int().positive() }), req.query);
  if (!config.locarx) throw erro(503, 'API LocarX não configurada no servidor (LOCARX_API_TOKEN).');
  res.json(await locarx.diagnostico(branchId));
}));

// =====================================================================
// Servidor MCP (JSON-RPC 2.0, "Streamable HTTP" simples, sem streaming)
// Uso por outros sistemas da rede: Authorization: Bearer <MCP_TOKEN> e X-Conecta-Filial: <branchId>
// Só ferramentas de consulta; reserva e cancelamento ficam restritos ao assistente do WhatsApp.
// =====================================================================
const SO_CONSULTA = ['buscar_informacoes', 'dados_da_loja', 'consultar_disponibilidade', 'calcular_preco', 'consultar_reserva'];
mcp.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));
mcp.post('/', rota(async (req, res) => {
  const token = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!config.mcpToken || !token || !iguais(token, config.mcpToken)) return res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Não autorizado' } });
  const { id = null, method, params = {} } = req.body || {};
  const responder = (result) => res.json({ jsonrpc: '2.0', id, result });
  const falhar = (code, message) => res.json({ jsonrpc: '2.0', id, error: { code, message } });
  if (method === 'initialize') return responder({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'locarx-tools', version: '1.0.0' } });
  if (method === 'notifications/initialized') return res.status(202).end();
  const branchId = Number(req.get('x-conecta-filial'));
  const loja = Number.isInteger(branchId) && branchId > 0 ? await comoSistema(async (c) => (await c.query('SELECT id, branch_id FROM lojas WHERE branch_id = $1 AND ativa', [branchId])).rows[0]) : null;
  if (!loja) return falhar(-32602, 'Informe X-Conecta-Filial com o branchId de uma loja ativa.');
  const ferramentas = ferramentasDaLoja({ lojaId: loja.id, branchId: loja.branch_id, locarxDisponivel: !!config.locarx, simulacao: false }).filter((f) => SO_CONSULTA.includes(f.nome));
  if (method === 'tools/list') return responder({ tools: ferramentas.map((f) => ({ name: f.nome, description: f.descricao, inputSchema: f.parametros })) });
  if (method === 'tools/call') {
    const f = ferramentas.find((x) => x.nome === params.name);
    if (!f) return falhar(-32602, 'Ferramenta não disponível.');
    try {
      const r = await f.executar(params.arguments || {});
      return responder({ content: [{ type: 'text', text: typeof r === 'string' ? r : JSON.stringify(r) }], isError: false });
    } catch (e) { return responder({ content: [{ type: 'text', text: e.message }], isError: true }); }
  }
  return falhar(-32601, 'Método não suportado.');
}));
