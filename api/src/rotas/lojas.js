// Lojas da rede (administração e matriz) e resumo da loja logada.
import { Router } from 'express';
import { z } from 'zod';
import { comContexto, contextoDoUsuario } from '../banco/conexao.js';
import { rota, erro, validar, zUuid, exigirPerfil, lojaPublica, usuarioPublico, registrar } from '../http.js';

export const admin = Router();
export const loja = Router();

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const esquemaLoja = z.object({
  nome: z.string().trim().min(2, 'Informe o nome da loja.').max(120),
  cidade: z.string().trim().min(2, 'Informe a cidade.').max(80),
  uf: z.enum(UFS, { errorMap: () => ({ message: 'Escolha o estado.' }) }),
  branchId: z.coerce.number({ invalid_type_error: 'Use só números, ex.: 5.' }).int('Use só números, ex.: 5.').positive('Use só números, ex.: 5.').max(2_000_000_000),
  branchCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,6}$/, 'Use de 2 a 6 letras ou números, ex.: SSA1.'),
  tipo: z.enum(['Cidade', 'Aeroporto']).default('Cidade'),
});

const ctx = (req) => contextoDoUsuario(req.usuario);
const idValido = (id) => { if (!zUuid.safeParse(id).success) throw erro(404, 'Loja não encontrada.'); return id; };

// ---------- resumo da rede ----------
admin.get('/resumo', exigirPerfil('admin', 'matriz'), rota(async (req, res) => {
  const r = await comContexto(ctx(req), async (c) => (await c.query(`
    SELECT (SELECT count(*) FROM lojas WHERE ativa) AS lojas_ativas,
           (SELECT count(*) FROM lojas) AS lojas_total,
           (SELECT count(*) FROM usuarios WHERE status = 'ativo') AS usuarios,
           (SELECT count(*) FROM lojas WHERE whatsapp = 'conectado') AS whatsapp`)).rows[0]);
  res.json({ lojasAtivas: Number(r.lojas_ativas), lojasTotal: Number(r.lojas_total), usuarios: Number(r.usuarios), whatsappConectado: Number(r.whatsapp) });
}));

// ---------- lojas ----------
const SQL_LOJAS = `
  SELECT l.*, (SELECT count(*) FROM usuarios u WHERE u.loja_id = l.id) AS qtd_usuarios,
         (SELECT u.nome FROM usuarios u WHERE u.loja_id = l.id AND u.perfil = 'dono' AND u.status <> 'inativo' ORDER BY u.criado_em LIMIT 1) AS dono_nome
    FROM lojas l`;

admin.get('/lojas', exigirPerfil('admin', 'matriz'), rota(async (req, res) => {
  const rows = await comContexto(ctx(req), async (c) => (await c.query(`${SQL_LOJAS} ORDER BY l.ativa DESC, l.nome`)).rows);
  res.json(rows.map(lojaPublica));
}));

admin.get('/lojas/:id', exigirPerfil('admin', 'matriz'), rota(async (req, res) => {
  const id = idValido(req.params.id);
  const r = await comContexto(ctx(req), async (c) => {
    const l = (await c.query(`${SQL_LOJAS} WHERE l.id = $1`, [id])).rows[0];
    if (!l) return null;
    const usuarios = (await c.query('SELECT * FROM usuarios WHERE loja_id = $1 ORDER BY nome', [id])).rows;
    return { ...lojaPublica(l), usuarios: usuarios.map(usuarioPublico) };
  });
  if (!r) throw erro(404, 'Loja não encontrada.');
  res.json(r);
}));

async function salvar(req, res, id) {
  const d = validar(esquemaLoja, req.body);
  const salva = await comContexto(ctx(req), async (c) => {
    const repetida = (await c.query('SELECT nome FROM lojas WHERE branch_id = $1 AND id IS DISTINCT FROM $2', [d.branchId, id || null])).rows[0];
    if (repetida) throw erro(422, 'Confira os campos destacados.', { branchId: `Esta filial já está ligada à loja ${repetida.nome}.` });
    let l;
    if (id) {
      l = (await c.query(
        `UPDATE lojas SET nome = $2, cidade = $3, uf = $4, branch_id = $5, branch_code = $6, tipo = $7 WHERE id = $1 RETURNING *`,
        [id, d.nome, d.cidade, d.uf, d.branchId, d.branchCode, d.tipo])).rows[0];
      if (!l) throw erro(404, 'Loja não encontrada.');
    } else {
      l = (await c.query(
        `INSERT INTO lojas (nome, cidade, uf, branch_id, branch_code, tipo) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [d.nome, d.cidade, d.uf, d.branchId, d.branchCode, d.tipo])).rows[0];
    }
    await registrar(c, req, id ? 'editou_loja' : 'criou_loja', { alvo: l.id, lojaId: l.id, detalhes: d });
    return l;
  });
  res.status(id ? 200 : 201).json(lojaPublica(salva));
}

admin.post('/lojas', exigirPerfil('admin'), rota((req, res) => salvar(req, res, null)));
admin.put('/lojas/:id', exigirPerfil('admin'), rota((req, res) => salvar(req, res, idValido(req.params.id))));

admin.patch('/lojas/:id', exigirPerfil('admin'), rota(async (req, res) => {
  const id = idValido(req.params.id);
  const { ativa } = validar(z.object({ ativa: z.boolean() }), req.body);
  const l = await comContexto(ctx(req), async (c) => {
    const r = (await c.query('UPDATE lojas SET ativa = $2 WHERE id = $1 RETURNING *', [id, ativa])).rows[0];
    if (!r) throw erro(404, 'Loja não encontrada.');
    if (!ativa) await c.query('DELETE FROM sessoes WHERE usuario_id IN (SELECT id FROM usuarios WHERE loja_id = $1)', [id]);
    await registrar(c, req, ativa ? 'reativou_loja' : 'desativou_loja', { alvo: id, lojaId: id });
    return r;
  });
  res.json(lojaPublica(l));
}));

// ---------- resumo da loja logada ----------
loja.get('/resumo', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  const r = await comContexto(ctx(req), async (c) => (await c.query(
    `SELECT count(*) FILTER (WHERE status = 'ativo') AS ativos, count(*) FILTER (WHERE status = 'convidado') AS convidados
       FROM usuarios WHERE loja_id = $1`, [req.usuario.loja_id])).rows[0]);
  // conversas e reservas entram nas próximas etapas (WhatsApp e reservas)
  res.json({
    conversasHoje: 0, aguardando: 0, reservasSemana: 0, valorSemana: 0,
    equipeAtiva: Number(r.ativos), equipeConvidada: Number(r.convidados), ultimas: [],
  });
}));
