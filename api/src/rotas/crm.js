// Etapa 5: CRM — clientes, funil, tarefas, modelos de mensagem e mensagens ativas.
import { Router } from 'express';
import { z } from 'zod';
import { comContexto, contextoDoUsuario } from '../banco/conexao.js';
import { cifrar } from '../servicos/seguranca.js';
import { evolution } from '../servicos/canais/evolution.js';
import { cpfValido } from '../servicos/locarx/ferramentas.js';
import { garantirModelos, preencherModelo, quandoTexto } from '../servicos/crm/modelos.js';
import { garantirFunil } from '../servicos/crm/funis.js';
import { listarEtiquetas, etiquetaPublica } from '../servicos/crm/personalizacao.js';
import { rota, erro, validar, zUuid, zEmail, exigirPerfil, registrar } from '../http.js';

export const crm = Router(); // /api/crm
const provedores = { evolution };
const ctx = (req) => contextoDoUsuario(req.usuario);
const uuid = (id) => { if (!zUuid.safeParse(id).success) throw erro(404, 'Não encontrado.'); return id; };
const loja = exigirPerfil('dono', 'atendente');

// ---------- clientes ----------
function contatoPublico(k) {
  return {
    id: k.id, nome: k.nome, telefone: k.telefone, igUsername: k.ig_username || null, email: k.email, etiquetas: k.etiquetas || [], observacoes: k.observacoes || '',
    cpf: k.cpf_final ? `***.***.***-${k.cpf_final}` : null, optout: k.optout, criadoEm: k.criado_em,
    ultimaConversa: k.ultima_mensagem_em || null, conversaId: k.conversa_id || null, etapa: k.etapa || null, reservas: k.qtd_reservas != null ? Number(k.qtd_reservas) : undefined,
  };
}

const SQL_CONTATOS = `
  SELECT k.*, cv.id AS conversa_id, cv.ultima_mensagem_em,
         (SELECT json_build_object('nome', e.nome, 'cor', e.cor, 'tipo', e.tipo, 'funil', f.nome)
            FROM oportunidades o JOIN etapas_funil e ON e.id = o.etapa_id JOIN funis f ON f.id = o.funil_id
           WHERE o.contato_id = k.id ORDER BY o.fechada_em IS NULL DESC, f.principal DESC, o.atualizada_em DESC LIMIT 1) AS etapa,
         (SELECT coalesce(json_agg(json_build_object('id', t.id, 'nome', t.nome, 'cor', t.cor) ORDER BY lower(t.nome)), '[]')
            FROM contato_etiquetas ce JOIN etiquetas t ON t.id = ce.etiqueta_id WHERE ce.contato_id = k.id) AS etiquetas,
         (SELECT count(*) FROM reservas r WHERE r.contato_id = k.id AND r.status <> 'cancelada') AS qtd_reservas
    FROM contatos k LEFT JOIN conversas cv ON cv.contato_id = k.id`;

crm.get('/contatos', loja, rota(async (req, res) => {
  const q = validar(z.object({ busca: z.string().trim().max(60).optional(), etiqueta: zUuid.optional(), pagina: z.coerce.number().int().min(1).max(1000).default(1) }), req.query);
  const params = [req.usuario.loja_id];
  let filtro = '';
  if (q.busca) {
    params.push('%' + q.busca.replace(/[%_\\]/g, '\\$&') + '%');
    const dig = q.busca.replace(/\D/g, '');
    params.push(dig ? '%' + dig + '%' : '__nada__');
    filtro += ` AND (k.nome ILIKE $${params.length - 1} OR k.email ILIKE $${params.length - 1} OR k.telefone LIKE $${params.length})`;
  }
  if (q.etiqueta) { params.push(q.etiqueta); filtro += ` AND EXISTS (SELECT 1 FROM contato_etiquetas ce WHERE ce.contato_id = k.id AND ce.etiqueta_id = $${params.length})`; }
  params.push((q.pagina - 1) * 50);
  const r = await comContexto(ctx(req), async (c) => ({
    rows: (await c.query(`${SQL_CONTATOS} WHERE k.loja_id = $1 ${filtro} ORDER BY coalesce(cv.ultima_mensagem_em, k.criado_em) DESC LIMIT 50 OFFSET $${params.length}`, params)).rows,
    total: Number((await c.query(`SELECT count(*) FROM contatos k WHERE k.loja_id = $1 ${filtro}`, params.slice(0, -1))).rows[0].count),
    etiquetas: (await listarEtiquetas(c, req.usuario.loja_id)).map(etiquetaPublica),
  }));
  res.json({ contatos: r.rows.map(contatoPublico), total: r.total, etiquetas: r.etiquetas });
}));

crm.get('/contatos/:id', loja, rota(async (req, res) => {
  const id = uuid(req.params.id);
  const r = await comContexto(ctx(req), async (c) => {
    const k = (await c.query(`${SQL_CONTATOS} WHERE k.id = $1 AND k.loja_id = $2`, [id, req.usuario.loja_id])).rows[0];
    if (!k) throw erro(404, 'Cliente não encontrado.');
    return {
      k,
      reservas: (await c.query(`SELECT id, codigo, status, retirada, devolucao, grupo, valor FROM reservas WHERE contato_id = $1 ORDER BY retirada DESC LIMIT 20`, [id])).rows,
      oportunidades: (await c.query(`SELECT o.id, o.valor_previsto, o.motivo_perda, o.resultado, o.criada_em, o.atualizada_em, o.fechada_em, e.nome AS etapa_nome, e.cor AS etapa_cor, f.nome AS funil_nome
          FROM oportunidades o JOIN etapas_funil e ON e.id = o.etapa_id JOIN funis f ON f.id = o.funil_id WHERE o.contato_id = $1 ORDER BY o.criada_em DESC LIMIT 20`, [id])).rows,
      tarefas: (await c.query(`SELECT t.*, u.nome AS responsavel_nome FROM tarefas t LEFT JOIN usuarios u ON u.id = t.responsavel_id WHERE t.contato_id = $1 ORDER BY t.feita_em NULLS FIRST, t.vence_em LIMIT 30`, [id])).rows,
      janela: (await c.query(`SELECT ultima_do_cliente FROM conversas WHERE contato_id = $1`, [id])).rows[0]?.ultima_do_cliente || null,
    };
  });
  res.json({
    ...contatoPublico(r.k),
    janelaAbertaAte: r.janela ? new Date(new Date(r.janela).getTime() + 24 * 3_600_000) : null,
    reservas: r.reservas.map((x) => ({ ...x, valor: x.valor != null ? Number(x.valor) : null })),
    oportunidades: r.oportunidades.map((o) => ({ id: o.id, funil: o.funil_nome, etapa: { nome: o.etapa_nome, cor: o.etapa_cor }, resultado: o.resultado, valor: o.valor_previsto != null ? Number(o.valor_previsto) : null, motivoPerda: o.motivo_perda, criadaEm: o.criada_em, fechadaEm: o.fechada_em })),
    tarefas: r.tarefas.map(tarefaPublica),
  });
}));

const zTelefone = z.string().transform((t) => t.replace(/\D/g, '')).pipe(z.string().regex(/^\d{10,13}$/, 'Informe o telefone com DDD.'))
  .transform((t) => (t.length <= 11 ? '55' + t : t));

crm.post('/contatos', loja, rota(async (req, res) => {
  const d = validar(z.object({ telefone: zTelefone, nome: z.string().trim().min(2, 'Informe o nome.').max(120) }), req.body);
  const k = await comContexto(ctx(req), async (c) => (await c.query(
    `INSERT INTO contatos (loja_id, telefone, nome) VALUES ($1, $2, $3) RETURNING *`, [req.usuario.loja_id, d.telefone, d.nome])).rows[0])
    .catch((e) => { if (e.code === '23505') throw erro(422, 'Confira os campos.', { telefone: 'Já existe um cliente com este telefone.' }); throw e; });
  res.status(201).json(contatoPublico(k));
}));

crm.patch('/contatos/:id', loja, rota(async (req, res) => {
  const id = uuid(req.params.id);
  const d = validar(z.object({
    nome: z.string().trim().min(2).max(120).optional(),
    email: zEmail.or(z.literal('')).optional(),
    cpf: z.string().optional().refine((v) => !v || cpfValido(v), 'CPF inválido.'),
    observacoes: z.string().max(4000).optional(),
    optout: z.boolean().optional(),
  }), req.body);
  const k = await comContexto(ctx(req), async (c) => {
    const cpf = d.cpf ? d.cpf.replace(/\D/g, '') : null;
    const r = (await c.query(
      `UPDATE contatos SET nome = coalesce($3, nome), email = CASE WHEN $4::text IS NULL THEN email ELSE nullif($4, '') END,
         cpf_cifrado = coalesce($5, cpf_cifrado), cpf_final = coalesce($6, cpf_final),
         observacoes = coalesce($7, observacoes), optout = coalesce($8, optout), atualizado_em = now()
       WHERE id = $1 AND loja_id = $2 RETURNING *`,
      [id, req.usuario.loja_id, d.nome ?? null, d.email ?? null, cpf ? cifrar(cpf) : null, cpf ? cpf.slice(-2) : null,
        d.observacoes ?? null, d.optout ?? null])).rows[0];
    if (!r) throw erro(404, 'Cliente não encontrado.');
    if (d.cpf) await registrar(c, req, 'editou_cpf_cliente', { alvo: id });
    return (await c.query(`${SQL_CONTATOS} WHERE k.id = $1`, [id])).rows[0];
  });
  res.json(contatoPublico(k));
}));

// exportação para planilha (sem CPF). Protege contra fórmulas maliciosas no Excel.
crm.get('/contatos.csv', exigirPerfil('dono'), rota(async (req, res) => {
  const rows = await comContexto(ctx(req), async (c) => {
    await registrar(c, req, 'exportou_clientes');
    return (await c.query(`${SQL_CONTATOS} WHERE k.loja_id = $1 ORDER BY k.nome NULLS LAST`, [req.usuario.loja_id])).rows;
  });
  const cel = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const linhas = [['Nome', 'Telefone', 'E-mail', 'Etiquetas', 'Etapa', 'Reservas', 'Não quer mensagens', 'Cliente desde'].map(cel).join(';')];
  for (const k of rows) linhas.push([k.nome, '+' + k.telefone, k.email, (k.etiquetas || []).map((e) => e.nome).join(', '), k.etapa?.nome, k.qtd_reservas, k.optout ? 'sim' : 'não', new Date(k.criado_em).toLocaleDateString('pt-BR')].map(cel).join(';'));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="clientes-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + linhas.join('\r\n'));
}));

// ---------- funil (quadro de um funil da loja) ----------
const valorNum = (v) => (v != null ? Number(v) : null);
function oportunidadePublica(o) {
  return {
    id: o.id, funilId: o.funil_id, etapaId: o.etapa_id, resultado: o.resultado, valor: valorNum(o.valor_previsto), motivoPerda: o.motivo_perda,
    contato: { id: o.contato_id, nome: o.nome, telefone: o.telefone, etiquetas: o.etiquetas || [] }, conversaId: o.conversa_id_atual || o.conversa_id,
    responsavel: o.responsavel_id ? { id: o.responsavel_id, nome: o.responsavel_nome } : null, atualizadaEm: o.atualizada_em, criadaEm: o.criada_em, fechadaEm: o.fechada_em,
  };
}

crm.get('/funil', loja, rota(async (req, res) => {
  const q = validar(z.object({ funil: zUuid.optional() }), req.query);
  const r = await comContexto(ctx(req), async (c) => {
    const principal = await garantirFunil(c, req.usuario.loja_id);
    const funilId = q.funil || principal;
    const f = (await c.query('SELECT id FROM funis WHERE id = $1 AND loja_id = $2 AND NOT arquivado', [funilId, req.usuario.loja_id])).rows[0];
    if (!f) throw erro(404, 'Funil não encontrado.');
    const rows = (await c.query(
      `SELECT o.*, k.nome, k.telefone, u.nome AS responsavel_nome, cv.id AS conversa_id_atual,
              (SELECT coalesce(json_agg(json_build_object('id', t.id, 'nome', t.nome, 'cor', t.cor) ORDER BY lower(t.nome)), '[]')
                 FROM contato_etiquetas ce JOIN etiquetas t ON t.id = ce.etiqueta_id WHERE ce.contato_id = k.id) AS etiquetas
         FROM oportunidades o JOIN contatos k ON k.id = o.contato_id LEFT JOIN usuarios u ON u.id = o.responsavel_id LEFT JOIN conversas cv ON cv.contato_id = k.id
        WHERE o.loja_id = $1 AND o.funil_id = $2 AND (o.fechada_em IS NULL OR o.fechada_em > now() - interval '30 days')
        ORDER BY o.atualizada_em DESC LIMIT 800`, [req.usuario.loja_id, f.id])).rows;
    return { funilId: f.id, rows };
  });
  res.json({ funilId: r.funilId, oportunidades: r.rows.map(oportunidadePublica) });
}));

crm.post('/oportunidades', loja, rota(async (req, res) => {
  const { contatoId, funilId, valor } = validar(z.object({ contatoId: zUuid, funilId: zUuid.optional(), valor: z.coerce.number().min(0).max(1_000_000).optional() }), req.body);
  const o = await comContexto(ctx(req), async (c) => {
    const k = (await c.query('SELECT id FROM contatos WHERE id = $1 AND loja_id = $2', [contatoId, req.usuario.loja_id])).rows[0];
    if (!k) throw erro(404, 'Cliente não encontrado.');
    const fid = funilId || await garantirFunil(c, req.usuario.loja_id);
    const etapa = (await c.query(`SELECT e.id FROM etapas_funil e JOIN funis f ON f.id = e.funil_id
       WHERE f.id = $1 AND f.loja_id = $2 AND NOT f.arquivado AND e.tipo = 'aberta' ORDER BY e.ordem LIMIT 1`, [fid, req.usuario.loja_id])).rows[0];
    if (!etapa) throw erro(404, 'Funil não encontrado.');
    return (await c.query(`INSERT INTO oportunidades (loja_id, contato_id, funil_id, etapa_id, valor_previsto, responsavel_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.usuario.loja_id, contatoId, fid, etapa.id, valor ?? null, req.usuario.id])).rows[0];
  }).catch((e) => { if (e.code === '23505') throw erro(409, 'Este cliente já está em andamento neste funil.'); throw e; });
  res.status(201).json({ id: o.id, funilId: o.funil_id, etapaId: o.etapa_id });
}));

// mover de etapa (inclusive para outro funil da loja), mudar valor ou responsável
crm.patch('/oportunidades/:id', loja, rota(async (req, res) => {
  const id = uuid(req.params.id);
  const d = validar(z.object({
    etapaId: zUuid.optional(),
    motivoPerda: z.string().trim().max(200).optional(),
    valor: z.coerce.number().min(0).max(1_000_000).nullable().optional(),
    responsavelId: zUuid.nullable().optional(),
  }), req.body);
  const o = await comContexto(ctx(req), async (c) => {
    const atual = (await c.query('SELECT * FROM oportunidades WHERE id = $1 AND loja_id = $2 FOR UPDATE', [id, req.usuario.loja_id])).rows[0];
    if (!atual) throw erro(404, 'Oportunidade não encontrada.');
    if (d.responsavelId) {
      const ok = (await c.query(`SELECT 1 FROM usuarios WHERE id = $1 AND loja_id = $2 AND status = 'ativo'`, [d.responsavelId, req.usuario.loja_id])).rowCount;
      if (!ok) throw erro(422, 'Escolha alguém da equipe.');
    }
    let etapa = null;
    if (d.etapaId) {
      etapa = (await c.query(`SELECT e.* FROM etapas_funil e JOIN funis f ON f.id = e.funil_id WHERE e.id = $1 AND f.loja_id = $2 AND NOT f.arquivado`, [d.etapaId, req.usuario.loja_id])).rows[0];
      if (!etapa) throw erro(422, 'Etapa não encontrada.');
      if (etapa.tipo === 'perdido' && (!d.motivoPerda || d.motivoPerda.length < 2)) throw erro(422, 'Informe o motivo da perda.', { motivoPerda: 'Informe o motivo da perda.' });
    }
    const fecha = etapa && etapa.tipo !== 'aberta';
    const r = (await c.query(
      `UPDATE oportunidades SET
         funil_id = coalesce($3, funil_id), etapa_id = coalesce($4, etapa_id),
         resultado = CASE WHEN $4::uuid IS NULL THEN resultado WHEN $5 THEN $6 ELSE NULL END,
         fechada_em = CASE WHEN $4::uuid IS NULL THEN fechada_em WHEN $5 THEN coalesce(fechada_em, now()) ELSE NULL END,
         motivo_perda = CASE WHEN $4::uuid IS NULL THEN motivo_perda WHEN $6 = 'perdido' THEN $7 ELSE NULL END,
         valor_previsto = CASE WHEN $9 THEN $8 ELSE valor_previsto END, responsavel_id = CASE WHEN $11 THEN $10 ELSE responsavel_id END,
         atualizada_em = now()
       WHERE id = $1 AND loja_id = $2 RETURNING *`,
      [id, req.usuario.loja_id, etapa?.funil_id ?? null, etapa?.id ?? null, !!fecha, fecha ? etapa.tipo : null, d.motivoPerda ?? null,
        d.valor ?? null, d.valor !== undefined, d.responsavelId ?? null, d.responsavelId !== undefined])).rows[0];
    return r;
  }).catch((e) => { if (e.code === '23505') throw erro(409, 'Este cliente já está em andamento no outro funil.'); throw e; });
  res.json(oportunidadePublica(o));
}));

// ---------- tarefas ----------
function tarefaPublica(t) {
  return { id: t.id, titulo: t.titulo, venceEm: t.vence_em, feitaEm: t.feita_em, automatica: t.automatica, contatoId: t.contato_id, contatoNome: t.contato_nome || null, conversaId: t.conversa_id,
    responsavel: t.responsavel_id ? { id: t.responsavel_id, nome: t.responsavel_nome } : null };
}

crm.get('/tarefas', loja, rota(async (req, res) => {
  const q = validar(z.object({ situacao: z.enum(['abertas', 'feitas']).default('abertas'), minhas: z.enum(['0', '1']).default('0') }), req.query);
  const params = [req.usuario.loja_id];
  let filtro = q.situacao === 'abertas' ? 'AND t.feita_em IS NULL' : `AND t.feita_em > now() - interval '30 days'`;
  if (q.minhas === '1') { params.push(req.usuario.id); filtro += ` AND (t.responsavel_id = $2 OR t.responsavel_id IS NULL)`; }
  const rows = await comContexto(ctx(req), async (c) => (await c.query(
    `SELECT t.*, k.nome AS contato_nome, u.nome AS responsavel_nome FROM tarefas t LEFT JOIN contatos k ON k.id = t.contato_id LEFT JOIN usuarios u ON u.id = t.responsavel_id
      WHERE t.loja_id = $1 ${filtro} ORDER BY ${q.situacao === 'abertas' ? 't.vence_em' : 't.feita_em DESC'} LIMIT 300`, params)).rows);
  res.json(rows.map(tarefaPublica));
}));

crm.post('/tarefas', loja, rota(async (req, res) => {
  const d = validar(z.object({
    titulo: z.string().trim().min(2, 'Descreva a tarefa.').max(200), venceEm: z.string().datetime({ offset: true }),
    contatoId: zUuid.nullable().optional(), responsavelId: zUuid.nullable().optional(),
  }), req.body);
  const t = await comContexto(ctx(req), async (c) => {
    if (d.contatoId && !(await c.query('SELECT 1 FROM contatos WHERE id = $1 AND loja_id = $2', [d.contatoId, req.usuario.loja_id])).rowCount) throw erro(404, 'Cliente não encontrado.');
    if (d.responsavelId && !(await c.query(`SELECT 1 FROM usuarios WHERE id = $1 AND loja_id = $2 AND status = 'ativo'`, [d.responsavelId, req.usuario.loja_id])).rowCount) throw erro(422, 'Escolha alguém da equipe.');
    return (await c.query(`INSERT INTO tarefas (loja_id, contato_id, titulo, vence_em, responsavel_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.usuario.loja_id, d.contatoId || null, d.titulo, d.venceEm, d.responsavelId ?? req.usuario.id])).rows[0];
  });
  res.status(201).json(tarefaPublica(t));
}));

crm.patch('/tarefas/:id', loja, rota(async (req, res) => {
  const id = uuid(req.params.id);
  const { feita } = validar(z.object({ feita: z.boolean() }), req.body);
  const t = await comContexto(ctx(req), async (c) => (await c.query(
    `UPDATE tarefas SET feita_em = CASE WHEN $3 THEN now() ELSE NULL END WHERE id = $1 AND loja_id = $2 RETURNING *`, [id, req.usuario.loja_id, feita])).rows[0]);
  if (!t) throw erro(404, 'Tarefa não encontrada.');
  res.json(tarefaPublica(t));
}));

crm.delete('/tarefas/:id', loja, rota(async (req, res) => {
  await comContexto(ctx(req), (c) => c.query('DELETE FROM tarefas WHERE id = $1 AND loja_id = $2', [uuid(req.params.id), req.usuario.loja_id]));
  res.status(204).end();
}));

// ---------- modelos de mensagem ----------
crm.get('/modelos', loja, rota(async (req, res) => {
  const rows = await comContexto(ctx(req), (c) => garantirModelos(c, req.usuario.loja_id));
  res.json(rows.map((m) => ({
    chave: m.chave, nome: m.nome, texto: m.texto, automatico: m.automatico, ativo: m.ativo, quando: quandoTexto(m),
    daRede: m.da_rede, personalizado: m.personalizado, podeEditar: m.permite_editar,
  })));
}));

// A loja liga/desliga e, se a rede permitir, troca o texto. Voltar ao texto da rede = escrever o mesmo texto (ou usar "restaurar").
crm.put('/modelos/:chave', exigirPerfil('dono'), rota(async (req, res) => {
  const chave = String(req.params.chave);
  const d = validar(z.object({ texto: z.string().trim().min(2, 'Escreva o texto.').max(1000).optional(), ativo: z.boolean(), restaurar: z.boolean().optional() }), req.body);
  await comContexto(ctx(req), async (c) => {
    await garantirModelos(c, req.usuario.loja_id);
    const m = (await c.query('SELECT * FROM modelos_mensagem WHERE loja_id = $1 AND chave = $2', [req.usuario.loja_id, chave])).rows[0];
    if (!m) throw erro(404, 'Modelo não encontrado.');
    const rede = (await c.query('SELECT texto FROM modelos_mensagem WHERE loja_id IS NULL AND chave = $1', [chave])).rows[0];
    let texto = m.texto, personalizado = m.personalizado;
    if (d.restaurar && rede) { texto = rede.texto; personalizado = false; }
    else if (d.texto !== undefined && d.texto !== m.texto) {
      if (m.da_rede && !m.permite_editar) throw erro(403, 'A rede não permite alterar o texto deste modelo. Você pode desligá-lo.');
      texto = d.texto; personalizado = rede ? d.texto !== rede.texto : true;
    }
    await c.query('UPDATE modelos_mensagem SET texto = $3, personalizado = $4, desligado_loja = $5, ativo = $6 WHERE loja_id = $1 AND chave = $2',
      [req.usuario.loja_id, chave, texto, personalizado, !d.ativo, d.ativo]);
    await garantirModelos(c, req.usuario.loja_id); // se a rede desligou o modelo, continua desligado
  });
  res.json({ ok: true });
}));

// ---------- mensagem ativa (a loja inicia a conversa) ----------
// Regra do WhatsApp: fora de 24 h da última mensagem do cliente, só com modelo de mensagem.
crm.post('/contatos/:id/mensagem', loja, rota(async (req, res) => {
  const id = uuid(req.params.id);
  const d = validar(z.object({
    modelo: z.string().max(40).optional(), texto: z.string().trim().max(1000).optional(),
    variaveis: z.record(z.string().max(30), z.string().max(200)).optional(),
  }).refine((x) => x.modelo || x.texto, 'Escolha um modelo ou escreva a mensagem.'), req.body);
  const prep = await comContexto(ctx(req), async (c) => {
    const k = (await c.query('SELECT * FROM contatos WHERE id = $1 AND loja_id = $2', [id, req.usuario.loja_id])).rows[0];
    if (!k) throw erro(404, 'Cliente não encontrado.');
    if (!k.telefone) throw erro(422, 'Este cliente veio pelo Instagram e ainda não informou o WhatsApp. Responda pela própria conversa do Instagram.');
    const canal = (await c.query('SELECT * FROM canais WHERE loja_id = $1', [req.usuario.loja_id])).rows[0];
    if (!canal || canal.status !== 'conectado') throw erro(409, 'O WhatsApp da loja está desconectado.');
    const cv = (await c.query('SELECT * FROM conversas WHERE contato_id = $1', [id])).rows[0];
    const janelaAberta = cv?.ultima_do_cliente && Date.now() - new Date(cv.ultima_do_cliente) < 24 * 3_600_000;
    if (!janelaAberta && !d.modelo) throw erro(422, 'Passaram mais de 24 horas desde a última mensagem do cliente. Use um modelo de mensagem.');
    if (k.optout && !janelaAberta) throw erro(409, 'Este cliente pediu para não receber mensagens. Só dá para responder se ele escrever primeiro.');
    let texto = d.texto;
    if (d.modelo) {
      const modelos = await garantirModelos(c, req.usuario.loja_id);
      const m = modelos.find((x) => x.chave === d.modelo && x.ativo);
      if (!m) throw erro(422, 'Modelo de mensagem não encontrado ou desligado.');
      const lojaNome = (await c.query('SELECT nome FROM lojas WHERE id = $1', [req.usuario.loja_id])).rows[0].nome;
      texto = preencherModelo(m.texto, { nome: (k.nome || '').split(' ')[0] || 'cliente', loja: lojaNome, ...(d.variaveis || {}) });
      if (/\{[a-z_]+\}/.test(texto)) throw erro(422, 'Preencha todos os campos do modelo.', { variaveis: 'Faltam campos: ' + texto.match(/\{[a-z_]+\}/g).join(', ') });
    }
    return { k, canal, cv, texto };
  });
  let externoId;
  try { externoId = await provedores[prep.canal.provedor].enviarTexto(prep.canal.instancia, prep.k.telefone, prep.texto); }
  catch (e) { console.error('[mensagem ativa]', e.message); throw erro(502, 'A mensagem não foi enviada. Confira a conexão do WhatsApp.'); }
  const conversaId = await comContexto(ctx(req), async (c) => {
    let cvId = prep.cv?.id;
    if (!cvId) {
      cvId = (await c.query(`INSERT INTO conversas (loja_id, contato_id, estado, atendente_id, ultima_previa, humano_respondeu_em) VALUES ($1, $2, 'humano', $3, $4, now()) RETURNING id`,
        [req.usuario.loja_id, id, req.usuario.id, prep.texto.slice(0, 140)])).rows[0].id;
    } else {
      await c.query(`UPDATE conversas SET estado = 'humano', atendente_id = $2, ultima_previa = $3, ultima_mensagem_em = now(), humano_respondeu_em = now(), atualizada_em = now() WHERE id = $1`,
        [cvId, req.usuario.id, prep.texto.slice(0, 140)]);
    }
    await c.query(`INSERT INTO mensagens (conversa_id, loja_id, direcao, autor, autor_id, tipo, texto, externo_id) VALUES ($1, $2, 'saida', 'atendente', $3, 'texto', $4, $5)`,
      [cvId, req.usuario.loja_id, req.usuario.id, prep.texto, externoId]);
    await registrar(c, req, 'mensagem_ativa', { alvo: id, detalhes: { modelo: d.modelo || null } });
    return cvId;
  });
  res.status(201).json({ conversaId });
}));
