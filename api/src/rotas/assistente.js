// Etapa 3: configuração do assistente da loja, base de conhecimento, orientações da rede e perguntas sem resposta.
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { comContexto, comoSistema, contextoDoUsuario } from '../banco/conexao.js';
import { cifrar } from '../servicos/seguranca.js';
import { testarChave, conversarComIa } from '../servicos/ia/provedores.js';
import { testarAssistente, montarSistema } from '../servicos/ia/assistente.js';
import { dividirEmBlocos } from '../servicos/ia/conhecimento.js';
import { extrairTexto } from '../servicos/arquivos/extrair-texto.js';
import * as locarx from '../servicos/locarx/api-locarx.js';
import { resolverFilial, filiaisDaLoja, filiaisComPortal, filialPublica } from '../servicos/locarx/filiais.js';
import { rota, erro, validar, zUuid, exigirPerfil, registrar } from '../http.js';
import { moduloLigado } from '../servicos/modulos.js';

export const assistente = Router();   // /api/loja/...
export const conhecimento = Router(); // /api/conhecimento
export const rede = Router();         // /api/admin/...

const ctx = (req) => contextoDoUsuario(req.usuario);
const uuid = (id) => { if (!zUuid.safeParse(id).success) throw erro(404, 'Não encontrado.'); return id; };
const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function publico(a) {
  return {
    ativo: a.ativo, nome: a.nome, instrucoes: a.instrucoes, boasVindas: a.boas_vindas, msgAusencia: a.msg_ausencia, msgRepasse: a.msg_repasse,
    horario: a.horario, foraHorario: a.fora_horario, palavrasAtendente: a.palavras_atendente, retornoHoras: a.retorno_horas,
    provedor: a.provedor, modelo: a.modelo, temChave: !!a.chave_cifrada, chaveFinal: a.chave_final || null, temChaveAudio: !!a.chave_audio_cifrada,
    limiteDiario: a.limite_diario, silencioInicio: a.silencio_inicio, silencioFim: a.silencio_fim,
  };
}

async function garantirAssistente(c, lojaId) {
  let a = (await c.query('SELECT * FROM assistentes WHERE loja_id = $1', [lojaId])).rows[0];
  if (!a) {
    // loja nova recebe o modelo padrão definido pela rede
    const modelo = (await c.query('SELECT modelo_assistente FROM rede_config LIMIT 1')).rows[0]?.modelo_assistente || {};
    a = (await c.query(
      `INSERT INTO assistentes (loja_id, nome, instrucoes, boas_vindas, msg_ausencia, msg_repasse, horario)
       VALUES ($1, coalesce($2, 'Assistente LocarX'), coalesce($3, ''), coalesce($4, ''), coalesce($5, ''), coalesce($6, ''), coalesce($7, '{}'::jsonb)) RETURNING *`,
      [lojaId, modelo.nome || null, modelo.instrucoes || null, modelo.boasVindas || null, modelo.msgAusencia || null, modelo.msgRepasse || null, modelo.horario ? JSON.stringify(modelo.horario) : null])).rows[0];
  }
  return a;
}

// ---------- configuração ----------
assistente.get('/assistente', exigirPerfil('dono'), rota(async (req, res) => {
  const a = await comContexto(ctx(req), (c) => garantirAssistente(c, req.usuario.loja_id));
  res.json({ ...publico(a), iaSimulada: config.iaSimulada, apiLocarx: !!config.locarx });
}));

const zHorario = z.record(z.enum(DIAS), z.tuple([z.string().regex(HORA), z.string().regex(HORA)]).nullable())
  .refine((h) => Object.values(h).every((f) => !f || f[0] < f[1]), 'O horário de fechar precisa ser depois do de abrir.');

assistente.put('/assistente', exigirPerfil('dono'), rota(async (req, res) => {
  const d = validar(z.object({
    ativo: z.boolean(),
    nome: z.string().trim().min(2, 'Informe o nome do assistente.').max(60),
    instrucoes: z.string().max(8000, 'Máximo de 8.000 caracteres.'),
    boasVindas: z.string().max(1000),
    msgAusencia: z.string().max(1000),
    msgRepasse: z.string().max(1000),
    horario: zHorario,
    foraHorario: z.enum(['assistente', 'mensagem']),
    palavrasAtendente: z.array(z.string().trim().min(2).max(40)).max(30),
    retornoHoras: z.coerce.number().int().min(0).max(72),
    limiteDiario: z.coerce.number().int().min(0).max(100000),
    silencioInicio: z.coerce.number().int().min(0).max(23),
    silencioFim: z.coerce.number().int().min(0).max(23),
  }), req.body);
  const a = await comContexto(ctx(req), async (c) => {
    const atual = await garantirAssistente(c, req.usuario.loja_id);
    if (d.ativo && !atual.chave_cifrada && !config.iaSimulada) throw erro(422, 'Cadastre a chave da IA antes de ligar o assistente.', { ativo: 'Cadastre a chave da IA antes de ligar.' });
    const r = (await c.query(
      `UPDATE assistentes SET ativo = $2, nome = $3, instrucoes = $4, boas_vindas = $5, msg_ausencia = $6, msg_repasse = $7, horario = $8,
         fora_horario = $9, palavras_atendente = $10, retorno_horas = $11, limite_diario = $12, silencio_inicio = $13, silencio_fim = $14, atualizado_em = now()
       WHERE loja_id = $1 RETURNING *`,
      [req.usuario.loja_id, d.ativo, d.nome, d.instrucoes, d.boasVindas, d.msgAusencia, d.msgRepasse, JSON.stringify(d.horario), d.foraHorario,
        d.palavrasAtendente.map((p) => p.toLowerCase()), d.retornoHoras, d.limiteDiario, d.silencioInicio, d.silencioFim])).rows[0];
    await registrar(c, req, 'configurou_assistente', { detalhes: { ativo: d.ativo } });
    return r;
  });
  res.json(publico(a));
}));

assistente.post('/assistente/chave', exigirPerfil('dono'), rota(async (req, res) => {
  const d = validar(z.object({
    provedor: z.enum(['anthropic', 'openai']),
    modelo: z.string().trim().min(3).max(80).regex(/^[\w.:-]+$/, 'Nome de modelo inválido.'),
    chave: z.string().trim().min(20, 'Chave inválida.').max(300).regex(/^[\w-]+$/, 'Chave inválida.').optional(),
    tipo: z.enum(['principal', 'audio']).default('principal'),
  }), req.body);
  if (d.tipo === 'principal' && d.chave) {
    try { await testarChave({ provedor: d.provedor, chave: d.chave, modelo: d.modelo }); } catch (e) {
      throw erro(422, 'A chave não funcionou.', { chave: `A ${d.provedor === 'openai' ? 'OpenAI' : 'Anthropic'} recusou: ${e.message.slice(0, 160)}` });
    }
  }
  const a = await comContexto(ctx(req), async (c) => {
    await garantirAssistente(c, req.usuario.loja_id);
    let r;
    if (d.tipo === 'audio') {
      r = (await c.query(`UPDATE assistentes SET chave_audio_cifrada = $2, atualizado_em = now() WHERE loja_id = $1 RETURNING *`, [req.usuario.loja_id, d.chave ? cifrar(d.chave) : null])).rows[0];
    } else if (d.chave) {
      r = (await c.query(`UPDATE assistentes SET provedor = $2, modelo = $3, chave_cifrada = $4, chave_final = $5, atualizado_em = now() WHERE loja_id = $1 RETURNING *`,
        [req.usuario.loja_id, d.provedor, d.modelo, cifrar(d.chave), d.chave.slice(-4)])).rows[0];
    } else {
      r = (await c.query(`UPDATE assistentes SET modelo = $2, atualizado_em = now() WHERE loja_id = $1 AND provedor = $3 RETURNING *`, [req.usuario.loja_id, d.modelo, d.provedor])).rows[0];
      if (!r) throw erro(422, 'Para trocar de empresa de IA, informe a chave nova.', { chave: 'Informe a chave da nova empresa de IA.' });
    }
    await registrar(c, req, d.tipo === 'audio' ? 'chave_audio' : 'chave_ia', { detalhes: { provedor: d.provedor, modelo: d.modelo } });
    return r;
  });
  res.json(publico(a));
}));

assistente.delete('/assistente/chave', exigirPerfil('dono'), rota(async (req, res) => {
  const a = await comContexto(ctx(req), async (c) => {
    const r = (await c.query(`UPDATE assistentes SET chave_cifrada = NULL, chave_final = NULL, ativo = false, atualizado_em = now() WHERE loja_id = $1 RETURNING *`, [req.usuario.loja_id])).rows[0];
    await registrar(c, req, 'removeu_chave_ia');
    return r;
  });
  res.json(publico(a));
}));

assistente.post('/assistente/testar', exigirPerfil('dono'), rota(async (req, res) => {
  const { historico } = validar(z.object({
    historico: z.array(z.object({ papel: z.enum(['cliente', 'assistente']), texto: z.string().trim().min(1).max(2000) })).min(1).max(30),
  }), req.body);
  try { res.json(await testarAssistente(req.usuario.loja_id, historico)); } catch (e) {
    if (e.status === 400) throw erro(400, e.message);
    console.error('[testar assistente]', e.message);
    throw erro(502, `A IA não respondeu: ${e.message.slice(0, 160)}`);
  }
}));

// ---------- perguntas sem resposta ----------
assistente.get('/perguntas', exigirPerfil('dono'), rota(async (req, res) => {
  const rows = await comContexto(ctx(req), async (c) => (await c.query(
    `SELECT id, pergunta, conversa_id, criada_em FROM perguntas_sem_resposta WHERE loja_id = $1 AND NOT resolvida ORDER BY criada_em DESC LIMIT 100`, [req.usuario.loja_id])).rows);
  res.json(rows.map((r) => ({ id: r.id, pergunta: r.pergunta, conversaId: r.conversa_id, criadaEm: r.criada_em })));
}));
assistente.post('/perguntas/:id/resolver', exigirPerfil('dono'), rota(async (req, res) => {
  await comContexto(ctx(req), (c) => c.query('UPDATE perguntas_sem_resposta SET resolvida = true WHERE id = $1 AND loja_id = $2', [uuid(req.params.id), req.usuario.loja_id]));
  res.status(204).end();
}));

// =====================================================================
// Base de conhecimento (rede: administração/matriz; loja: dono aprova, atendente sugere)
// =====================================================================
function quemAprova(u, escopo) { return escopo === 'rede' ? ['admin', 'matriz'].includes(u.perfil) : u.perfil === 'dono'; }
function podeEditar(u, escopo) { return escopo === 'rede' ? ['admin', 'matriz'].includes(u.perfil) : ['dono', 'atendente'].includes(u.perfil); }
const itemPublico = (k) => ({ id: k.id, escopo: k.escopo, titulo: k.titulo, conteudo: k.conteudo, status: k.status, autor: k.autor_nome || null, criadoEm: k.criado_em, atualizadoEm: k.atualizado_em });

// base da loja só com o módulo liberado (a da rede continua visível para todos)
conhecimento.use((req, res, next) => {
  const escopo = req.query?.escopo || req.body?.escopo || (Array.isArray(req.body?.itens) ? req.body.itens[0]?.escopo : null) || 'loja';
  if (escopo === 'loja' && req.usuario?.loja_id && !moduloLigado(req.usuario.loja_modulos, 'base')) return next(erro(403, 'A base de conhecimento da loja não está liberada para a sua loja. Fale com a administração da rede.'));
  next();
});
conhecimento.get('/', rota(async (req, res) => {
  const q = validar(z.object({ escopo: z.enum(['rede', 'loja']).default('loja'), status: z.enum(['pendente', 'aprovado', 'arquivado', 'todos']).default('todos'), busca: z.string().trim().max(80).optional() }), req.query);
  if (q.escopo === 'loja' && !req.usuario.loja_id) throw erro(400, 'Base de loja só existe para usuários de loja.');
  const params = [q.escopo];
  let filtro = 'k.escopo = $1';
  if (q.escopo === 'loja') { params.push(req.usuario.loja_id); filtro += ` AND k.loja_id = $${params.length}`; }
  if (q.status !== 'todos') { params.push(q.status); filtro += ` AND k.status = $${params.length}`; } else filtro += ` AND k.status <> 'arquivado'`;
  if (q.busca) { params.push('%' + q.busca.replace(/[%_\\]/g, '\\$&') + '%'); filtro += ` AND (k.titulo ILIKE $${params.length} OR k.conteudo ILIKE $${params.length})`; }
  const rows = await comContexto(ctx(req), async (c) => (await c.query(
    `SELECT k.*, u.nome AS autor_nome FROM conhecimento k LEFT JOIN usuarios u ON u.id = k.criado_por WHERE ${filtro} ORDER BY k.status = 'pendente' DESC, k.titulo LIMIT 500`, params)).rows);
  res.json(rows.map(itemPublico));
}));

const zItem = z.object({
  escopo: z.enum(['rede', 'loja']),
  titulo: z.string().trim().min(2, 'Informe o título (a pergunta ou o assunto).').max(200),
  conteudo: z.string().trim().min(2, 'Escreva o conteúdo.').max(6000, 'Máximo de 6.000 caracteres. Divida em mais de um item.'),
});

async function salvarItens(req, itens) {
  return comContexto(ctx(req), async (c) => {
    const salvos = [];
    for (const d of itens) {
      if (!podeEditar(req.usuario, d.escopo)) throw erro(403, 'Você não pode alterar esta base.');
      const status = quemAprova(req.usuario, d.escopo) ? 'aprovado' : 'pendente';
      const k = (await c.query(
        `INSERT INTO conhecimento (escopo, loja_id, titulo, conteudo, status, criado_por, aprovado_por) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [d.escopo, d.escopo === 'loja' ? req.usuario.loja_id : null, d.titulo, d.conteudo, status, req.usuario.id, status === 'aprovado' ? req.usuario.id : null])).rows[0];
      salvos.push(k);
    }
    await registrar(c, req, 'conhecimento_incluido', { detalhes: { quantidade: itens.length, escopo: itens[0]?.escopo } });
    return salvos;
  });
}

conhecimento.post('/', rota(async (req, res) => {
  const d = validar(zItem, req.body);
  const [k] = await salvarItens(req, [d]);
  res.status(201).json(itemPublico(k));
}));

conhecimento.post('/lote', rota(async (req, res) => {
  const { itens } = validar(z.object({ itens: z.array(zItem).min(1).max(100) }), req.body);
  const salvos = await salvarItens(req, itens);
  res.status(201).json({ salvos: salvos.length });
}));

conhecimento.put('/:id', rota(async (req, res) => {
  const id = uuid(req.params.id);
  const d = validar(zItem.omit({ escopo: true }), req.body);
  const k = await comContexto(ctx(req), async (c) => {
    const atual = (await c.query('SELECT * FROM conhecimento WHERE id = $1', [id])).rows[0];
    if (!atual || !podeEditar(req.usuario, atual.escopo)) throw erro(404, 'Item não encontrado.');
    const status = quemAprova(req.usuario, atual.escopo) ? 'aprovado' : 'pendente';
    return (await c.query(`UPDATE conhecimento SET titulo = $2, conteudo = $3, status = $4, aprovado_por = $5, atualizado_em = now() WHERE id = $1 RETURNING *`,
      [id, d.titulo, d.conteudo, status, status === 'aprovado' ? req.usuario.id : null])).rows[0];
  });
  res.json(itemPublico(k));
}));

conhecimento.post('/:id/:acao(aprovar|arquivar)', rota(async (req, res) => {
  const id = uuid(req.params.id);
  const k = await comContexto(ctx(req), async (c) => {
    const atual = (await c.query('SELECT * FROM conhecimento WHERE id = $1', [id])).rows[0];
    if (!atual || !quemAprova(req.usuario, atual.escopo)) throw erro(403, 'Só quem aprova a base pode fazer isso.');
    const r = (await c.query(`UPDATE conhecimento SET status = $2, aprovado_por = $3, atualizado_em = now() WHERE id = $1 RETURNING *`,
      [id, req.params.acao === 'aprovar' ? 'aprovado' : 'arquivado', req.usuario.id])).rows[0];
    await registrar(c, req, `conhecimento_${req.params.acao}`, { alvo: id });
    return r;
  });
  res.json(itemPublico(k));
}));

// importar: texto colado ou arquivo (PDF/Word) → blocos para revisar antes de salvar
// Importa do portal, para a base DESTA loja, o endereço, os horários e as políticas de uma filial (com várias filiais, cada
// uma ganha os próprios itens, com o nome da filial no título). Entra como pendente até o dono aprovar.
conhecimento.post('/importar-portal', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  if (!config.locarx) throw erro(503, 'API LocarX não configurada no servidor.');
  const { filialId } = validar(z.object({ filialId: z.string().max(60).optional() }), req.body || {});
  const filial = await comContexto(ctx(req), async (c) => { try { return await resolverFilial(c, req.usuario.loja_id, filialId); } catch (e) { throw erro(422, e.message); } });
  if (!filial) throw erro(409, 'Esta loja ainda não está vinculada a uma filial do portal.');
  const varias = (await comContexto(ctx(req), (c) => filiaisDaLoja(c, req.usuario.loja_id))).length > 1;
  const sufixo = varias ? ` — ${filial.nome}` : '';
  const itens = [];
  let dados = null;
  try { dados = await locarx.dadosDaFilial(filial.branchId); } catch (e) { throw erro(502, `Não foi possível ler a filial no portal: ${e.motivo || e.message}`); }
  if (dados) {
    const linhas = [dados.nome ? `Filial: ${dados.nome}` : null, dados.endereco ? `Endereço: ${dados.endereco}` : null, dados.horariosTexto ? `Horário de atendimento:\n${dados.horariosTexto}` : null, dados.especiaisTexto ? `Atendimento especial (fora do horário):\n${dados.especiaisTexto}` : null].filter(Boolean);
    if (linhas.length) itens.push({ titulo: `Endereço e horários${sufixo}`, conteudo: linhas.join('\n\n').slice(0, 6000) });
  }
  try { for (const it of await locarx.politicasDoPortal(filial.branchId)) itens.push({ titulo: `${it.titulo}${sufixo}`.slice(0, 200), conteudo: it.conteudo }); } catch { /* políticas são opcionais aqui */ }
  if (!itens.length) throw erro(409, 'O portal não devolveu informações para esta filial.');
  const r = await comContexto(ctx(req), async (c) => {
    const existentes = new Set((await c.query(`SELECT lower(titulo) AS t FROM conhecimento WHERE escopo = 'loja' AND loja_id = $1 AND status <> 'arquivado'`, [req.usuario.loja_id])).rows.map((x) => x.t));
    const incluidos = [], ignorados = [];
    for (const it of itens) {
      if (existentes.has(it.titulo.toLowerCase())) { ignorados.push(it.titulo); continue; }
      await c.query(`INSERT INTO conhecimento (escopo, loja_id, titulo, conteudo, status, criado_por) VALUES ('loja', $1, $2, $3, 'pendente', $4)`, [req.usuario.loja_id, it.titulo, it.conteudo, req.usuario.id]);
      incluidos.push(it.titulo);
    }
    await registrar(c, req, 'conhecimento_importado_portal', { lojaId: req.usuario.loja_id, detalhes: { incluidos: incluidos.length, ignorados: ignorados.length, filial: filial.branchId } });
    return { incluidos, ignorados };
  });
  res.json({ ...r, filial: filial.nome });
}));

conhecimento.post('/importar', rota(async (req, res) => {
  const d = validar(z.object({
    texto: z.string().max(400_000).optional(),
    arquivo: z.object({ tipo: z.enum(['pdf', 'docx']), base64: z.string().max(Math.ceil(10 * 1024 * 1024 * 4 / 3)) }).optional(),
  }).refine((x) => x.texto || x.arquivo, 'Cole um texto ou envie um arquivo.'), req.body);
  let texto = d.texto || '';
  if (d.arquivo) {
    try { texto = await extrairTexto(Buffer.from(d.arquivo.base64, 'base64'), d.arquivo.tipo); } catch (e) { throw erro(422, e.message); }
    if (!texto.trim()) throw erro(422, 'Não encontrei texto no arquivo. Se for um PDF escaneado (foto), copie e cole o texto.');
  }
  res.json({ blocos: dividirEmBlocos(texto) });
}));

// =====================================================================
// Prompt da Lia: regras da rede (entram no prompt de TODAS as lojas, inclusive a Central), com histórico de versões
// e prévia do prompt completo. Só administração e matriz. O roteiro fixo (reserva, proteções, ferramentas, datas,
// segurança) continua no código: aqui vai o que é regra de negócio e muda com o tempo.
// =====================================================================
const zPromptRede = z.object({ texto: z.string().max(20000, 'Máximo de 20.000 caracteres.'), motivo: z.string().trim().max(200).optional() });
const versaoPublica = (v) => ({ id: v.id, texto: v.texto, autor: v.autor_nome || null, motivo: v.motivo || null, criadaEm: v.criada_em });

rede.get('/prompt', exigirPerfil('admin', 'matriz'), rota(async (req, res) => {
  const r = await comContexto(ctx(req), async (c) => ({
    cfg: (await c.query('SELECT orientacoes_rede, atualizado_em FROM rede_config LIMIT 1')).rows[0],
    versoes: (await c.query('SELECT * FROM rede_prompt_versoes ORDER BY criada_em DESC LIMIT 30')).rows,
    lojas: (await c.query('SELECT id, nome, central FROM lojas WHERE ativa ORDER BY central DESC, nome')).rows,
  }));
  res.json({ texto: r.cfg?.orientacoes_rede || '', atualizadoEm: r.cfg?.atualizado_em || null, versoes: r.versoes.map(versaoPublica), lojas: r.lojas.map((l) => ({ id: l.id, nome: l.nome, central: !!l.central })) });
}));

rede.put('/prompt', exigirPerfil('admin', 'matriz'), rota(async (req, res) => {
  const d = validar(zPromptRede, req.body);
  await comContexto(ctx(req), async (c) => {
    const atual = (await c.query('SELECT orientacoes_rede FROM rede_config LIMIT 1')).rows[0]?.orientacoes_rede || '';
    if (atual === d.texto) return;
    await c.query('UPDATE rede_config SET orientacoes_rede = $1, atualizado_em = now()', [d.texto]);
    await c.query('INSERT INTO rede_prompt_versoes (texto, autor_id, autor_nome, motivo) VALUES ($1, $2, $3, $4)', [d.texto, req.usuario.id, req.usuario.nome, d.motivo || null]);
    await registrar(c, req, 'editou_prompt_rede', { detalhes: { tamanho: d.texto.length, motivo: d.motivo || null } });
  });
  res.json({ ok: true });
}));

rede.post('/prompt/restaurar/:id', exigirPerfil('admin', 'matriz'), rota(async (req, res) => {
  if (!zUuid.safeParse(req.params.id).success) throw erro(404, 'Versão não encontrada.');
  await comContexto(ctx(req), async (c) => {
    const v = (await c.query('SELECT * FROM rede_prompt_versoes WHERE id = $1', [req.params.id])).rows[0];
    if (!v) throw erro(404, 'Versão não encontrada.');
    await c.query('UPDATE rede_config SET orientacoes_rede = $1, atualizado_em = now()', [v.texto]);
    await c.query('INSERT INTO rede_prompt_versoes (texto, autor_id, autor_nome, motivo) VALUES ($1, $2, $3, $4)', [v.texto, req.usuario.id, req.usuario.nome, `Restaurada a versão de ${new Date(v.criada_em).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })}`]);
    await registrar(c, req, 'restaurou_prompt_rede', { detalhes: { versao: v.id } });
  });
  res.json({ ok: true });
}));

// prévia do prompt completo como uma loja recebe (texto do sistema, sem dados de cliente real)
rede.get('/prompt/previa', exigirPerfil('admin', 'matriz'), rota(async (req, res) => {
  const lojaId = zUuid.safeParse(req.query.loja).success ? req.query.loja : null;
  const texto = await comoSistema(async (c) => {
    const loja = (await c.query(lojaId ? 'SELECT * FROM lojas WHERE id = $1' : 'SELECT * FROM lojas WHERE ativa ORDER BY central DESC, criada_em LIMIT 1', lojaId ? [lojaId] : [])).rows[0];
    if (!loja) throw erro(404, 'Loja não encontrada.');
    const a = (await c.query('SELECT * FROM assistentes WHERE loja_id = $1', [loja.id])).rows[0] || { nome: 'Lia', instrucoes: '', boas_vindas: '' };
    const redeCfg = (await c.query('SELECT * FROM rede_config LIMIT 1')).rows[0] || {};
    let filiais = [];
    try { filiais = (await filiaisComPortal(c, loja.id)).map(filialPublica); } catch { filiais = []; }
    return montarSistema({ loja, a, rede: redeCfg, contato: { nome: 'Cliente de exemplo' }, historicoReservas: [], crm: null, pix: !!config.abacatepay, filiais });
  });
  res.json({ texto });
}));

// Conferir conflitos: a IA compara as regras da rede (texto que o admin está escrevendo) com a parte FIXA do prompt
// e aponta contradições. Usa a chave de IA de uma loja ativa (a rede não tem chave própria). Só no clique.
rede.post('/prompt/conflitos', exigirPerfil('admin', 'matriz'), rota(async (req, res) => {
  const d = validar(z.object({ texto: z.string().max(20000) }), req.body);
  if (!d.texto.trim()) return res.json({ conflitos: [], resumo: 'Nenhuma regra escrita ainda.' });
  const r = await comoSistema(async (c) => {
    const a = (await c.query(`SELECT a.provedor, a.modelo, a.chave_cifrada, l.nome FROM assistentes a JOIN lojas l ON l.id = a.loja_id
                               WHERE a.chave_cifrada IS NOT NULL AND l.ativa ORDER BY l.central DESC, l.criada_em LIMIT 1`)).rows[0];
    if (!a) throw erro(409, 'Nenhuma loja ativa tem chave de IA cadastrada; a conferência usa a chave de uma loja.');
    const loja = (await c.query('SELECT * FROM lojas WHERE ativa ORDER BY central DESC, criada_em LIMIT 1')).rows[0];
    const fixo = montarSistema({ loja, a: { nome: 'Lia', instrucoes: '', boas_vindas: '' }, rede: { orientacoes_rede: '' }, contato: { nome: 'Cliente' }, historicoReservas: [], crm: null, pix: !!config.abacatepay, filiais: [] });
    return { a, fixo };
  });
  const sistema = `Você revisa regras de negócio escritas pela administração de uma rede de locadoras para um assistente virtual. Receberá (1) o PROMPT FIXO do assistente, que não pode ser alterado, e (2) as REGRAS DA REDE escritas pela administração. Aponte SOMENTE contradições reais entre as regras e o prompt fixo (ex.: a regra diz "pode reservar com 12 h" e o fixo exige 24 h; a regra manda cancelar pelo assistente e o fixo proíbe). Ignore complementos, detalhes e estilo. Responda em JSON puro, sem markdown: {"conflitos":[{"regra":"trecho da regra","fixo":"o que o prompt fixo diz","efeito":"o que a Lia vai fazer na prática (o fixo prevalece)","sugestao":"como reescrever ou o que pedir ao desenvolvedor"}],"resumo":"uma frase"}. Se não houver contradição, "conflitos" vazio e o resumo diz isso.`;
  const pergunta = `PROMPT FIXO:\n"""\n${r.fixo}\n"""\n\nREGRAS DA REDE:\n"""\n${d.texto}\n"""`;
  const { decifrar } = await import('../servicos/seguranca.js');
  if (config.iaSimulada) return res.json({ conflitos: [], resumo: 'IA simulada: sem análise real.', usandoChaveDe: r.a.nome });
  const resp = await conversarComIa({ provedor: r.a.provedor, modelo: r.a.modelo, chave: decifrar(r.a.chave_cifrada), sistema, historico: [{ papel: 'cliente', texto: pergunta }], maxTokens: 1500 });
  let saida = { conflitos: [], resumo: '' };
  try { saida = JSON.parse(String(resp.texto || '').replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { saida = { conflitos: [], resumo: String(resp.texto || '').slice(0, 600) || 'A IA não devolveu uma análise legível. Tente de novo.' }; }
  saida.conflitos = Array.isArray(saida.conflitos) ? saida.conflitos.slice(0, 20).map((x) => ({ regra: String(x.regra || '').slice(0, 400), fixo: String(x.fixo || '').slice(0, 400), efeito: String(x.efeito || '').slice(0, 400), sugestao: String(x.sugestao || '').slice(0, 400) })) : [];
  res.json({ ...saida, usandoChaveDe: r.a.nome });
}));

// =====================================================================
// Rede: orientações gerais, modelo padrão do assistente e sinônimos
// =====================================================================
rede.get('/rede', exigirPerfil('admin', 'matriz'), rota(async (req, res) => {
  const r = await comContexto(ctx(req), async (c) => ({
    cfg: (await c.query('SELECT * FROM rede_config LIMIT 1')).rows[0],
    sinonimos: (await c.query('SELECT id, termos FROM sinonimos ORDER BY termos[1]')).rows,
  }));
  res.json({ orientacoes: r.cfg?.orientacoes_rede || '', modeloAssistente: r.cfg?.modelo_assistente || {}, sinonimos: r.sinonimos });
}));

rede.put('/rede', exigirPerfil('admin', 'matriz'), rota(async (req, res) => {
  const d = validar(z.object({
    orientacoes: z.string().max(20000, 'Máximo de 20.000 caracteres.').optional(),
    modeloAssistente: z.object({
      nome: z.string().trim().max(60).optional(), instrucoes: z.string().max(8000).optional(), boasVindas: z.string().max(1000).optional(),
      msgAusencia: z.string().max(1000).optional(), msgRepasse: z.string().max(1000).optional(), horario: zHorario.optional(),
    }),
  }), req.body);
  await comContexto(ctx(req), async (c) => {
    if (d.orientacoes !== undefined) await c.query('UPDATE rede_config SET orientacoes_rede = $1, atualizado_em = now()', [d.orientacoes]);
    await c.query('UPDATE rede_config SET modelo_assistente = $1, atualizado_em = now()', [JSON.stringify(d.modeloAssistente)]);
    await registrar(c, req, 'editou_orientacoes_rede');
  });
  res.json({ ok: true });
}));

// Importa as políticas oficiais do portal LocarX (texto do bloco comum da disponibilidade) como itens PENDENTES da base da rede.
// Não duplica: título já existente (não arquivado) é ignorado. A administração revisa, edita e aprova na tela.
rede.post('/rede/importar-politicas', exigirPerfil('admin', 'matriz'), rota(async (req, res) => {
  if (!config.locarx) throw erro(503, 'API LocarX não configurada no servidor.');
  // de qual filial ler (as políticas são da rede, mas o portal as devolve por filial): escolhida ou a primeira loja ativa
  const { branchId } = validar(z.object({ branchId: z.coerce.number().int().positive().optional() }), req.body || {});
  const loja = await comContexto(ctx(req), async (c) => branchId
    ? (await c.query('SELECT f.branch_id, f.nome FROM filiais f WHERE f.branch_id = $1 UNION SELECT branch_id, nome FROM lojas WHERE branch_id = $1 LIMIT 1', [branchId])).rows[0] || { branch_id: branchId, nome: `filial ${branchId}` }
    : (await c.query('SELECT branch_id, nome FROM lojas WHERE ativa AND branch_id IS NOT NULL ORDER BY criada_em LIMIT 1')).rows[0]);
  if (!loja) throw erro(409, 'Cadastre pelo menos uma loja vinculada a uma filial do portal para importar as políticas.');
  let itens;
  try { itens = await locarx.politicasDoPortal(loja.branch_id); }
  catch (e) { throw erro(502, `Não foi possível ler as políticas no portal LocarX: ${e.motivo || e.message}`); }
  if (!itens.length) throw erro(409, `O portal não devolveu políticas para a filial da loja ${loja.nome}.`);
  const r = await comContexto(ctx(req), async (c) => {
    const existentes = new Set((await c.query(`SELECT lower(titulo) AS t FROM conhecimento WHERE escopo = 'rede' AND status <> 'arquivado'`)).rows.map((x) => x.t));
    const incluidos = [], ignorados = [];
    for (const it of itens) {
      if (existentes.has(it.titulo.toLowerCase())) { ignorados.push(it.titulo); continue; }
      await c.query(`INSERT INTO conhecimento (escopo, loja_id, titulo, conteudo, status, criado_por) VALUES ('rede', NULL, $1, $2, 'pendente', $3)`, [it.titulo, it.conteudo, req.usuario.id]);
      incluidos.push(it.titulo);
    }
    await registrar(c, req, 'conhecimento_importado_portal', { detalhes: { incluidos: incluidos.length, ignorados: ignorados.length, filial: loja.branch_id } });
    return { incluidos, ignorados };
  });
  res.json({ ...r, filial: loja.nome });
}));

rede.post('/sinonimos', exigirPerfil('admin', 'matriz'), rota(async (req, res) => {
  const { termos } = validar(z.object({ termos: z.array(z.string().trim().min(1).max(40)).min(2, 'Informe pelo menos 2 palavras.').max(20) }), req.body);
  const r = await comContexto(ctx(req), async (c) => (await c.query('INSERT INTO sinonimos (termos) VALUES ($1) RETURNING id, termos', [termos.map((t) => t.toLowerCase())])).rows[0]);
  res.status(201).json(r);
}));
rede.delete('/sinonimos/:id', exigirPerfil('admin', 'matriz'), rota(async (req, res) => {
  await comContexto(ctx(req), (c) => c.query('DELETE FROM sinonimos WHERE id = $1', [uuid(req.params.id)]));
  res.status(204).end();
}));

// =====================================================================
// Monitor do assistente (administração): cada resposta da IA em tempo real — loja, modelo, tokens, tempo,
// ferramentas chamadas, erros da API LocarX/IA e "promessas sem ação". Nada de conteúdo de conversa.
// A tela consulta a cada poucos segundos passando o último id visto (`desde`).
// =====================================================================
rede.get('/assistente/monitor', exigirPerfil('admin'), rota(async (req, res) => {
  const q = validar(z.object({
    desde: z.coerce.number().int().nonnegative().optional(),
    antes: z.coerce.number().int().positive().optional(),
    loja: zUuid.optional(),
    so: z.enum(['tudo', 'erros']).default('tudo'),
    limite: z.coerce.number().int().min(1).max(200).default(60),
  }), req.query);
  const params = [q.limite];
  let filtro = '';
  if (q.desde) { params.push(q.desde); filtro += ` AND u.id > $${params.length}`; }
  if (q.antes) { params.push(q.antes); filtro += ` AND u.id < $${params.length}`; }
  if (q.loja) { params.push(q.loja); filtro += ` AND u.loja_id = $${params.length}`; }
  if (q.so === 'erros') filtro += ' AND (u.ok = false OR u.erro IS NOT NULL)';
  const r = await comContexto(ctx(req), async (c) => ({
    itens: (await c.query(
      `SELECT u.id, u.criado_em, u.loja_id, l.nome AS loja_nome, u.conversa_id, u.provedor, u.modelo, u.tokens_in, u.tokens_out, u.ferramentas, u.ok, u.erro, u.detalhes, u.duracao_ms
         FROM uso_ia u JOIN lojas l ON l.id = u.loja_id
        WHERE true ${filtro}
        ORDER BY u.id DESC LIMIT $1`, params)).rows,
    resumo: (await c.query(
      `SELECT count(*)::int AS respostas,
              count(*) FILTER (WHERE NOT ok OR erro IS NOT NULL)::int AS com_erro,
              count(*) FILTER (WHERE detalhes @> '{"eventos":[{"tipo":"nudge"}]}')::int AS promessas,
              coalesce(avg(duracao_ms), 0)::int AS media_ms,
              coalesce(sum(tokens_in + tokens_out), 0)::bigint AS tokens,
              count(DISTINCT conversa_id)::int AS conversas
         FROM uso_ia WHERE criado_em > now() - interval '24 hours'`)).rows[0],
    porLoja: (await c.query(
      `SELECT l.id, l.nome, count(u.*)::int AS respostas, count(u.*) FILTER (WHERE NOT u.ok OR u.erro IS NOT NULL)::int AS com_erro, max(u.criado_em) AS ultima
         FROM lojas l LEFT JOIN uso_ia u ON u.loja_id = l.id AND u.criado_em > now() - interval '24 hours'
        WHERE l.ativa GROUP BY l.id, l.nome ORDER BY respostas DESC, l.nome`)).rows,
  }));
  res.json({
    resumo: { respostas: r.resumo.respostas, comErro: r.resumo.com_erro, promessas: r.resumo.promessas, mediaMs: r.resumo.media_ms, tokens: Number(r.resumo.tokens), conversas: r.resumo.conversas },
    porLoja: r.porLoja.map((x) => ({ id: x.id, nome: x.nome, respostas: x.respostas, comErro: x.com_erro, ultima: x.ultima })),
    itens: r.itens.map((u) => ({
      id: Number(u.id), em: u.criado_em, loja: { id: u.loja_id, nome: u.loja_nome }, conversaId: u.conversa_id, provedor: u.provedor, modelo: u.modelo,
      tokens: { entrada: u.tokens_in, saida: u.tokens_out }, ferramentas: u.ferramentas || [], ok: u.ok, erro: u.erro, duracaoMs: u.duracao_ms,
      eventos: u.detalhes?.eventos || [], semDetalhes: !u.detalhes, voltas: u.detalhes?.voltas ?? null, parada: u.detalhes?.parada ?? null, tamanho: u.detalhes?.tamanho ?? null, pedidoAtendente: u.detalhes?.pedidoAtendente ?? null,
    })),
  });
}));

// Ocorrências de reservas e cotações (equipe e assistente), com o motivo. Administração.
rede.get('/ocorrencias', exigirPerfil('admin'), rota(async (req, res) => {
  const q = validar(z.object({ desde: z.coerce.number().int().nonnegative().optional(), antes: z.coerce.number().int().positive().optional(), loja: zUuid.optional(), nivel: z.enum(['tudo', 'erro']).default('tudo'), limite: z.coerce.number().int().min(1).max(200).default(60) }), req.query);
  const params = [q.limite];
  let filtro = '';
  if (q.desde) { params.push(q.desde); filtro += ` AND o.id > $${params.length}`; }
  if (q.antes) { params.push(q.antes); filtro += ` AND o.id < $${params.length}`; }
  if (q.loja) { params.push(q.loja); filtro += ` AND o.loja_id = $${params.length}`; }
  if (q.nivel === 'erro') filtro += ` AND o.nivel IN ('erro', 'aviso')`;
  const rows = await comContexto(ctx(req), async (c) => (await c.query(
    `SELECT o.*, l.nome AS loja_nome, u.nome AS usuario_nome FROM ocorrencias o JOIN lojas l ON l.id = o.loja_id LEFT JOIN usuarios u ON u.id = o.usuario_id
      WHERE true ${filtro} ORDER BY o.id DESC LIMIT $1`, params)).rows);
  res.json(rows.map((o) => ({
    id: Number(o.id), em: o.criado_em, loja: { id: o.loja_id, nome: o.loja_nome }, conversaId: o.conversa_id, origem: o.origem, quem: o.usuario_nome || (o.origem === 'assistente' ? 'Assistente' : 'Sistema'),
    tipo: o.tipo, nivel: o.nivel, mensagem: o.mensagem, detalhes: o.detalhes,
  })));
}));
