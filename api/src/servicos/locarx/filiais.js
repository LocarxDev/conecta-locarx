// Filiais de uma franquia (loja do Conecta). lojas.branch_id é a principal; as demais ficam em `filiais`.
// Tudo o que precisa de um branchId (cotação, reserva, assistente, MCP) resolve a filial por aqui.
import * as locarx from './api-locarx.js';
import { config } from '../../config.js';

export const filialPublica = (f) => ({ id: f.id, branchId: f.branch_id, nome: f.nome, principal: f.principal, ativa: f.ativa, ...(f.portal !== undefined ? { portal: f.portal } : {}) });

/**
 * Filiais da loja com o que o portal diz de cada uma (nome oficial, endereço, cidade, horários, atendimento especial).
 * O portal é a fonte: se mudarem o nome ou o horário lá, muda aqui (cache de 1 h). Sem API ou filial não encontrada → portal: null.
 */
export async function filiaisComPortal(c, lojaId, { soAtivas = true } = {}) {
  const lista = await filiaisDaLoja(c, lojaId, { soAtivas });
  if (!config.locarx) return lista.map((f) => ({ ...f, portal: null }));
  return Promise.all(lista.map(async (f) => {
    let d = null;
    try { d = await locarx.dadosDaFilial(f.branch_id); } catch { d = null; }
    return { ...f, portal: d ? { nome: d.nome, nomeCompleto: d.nomeCompleto, tipo: d.tipo, endereco: d.endereco, cidade: d.cidade, uf: d.uf, horarios: d.horariosTexto || null, especiais: d.especiaisTexto || null } : null };
  }));
}

export async function filiaisDaLoja(c, lojaId, { soAtivas = true } = {}) {
  const rows = (await c.query(`SELECT * FROM filiais WHERE loja_id = $1 ${soAtivas ? 'AND ativa' : ''} ORDER BY principal DESC, nome`, [lojaId])).rows;
  if (rows.length) return rows;
  // loja antiga sem linha em filiais (esquema ainda não migrado): a própria loja é a filial
  const l = (await c.query('SELECT id, branch_id, nome FROM lojas WHERE id = $1', [lojaId])).rows[0];
  return l?.branch_id ? [{ id: null, loja_id: l.id, branch_id: l.branch_id, nome: l.nome, principal: true, ativa: true }] : [];
}

/**
 * Resolve a filial pedida (id, branchId ou nome aproximado) entre as da loja. Sem pedido → principal.
 * Devolve { branchId, nome, id } ou null se a loja não tiver filial válida; lança se o pedido não bater com nenhuma.
 */
export async function resolverFilial(c, lojaId, pedido) {
  const lista = await filiaisDaLoja(c, lojaId);
  if (!lista.length) return null;
  if (pedido == null || pedido === '') return filialPublica(lista[0]);
  const p = String(pedido).trim().toLowerCase();
  const achada = lista.find((f) => f.id === p || String(f.branch_id) === p)
    || lista.find((f) => f.nome.toLowerCase() === p)
    || lista.find((f) => f.nome.toLowerCase().includes(p) || p.includes(f.nome.toLowerCase()));
  if (!achada) { const e = new Error(`Filial "${pedido}" não encontrada. Opções: ${lista.map((f) => f.nome).join(', ')}.`); e.status = 422; throw e; }
  return filialPublica(achada);
}

// nome da filial por branchId (para telas e relatórios); mapa { branchId: nome }
export async function nomesDasFiliais(c, lojaId) {
  const lista = await filiaisDaLoja(c, lojaId, { soAtivas: false });
  return Object.fromEntries(lista.map((f) => [f.branch_id, f.nome]));
}
