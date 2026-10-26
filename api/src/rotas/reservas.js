// Etapa 4: reservas da loja, teste da API LocarX e servidor MCP (LocarX Tools para outros sistemas).
import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { comContexto, comoSistema, contextoDoUsuario } from '../banco/conexao.js';
import * as locarx from '../servicos/locarx/api-locarx.js';
import * as cotacao from '../servicos/locarx/cotacao.js';
import { registrarOcorrencia, detalhesDoErro } from '../servicos/ocorrencias.js';
import { ferramentasDaLoja, cpfValido, registrarReserva } from '../servicos/locarx/ferramentas.js';
import { iguais } from '../servicos/seguranca.js';
import { rota, erro, ErroApp, validar, zUuid, exigirPerfil, registrar } from '../http.js';

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

// ---------- cotação ao vivo (tela Cotação: dono e atendente) ----------
// A equipe informa só data e hora; a filial é a da loja do usuário logado (cada loja cota no próprio contexto).
const zData = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data.');
const zHora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Informe a hora.');
const zPeriodo = { dataRetirada: zData, horaRetirada: zHora, dataDevolucao: zData, horaDevolucao: zHora };
const limiteCotacao = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { mensagem: 'Muitas consultas seguidas. Aguarde um minuto.' } });

function periodoDaEquipe(d) {
  try {
    return cotacao.validarPeriodo({ data_retirada: d.dataRetirada, hora_retirada: d.horaRetirada, data_devolucao: d.dataDevolucao, hora_devolucao: d.horaDevolucao }, { antecedenciaHoras: 0 });
  } catch (e) { throw erro(422, e.message, { dataRetirada: e.message }); }
}

async function lojaDoUsuario(req) {
  const loja = await comContexto(ctx(req), async (c) => (await c.query('SELECT id, branch_id FROM lojas WHERE id = $1', [req.usuario.loja_id])).rows[0]);
  if (!loja?.branch_id) throw erro(409, 'Esta loja ainda não está vinculada a uma filial do portal LocarX. Peça à administração.');
  if (!config.locarx) throw erro(503, 'API LocarX não configurada no servidor.');
  return loja;
}

// Transforma qualquer falha da API LocarX numa mensagem clara para a tela (com o motivo que o portal deu, se houver).
function motivoDaApi(resposta) {
  if (!resposta) return '';
  const m = resposta.message || resposta.mensagem || resposta.error || resposta.erro || (Array.isArray(resposta.errors) ? resposta.errors.map((x) => x.message || x.defaultMessage || x).join('; ') : resposta.errors) || resposta.bruto;
  return m ? String(typeof m === 'string' ? m : JSON.stringify(m)).slice(0, 200) : '';
}
function erroLocarx(e) {
  if (e instanceof ErroApp) return e;
  console.error('[locarx]', e.message, e.resposta ? JSON.stringify(e.resposta).slice(0, 800) : '', e.stack?.split('\n').slice(1, 3).join(' | ') || '');
  if (e.status === 409 || e.status === 422) return erro(e.status, e.message);
  if (e.status === 503) return erro(503, 'API LocarX não configurada no servidor.');
  if (e.status === 404) return erro(502, 'A filial desta loja não foi encontrada no ambiente atual da API LocarX.');
  const motivo = motivoDaApi(e.resposta);
  if (e.status) return erro(502, `A API LocarX respondeu com erro (HTTP ${e.status})${motivo ? ': ' + motivo : ''}.`);
  return erro(502, `Falha ao falar com o portal LocarX: ${String(e.message || e).slice(0, 160)}`);
}

const grupoPublico = (g) => ({
  fleetId: g.fleetId, letra: g.rotulo.letra, nome: g.rotulo.nome, grupo: g.grupo, exemplos: g.exemplos, cambio: g.cambio,
  passageiros: g.passageiros, portas: g.portas, malas: g.malas, itens: g.itens, diaria: g.diaria, diarias: g.diarias, total: g.total,
  protecoes: g.protecoes.map((p) => ({ codigo: p.codigo, nome: p.nome, descricao: p.descricao, diaria: p.diaria, total: p.total, basica: p.base, padrao: p.padrao })),
});

reservas.post('/cotacao', exigirPerfil('dono', 'atendente'), limiteCotacao, rota(async (req, res) => {
  const d = validar(z.object(zPeriodo), req.body);
  const periodo = periodoDaEquipe(d);
  const loja = await lojaDoUsuario(req);
  let r;
  try { r = await cotacao.cotarPeriodo({ branchId: loja.branch_id, periodo }); } catch (e) {
    await registrarOcorrencia({ lojaId: loja.id, usuarioId: req.usuario.id, origem: 'equipe', tipo: 'cotacao', nivel: 'erro', mensagem: `Cotação falhou: ${erroLocarx(e).message}`, detalhes: detalhesDoErro(e, { periodo: d }) });
    throw erroLocarx(e);
  }
  const menos24h = periodo.ini < new Date(Date.now() + 24 * 3_600_000);
  const texto = r.grupos.length ? cotacao.textoOpcoes(r.grupos.slice(0, 3), { periodo: cotacao.periodoTexto({ data_retirada: d.dataRetirada, hora_retirada: d.horaRetirada, data_devolucao: d.dataDevolucao, hora_devolucao: d.horaDevolucao }), haMais: r.grupos.length > 3 }) : null;
  res.json({
    periodo: { retirada: periodo.retirada, devolucao: periodo.devolucao },
    grupos: r.grupos.map(grupoPublico),
    adicionais: r.adicionais, km: r.km, politicas: r.politicas,
    textoWhatsapp: texto,
    aviso: !r.grupos.length && menos24h ? 'O portal LocarX não mostra carros para retirada com menos de 24 horas. Para esse prazo, a reserva é feita direto no portal.' : null,
  });
}));

reservas.post('/cotacao/preco', exigirPerfil('dono', 'atendente'), limiteCotacao, rota(async (req, res) => {
  const d = validar(z.object({ ...zPeriodo, fleetId: z.coerce.number().int().positive(), protecoes: z.array(z.string().max(30)).max(5).default([]) }), req.body);
  const periodo = periodoDaEquipe(d);
  const loja = await lojaDoUsuario(req);
  const protecoes = cotacao.normalizarProtecoes(d.protecoes);
  let r;
  try { r = await locarx.calcularPreco({ branchId: loja.branch_id, fleetId: d.fleetId, retirada: periodo.retirada, devolucao: periodo.devolucao, protecoes }); } catch (e) { throw erroLocarx(e); }
  const rotulo = cotacao.rotuloGrupo({ grupo: r.grupo }, 1);
  const nomes = r.protecoes.length ? r.protecoes.map((x) => x.nome) : protecoes;
  res.json({
    fleetId: d.fleetId, grupo: r.grupo, letra: rotulo.letra, nome: rotulo.nome, total: r.total, diaria: r.diaria, diarias: r.diarias, taxas: r.taxas, protecoes: nomes,
    textoWhatsapp: `*${rotulo.letra} – ${rotulo.nome}*\n📅 Retirada: ${cotacao.dataBr(periodo.retirada)}\n📅 Devolução: ${cotacao.dataBr(periodo.devolucao)}\n🛡️ Proteção: ${nomes.join(', ')}\n💰 Total: *${cotacao.reais(r.total)}* (pagamento na loja, na retirada)`,
  });
}));

// ---------- reserva pela equipe (botão "Reservar" da cotação) ----------
// Dois passos, iguais aos do assistente: sem `confirmar`, devolve o resumo; com `confirmar: true`, cria no portal,
// grava no histórico da loja, na ficha do cliente e no funil, e registra o evento na conversa (se houver).
const zReservaEquipe = z.object({
  ...zPeriodo,
  fleetId: z.coerce.number().int().positive(),
  protecoes: z.array(z.string().max(30)).max(5).default([]),
  nome: z.string().trim().min(2, 'Informe o nome completo.').max(120).refine((v) => v.split(/\s+/).length >= 2, 'Informe o nome completo.'),
  cpf: z.string().trim().max(20).refine((v) => cpfValido(v), 'CPF inválido.'),
  email: z.string().trim().toLowerCase().max(254).email('Informe um e-mail válido.'),
  cnh: z.string().trim().max(20).optional().default('').refine((v) => !v || /^\d{9,11}$/.test(v.replace(/\D/g, '')), 'CNH parece incompleta (9 a 11 números).'),
  telefone: z.string().trim().max(20).optional().default(''),
  contatoId: zUuid.optional(),
  conversaId: zUuid.optional(),
  confirmar: z.boolean().default(false),
});

reservas.post('/reservas', exigirPerfil('dono', 'atendente'), limiteCotacao, rota(async (req, res) => {
  const d = validar(zReservaEquipe, req.body);
  const periodo = periodoDaEquipe(d);
  // a equipe pode reservar com menos de 24 h? Não pela API: ela não devolve carros nesse prazo.
  if (periodo.ini < new Date(Date.now() + 24 * 3_600_000)) throw erro(422, 'O portal LocarX só aceita reservas pela API com retirada a partir de 24 horas. Para esse prazo, reserve direto no portal.', { dataRetirada: 'Retirada com menos de 24 h.' });
  const loja = await lojaDoUsuario(req);
  const protecoes = cotacao.normalizarProtecoes(d.protecoes);

  // contato e conversa precisam ser desta loja (RLS já garante; aqui só para a mensagem de erro ficar clara)
  const vinculo = await comContexto(ctx(req), async (c) => ({
    contato: d.contatoId ? (await c.query('SELECT id, telefone, nome, email FROM contatos WHERE id = $1 AND loja_id = $2', [d.contatoId, loja.id])).rows[0] : null,
    conversa: d.conversaId ? (await c.query('SELECT id, contato_id FROM conversas WHERE id = $1 AND loja_id = $2', [d.conversaId, loja.id])).rows[0] : null,
  }));
  if (d.contatoId && !vinculo.contato) throw erro(404, 'Cliente não encontrado.');
  if (d.conversaId && !vinculo.conversa) throw erro(404, 'Conversa não encontrada.');
  const contatoId = vinculo.contato?.id || vinculo.conversa?.contato_id || null;
  const telefone = String(d.telefone || vinculo.contato?.telefone || '').replace(/\D/g, '');
  if (!telefone) throw erro(422, 'Confira os campos destacados.', { telefone: 'Informe o telefone do cliente.' });
  const cliente = { nome: d.nome, cpf: d.cpf.replace(/\D/g, ''), cnh: d.cnh.replace(/\D/g, ''), email: d.email, telefone };

  const base = { lojaId: loja.id, usuarioId: req.usuario.id, conversaId: vinculo.conversa?.id || null, origem: 'equipe', tipo: 'reserva' };
  const contexto = { fleetId: d.fleetId, protecoes, periodo: { retirada: periodo.retirada, devolucao: periodo.devolucao }, passo: d.confirmar ? 'confirmar' : 'resumo' };
  let preco;
  try { preco = await locarx.calcularPreco({ branchId: loja.branch_id, fleetId: d.fleetId, retirada: periodo.retirada, devolucao: periodo.devolucao, protecoes }); } catch (e) {
    const amigavel = erroLocarx(e);
    await registrarOcorrencia({ ...base, nivel: 'erro', mensagem: `Reserva não criada (cálculo do preço): ${amigavel.message}`, detalhes: detalhesDoErro(e, contexto) });
    throw amigavel;
  }
  const rotulo = cotacao.rotuloGrupo({ grupo: preco.grupo }, 1);
  const nomes = preco.protecoes.length ? preco.protecoes.map((x) => x.nome) : protecoes;
  const resumo = `*Resumo da reserva*\n🚗 ${rotulo.letra} – ${rotulo.nome}\n📅 Retirada: ${cotacao.dataBr(periodo.retirada)}\n📅 Devolução: ${cotacao.dataBr(periodo.devolucao)}\n🛡️ Proteção: ${nomes.join(', ')}\n💰 Total: *${cotacao.reais(preco.total)}* (pagamento na loja, na retirada)\n👤 ${cliente.nome} · CPF final ${cliente.cpf.slice(-2)} · ${cliente.email}`;
  if (!d.confirmar) return res.json({ passo: 'resumo', grupo: preco.grupo, letra: rotulo.letra, nome: rotulo.nome, total: preco.total, diarias: preco.diarias, protecoes: nomes, resumo });

  let reserva;
  try { reserva = await locarx.criarReserva({ branchId: loja.branch_id, fleetId: d.fleetId, retirada: periodo.retirada, devolucao: periodo.devolucao, protecoes, cliente }); } catch (e) {
    const amigavel = erroLocarx(e);
    await registrarOcorrencia({ ...base, nivel: 'erro', mensagem: `Reserva não criada: ${amigavel.message}`, detalhes: detalhesDoErro(e, contexto) });
    throw amigavel;
  }
  if (reserva.valor == null) reserva.valor = preco.total;
  if (!reserva.grupo) reserva.grupo = preco.grupo;
  // A partir daqui a reserva JÁ EXISTE no portal. Se algo falhar ao gravar no Conecta, o atendente ainda recebe o código
  // (com um aviso), para não criar a mesma reserva duas vezes.
  let reservaId = null, avisoGravacao = null;
  try {
    reservaId = await registrarReserva(
      { lojaId: loja.id, contatoId, conversaId: vinculo.conversa?.id || null, origem: 'equipe' },
      reserva, { ini: periodo.ini, fim: periodo.fim }, cliente, { fleetId: d.fleetId, protecoes, porUsuarioId: req.usuario.id },
    );
    await comContexto(ctx(req), async (c) => {
      if (vinculo.conversa) {
        await c.query(`INSERT INTO mensagens (conversa_id, loja_id, direcao, autor, tipo, texto) VALUES ($1, $2, 'interna', 'sistema', 'evento', $3)`,
          [vinculo.conversa.id, loja.id, `Reserva ${reserva.codigo || ''} criada por ${req.usuario.nome} (${cotacao.reais(reserva.valor)})`.trim()]);
        await c.query('UPDATE conversas SET atualizada_em = now() WHERE id = $1', [vinculo.conversa.id]);
      }
      await registrar(c, req, 'reserva_criar', { alvo: reservaId, detalhes: { codigo: reserva.codigo, fleetId: d.fleetId } });
    });
  } catch (e) {
    console.error('[reserva-equipe] reserva criada no portal mas falhou ao gravar no Conecta:', reserva.codigo, e);
    avisoGravacao = `A reserva ${reserva.codigo || ''} foi criada no portal, mas não ficou registrada no Conecta (${String(e.message || e).slice(0, 120)}). Anote o código e avise a administração.`;
    await registrarOcorrencia({ ...base, nivel: 'aviso', mensagem: `Reserva ${reserva.codigo || ''} criada no portal, mas não gravada no Conecta: ${String(e.message || e).slice(0, 200)}`, detalhes: { ...contexto, codigo: reserva.codigo, erro: String(e.stack || e).slice(0, 600) } });
  }
  if (!avisoGravacao) await registrarOcorrencia({ ...base, nivel: 'info', mensagem: `Reserva ${reserva.codigo || ''} criada por ${req.usuario.nome} (${cotacao.reais(reserva.valor)})`, detalhes: { ...contexto, codigo: reserva.codigo, total: reserva.valor } });
  const divergente = reserva.valor != null && preco.total != null && Math.abs(reserva.valor - preco.total) > 1;
  res.status(201).json({
    passo: 'criada', id: reservaId, codigo: reserva.codigo, total: reserva.valor, status: reserva.status,
    atencao: avisoGravacao || (divergente ? `O portal fechou a reserva em ${cotacao.reais(reserva.valor)} (a cotação mostrava ${cotacao.reais(preco.total)}).` : null),
    textoWhatsapp: `✅ *Reserva confirmada!*\nCódigo: *${reserva.codigo || '—'}*\n🚗 ${rotulo.letra} – ${rotulo.nome}\n📅 Retirada: ${cotacao.dataBr(periodo.retirada)}\n📅 Devolução: ${cotacao.dataBr(periodo.devolucao)}\n🛡️ ${nomes.join(', ')}\n💰 Total: *${cotacao.reais(reserva.valor)}*, pagamento na loja, na retirada.\nQualquer dúvida é só chamar por aqui!`,
  });
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
