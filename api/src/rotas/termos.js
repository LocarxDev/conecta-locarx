// v14.5 — Termos de adesão (donos) e de privacidade (atendentes).
// Usuário: vê os pendentes e aceita. Administração: publica versões novas e consulta quem aceitou.
import { Router } from 'express';
import { z } from 'zod';
import { comContexto, comoSistema, contextoDoUsuario } from '../banco/conexao.js';
import { rota, erro, validar, zUuid, exigirPerfil, registrar, ipDe, navegadorDe } from '../http.js';
import { TIPOS, tiposDoPerfil, vigentes, pendentesDe, termoPublico, hashTexto } from '../servicos/termos.js';
import { docxParaTermo, limparHtml } from '../servicos/termos-docx.js';

export const termos = Router();        // /api/termos
export const termosAdmin = Router();   // /api/admin/termos
const ctx = (req) => contextoDoUsuario(req.usuario);
const uuid = (id) => { if (!zUuid.safeParse(id).success) throw erro(404, 'Termo não encontrado.'); return id; };

// ---------- usuário ----------
termos.get('/pendentes', rota(async (req, res) => {
  const lista = await comContexto(ctx(req), (c) => pendentesDe(c, req.usuario));
  res.json(lista.map(termoPublico));
}));

termos.post('/:id/aceitar', rota(async (req, res) => {
  const id = uuid(req.params.id);
  const { hash } = validar(z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/, 'Assinatura do texto inválida.') }), req.body);
  const restantes = await comContexto(ctx(req), async (c) => {
    const t = (await c.query('SELECT * FROM termos WHERE id = $1', [id])).rows[0];
    if (!t) throw erro(404, 'Termo não encontrado.');
    if (!(TIPOS[t.tipo]?.perfis || []).includes(req.usuario.perfil_base || req.usuario.perfil)) throw erro(403, 'Este termo não se aplica ao seu perfil.');
    if (hashTexto(t.texto) !== hash) throw erro(409, 'O texto do termo mudou enquanto você lia. Recarregue a página e leia a versão atual.');
    await c.query(
      `INSERT INTO aceites_termos (usuario_id, termo_id, tipo, versao, loja_id, nome, email, perfil, ip, navegador, hash_texto)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (usuario_id, termo_id) DO NOTHING`,
      [req.usuario.id, t.id, t.tipo, t.versao, req.usuario.loja_principal_id || req.usuario.loja_id || null, req.usuario.nome, req.usuario.email, req.usuario.perfil_base || req.usuario.perfil, ipDe(req), navegadorDe(req), hash]);
    await registrar(c, req, 'aceitou_termo', { detalhes: { tipo: t.tipo, versao: t.versao } });
    return pendentesDe(c, req.usuario);
  });
  res.json({ ok: true, pendentes: restantes.length });
}));

// ---------- administração ----------
const admin = exigirPerfil('admin', 'matriz');

termosAdmin.get('/termos', admin, rota(async (req, res) => {
  const r = await comContexto(ctx(req), async (c) => ({
    vigentes: await vigentes(c),
    versoes: (await c.query(`SELECT t.id, t.tipo, t.versao, t.titulo, t.publicado_em, u.nome AS publicado_por_nome, (SELECT count(*)::int FROM aceites_termos a WHERE a.termo_id = t.id) AS aceites
                               FROM termos t LEFT JOIN usuarios u ON u.id = t.publicado_por ORDER BY t.tipo, t.versao DESC`)).rows,
    // quantas pessoas ainda precisam aceitar a versão vigente de cada tipo
    // por tipo: quantas pessoas ativas do(s) perfil(is) ainda não aceitaram a versão vigente
    pendentes: (await c.query(`SELECT t.tipo, count(*)::int AS n FROM usuarios u
                                 JOIN termos t ON t.versao = (SELECT max(x.versao) FROM termos x WHERE x.tipo = t.tipo)
                                  AND t.tipo = ANY (CASE u.perfil WHEN 'dono' THEN ARRAY['adesao', 'uso', 'privacidade'] ELSE ARRAY['uso', 'privacidade'] END)
                                WHERE u.status = 'ativo' AND u.perfil IN ('dono', 'atendente')
                                  AND NOT EXISTS (SELECT 1 FROM aceites_termos a WHERE a.usuario_id = u.id AND a.termo_id = t.id)
                                GROUP BY 1`)).rows,
  }));
  res.json({
    tipos: Object.entries(TIPOS).sort((a, b) => a[1].ordem - b[1].ordem).map(([tipo, t]) => ({ tipo, nome: t.nome, perfis: t.perfis })),
    vigentes: r.vigentes.map(termoPublico),
    versoes: r.versoes.map((v) => ({ id: v.id, tipo: v.tipo, versao: v.versao, titulo: v.titulo, publicadoEm: v.publicado_em, publicadoPor: v.publicado_por_nome || null, aceites: v.aceites })),
    pendentes: Object.fromEntries(r.pendentes.map((p) => [p.tipo, p.n])),
  });
}));

// publica uma versão nova: todo mundo do perfil precisa aceitar de novo
termosAdmin.put('/termos/:tipo', exigirPerfil('admin'), rota(async (req, res) => {
  const tipo = req.params.tipo;
  if (!TIPOS[tipo]) throw erro(404, 'Termo não encontrado.');
  const d = validar(z.object({
    titulo: z.string().trim().min(3, 'Informe o título.').max(160),
    texto: z.string().trim().min(20, 'O texto está curto demais.').max(400000, 'Máximo de 400.000 caracteres.'),
    formato: z.enum(['texto', 'html']).default('texto'),   // v14.8.4: html = importado de um Word (já limpo no servidor; limpa de novo por garantia)
  }), req.body);
  if (d.formato === 'html') d.texto = limparHtml(d.texto);
  if (d.formato === 'texto' && d.texto.length > 60000) throw erro(422, 'Confira os campos destacados.', { texto: 'Máximo de 60.000 caracteres.' });
  const t = await comContexto(ctx(req), async (c) => {
    const atual = (await c.query('SELECT * FROM termos WHERE tipo = $1 ORDER BY versao DESC LIMIT 1', [tipo])).rows[0];
    if (atual && atual.titulo === d.titulo && atual.texto === d.texto) throw erro(422, 'Nada mudou em relação à versão vigente.');
    const r = (await c.query(`INSERT INTO termos (tipo, versao, titulo, texto, formato, publicado_por) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tipo, (atual?.versao || 0) + 1, d.titulo, d.texto, d.formato, req.usuario.id])).rows[0];
    await registrar(c, req, 'publicou_termo', { detalhes: { tipo, versao: r.versao } });
    return r;
  });
  res.status(201).json(termoPublico(t));
}));

// v14.8.4: converte um Word (.docx, em base64) em HTML limpo para virar o texto do termo (a publicação é o PUT acima)
termosAdmin.post('/termos/converter-docx', exigirPerfil('admin'), rota(async (req, res) => {
  const { nome, base64 } = validar(z.object({ nome: z.string().trim().max(200).optional(), base64: z.string().min(100, 'Arquivo vazio.').max(11_000_000, 'Arquivo grande demais (máximo 8 MB).') }), req.body);
  if (nome && !/\.docx$/i.test(nome)) throw erro(422, 'Envie um arquivo .docx (Word).', { arquivo: 'Só .docx.' });
  let buffer; try { buffer = Buffer.from(base64.replace(/^data:[^,]*,/, ''), 'base64'); } catch { throw erro(422, 'Arquivo inválido.'); }
  if (buffer.subarray(0, 2).toString('latin1') !== 'PK') throw erro(422, 'Isso não parece um .docx (Word). Salve como .docx e tente de novo.', { arquivo: 'Formato inválido.' });
  try {
    const r = await docxParaTermo(buffer);
    res.json({ html: r.html, texto: r.texto, avisos: r.avisos, caracteres: r.html.length });
  } catch (err) { if (err.status) throw err; throw erro(422, 'Não consegui ler o documento: ' + (err.message || 'erro desconhecido')); }
}));

termosAdmin.get('/termos/:id', admin, rota(async (req, res) => {
  const t = await comContexto(ctx(req), async (c) => (await c.query('SELECT * FROM termos WHERE id = $1', [uuid(req.params.id)])).rows[0]);
  if (!t) throw erro(404, 'Termo não encontrado.');
  res.json(termoPublico(t));
}));

const SQL_ACEITES = `SELECT a.*, l.nome AS loja_nome, t.titulo FROM aceites_termos a LEFT JOIN lojas l ON l.id = a.loja_id JOIN termos t ON t.id = a.termo_id`;
const aceitePublico = (a) => ({ id: a.id, tipo: a.tipo, versao: a.versao, titulo: a.titulo, nome: a.nome, email: a.email, perfil: a.perfil, loja: a.loja_nome || null, lojaId: a.loja_id, aceitoEm: a.aceito_em, ip: a.ip, navegador: a.navegador, hash: a.hash_texto });

termosAdmin.get('/termos-aceites', admin, rota(async (req, res) => {
  const q = validar(z.object({ tipo: z.enum(Object.keys(TIPOS)).optional(), loja: zUuid.optional(), busca: z.string().trim().max(80).optional() }), req.query);
  const params = []; let filtro = 'WHERE true';
  if (q.tipo) { params.push(q.tipo); filtro += ` AND a.tipo = $${params.length}`; }
  if (q.loja) { params.push(q.loja); filtro += ` AND a.loja_id = $${params.length}`; }
  if (q.busca) { params.push('%' + q.busca.replace(/[%_\\]/g, '\\$&') + '%'); filtro += ` AND (a.nome ILIKE $${params.length} OR a.email ILIKE $${params.length})`; }
  const rows = await comContexto(ctx(req), async (c) => (await c.query(`${SQL_ACEITES} ${filtro} ORDER BY a.aceito_em DESC LIMIT 2000`, params)).rows);
  res.json(rows.map(aceitePublico));
}));

termosAdmin.get('/termos-aceites.csv', admin, rota(async (req, res) => {
  const rows = await comContexto(ctx(req), async (c) => (await c.query(`${SQL_ACEITES} ORDER BY a.aceito_em DESC LIMIT 20000`)).rows);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const linhas = [['termo', 'versao', 'titulo', 'nome', 'email', 'perfil', 'loja', 'aceito_em', 'ip', 'navegador', 'hash_do_texto'].join(';')];
  for (const a of rows) linhas.push([TIPOS[a.tipo]?.nome || a.tipo, a.versao, a.titulo, a.nome, a.email, a.perfil, a.loja_nome || '', new Date(a.aceito_em).toLocaleString('pt-BR', { timeZone: 'America/Bahia' }), a.ip || '', a.navegador || '', a.hash_texto].map(esc).join(';'));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="aceites-termos.csv"');
  res.send('﻿' + linhas.join('\r\n'));
}));

// pessoas ativas que ainda não aceitaram a versão vigente (para a administração cobrar)
termosAdmin.get('/termos-pendentes', admin, rota(async (req, res) => {
  const rows = await comoSistema(async (c) => (await c.query(
    `SELECT u.id, u.nome, u.email, u.perfil, u.ultimo_acesso, l.nome AS loja_nome,
            (SELECT array_agg(t.tipo ORDER BY t.tipo) FROM termos t WHERE t.versao = (SELECT max(x.versao) FROM termos x WHERE x.tipo = t.tipo)
               AND t.tipo = ANY (CASE u.perfil WHEN 'dono' THEN ARRAY['adesao', 'uso', 'privacidade'] ELSE ARRAY['uso', 'privacidade'] END)
               AND NOT EXISTS (SELECT 1 FROM aceites_termos a WHERE a.usuario_id = u.id AND a.termo_id = t.id)) AS faltam
       FROM usuarios u LEFT JOIN lojas l ON l.id = u.loja_id
      WHERE u.status = 'ativo' AND u.perfil IN ('dono', 'atendente')
      ORDER BY l.nome NULLS LAST, u.nome LIMIT 2000`)).rows.filter((u) => u.faltam?.length));
  res.json(rows.map((u) => ({ id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, loja: u.loja_nome || null, ultimoAcesso: u.ultimo_acesso, faltam: u.faltam.map((t) => TIPOS[t]?.nome || t) })));
}));
