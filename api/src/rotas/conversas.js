// Etapa 2: caixa de conversas da loja — listar, ler, responder, notas, assumir/devolver/encerrar, mídia e respostas rápidas.
import { Router } from 'express';
import { z } from 'zod';
import { comContexto, comoSistema, contextoDoUsuario } from '../banco/conexao.js';
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
    atendente: r.atendente_id ? { id: r.atendente_id, nome: r.atendente_nome } : null, atribuidaEm: r.atribuida_em || null,
    contato: { id: r.contato_id, nome: r.contato_nome, telefone: r.telefone },
    etiquetas: r.etiquetas || [],
    cursor: r.cursor,
    // transferência entre lojas: de onde veio e quem atende (só aparece quando há transferência)
    ...(r.loja_atendimento_id ? { transferida: { origem: { id: r.loja_id, nome: r.loja_origem_nome }, atendimento: { id: r.loja_atendimento_id, nome: r.loja_atendimento_nome }, em: r.transferida_em } } : {}),
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
  SELECT cv.*, ct.nome AS contato_nome, ct.telefone, u.nome AS atendente_nome, ${cursor('cv.atualizada_em')} AS cursor,
         lo.nome AS loja_origem_nome, la.nome AS loja_atendimento_nome,
         (SELECT coalesce(json_agg(json_build_object('id', e.id, 'nome', e.nome, 'cor', e.cor) ORDER BY lower(e.nome)), '[]')
            FROM contato_etiquetas ce JOIN etiquetas e ON e.id = ce.etiqueta_id WHERE ce.contato_id = cv.contato_id) AS etiquetas
    FROM conversas cv JOIN contatos ct ON ct.id = cv.contato_id LEFT JOIN usuarios u ON u.id = cv.atendente_id
    LEFT JOIN lojas lo ON lo.id = cv.loja_id LEFT JOIN lojas la ON la.id = cv.loja_atendimento_id`;

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
  filtro += filtroVisibilidade(req, params);
  const r = await comContexto(ctx(req), async (c) => {
    const rows = (await c.query(`${SQL_CONVERSA} WHERE ${DA_LOJA} ${filtro} ORDER BY cv.ultima_mensagem_em DESC LIMIT 200`, params)).rows;
    const agora = (await c.query(`SELECT ${cursor('now()')} AS agora`)).rows[0].agora;
    return { rows, agora };
  });
  res.json({ conversas: r.rows.map(conversaPublica), cursor: r.agora });
}));

// "da loja": conversa do WhatsApp desta loja que não foi transferida, ou transferida para cá ($1 = loja do usuário)
const DA_LOJA = `((cv.loja_id = $1 AND cv.loja_atendimento_id IS NULL) OR cv.loja_atendimento_id = $1)`;
// atendente vê só o que está com ele e o que ainda não tem dono (fila / assistente); o dono vê tudo
function filtroVisibilidade(req, params) {
  if (req.usuario.perfil !== 'atendente') return '';
  params.push(req.usuario.id);
  return ` AND (cv.atendente_id = $${params.length} OR cv.atendente_id IS NULL)`;
}
async function obterConversa(c, req, id) {
  const cv = (await c.query(`${SQL_CONVERSA} WHERE cv.id = $2 AND ${DA_LOJA}`, [req.usuario.loja_id, id])).rows[0];
  if (!cv) throw erro(404, 'Conversa não encontrada.');
  if (req.usuario.perfil === 'atendente' && cv.atendente_id && cv.atendente_id !== req.usuario.id) throw erro(403, `Esta conversa está com ${cv.atendente_nome}.`);
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
  await comContexto(ctx(req), (c) => c.query(`UPDATE conversas cv SET nao_lidas = 0, atualizada_em = now() WHERE cv.id = $2 AND ${DA_LOJA} AND nao_lidas > 0`, [req.usuario.loja_id, id]));
  res.status(204).end();
}));

// ---------- enviar ----------
async function evento(c, cv, req, texto) {
  await c.query(`INSERT INTO mensagens (conversa_id, loja_id, direcao, autor, autor_id, tipo, texto) VALUES ($1, $2, 'interna', 'sistema', $3, 'evento', $4)`,
    [cv.id, cv.loja_id, req.usuario.id, texto]);
}

// o canal (WhatsApp) é sempre o da loja de origem da conversa, mesmo quando outra loja atende
async function canalDaConversa(c, cv) {
  if (!cv.loja_atendimento_id) return (await c.query('SELECT * FROM canais WHERE loja_id = $1', [cv.loja_id])).rows[0];
  return comoSistema(async (cs) => (await cs.query('SELECT * FROM canais WHERE loja_id = $1', [cv.loja_id])).rows[0]);   // loja de origem: fora do RLS desta loja
}
async function prepararEnvio(req, id) {
  return comContexto(ctx(req), async (c) => {
    const cv = await obterConversa(c, req, id);
    const canal = await canalDaConversa(c, cv);
    if (!canal || canal.status !== 'conectado') throw erro(409, `O WhatsApp da loja${cv.loja_atendimento_id ? ' de origem (' + cv.loja_origem_nome + ')' : ''} está desconectado. Conecte em "WhatsApp" antes de responder.`);
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

// O cliente vê quem está falando: a mensagem no WhatsApp sai como "*Carla:* texto" (no CRM o texto fica como foi escrito;
// o nome já aparece pela autoria). Só o primeiro nome, como no WhatsApp Business.
export const assinar = (usuario, texto) => { const nome = String(usuario?.nome || '').trim().split(/\s+/)[0]; return nome ? `*${nome}:* ${texto}` : texto; };

conversas.post('/:id/mensagens', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  const id = uuid(req.params.id);
  const { texto } = validar(z.object({ texto: z.string().trim().min(1, 'Escreva a mensagem.').max(4000, 'Mensagem muito longa (máx. 4.000 caracteres).') }), req.body);
  const { cv, canal } = await prepararEnvio(req, id);
  res.status(201).json(await finalizarEnvio(req, cv, { tipo: 'texto', texto, midia: null, enviar: () => provedores[canal.provedor].enviarTexto(canal.instancia, cv.telefone, assinar(req.usuario, texto)) }));
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
    enviar: () => provedores[canal.provedor].enviarMidia(canal.instancia, cv.telefone, { tipo: regra.tipo, mimetype: d.mimetype, base64: d.base64, nomeArquivo: d.nomeArquivo, legenda: d.legenda ? assinar(req.usuario, d.legenda) : '' }),
  }));
}));

// arquivo recebido/enviado: baixado da Evolution na hora (não fica guardado no Conecta)
conversas.get('/:id/mensagens/:mid/arquivo', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  const id = uuid(req.params.id); const mid = uuid(req.params.mid);
  const r = await comContexto(ctx(req), async (c) => {
    const cv = await obterConversa(c, req, id);
    const m = (await c.query('SELECT * FROM mensagens WHERE id = $1 AND conversa_id = $2', [mid, id])).rows[0];
    const canal = await canalDaConversa(c, cv);
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
    const a = await comoSistema(async (cs) => (await cs.query('SELECT ativo FROM assistentes WHERE loja_id = $1', [cv.loja_id])).rows[0]);
    if (!a?.ativo) throw erro(409, 'O assistente virtual desta loja está desligado. Ligue em "Assistente virtual".');
    // marca como já respondido até agora: o assistente só fala quando o cliente escrever de novo
    await c.query(`UPDATE conversas SET estado = 'assistente', atendente_id = NULL, bot_respondeu_em = now() WHERE id = $1`, [cv.id]);
    await evento(c, cv, req, `${req.usuario.nome} devolveu a conversa ao assistente`);
  });
  res.json(r);
}));

// ---------- transferir para outra loja (números de WhatsApp diferentes) ----------
// A conversa continua no WhatsApp da loja de origem; a loja de destino passa a ver e responder por ele.
// Vai para a fila do destino (sem atendente, estado "aguardando"); a roleta de lá distribui.
conversas.get('/lojas-destino', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  const rows = await comoSistema(async (c) => (await c.query('SELECT id, nome, cidade, uf FROM lojas WHERE ativa AND id <> $1 ORDER BY nome', [req.usuario.loja_id])).rows);
  res.json(rows);
}));
conversas.post('/:id/transferir-loja', exigirPerfil('dono', 'atendente'), rota(async (req, res) => {
  const id = uuid(req.params.id);
  const d = validar(z.object({ lojaId: zUuid, nota: z.string().trim().max(300).optional() }), req.body);
  const r = await comContexto(ctx(req), async (c) => {
    const cv = await obterConversa(c, req, id);
    const destino = await comoSistema(async (cs) => (await cs.query('SELECT id, nome FROM lojas WHERE id = $1 AND ativa', [d.lojaId])).rows[0]);
    if (!destino) throw erro(404, 'Loja de destino não encontrada.');
    if (destino.id === cv.loja_id && !cv.loja_atendimento_id) throw erro(400, 'A conversa já é desta loja.');
    const voltando = destino.id === cv.loja_id;   // devolver para a loja de origem
    await c.query(`UPDATE conversas SET loja_atendimento_id = $2, transferida_em = CASE WHEN $2::uuid IS NULL THEN NULL ELSE now() END, transferida_por = $3,
                     estado = 'aguardando', atendente_id = NULL, atualizada_em = now() WHERE id = $1`, [cv.id, voltando ? null : destino.id, req.usuario.id]);
    await evento(c, cv, req, `${req.usuario.nome} transferiu a conversa para ${destino.nome}${d.nota ? ` — ${d.nota}` : ''}`);
    await registrar(c, req, 'transferiu_conversa', { alvo: cv.id, lojaId: req.usuario.loja_id, detalhes: { para: destino.id, nota: d.nota || null } });
    return destino;
  });
  // avisa a loja de destino pela roleta dela (distribui para quem estiver disponível)
  try { const { distribuirPendentes } = await import('../servicos/crm/roleta.js'); await comoSistema((c) => distribuirPendentes(c, r.id)); } catch { /* sem roleta: fica na fila */ }
  res.json({ ok: true, para: r });
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
    await c.query(`UPDATE conversas SET estado = 'humano', atendente_id = $2, atribuida_em = now() WHERE id = $1`, [cv.id, alvo.id]);
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
