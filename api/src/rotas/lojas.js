// Lojas da rede (administração e matriz) e resumo da loja logada.
import { Router } from 'express';
import { filiaisDaLoja, filialPublica } from '../servicos/locarx/filiais.js';
import { MODULOS, normalizarModulos } from '../servicos/modulos.js';
import { z } from 'zod';
import { comContexto, contextoDoUsuario } from '../banco/conexao.js';
import { rota, erro, validar, zUuid, exigirPerfil, lojaPublica, usuarioPublico, registrar } from '../http.js';
import { config } from '../config.js';
import * as locarx from '../servicos/locarx/api-locarx.js';
import { evolution } from '../servicos/canais/evolution.js';

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
    const filiais = (await filiaisDaLoja(c, id, { soAtivas: false })).map(filialPublica);
    return { ...lojaPublica(l), usuarios: usuarios.map(usuarioPublico), filiais };
  });
  if (!r) throw erro(404, 'Loja não encontrada.');
  // a filial existe no ambiente atual da API? (os ids mudam entre homologação e produção)
  let filialPortal = null;
  if (config.locarx && r.filial?.branchId) {
    try { const f = await locarx.dadosDaFilial(r.filial.branchId); filialPortal = f ? { encontrada: true, nome: f.nome, endereco: f.endereco, horarios: f.horariosTexto, ambiente: locarx.ehHomologacao() ? 'homologação' : 'produção' } : { encontrada: false, ambiente: locarx.ehHomologacao() ? 'homologação' : 'produção' }; }
    catch (e) { filialPortal = { encontrada: null, erro: e.motivo || e.message, ambiente: locarx.ehHomologacao() ? 'homologação' : 'produção' }; }
  }
  res.json({ ...r, filialPortal });
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
    // a filial principal acompanha lojas.branch_id
    const outra = (await c.query('SELECT loja_id FROM filiais WHERE branch_id = $1 AND loja_id <> $2', [d.branchId, l.id])).rows[0];
    if (outra) throw erro(422, 'Confira os campos destacados.', { branchId: 'Esta filial já pertence a outra loja.' });
    await c.query('UPDATE filiais SET principal = false WHERE loja_id = $1 AND principal AND branch_id <> $2', [l.id, d.branchId]);
    await c.query(`INSERT INTO filiais (loja_id, branch_id, nome, principal) VALUES ($1, $2, $3, true)
                   ON CONFLICT (branch_id) DO UPDATE SET principal = true, ativa = true, nome = CASE WHEN filiais.loja_id = EXCLUDED.loja_id THEN filiais.nome ELSE EXCLUDED.nome END`, [l.id, d.branchId, d.nome.slice(0, 60)]);
    await registrar(c, req, id ? 'editou_loja' : 'criou_loja', { alvo: l.id, lojaId: l.id, detalhes: d });
    return l;
  });
  res.status(id ? 200 : 201).json(lojaPublica(salva));
}

// ---------- filiais da franquia (várias filiais do portal num só WhatsApp/equipe) ----------
const zFilial = z.object({ nome: z.string().trim().min(2, 'Dê um nome curto à filial (ex.: Aeroporto).').max(60), branchId: z.coerce.number().int().positive('Use só números, ex.: 9.') });
admin.post('/lojas/:id/filiais', exigirPerfil('admin'), rota(async (req, res) => {
  const id = idValido(req.params.id);
  const d = validar(zFilial, req.body);
  const f = await comContexto(ctx(req), async (c) => {
    if (!(await c.query('SELECT 1 FROM lojas WHERE id = $1', [id])).rowCount) throw erro(404, 'Loja não encontrada.');
    const dona = (await c.query('SELECT l.nome FROM filiais f JOIN lojas l ON l.id = f.loja_id WHERE f.branch_id = $1 UNION SELECT nome FROM lojas WHERE branch_id = $1', [d.branchId])).rows[0];
    if (dona) throw erro(422, 'Confira os campos destacados.', { branchId: `Esta filial já está ligada à loja ${dona.nome}.` });
    if (config.locarx) {
      const portal = await locarx.dadosDaFilial(d.branchId).catch(() => null);
      if (!portal) throw erro(422, 'Confira os campos destacados.', { branchId: 'O portal LocarX não encontrou uma filial com este número no ambiente atual.' });
    }
    const r = (await c.query('INSERT INTO filiais (loja_id, branch_id, nome) VALUES ($1, $2, $3) RETURNING *', [id, d.branchId, d.nome])).rows[0];
    await registrar(c, req, 'adicionou_filial', { alvo: id, lojaId: id, detalhes: d });
    return r;
  });
  res.status(201).json(filialPublica(f));
}));
admin.patch('/lojas/:id/filiais/:fid', exigirPerfil('admin'), rota(async (req, res) => {
  const id = idValido(req.params.id); const fid = idValido(req.params.fid);
  const d = validar(z.object({ nome: z.string().trim().min(2).max(60).optional(), principal: z.literal(true).optional(), ativa: z.boolean().optional() }), req.body);
  const f = await comContexto(ctx(req), async (c) => {
    const atual = (await c.query('SELECT * FROM filiais WHERE id = $1 AND loja_id = $2', [fid, id])).rows[0];
    if (!atual) throw erro(404, 'Filial não encontrada.');
    if (d.ativa === false && atual.principal) throw erro(400, 'A filial principal não pode ser desativada. Torne outra principal antes.');
    if (d.principal) {
      await c.query('UPDATE filiais SET principal = false WHERE loja_id = $1', [id]);
      await c.query('UPDATE lojas SET branch_id = $2 WHERE id = $1', [id, atual.branch_id]);
    }
    const r = (await c.query('UPDATE filiais SET nome = coalesce($3, nome), principal = CASE WHEN $4 THEN true ELSE principal END, ativa = coalesce($5, ativa) WHERE id = $1 AND loja_id = $2 RETURNING *', [fid, id, d.nome ?? null, !!d.principal, d.ativa ?? null])).rows[0];
    await registrar(c, req, 'editou_filial', { alvo: id, lojaId: id, detalhes: { filial: fid, ...d } });
    return r;
  });
  res.json(filialPublica(f));
}));
admin.delete('/lojas/:id/filiais/:fid', exigirPerfil('admin'), rota(async (req, res) => {
  const id = idValido(req.params.id); const fid = idValido(req.params.fid);
  await comContexto(ctx(req), async (c) => {
    const atual = (await c.query('SELECT * FROM filiais WHERE id = $1 AND loja_id = $2', [fid, id])).rows[0];
    if (!atual) throw erro(404, 'Filial não encontrada.');
    if (atual.principal) throw erro(400, 'A filial principal não pode ser removida. Torne outra principal antes.');
    await c.query('DELETE FROM filiais WHERE id = $1', [fid]);
    await registrar(c, req, 'removeu_filial', { alvo: id, lojaId: id, detalhes: { filial: fid, branchId: atual.branch_id } });
  });
  res.status(204).end();
}));

// ---------- excluir loja (administração): só desativada e com o nome digitado para confirmar ----------
// Apaga TUDO da loja (equipe, conversas, clientes, reservas, cobranças, base, funil…) — pensado para lojas de teste.
admin.delete('/lojas/:id', exigirPerfil('admin'), rota(async (req, res) => {
  const id = idValido(req.params.id);
  const { confirmacao } = validar(z.object({ confirmacao: z.string().trim().max(120) }), req.body || {});
  const l = await comContexto(ctx(req), async (c) => (await c.query('SELECT * FROM lojas WHERE id = $1', [id])).rows[0]);
  if (!l) throw erro(404, 'Loja não encontrada.');
  if (l.ativa) throw erro(400, 'Desative a loja antes de excluir.');
  if (confirmacao.toLowerCase() !== String(l.nome).toLowerCase()) throw erro(422, 'Confira os campos destacados.', { confirmacao: 'Digite o nome da loja exatamente como está cadastrado.' });
  const pagos = await comoSistema(async (c) => Number((await c.query(`SELECT count(*) FROM cobrancas WHERE loja_id = $1 AND status = 'paga' AND NOT dev_mode`, [id])).rows[0].count));
  if (pagos) throw erro(409, `Esta loja tem ${pagos} pagamento(s) Pix reais registrados. Mantenha-a desativada em vez de excluir (histórico financeiro).`);
  // desliga o WhatsApp na Evolution (se existir) antes de apagar o canal
  const canal = await comoSistema(async (c) => (await c.query('SELECT * FROM canais WHERE loja_id = $1', [id])).rows[0]);
  if (canal?.instancia) { try { await evolution.desconectar(canal.instancia); } catch { /* já desconectado ou Evolution fora */ } }
  await comoSistema(async (c) => {
    await c.query('DELETE FROM sessoes WHERE usuario_id IN (SELECT id FROM usuarios WHERE loja_id = $1)', [id]);
    await c.query('DELETE FROM oportunidades WHERE loja_id = $1', [id]);   // referencia funis/etapas com RESTRICT: sai antes do cascade
    await c.query('DELETE FROM usuarios WHERE loja_id = $1', [id]);
    await c.query('DELETE FROM lojas WHERE id = $1', [id]);
    await c.query(`INSERT INTO auditoria (usuario_id, acao, alvo, detalhes) VALUES ($1, 'excluiu_loja', $2, $3)`, [req.usuario.id, id, { nome: l.nome, branchId: l.branch_id }]);
  });
  res.status(204).end();
}));

// ---------- dono com várias lojas: dar acesso a esta loja a um dono que já existe em outra ----------
admin.post('/lojas/:id/acessos', exigirPerfil('admin'), rota(async (req, res) => {
  const id = idValido(req.params.id);
  const { email, perfil } = validar(z.object({ email: z.string().trim().toLowerCase().email('Informe um e-mail válido.'), perfil: z.enum(['dono', 'atendente']).default('dono') }), req.body);
  const r = await comContexto(ctx(req), async (c) => {
    if (!(await c.query('SELECT 1 FROM lojas WHERE id = $1', [id])).rowCount) throw erro(404, 'Loja não encontrada.');
    const u = (await c.query(`SELECT id, nome, loja_id, perfil, status FROM usuarios WHERE email = $1 AND perfil IN ('dono', 'atendente')`, [email])).rows[0];
    if (!u) throw erro(422, 'Confira os campos destacados.', { email: 'Não há uma pessoa de loja com este e-mail. Para alguém novo, use Convidar.' });
    if (u.loja_id === id) throw erro(422, 'Confira os campos destacados.', { email: 'Esta pessoa já é desta loja.' });
    await c.query('INSERT INTO usuario_lojas (usuario_id, loja_id, perfil) VALUES ($1, $2, $3) ON CONFLICT (usuario_id, loja_id) DO UPDATE SET perfil = EXCLUDED.perfil', [u.id, id, perfil]);
    await registrar(c, req, 'deu_acesso_loja', { alvo: u.id, lojaId: id, detalhes: { perfil } });
    return u;
  });
  res.status(201).json({ id: r.id, nome: r.nome, perfil });
}));
admin.delete('/lojas/:id/acessos/:usuarioId', exigirPerfil('admin'), rota(async (req, res) => {
  const id = idValido(req.params.id); const uid = idValido(req.params.usuarioId);
  await comContexto(ctx(req), async (c) => {
    const u = (await c.query('SELECT loja_id FROM usuarios WHERE id = $1', [uid])).rows[0];
    if (!u) throw erro(404, 'Pessoa não encontrada.');
    if (u.loja_id === id) throw erro(400, 'Esta é a loja principal da pessoa: desative ou exclua o acesso na equipe.');
    await c.query('DELETE FROM usuario_lojas WHERE usuario_id = $1 AND loja_id = $2', [uid, id]);
    await c.query('UPDATE sessoes SET loja_id = NULL WHERE usuario_id = $1 AND loja_id = $2', [uid, id]);
    await registrar(c, req, 'tirou_acesso_loja', { alvo: uid, lojaId: id });
  });
  res.status(204).end();
}));
admin.get('/lojas/:id/acessos', exigirPerfil('admin', 'matriz'), rota(async (req, res) => {
  const id = idValido(req.params.id);
  const rows = await comContexto(ctx(req), async (c) => (await c.query(
    `SELECT u.id, u.nome, u.email, ul.perfil, l.nome AS loja_principal FROM usuario_lojas ul JOIN usuarios u ON u.id = ul.usuario_id LEFT JOIN lojas l ON l.id = u.loja_id
      WHERE ul.loja_id = $1 AND u.loja_id <> $1 ORDER BY u.nome`, [id])).rows);
  res.json(rows);
}));

// a equipe da loja vê as próprias filiais (para escolher na cotação e no Reservar)
loja.get('/filiais', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  res.json((await comContexto(ctx(req), (c) => filiaisDaLoja(c, req.usuario.loja_id))).map(filialPublica));
}));

admin.get('/modulos', exigirPerfil('admin', 'matriz'), rota(async (req, res) => res.json(MODULOS)));

admin.post('/lojas', exigirPerfil('admin'), rota((req, res) => salvar(req, res, null)));
admin.put('/lojas/:id', exigirPerfil('admin'), rota((req, res) => salvar(req, res, idValido(req.params.id))));

admin.patch('/lojas/:id', exigirPerfil('admin'), rota(async (req, res) => {
  const id = idValido(req.params.id);
  // ativa: liga/desliga a loja. pixProprio: a loja recebe o Pix na própria conta AbacatePay (ela cadastra a chave em Pagamentos online).
  const d = validar(z.object({ ativa: z.boolean().optional(), pixProprio: z.boolean().optional(), modulos: z.record(z.boolean()).optional() }), req.body);
  const modulos = d.modulos ? normalizarModulos(d.modulos) : null;
  const l = await comContexto(ctx(req), async (c) => {
    const r = (await c.query('UPDATE lojas SET ativa = coalesce($2, ativa), pix_proprio = coalesce($3, pix_proprio), modulos = coalesce($4, modulos) WHERE id = $1 RETURNING *', [id, d.ativa ?? null, d.pixProprio ?? null, modulos])).rows[0];
    if (!r) throw erro(404, 'Loja não encontrada.');
    if (d.ativa === false) await c.query('DELETE FROM sessoes WHERE usuario_id IN (SELECT id FROM usuarios WHERE loja_id = $1)', [id]);
    if (d.ativa !== undefined) await registrar(c, req, d.ativa ? 'reativou_loja' : 'desativou_loja', { alvo: id, lojaId: id });
    if (d.pixProprio !== undefined) await registrar(c, req, d.pixProprio ? 'ligou_pix_proprio' : 'desligou_pix_proprio', { alvo: id, lojaId: id });
    if (modulos) { await c.query('DELETE FROM sessoes WHERE usuario_id IN (SELECT id FROM usuarios WHERE loja_id = $1)', [id]); await registrar(c, req, 'alterou_modulos', { alvo: id, lojaId: id, detalhes: modulos }); }   // a equipe entra de novo já com o menu certo
    return r;
  });
  res.json(lojaPublica(l));
}));

// ---------- resumo da loja logada ----------
loja.get('/resumo', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  const r = await comContexto(ctx(req), async (c) => {
    const lojaId = req.usuario.loja_id;
    const equipe = (await c.query(
      `SELECT count(*) FILTER (WHERE status = 'ativo') AS ativos, count(*) FILTER (WHERE status = 'convidado') AS convidados
         FROM usuarios WHERE loja_id = $1`, [lojaId])).rows[0];
    const atend = (await c.query(
      `SELECT count(*) FILTER (WHERE ultima_do_cliente >= date_trunc('day', now() AT TIME ZONE 'America/Bahia') AT TIME ZONE 'America/Bahia') AS hoje,
              count(*) FILTER (WHERE estado = 'aguardando') AS aguardando
         FROM conversas WHERE loja_id = $1`, [lojaId])).rows[0];
    const ultimas = (await c.query(
      `SELECT cv.id, cv.estado, cv.ultima_previa, cv.ultima_mensagem_em, coalesce(ct.nome, '+' || ct.telefone) AS cliente
         FROM conversas cv JOIN contatos ct ON ct.id = cv.contato_id WHERE cv.loja_id = $1 ORDER BY cv.ultima_mensagem_em DESC LIMIT 5`, [lojaId])).rows;
    return { equipe, atend, ultimas };
  });
  res.json({
    conversasHoje: Number(r.atend.hoje), aguardando: Number(r.atend.aguardando),
    reservasSemana: 0, valorSemana: 0, // reservas entram na etapa 4
    equipeAtiva: Number(r.equipe.ativos), equipeConvidada: Number(r.equipe.convidados),
    ultimas: r.ultimas.map((u) => ({ id: u.id, cliente: u.cliente, assunto: u.ultima_previa, quando: u.ultima_mensagem_em, estado: u.estado })),
  });
}));
