// Cotação de locação: o que o assistente (ferramentas.js) e a equipe (tela Cotação) usam em comum.
// Toda chamada à API LocarX continua em api-locarx.js; aqui fica só a regra de negócio e o texto para o cliente.
import * as locarx from './api-locarx.js';

export const reais = (v) => (v == null ? 'a confirmar' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/, RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export const PROTECOES_VALIDAS = ['PROTECAO_X', 'PROTECAO_SUPER_X', 'TERCEIROS', 'VIDROS', 'VIDROS_E_PNEUS'];

// datas no horário de Salvador (UTC-3, sem horário de verão)
export const instante = (x) => new Date(`${x.date}T${x.time}:00-03:00`);

/**
 * Valida o período pedido. `antecedenciaHoras` é o mínimo até a retirada (24 h para o assistente,
 * porque a API LocarX não devolve carros com menos de 24 h; 0 para a equipe, que só consulta).
 */
export function validarPeriodo(a, { antecedenciaHoras = 24 } = {}) {
  for (const [c, re] of [['data_retirada', RE_DATA], ['hora_retirada', RE_HORA], ['data_devolucao', RE_DATA], ['hora_devolucao', RE_HORA]]) {
    if (!re.test(String(a[c] || ''))) throw new Error(`Informe ${c.replace('_', ' ')} no formato ${re === RE_DATA ? 'AAAA-MM-DD' : 'HH:MM'}.`);
  }
  const retirada = { date: a.data_retirada, time: a.hora_retirada }, devolucao = { date: a.data_devolucao, time: a.hora_devolucao };
  const ini = instante(retirada), fim = instante(devolucao);
  if (Number.isNaN(ini.getTime()) || Number.isNaN(fim.getTime())) throw new Error('Data inválida.');
  if (antecedenciaHoras > 0 && ini < new Date(Date.now() + antecedenciaHoras * 3_600_000)) {
    throw new Error(`Retirada com menos de ${antecedenciaHoras} horas de antecedência não pode ser reservada pelo assistente. Avise o cliente e use chamar_atendente com o motivo "retirada em menos de ${antecedenciaHoras} h".`);
  }
  if (antecedenciaHoras <= 0 && ini < new Date()) throw new Error('A retirada precisa ser no futuro.');
  if (fim <= ini) throw new Error('A devolução precisa ser depois da retirada.');
  if (fim - ini > 90 * 86_400_000) throw new Error('Períodos acima de 90 dias precisam ser tratados com um atendente.');
  return { retirada, devolucao, ini, fim };
}

export function normalizarProtecoes(lista) {
  let p = [...new Set((Array.isArray(lista) ? lista : []).map((x) => String(x).toUpperCase().replace(/[\s-]+/g, '_').replace(/[^A-Z_]/g, '')).filter((x) => PROTECOES_VALIDAS.includes(x)))];
  if (!p.includes('PROTECAO_X') && !p.includes('PROTECAO_SUPER_X')) p.unshift('PROTECAO_X');
  if (p.includes('PROTECAO_X') && p.includes('PROTECAO_SUPER_X')) p = p.filter((x) => x !== 'PROTECAO_X');
  if (p.includes('VIDROS') && p.includes('VIDROS_E_PNEUS')) p = p.filter((x) => x !== 'VIDROS');
  return p;
}

// ---------- textos ----------
export const periodoTexto = (a) => `${a.data_retirada.split('-').reverse().slice(0, 2).join('/')} ${a.hora_retirada} até ${a.data_devolucao.split('-').reverse().slice(0, 2).join('/')} ${a.hora_devolucao}`;
export const dataBr = (x) => `${x.date.split('-').reverse().join('/')} às ${x.time}`;

// "B - COMPACTO COM AR" → letra B, nome "Compacto com ar". Sem letra no nome, usa o número da opção.
export function rotuloGrupo(g, n) {
  const m = String(g.grupo || '').match(/^\s*([A-Z0-9]{1,3})\s*[-–.]\s*(.+)$/i);
  const cap = (t) => t.toLowerCase().replace(/^./, (c) => c.toUpperCase());
  return m ? { letra: m[1].toUpperCase(), nome: cap(m[2].trim()) } : { letra: String(n), nome: cap(String(g.grupo || 'Grupo')) };
}

export const cambioTexto = (c) => (c ? 'câmbio ' + String(c).toLowerCase().replace('automatic', 'automático') : null);

// ordena do mais barato para o mais caro (sem total vai para o fim)
export const ordenarPorPreco = (grupos) => [...grupos].sort((x, y) => (x.total ?? 1e9) - (y.total ?? 1e9));

/**
 * Mensagem de WhatsApp com as opções, no formato fixo da rede.
 * @param {Array} mostrar grupos já ordenados e recortados
 * @param {object} opcoes { periodo: texto, inicio: número da primeira opção (para letras sem grupo), haMais: boolean }
 */
export function textoOpcoes(mostrar, { periodo, inicio = 1, haMais = false } = {}) {
  const linhas = mostrar.map((g, i) => {
    const rotulo = rotuloGrupo(g, i + inicio);
    return `*${rotulo.letra} – ${rotulo.nome}*\n${[g.exemplos, cambioTexto(g.cambio)].filter(Boolean).join(' · ')}\n${reais(g.diaria)} por diária · *Total ${reais(g.total)}*`;
  });
  const letras = mostrar.map((g, i) => rotuloGrupo(g, i + inicio).letra);
  const pedir = letras.length > 1 ? 'a letra (' + letras.slice(0, -1).join(', ') + ' ou ' + letras.at(-1) + ')' : 'a letra ' + letras[0];
  return `🚗 *Opções para ${periodo}:*\n\n${linhas.join('\n\n')}\n\nO total já inclui a Proteção X e as taxas. Pagamento na loja, na retirada.\nQual você prefere? É só responder com ${pedir}.${haMais ? '\nSe quiser, mostro outras opções.' : ''}`;
}

// ---------- consulta ----------
/**
 * Consulta a disponibilidade da filial e devolve os grupos ordenados por preço, já com rótulo (letra/nome).
 * Usado pela tela Cotação (equipe). O assistente usa consultar_disponibilidade (ferramentas.js), que recorta em 3.
 */
export async function cotarPeriodo({ branchId, periodo }) {
  const d = await locarx.disponibilidadeCompleta({ branchId, retirada: periodo.retirada, devolucao: periodo.devolucao });
  const grupos = ordenarPorPreco(d.grupos).map((g, i) => ({ ...g, rotulo: rotuloGrupo(g, i + 1) }));
  return { grupos, adicionais: d.adicionais, politicas: d.politicas, km: d.km };
}
