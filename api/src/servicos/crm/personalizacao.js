// Etiquetas e campos personalizados (informações do cliente que o assistente coleta na conversa).
// loja_id NULL = da rede (valem para todas as lojas); preenchido = da loja.
import { z } from 'zod';
import { erro } from '../../http.js';

const zCor = z.string().trim().toLowerCase().regex(/^#[0-9a-f]{6}$/, 'Cor inválida.');
export const zEtiqueta = z.object({
  nome: z.string().trim().min(2, 'Dê um nome à etiqueta.').max(30).regex(/^[\p{L}\p{N} /&+.-]+$/u, 'Use só letras, números e espaços.'),
  cor: zCor.default('#64748b'),
  descricaoBot: z.string().trim().max(300).nullable().optional(),
});

export const TIPOS_CAMPO = ['texto', 'numero', 'data', 'lista', 'simnao'];
export const zCampo = z.object({
  nome: z.string().trim().min(2, 'Dê um nome ao campo.').max(60),
  tipo: z.enum(TIPOS_CAMPO).default('texto'),
  opcoes: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  instrucaoBot: z.string().trim().max(300).nullable().optional(),
  ativo: z.boolean().default(true),
}).refine((c) => c.tipo !== 'lista' || new Set(c.opcoes.map((o) => o.toLowerCase())).size >= 2, { message: 'Uma lista precisa de pelo menos 2 opções diferentes.', path: ['opcoes'] });

export function etiquetaPublica(e) {
  return { id: e.id, nome: e.nome, cor: e.cor, descricaoBot: e.descricao_bot || null, daRede: !e.loja_id, ...(e.uso != null ? { uso: Number(e.uso) } : {}) };
}
export function campoPublico(c) {
  return { id: c.id, chave: c.chave, nome: c.nome, tipo: c.tipo, opcoes: c.opcoes || [], instrucaoBot: c.instrucao_bot || null, ativo: c.ativo, ordem: c.ordem, daRede: !c.loja_id };
}

/** Etiquetas disponíveis: da rede + da loja (lojaId null = só as da rede). */
export async function listarEtiquetas(c, lojaId) {
  return (await c.query(
    `SELECT e.*, ${lojaId ? '(SELECT count(*) FROM contato_etiquetas ce WHERE ce.etiqueta_id = e.id AND ce.loja_id = $1)' : 'NULL'} AS uso
       FROM etiquetas e WHERE e.loja_id IS NULL ${lojaId ? 'OR e.loja_id = $1' : ''} ORDER BY e.loja_id NULLS FIRST, lower(e.nome)`, lojaId ? [lojaId] : [])).rows;
}

export async function listarCampos(c, lojaId, { soAtivos = false } = {}) {
  return (await c.query(
    `SELECT * FROM campos_personalizados WHERE (loja_id IS NULL ${lojaId ? 'OR loja_id = $1' : ''}) ${soAtivos ? 'AND ativo' : ''}
      ORDER BY loja_id NULLS FIRST, ordem, criado_em`, lojaId ? [lojaId] : [])).rows;
}

export function chaveDoNome(nome) {
  const base = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36);
  return /^[a-z]/.test(base) ? base : 'c_' + base;
}

/** Confere e normaliza o valor conforme o tipo do campo. Devolve null para apagar. Lança mensagem amigável se inválido. */
export function normalizarValor(campo, valor) {
  if (valor == null) return null;
  let v = String(valor).trim();
  if (!v) return null;
  switch (campo.tipo) {
    case 'numero': {
      const n = Number(v.replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(n)) throw new Error(`"${campo.nome}" precisa ser um número.`);
      return String(n);
    }
    case 'data': {
      const br = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (br) v = `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + 'T12:00:00Z'))) throw new Error(`"${campo.nome}" precisa ser uma data (AAAA-MM-DD).`);
      return v;
    }
    case 'lista': {
      const achada = (campo.opcoes || []).find((o) => o.toLowerCase() === v.toLowerCase());
      if (!achada) throw new Error(`"${campo.nome}" aceita só: ${(campo.opcoes || []).join(', ')}.`);
      return achada;
    }
    case 'simnao': {
      if (/^(s|sim|true|1|yes)$/i.test(v)) return 'sim';
      if (/^(n|nao|não|false|0|no)$/i.test(v)) return 'não';
      throw new Error(`"${campo.nome}" aceita só sim ou não.`);
    }
    default:
      return v.slice(0, 500);
  }
}

/** Grava valores { campoId: valor } de um cliente. Campos de outra loja ou inexistentes são recusados. */
export async function salvarValores(c, lojaId, contatoId, valores, { peloAssistente = false } = {}) {
  const campos = await listarCampos(c, lojaId, { soAtivos: true });
  const erros = {};
  for (const [campoId, bruto] of Object.entries(valores)) {
    const campo = campos.find((x) => x.id === campoId);
    if (!campo) { erros[campoId] = 'Campo não encontrado.'; continue; }
    let v;
    try { v = normalizarValor(campo, bruto); } catch (e) { erros[campoId] = e.message; continue; }
    if (v == null) await c.query('DELETE FROM valores_campos WHERE contato_id = $1 AND campo_id = $2', [contatoId, campoId]);
    else {
      await c.query(
        `INSERT INTO valores_campos (contato_id, campo_id, loja_id, valor, pelo_assistente) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (contato_id, campo_id) DO UPDATE SET valor = EXCLUDED.valor, pelo_assistente = EXCLUDED.pelo_assistente, atualizado_em = now()`,
        [contatoId, campoId, lojaId, v, peloAssistente]);
    }
  }
  if (Object.keys(erros).length) throw erro(422, Object.values(erros)[0], erros);
}

/** Define exatamente quais etiquetas o cliente tem (equipe). */
export async function definirEtiquetas(c, lojaId, contatoId, etiquetaIds, usuarioId) {
  const validas = new Set((await listarEtiquetas(c, lojaId)).map((e) => e.id));
  const ids = [...new Set(etiquetaIds)];
  if (ids.some((id) => !validas.has(id))) throw erro(422, 'Etiqueta não encontrada.');
  if (ids.length > 20) throw erro(422, 'No máximo 20 etiquetas por cliente.');
  await c.query('DELETE FROM contato_etiquetas WHERE contato_id = $1 AND NOT (etiqueta_id = ANY($2::uuid[]))', [contatoId, ids]);
  for (const id of ids) {
    await c.query(`INSERT INTO contato_etiquetas (contato_id, etiqueta_id, loja_id, aplicada_por) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [contatoId, id, lojaId, usuarioId]);
  }
}

/** Painel do cliente: campos com valores, etiquetas (disponíveis e aplicadas). */
export async function dadosDoPainel(c, lojaId, contatoId) {
  const campos = await listarCampos(c, lojaId, { soAtivos: true });
  const valores = (await c.query('SELECT * FROM valores_campos WHERE contato_id = $1', [contatoId])).rows;
  const etiquetas = await listarEtiquetas(c, lojaId);
  const aplicadas = (await c.query('SELECT etiqueta_id, pelo_assistente FROM contato_etiquetas WHERE contato_id = $1', [contatoId])).rows;
  return {
    campos: campos.map((x) => {
      const v = valores.find((y) => y.campo_id === x.id);
      return { ...campoPublico(x), valor: v?.valor ?? null, peloAssistente: v?.pelo_assistente || false, atualizadoEm: v?.atualizado_em || null };
    }),
    etiquetas: etiquetas.map(etiquetaPublica),
    aplicadas: aplicadas.map((a) => ({ id: a.etiqueta_id, peloAssistente: a.pelo_assistente })),
  };
}
