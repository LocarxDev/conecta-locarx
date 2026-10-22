// Etapa 2: caixa de conversas da loja — listar, ler, responder, notas, assumir/devolver/encerrar, mídia e respostas rápidas.
import { Router } from 'express';
import { z } from 'zod';
import { comContexto, contextoDoUsuario } from '../banco/conexao.js';
import { evolution } from '../servicos/canais/evolution.js';
import { rota, erro, validar, zUuid, exigirPerfil, registrar } from '../http.js';
import { previaDe } from './whatsapp.js';

export const conversas = Router();
export const respostas = Router();

const provedores = { evolution };
const ctx = (req) => contextoDoUsuario(req.usuario);
const uuid = (id) => { if (!zUuid.safeParse(id).success) throw erro(404, 'Conversa não encontrada.'); return id; };
const CURSOR = `to_char(%s AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const cursor = (col) => CURSOR.replace('%s', col);

function conversaPublica(r) {
  return {
    id: r.id, estado: r.estado, naoLidas: r.nao_lidas, previa: r.ultima_previa,
    ultimaMensagemEm: r.ultima_mensagem_em, ultimaDoCliente: r.ultima_do_cliente,
    atendente: r.atendente_id ? { id: r.atendente_id, nome: r.atendente_nome } : null,
    contato: { id: r.contato_id, nome: r.contato_nome, telefone: r.telefone },
    cursor: r.cursor,
  };
}
function mensagemPublica(m) {
  return {
    id: m.id, direcao: m.direcao, autor: m.autor, autorNome: m.autor_nome || null, tipo: m.tipo, texto: m.texto,
    midia: m.midia ? { mimetype: m.midia.mimetype || null, nome: m.midia.nome || null, segundos: m.midia.segundos || null, lat: m.midia.lat ?? null, lng: m.midia.lng ?? null } : null,
    temArquivo: !!(m.externo_id && ['imagem', 'audio', 'video', 'documento', 'figurinha'].includes(m.tipo)),
    status: m.status, criadaEm: m.criada_em, cursor: m.cursor,
  };
}

const SQL_CONVERSA = `
  SELECT cv.*, ct.nome AS contato_nome, ct.telefone, u.nome AS atendente_nome, ${cursor('cv.atualizada_em')} AS cursor
    FROM conversas cv JOIN contatos ct ON ct.id = cv.contato_id LEFT JOIN usuarios u ON u.id = cv.atendente_id`;

// ---------- lista (com "desde" para atualizar a cada poucos segundos) ----------
conversas.get('/', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  const q = validar(z.object({
    desde: z.string().datetime({ offset: true }).optional(),
    busca: z.string().trim().max(60).optional(),
  }), req.query);
  const params = [req.usuario.loja_id];
  let filtro = '';
  if (q.desde) { params.push(q.desde); filtro += ` AND cv.atualizada_em > $${params.length}::timestamptz`; }
  if (q.busca) {
    params.push('%' + q.busca.replace(/[%_\\]/g, '\\$&') + '%');
    params.push(q.busca.replace(/\D/g, '') ? '%' + q.busca.replace(/\D/g, '') + '%' : '__nenhum__');
    filtro += ` AND (ct.nome ILIKE $${params.length - 1} OR ct.telefone LIKE $${params.length})`;
  }
  const r = await comContexto(ctx(req), async (c) => {
    const rows = (await c.query(`${SQL_CONVERSA} WHERE cv.loja_id = $1 ${filtro} ORDER BY cv.ultima_mensagem_em DESC LIMIT 200`, params)).rows;
    const agora = (await c.query(`SELECT ${cursor('now()')} AS agora`)).rows[0].agora;
    return { rows, agora };
  });
  res.json({ conversas: r.rows.map(conversaPublica), cursor: r.agora });
}));

async function obterConversa(c, req, id) {
  const cv = (await c.query(`${SQL_CONVERSA} WHERE cv.id = $1 AND cv.loja_id = $2`, [id, req.usuario.loja_id])).rows[0];
  if (!cv) throw erro(404, 'Conversa não encontrada.');
  return cv;
}

// ---------- mensagens ----------
conversas.get('/:id/mensagens', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  const id = uuid(req.params.id);
  const q = validar(z.object({ depois: z.string().datetime({ offset: true }).optional() }), req.query);
  const r = await comContexto(ctx(req), async (c) => {
    const cv = await obterConversa(c, req, id);
    const sql = `SELECT m.*, u.nome AS autor_nome, ${cursor('m.criada_em')} AS cursor FROM mensagens m LEFT JOIN usuarios u ON u.id = m.autor_id WHERE m.conversa_id = $1`;
    const rows = q.depois
      ? (await c.query(`${sql} AND m.criada_em > $2::timestamptz ORDER BY m.criada_em LIMIT 500`, [id, q.depois])).rows
      : (await c.query(`SELECT * FROM (${sql} ORDER BY m.criada_em DESC LIMIT 300) x ORDER BY criada_em`, [id])).rows;
    return { cv, rows };
  });
  res.json({ conversa: conversaPublica(r.cv), mensagens: r.rows.map(mensagemPublica) });
}));

conversas.post('/:id/lida', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  const id = uuid(req.params.id);
  await comContexto(ctx(req), (c) => c.query(`UPDATE conversas SET nao_lidas = 0, atualizada_em = now() WHERE id = $1 AND loja_id = $2 AND nao_lidas > 0`, [id, req.usuario.loja_id]));
  res.status(204).end();
}));

// ---------- enviar ----------
async function evento(c, cv, req, texto) {
  await c.query(`INSERT INTO mensagens (conversa_id, loja_id, direcao, autor, autor_id, tipo, texto) VALUES ($1, $2, 'interna', 'sistema', $3, 'evento', $4)`,
    [cv.id, cv.loja_id, req.usuario.id, texto]);
}

async function prepararEnvio(req, id) {
  return comContexto(ctx(req), async (c) => {
    const cv = await obterConversa(c, req, id);
    const canal = (await c.query('SELECT * FROM canais WHERE loja_id = $1', [req.usuario.loja_id])).rows[0];
    if (!canal || canal.status !== 'conectado') throw erro(409, 'O WhatsApp da loja está desconectado. Conecte em "WhatsApp" antes de responder.');
    // quem responde assume a conversa
    if (cv.estado !== 'humano' || cv.atendente_id !== req.usuario.id) {
      if (cv.estado === 'humano' && cv.atendente_id && cv.atendente_id !== req.usuario.id && req.usuario.perfil !== 'dono') {
        throw erro(409, `Esta conversa está com ${cv.atendente_nome}. Peça para ele(a) liberar ou para o dono da loja transferir.`);
      }
      await c.query(`UPDATE conversas SET estado = 'humano', atendente_id = $2, atualizada_em = now() WHERE id = $1`, [id, req.usuario.id]);
      await evento(c, cv, req, `${req.usuario.nome} assumiu a conversa`);
    }
    return { cv, canal };
  });
}

async function finalizarEnvio(req, cv, { tipo, texto, midia, enviar }) {
  const msg = await comContexto(ctx(req), async (c) => (await c.query(
    `INSERT INTO mensagens (conversa_id, loja_id, direcao, autor, autor_id, tipo, texto, midia, status)
     VALUES ($1, $2, 'saida', 'atendente', $3, $4, $5, $6, 'enviando') RETURNING id`,
    [cv.id, cv.loja_id, req.usuario.id, tipo, texto, midia])).rows[0]);
  let externoId = null, falhou = false;
  try { externoId = await enviar(); } catch (e) { falhou = true; console.error('[envio]', e.message, JSON.stringify(e.resposta || '').slice(0, 200)); }
  const final = await comContexto(ctx(req), async (c) => {
    await c.query(`UPDATE mensagens SET status = $2, externo_id = $3 WHERE id = $1`, [msg.id, falhou ? 'erro' : 'ok', externoId]);
    if (!falhou) await c.query(`UPDATE conversas SET ultima_previa = $2, ultima_mensagem_em = now(), humano_respondeu_em = now(), atualizada_em = now() WHERE id = $1`, [cv.id, previaDe(tipo, texto)]);
    return (await c.query(`SELECT m.*, u.nome AS autor_nome, ${cursor('m.criada_em')} AS cursor FROM mensagens m LEFT JOIN usuarios u ON u.id = m.autor_id WHERE m.id = $1`, [msg.id])).rows[0];
  });
  if (falhou) throw erro(502, 'A mensagem não foi enviada. Confira a conexão do WhatsApp e tente de novo.');
  return mensagemPublica(final);
}

conversas.post('/:id/mensagens', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  const id = uuid(req.params.id);
  const { texto } = validar(z.object({ texto: z.string().trim().min(1, 'Escreva a mensagem.').max(4000, 'Mensagem muito longa (máx. 4.000 caracteres).') }), req.body);
  const { cv, canal } = await prepararEnvio(req, id);
  res.status(201).json(await finalizarEnvio(req, cv, { tipo: 'texto', texto, midia: null, enviar: () => provedores[canal.provedor].enviarTexto(canal.instancia, cv.telefone, texto) }));
}));

// mídia: só tipos seguros, conferindo o conteúdo real do arquivo (não só a extensão)
const TIPOS_MIDIA = {
  'image/jpeg': { tipo: 'imagem', assinatura: [0xff, 0xd8, 0xff] },
  'image/png': { tipo: 'imagem', assinatura: [0x89, 0x50, 0x4e, 0x47] },
  'image/webp': { tipo: 'imagem', assinatura: [0x52, 0x49, 0x46, 0x46] },
  'application/pdf': { tipo: 'documento', assinatura: [0x25, 0x50, 0x44, 0x46] },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { tipo: 'documento', assinatura: [0x50, 0x4b, 0x03, 0x04] },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { tipo: 'documento', assinatura: [0x50, 0x4b, 0x03, 0x04] },
};
const MAX_MIDIA = 8 * 1024 * 1024;

conversas.post('/:id/midia', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  const id = uuid(req.params.id);
  const d = validar(z.object({
    mimetype: z.string().max(120),
    base64: z.string().max(Math.ceil(MAX_MIDIA * 4 / 3) + 8, 'Arquivo grande demais (máx. 8 MB).'),
    nomeArquivo: z.string().trim().max(120).regex(/^[^\\/:*?"<>|]+$/, 'Nome de arquivo inválido.').optional(),
    legenda: z.string().trim().max(1000).optional(),
  }), req.body);
  const regra = TIPOS_MIDIA[d.mimetype];
  if (!regra) throw erro(422, 'Tipo de arquivo não permitido. Envie foto (JPG, PNG, WEBP), PDF, Word ou Excel.');
  const bytes = Buffer.from(d.base64, 'base64');
  if (!bytes.length || bytes.length > MAX_MIDIA) throw erro(422, 'Arquivo vazio ou maior que 8 MB.');
  if (!regra.assinatura.every((b, i) => bytes[i] === b)) throw erro(422, 'O conteúdo do arquivo não corresponde ao tipo informado.');
  const { cv, canal } = await prepararEnvio(req, id);
  const midia = { mimetype: d.mimetype, nome: d.nomeArquivo || null };
  res.status(201).json(await finalizarEnvio(req, cv, {
    tipo: regra.tipo, texto: d.legenda || null, midia,
    enviar: () => provedores[canal.provedor].enviarMidia(canal.instancia, cv.telefone, { tipo: regra.tipo, mimetype: d.mimetype, base64: d.base64, nomeArquivo: d.nomeArquivo, legenda: d.legenda }),
  }));
}));

// arquivo recebido/enviado: baixado da Evolution na hora (não fica guardado no Conecta)
conversas.get('/:id/mensagens/:mid/arquivo', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  const id = uuid(req.params.id); const mid = uuid(req.params.mid);
  const r = await comContexto(ctx(req), async (c) => {
    const m = (await c.query('SELECT * FROM mensagens WHERE id = $1 AND conversa_id = $2 AND loja_id = $3', [mid, id, req.usuario.loja_id])).rows[0];
    const canal = (await c.query('SELECT * FROM canais WHERE loja_id = $1', [req.usuario.loja_id])).rows[0];
    return { m, canal };
  });
  if (!r.m?.externo_id || !r.canal) throw erro(404, 'Arquivo não encontrado.');
  let arq;
  try { arq = await provedores[r.canal.provedor].baixarMidia(r.canal.instancia, r.m.externo_id); } catch (e) { console.error('[arquivo]', e.message); }
  if (!arq) throw erro(404, 'O arquivo não está mais disponível no WhatsApp.');
  const seguro = /^(image\/(jpeg|png|webp|gif)|audio\/[\w.+-]+|video\/(mp4|3gpp)|application\/pdf)(;.*)?$/i.test(arq.mimetype);
  res.set('Content-Type', seguro ? arq.mimetype.split(';')[0] : 'application/octet-stream');
  res.set('Content-Disposition', `${seguro ? 'inline' : 'attachment'}; filename="${String(r.m.midia?.nome || arq.nome || 'arquivo').replace(/[^\w.\- ]/g, '_')}"`);
  res.set('Cache-Control', 'private, max-age=3600');
  res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
  res.send(arq.buffer);
}));

// ---------- notas internas (só a equipe vê) ----------
conversas.post('/:id/notas', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  const id = uuid(req.params.id);
  const { texto } = validar(z.object({ texto: z.string().trim().min(1, 'Escreva a nota.').max(2000) }), req.body);
  const m = await comContexto(ctx(req), async (c) => {
    const cv = await obterConversa(c, req, id);
    const nova = (await c.query(
      `INSERT INTO mensagens (conversa_id, loja_id, direcao, autor, autor_id, tipo, texto) VALUES ($1, $2, 'interna', 'atendente', $3, 'nota', $4) RETURNING id`,
      [cv.id, cv.loja_id, req.usuario.id, texto])).rows[0];
    await c.query('UPDATE conversas SET atualizada_em = now() WHERE id = $1', [cv.id]);
    return (await c.query(`SELECT m.*, u.nome AS autor_nome, ${cursor('m.criada_em')} AS cursor FROM mensagens m LEFT JOIN usuarios u ON u.id = m.autor_id WHERE m.id = $1`, [nova.id])).rows[0];
  });
  res.status(201).json(mensagemPublica(m));
}));

// ---------- assumir, devolver ao assistente, encerrar, transferir ----------
async function mudarEstado(req, id, fn) {
  return comContexto(ctx(req), async (c) => {
    const cv = await obterConversa(c, req, id);
    await fn(c, cv);
    await c.query('UPDATE conversas SET atualizada_em = now() WHERE id = $1', [id]);
    return conversaPublica(await obterConversa(c, req, id));
  });
}

conversas.post('/:id/assumir', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  res.json(await mudarEstado(req, uuid(req.params.id), async (c, cv) => {
    if (cv.estado === 'humano' && cv.atendente_id && cv.atendente_id !== req.usuario.id && req.usuario.perfil !== 'dono') {
      throw erro(409, `Esta conversa está com ${cv.atendente_nome}.`);
    }
    await c.query(`UPDATE conversas SET estado = 'humano', atendente_id = $2 WHERE id = $1`, [cv.id, req.usuario.id]);
    await evento(c, cv, req, `${req.usuario.nome} assumiu a conversa`);
  }));
}));

conversas.post('/:id/devolver', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  const r = await mudarEstado(req, uuid(req.params.id), async (c, cv) => {
    const a = (await c.query('SELECT ativo FROM assistentes WHERE loja_id = $1', [cv.loja_id])).rows[0];
    if (!a?.ativo) throw erro(409, 'O assistente virtual desta loja está desligado. Ligue em "Assistente virtual".');
    // marca como já respondido até agora: o assistente só fala quando o cliente escrever de novo
    await c.query(`UPDATE conversas SET estado = 'assistente', atendente_id = NULL, bot_respondeu_em = now() WHERE id = $1`, [cv.id]);
    await evento(c, cv, req, `${req.usuario.nome} devolveu a conversa ao assistente`);
  });
  res.json(r);
}));

conversas.post('/:id/encerrar', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  res.json(await mudarEstado(req, uuid(req.params.id), async (c, cv) => {
    await c.query(`UPDATE conversas SET estado = 'encerrada', nao_lidas = 0 WHERE id = $1`, [cv.id]);
    await evento(c, cv, req, `${req.usuario.nome} encerrou a conversa`);
  }));
}));

conversas.post('/:id/transferir', exigirPerfil('dono'), rota(async (req, res) => {
  const { atendenteId } = validar(z.object({ atendenteId: zUuid }), req.body);
  res.json(await mudarEstado(req, uuid(req.params.id), async (c, cv) => {
    const alvo = (await c.query(`SELECT id, nome FROM usuarios WHERE id = $1 AND loja_id = $2 AND status = 'ativo'`, [atendenteId, req.usuario.loja_id])).rows[0];
    if (!alvo) throw erro(422, 'Escolha uma pessoa ativa da sua equipe.');
    await c.query(`UPDATE conversas SET estado = 'humano', atendente_id = $2 WHERE id = $1`, [cv.id, alvo.id]);
    await evento(c, cv, req, `${req.usuario.nome} transferiu a conversa para ${alvo.nome}`);
    await registrar(c, req, 'transferiu_conversa', { alvo: cv.id, detalhes: { para: alvo.id } });
  }));
}));

// ---------- equipe disponível (para transferir) ----------
conversas.get('/equipe/ativa', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  const rows = await comContexto(ctx(req), async (c) => (await c.query(`SELECT id, nome, perfil FROM usuarios WHERE loja_id = $1 AND status = 'ativo' ORDER BY nome`, [req.usuario.loja_id])).rows);
  res.json(rows);
}));

// =====================================================================
// Respostas rápidas (o dono cadastra; todos da loja usam digitando "/")
// =====================================================================
const esquemaResposta = z.object({
  atalho: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,30}$/, 'Use de 2 a 30 letras minúsculas, números ou hífen, ex.: caucao.'),
  texto: z.string().trim().min(1, 'Escreva o texto da resposta.').max(2000),
});
const respostaPublica = (r) => ({ id: r.id, atalho: r.atalho, texto: r.texto });

respostas.get('/respostas', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  const rows = await comContexto(ctx(req), async (c) => (await c.query('SELECT * FROM respostas_rapidas WHERE loja_id = $1 ORDER BY atalho', [req.usuario.loja_id])).rows);
  res.json(rows.map(respostaPublica));
}));

respostas.post('/respostas', exigirPerfil('dono'), rota(async (req, res) => {
  const d = validar(esquemaResposta, req.body);
  const r = await comContexto(ctx(req), async (c) => (await c.query(
    'INSERT INTO respostas_rapidas (loja_id, atalho, texto) VALUES ($1, $2, $3) RETURNING *', [req.usuario.loja_id, d.atalho, d.texto])).rows[0])
    .catch((e) => { if (e.code === '23505') throw erro(422, 'Confira os campos destacados.', { atalho: 'Já existe uma resposta com este atalho.' }); throw e; });
  res.status(201).json(respostaPublica(r));
}));

respostas.put('/respostas/:id', exigirPerfil('dono'), rota(async (req, res) => {
  const id = uuid(req.params.id);
  const d = validar(esquemaResposta, req.body);
  const r = await comContexto(ctx(req), async (c) => (await c.query(
    'UPDATE respostas_rapidas SET atalho = $3, texto = $4 WHERE id = $1 AND loja_id = $2 RETURNING *', [id, req.usuario.loja_id, d.atalho, d.texto])).rows[0])
    .catch((e) => { if (e.code === '23505') throw erro(422, 'Confira os campos destacados.', { atalho: 'Já existe uma resposta com este atalho.' }); throw e; });
  if (!r) throw erro(404, 'Resposta não encontrada.');
  res.json(respostaPublica(r));
}));

respostas.delete('/respostas/:id', exigirPerfil('dono'), rota(async (req, res) => {
  const id = uuid(req.params.id);
  await comContexto(ctx(req), (c) => c.query('DELETE FROM respostas_rapidas WHERE id = $1 AND loja_id = $2', [id, req.usuario.loja_id]));
  res.status(204).end();
}));
