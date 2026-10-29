// Filiais de uma franquia (loja do Conecta). lojas.branch_id é a principal; as demais ficam em `filiais`.
// Tudo o que precisa de um branchId (cotação, reserva, assistente, MCP) resolve a filial por aqui.
import * as locarx from './api-locarx.js';
import { config } from '../../config.js';

export const filialPublica = (f) => ({ id: f.id ?? (f._portal ? String(f.branch_id) : null), branchId: f.branch_id, nome: f.nome, principal: f.principal, ativa: f.ativa, ...(f.cidade ? { cidade: f.cidade, uf: f.uf || null, tipo: f.tipo || null } : {}), ...(f.portal !== undefined ? { portal: f.portal } : {}) });

/**
 * Filiais da loja com o que o portal diz de cada uma (nome oficial, endereço, cidade, horários, atendimento especial).
 * O portal é a fonte: se mudarem o nome ou o horário lá, muda aqui (cache de 1 h). Sem API ou filial não encontrada → portal: null.
 */
export async function filiaisComPortal(c, lojaId, { soAtivas = true } = {}) {
  const lista = await filiaisDaLoja(c, lojaId, { soAtivas });
  // central: o portal já veio junto com a lista da rede (uma chamada só, em vez de uma por filial)
  if (lista.some((f) => f._portal)) return lista.map((f) => ({ ...f, portal: f._portal ? { nome: f._portal.nome, nomeCompleto: f._portal.nomeCompleto, tipo: f._portal.tipo, endereco: f._portal.endereco, cidade: f._portal.cidade, uf: f._portal.uf, horarios: f._portal.horariosTexto || null, especiais: f._portal.especiaisTexto || null } : null }));
  if (!config.locarx) return lista.map((f) => ({ ...f, portal: null }));
  return Promise.all(lista.map(async (f) => {
    let d = null;
    try { d = await locarx.dadosDaFilial(f.branch_id); } catch { d = null; }
    return { ...f, portal: d ? { nome: d.nome, nomeCompleto: d.nomeCompleto, tipo: d.tipo, endereco: d.endereco, cidade: d.cidade, uf: d.uf, horarios: d.horariosTexto || null, especiais: d.especiaisTexto || null } : null };
  }));
}

// ---------- Central de Reservas ----------
// A rede inteira de filiais do portal (cache de 1 h). A central reserva em qualquer uma delas.
let cacheRede = { em: 0, lista: null };
export async function redeDeFiliais() {
  if (cacheRede.lista && Date.now() - cacheRede.em < 3_600_000) return cacheRede.lista;
  const lista = (await locarx.localidades()).filter((f) => f.branchId && f.cidade);
  cacheRede = { em: Date.now(), lista };
  return lista;
}
export const limparCacheRede = () => { cacheRede = { em: 0, lista: null }; };
const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
export { semAcento };

async function linhasDaCentral(l) {
  let rede = [];
  try { rede = await redeDeFiliais(); } catch { rede = []; }
  if (!rede.length) return null;
  return rede
    .map((f) => ({ id: null, loja_id: l.id, branch_id: Number(f.branchId), nome: f.nome, cidade: f.cidade, uf: f.uf, tipo: f.tipo, principal: Number(f.branchId) === Number(l.branch_id), ativa: true, _portal: f }))
    .sort((a, b) => (a.principal ? -1 : b.principal ? 1 : semAcento(a.cidade).localeCompare(semAcento(b.cidade)) || a.nome.localeCompare(b.nome)));
}

export async function filiaisDaLoja(c, lojaId, { soAtivas = true } = {}) {
  const loja = (await c.query('SELECT id, branch_id, central FROM lojas WHERE id = $1', [lojaId])).rows[0];
  if (loja?.central) { const r = await linhasDaCentral(loja); if (r) return r; }   // sem API: cai na filial própria
  return filiaisDaLojaComum(c, lojaId, { soAtivas });
}

async function filiaisDaLojaComum(c, lojaId, { soAtivas = true } = {}) {
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
  if (pedido == null || pedido === '') {
    // Central sem filial própria: não existe "filial padrão"; a equipe/IA precisa escolher onde o cliente retira
    if (lista[0]?.cidade && !lista.some((f) => f.principal)) { const e = new Error('Escolha a filial de retirada (busque pela cidade).'); e.status = 422; throw e; }
    return filialPublica(lista.find((f) => f.principal) || lista[0]);
  }
  const p = String(pedido).trim().toLowerCase();
  if (lista[0]?.cidade) return filialDaCentral(lista, p);
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

// Central: o pedido pode ser branchId, nome da filial ou só a cidade. Se a cidade tem mais de uma filial (ex.: cidade e aeroporto), pede para escolher.
export function filialDaCentral(lista, pedido) {
  const p = semAcento(pedido);
  const exata = lista.find((f) => String(f.branch_id) === p) || lista.find((f) => semAcento(f.nome) === p);
  if (exata) return filialPublica(exata);
  const daCidade = lista.filter((f) => semAcento(f.cidade) === p);
  const porNome = lista.filter((f) => semAcento(f.nome).includes(p) || semAcento(`${f.cidade} ${f.nome}`).includes(p));
  const candidatas = daCidade.length ? daCidade : porNome;
  if (candidatas.length === 1) return filialPublica(candidatas[0]);
  const e = new Error(candidatas.length
    ? `Há ${candidatas.length} filiais para "${pedido}": ${candidatas.slice(0, 8).map((f) => `${f.nome} (${f.cidade}/${f.uf})`).join('; ')}. Pergunte ao cliente em qual retira e use o nome exato.`
    : `Nenhuma filial encontrada para "${pedido}". Use buscar_filiais com a cidade para ver as opções.`);
  e.status = 422;
  throw e;
}
