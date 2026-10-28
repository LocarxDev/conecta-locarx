// Funis de venda personalizáveis.
// A rede tem um funil padrão (loja_id NULL). Na primeira vez que a loja usa o funil, o padrão é copiado para ela
// (garantir_funil_loja, no banco). Depois o dono cria, renomeia e reordena os próprios funis e etapas.
// Toda etapa tem um tipo: aberta, ganho ou perdido. Cada funil tem exatamente uma de ganho e uma de perdido.
// Etapas abertas podem ter um "acontecimento" (cotacao, reserva, retirada): o assistente e as automações
// movem o cliente para lá sozinhos, no funil principal da loja.
import { z } from 'zod';
import { erro } from '../../http.js';

export const EVENTOS = ['cotacao', 'reserva', 'retirada'];
export const TIPOS = ['aberta', 'ganho', 'perdido'];
const zCor = z.string().trim().toLowerCase().regex(/^#[0-9a-f]{6}$/, 'Cor inválida.');

export const zFunil = z.object({
  nome: z.string().trim().min(2, 'Dê um nome ao funil.').max(60),
  principal: z.boolean().optional(),
  etapas: z.array(z.object({
    id: z.string().uuid().optional(),
    nome: z.string().trim().min(2, 'Toda etapa precisa de nome.').max(40),
    cor: zCor.default('#64748b'),
    tipo: z.enum(TIPOS).default('aberta'),
    evento: z.enum(EVENTOS).nullable().optional(),
    modeloChave: z.string().regex(/^[a-z0-9_]{2,40}$/, 'Modelo inválido.').nullable().optional(), // mensagem enviada ao entrar na etapa
  })).min(3, 'O funil precisa de pelo menos 3 etapas.').max(15, 'No máximo 15 etapas.'),
}).superRefine((f, ctx) => {
  const n = (t) => f.etapas.filter((e) => e.tipo === t).length;
  if (n('aberta') < 1) ctx.addIssue({ code: 'custom', path: ['etapas'], message: 'O funil precisa de pelo menos uma etapa em andamento.' });
  if (n('ganho') !== 1) ctx.addIssue({ code: 'custom', path: ['etapas'], message: 'O funil precisa de exatamente uma etapa de venda concluída.' });
  if (n('perdido') !== 1) ctx.addIssue({ code: 'custom', path: ['etapas'], message: 'O funil precisa de exatamente uma etapa de perdido.' });
  const ev = f.etapas.filter((e) => e.evento).map((e) => e.evento);
  if (new Set(ev).size !== ev.length) ctx.addIssue({ code: 'custom', path: ['etapas'], message: 'Cada acontecimento só pode mover o cliente para uma etapa.' });
  if (f.etapas.some((e) => e.evento && e.tipo !== 'aberta')) ctx.addIssue({ code: 'custom', path: ['etapas'], message: 'Acontecimentos só em etapas em andamento.' });
  const nomes = f.etapas.map((e) => e.nome.toLowerCase());
  if (new Set(nomes).size !== nomes.length) ctx.addIssue({ code: 'custom', path: ['etapas'], message: 'Há duas etapas com o mesmo nome.' });
});

export const ETAPAS_NOVO_FUNIL = [
  { nome: 'Novo contato', cor: '#64748b', tipo: 'aberta' },
  { nome: 'Em negociação', cor: '#2563eb', tipo: 'aberta' },
  { nome: 'Fechado', cor: '#16a34a', tipo: 'ganho' },
  { nome: 'Perdido', cor: '#dc2626', tipo: 'perdido' },
];

export const garantirFunil = async (c, lojaId) => (await c.query('SELECT garantir_funil_loja($1) AS id', [lojaId])).rows[0].id;

export function etapaPublica(e) {
  return { id: e.id, nome: e.nome, cor: e.cor, tipo: e.tipo, evento: e.evento || null, modeloChave: e.modelo_chave || null, ordem: e.ordem };
}

/** Funis (com etapas) da loja, ou da rede quando lojaId = null. */
export async function listarFunis(c, lojaId, { comArquivados = false } = {}) {
  const funis = (await c.query(
    `SELECT f.*, (SELECT count(*) FROM oportunidades o WHERE o.funil_id = f.id AND o.fechada_em IS NULL)::int AS abertas
       FROM funis f WHERE f.loja_id IS NOT DISTINCT FROM $1 ${comArquivados ? '' : 'AND NOT f.arquivado'}
      ORDER BY f.principal DESC, f.ordem, f.criado_em`, [lojaId])).rows;
  if (!funis.length) return [];
  const etapas = (await c.query(
    `SELECT e.*, (SELECT count(*) FROM oportunidades o WHERE o.etapa_id = e.id AND o.fechada_em IS NULL)::int AS abertas
       FROM etapas_funil e WHERE e.funil_id = ANY($1) ORDER BY e.ordem`, [funis.map((f) => f.id)])).rows;
  return funis.map((f) => ({
    id: f.id, nome: f.nome, principal: f.principal, arquivado: f.arquivado, personalizado: f.personalizado, abertas: f.abertas,
    etapas: etapas.filter((e) => e.funil_id === f.id).map((e) => ({ ...etapaPublica(e), abertas: e.abertas })),
  }));
}

/**
 * Cria (funilId = null) ou altera um funil e as etapas, na ordem recebida.
 * Etapas removidas: os clientes que estavam nelas vão para a etapa equivalente (mesmo tipo; nas abertas, a primeira).
 * O tipo de uma etapa que já existe não muda (para não bagunçar o histórico de ganhos e perdas).
 */
export async function salvarFunil(c, lojaId, funilId, d, { marcarPersonalizado = true } = {}) {
  let funil;
  if (funilId) {
    funil = (await c.query('SELECT * FROM funis WHERE id = $1 AND loja_id IS NOT DISTINCT FROM $2 AND NOT arquivado FOR UPDATE', [funilId, lojaId])).rows[0];
    if (!funil) throw erro(404, 'Funil não encontrado.');
    await c.query('UPDATE funis SET nome = $2, personalizado = personalizado OR $3 WHERE id = $1', [funil.id, d.nome, marcarPersonalizado]);
  } else {
    const qtd = (await c.query('SELECT count(*)::int AS n FROM funis WHERE loja_id IS NOT DISTINCT FROM $1 AND NOT arquivado', [lojaId])).rows[0].n;
    if (qtd >= 10) throw erro(409, 'Limite de 10 funis. Arquive um funil que não usa mais.');
    funil = (await c.query('INSERT INTO funis (loja_id, nome, ordem, personalizado) VALUES ($1, $2, $3, true) RETURNING *', [lojaId, d.nome, qtd])).rows[0];
  }
  const existentes = (await c.query('SELECT * FROM etapas_funil WHERE funil_id = $1', [funil.id])).rows;
  const porId = new Map(existentes.map((e) => [e.id, e]));
  // o tipo das etapas que já existem é o do banco
  const lista = d.etapas.map((e) => ({ ...e, tipo: porId.get(e.id)?.tipo || e.tipo, evento: e.evento || null, modeloChave: lojaId ? (e.modeloChave || null) : null }));
  const chaves = [...new Set(lista.map((e) => e.modeloChave).filter(Boolean))];
  if (chaves.length) {
    const ok = (await c.query('SELECT chave FROM modelos_mensagem WHERE loja_id = $1 AND chave = ANY($2)', [lojaId, chaves])).rows.map((r) => r.chave);
    if (chaves.some((k) => !ok.includes(k))) throw erro(422, 'Escolha um modelo de mensagem que exista na sua loja.');
  }
  const tipos = (t) => lista.filter((e) => e.tipo === t).length;
  if (tipos('ganho') !== 1 || tipos('perdido') !== 1 || tipos('aberta') < 1) throw erro(422, 'O funil precisa de uma etapa de venda concluída, uma de perdido e pelo menos uma em andamento.');
  if (lista.some((e) => e.evento && e.tipo !== 'aberta')) throw erro(422, 'Acontecimentos só em etapas em andamento.');

  // libera os acontecimentos antes de redistribuir (evita conflito no índice único)
  await c.query('UPDATE etapas_funil SET evento = NULL WHERE funil_id = $1', [funil.id]);
  const ids = [];
  for (const [i, e] of lista.entries()) {
    if (e.id && porId.has(e.id)) {
      // mensagem_desde: quem já estava na etapa antes de ligar/trocar a mensagem não recebe
      await c.query(`UPDATE etapas_funil SET nome = $2, cor = $3, evento = $4, ordem = $5,
          mensagem_desde = CASE WHEN modelo_chave IS DISTINCT FROM $6 THEN (CASE WHEN $6::text IS NULL THEN NULL ELSE now() END) ELSE mensagem_desde END, modelo_chave = $6 WHERE id = $1`,
        [e.id, e.nome, e.cor, e.evento, i, e.modeloChave]);
      ids.push(e.id);
    } else {
      const nova = (await c.query(`INSERT INTO etapas_funil (funil_id, nome, cor, tipo, evento, ordem, origem_id, modelo_chave, mensagem_desde)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8::text IS NULL THEN NULL ELSE now() END) RETURNING id`,
        [funil.id, e.nome, e.cor, e.tipo, e.evento, i, e.origemId || null, e.modeloChave])).rows[0];
      ids.push(nova.id);
      e.id = nova.id;
    }
  }
  const removidas = existentes.filter((e) => !ids.includes(e.id));
  for (const r of removidas) {
    const destino = lista.find((e) => e.tipo === r.tipo);
    await c.query('UPDATE oportunidades SET etapa_id = $2, atualizada_em = now() WHERE etapa_id = $1', [r.id, destino.id]);
    await c.query('DELETE FROM etapas_funil WHERE id = $1', [r.id]);
  }
  if (d.principal && !funil.principal) {
    await c.query('UPDATE funis SET principal = false WHERE loja_id IS NOT DISTINCT FROM $1 AND principal', [lojaId]);
    await c.query('UPDATE funis SET principal = true WHERE id = $1', [funil.id]);
  }
  return funil.id;
}

export async function arquivarFunil(c, lojaId, funilId) {
  const f = (await c.query('SELECT * FROM funis WHERE id = $1 AND loja_id = $2 AND NOT arquivado FOR UPDATE', [funilId, lojaId])).rows[0];
  if (!f) throw erro(404, 'Funil não encontrado.');
  if (f.principal) throw erro(409, 'Este é o funil principal (o que o assistente usa). Escolha outro funil como principal antes de arquivar.');
  const abertas = (await c.query('SELECT count(*)::int AS n FROM oportunidades WHERE funil_id = $1 AND fechada_em IS NULL', [funilId])).rows[0].n;
  if (abertas) throw erro(409, `Há ${abertas} cliente(s) em andamento neste funil. Conclua, marque como perdido ou mova antes de arquivar.`);
  await c.query('UPDATE funis SET arquivado = true, principal = false WHERE id = $1', [funilId]);
}

/**
 * Leva as mudanças do funil padrão da rede para as lojas que ainda não personalizaram o funil copiado.
 * As etapas são casadas pela origem (de qual etapa da rede vieram); clientes de etapas removidas são realocados.
 */
export async function propagarPadrao(c, funilRedeId) {
  const rede = (await c.query('SELECT * FROM funis WHERE id = $1 AND loja_id IS NULL', [funilRedeId])).rows[0];
  if (!rede) return 0;
  const etapasRede = (await c.query('SELECT * FROM etapas_funil WHERE funil_id = $1 ORDER BY ordem', [rede.id])).rows;
  const copias = (await c.query('SELECT * FROM funis WHERE origem_id = $1 AND NOT personalizado AND NOT arquivado', [rede.id])).rows;
  for (const f of copias) {
    const atuais = (await c.query('SELECT id, origem_id, tipo FROM etapas_funil WHERE funil_id = $1', [f.id])).rows;
    const etapas = etapasRede.map((e) => {
      const casada = atuais.find((a) => a.origem_id === e.id && a.tipo === e.tipo);
      return { id: casada?.id, nome: e.nome, cor: e.cor, tipo: e.tipo, evento: e.evento, origemId: e.id };
    });
    await salvarFunil(c, f.loja_id, f.id, { nome: rede.nome, etapas }, { marcarPersonalizado: false });
  }
  return copias.length;
}

/**
 * Move o cliente no funil principal da loja quando algo acontece na conversa
 * (cotacao, reserva). Só avança, nunca volta. Cria a oportunidade se não houver uma aberta.
 */
export async function registrarEvento(c, { lojaId, contatoId, conversaId, evento, valor = null, reservaId = null }) {
  const funilId = await garantirFunil(c, lojaId);
  const etapas = (await c.query('SELECT * FROM etapas_funil WHERE funil_id = $1 ORDER BY ordem', [funilId])).rows;
  const alvo = evento ? etapas.find((e) => e.evento === evento) : null;
  const cotou = ['cotacao', 'reserva'].includes(evento), reservou = evento === 'reserva';
  const o = (await c.query('SELECT * FROM oportunidades WHERE contato_id = $1 AND funil_id = $2 AND fechada_em IS NULL FOR UPDATE', [contatoId, funilId])).rows[0];
  if (!o) {
    const inicio = alvo || etapas.find((e) => e.tipo === 'aberta');
    await c.query(
      `INSERT INTO oportunidades (loja_id, contato_id, conversa_id, reserva_id, funil_id, etapa_id, valor_previsto, cotou_em, reservou_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8 THEN now() END, CASE WHEN $9 THEN now() END)
       ON CONFLICT (contato_id, funil_id) WHERE fechada_em IS NULL DO NOTHING`,
      [lojaId, contatoId, conversaId || null, reservaId, funilId, inicio.id, valor, cotou, reservou]);
    return;
  }
  const atual = etapas.find((e) => e.id === o.etapa_id);
  const avanca = alvo && atual?.tipo === 'aberta' && alvo.ordem > atual.ordem;
  await c.query(
    `UPDATE oportunidades SET etapa_id = $2, valor_previsto = coalesce($3, valor_previsto), reserva_id = coalesce($4, reserva_id),
       cotou_em = coalesce(cotou_em, CASE WHEN $5 THEN now() END), reservou_em = coalesce(reservou_em, CASE WHEN $6 THEN now() END),
       conversa_id = coalesce(conversa_id, $7), atualizada_em = now()
     WHERE id = $1`,
    [o.id, avanca ? alvo.id : o.etapa_id, valor, reservaId, cotou, reservou, conversaId || null]);
}

// =====================================================================
// Regras automáticas: perdido / concluído sem ninguém mexer (parâmetros em lojas.regras_funil)
// =====================================================================
export const REGRAS_PADRAO = { perdidoSemRespostaHoras: 48, perdidoPeloAssistente: true, concluidoAoPagar: true, concluidoNaRetirada: true };
export const zRegrasFunil = z.object({
  perdidoSemRespostaHoras: z.number().int().min(0).max(720),
  perdidoPeloAssistente: z.boolean(),
  concluidoAoPagar: z.boolean(),
  concluidoNaRetirada: z.boolean(),
});
export async function regrasDaLoja(c, lojaId) {
  const r = (await c.query('SELECT regras_funil FROM lojas WHERE id = $1', [lojaId])).rows[0]?.regras_funil;
  return { ...REGRAS_PADRAO, ...(r || {}) };
}

/**
 * Fecha a oportunidade aberta do contato no funil principal: move para a etapa de ganho/perdido e grava resultado.
 * Não mexe em oportunidade já fechada nem em funil sem a etapa. Devolve true se fechou.
 */
export async function fecharOportunidade(c, { lojaId, contatoId, oportunidadeId = null, resultado, motivo = null, por = 'automatico' }) {
  const o = oportunidadeId
    ? (await c.query('SELECT * FROM oportunidades WHERE id = $1 AND loja_id = $2 AND fechada_em IS NULL FOR UPDATE', [oportunidadeId, lojaId])).rows[0]
    : (await c.query(`SELECT o.* FROM oportunidades o JOIN funis f ON f.id = o.funil_id WHERE o.contato_id = $1 AND o.loja_id = $2 AND o.fechada_em IS NULL AND f.principal ORDER BY o.criada_em DESC LIMIT 1 FOR UPDATE OF o`, [contatoId, lojaId])).rows[0];
  if (!o) return false;
  const etapa = (await c.query('SELECT id FROM etapas_funil WHERE funil_id = $1 AND tipo = $2 LIMIT 1', [o.funil_id, resultado])).rows[0];
  if (!etapa) return false;
  await c.query(
    `UPDATE oportunidades SET etapa_id = $2, resultado = $3, fechada_em = now(), motivo_perda = CASE WHEN $3 = 'perdido' THEN $4 ELSE NULL END, fechada_por = $5, atualizada_em = now() WHERE id = $1`,
    [o.id, etapa.id, resultado, motivo ? String(motivo).slice(0, 200) : null, por]);
  return true;
}

/**
 * Varredura (a cada 10 min): aplica as regras de cada loja.
 * - perdido: oportunidade aberta, sem reserva, cuja conversa está parada há N h com a última palavra nossa (o cliente não respondeu).
 * - concluído: oportunidade aberta com reserva não cancelada cuja retirada já passou.
 */
export async function aplicarRegrasFunil(c) {
  const lojas = (await c.query(`SELECT id, regras_funil FROM lojas WHERE ativa`)).rows;
  const feito = { perdidas: 0, concluidas: 0 };
  for (const l of lojas) {
    const r = { ...REGRAS_PADRAO, ...(l.regras_funil || {}) };
    if (r.perdidoSemRespostaHoras > 0) {
      const paradas = (await c.query(
        `SELECT o.id FROM oportunidades o JOIN funis f ON f.id = o.funil_id JOIN conversas cv ON cv.id = o.conversa_id
          WHERE o.loja_id = $1 AND o.fechada_em IS NULL AND o.reservou_em IS NULL AND f.principal
            AND cv.ultima_do_cliente IS NOT NULL AND cv.ultima_do_cliente < now() - make_interval(hours => $2)
            AND cv.ultima_mensagem_em > cv.ultima_do_cliente LIMIT 200`, [l.id, r.perdidoSemRespostaHoras])).rows;
      for (const o of paradas) if (await fecharOportunidade(c, { lojaId: l.id, oportunidadeId: o.id, resultado: 'perdido', motivo: `Sem resposta há ${r.perdidoSemRespostaHoras} h` })) feito.perdidas++;
    }
    if (r.concluidoNaRetirada) {
      const retiradas = (await c.query(
        `SELECT o.id FROM oportunidades o JOIN reservas rs ON rs.id = o.reserva_id
          WHERE o.loja_id = $1 AND o.fechada_em IS NULL AND rs.status <> 'cancelada' AND rs.retirada < now() LIMIT 200`, [l.id])).rows;
      for (const o of retiradas) if (await fecharOportunidade(c, { lojaId: l.id, oportunidadeId: o.id, resultado: 'ganho' })) feito.concluidas++;
    }
  }
  return feito;
}
