// Adaptador da API LocarX (portal de reservas).
// TODA chamada à API LocarX passa por este arquivo. Se o formato de algum endpoint mudar,
// ajuste só aqui. O botão "Testar API LocarX" (painel da administração) mostra a resposta crua
// de cada endpoint para conferir os nomes dos campos.
//
// Confirmados em testes anteriores (26/09/2026): GET /locality e GET /reservations.
// A CONFIRMAR com token de homologação: parâmetros de /availabilities/external, corpo de
// /prices/calculate, /reservations/new e /reservations/cancel.
import { config } from '../../config.js';

export class ErroLocarx extends Error {
  constructor(mensagem, status, resposta) { super(mensagem); this.status = status; this.resposta = resposta; }
}

async function chamar(metodo, caminho, { query, corpo } = {}) {
  if (!config.locarx) throw new ErroLocarx('API LocarX não configurada no servidor.', 503);
  const url = new URL(config.locarx.url + caminho);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const r = await fetch(url, {
    method: metodo,
    headers: { Authorization: `Bearer ${config.locarx.token}`, Accept: 'application/json', ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(25_000),
  });
  const texto = await r.text();
  let dados = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch { dados = { bruto: texto.slice(0, 500) }; }
  if (!r.ok) throw new ErroLocarx(`API LocarX ${metodo} ${caminho} respondeu ${r.status}`, r.status, dados);
  return dados;
}

const lista = (d) => (Array.isArray(d) ? d : d?.content || d?.data || d?.items || d?.results || []);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const dataHora = (iso) => { const d = new Date(iso); return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) }; };

// Datas: o assistente trabalha no horário de Salvador; a API recebe data e hora locais da loja.
export function separarDataHora(data, hora) { return { date: data, time: hora }; }

// ---------- lojas ----------
export async function localidades() {
  return lista(await chamar('GET', '/locality')).map((l) => ({
    branchId: l.branchId, nome: l.displayName || l.name, cidade: l.city, uf: l.state,
    codigo: l.branchCode, iata: l.iataCode, tipo: l.typeLabel || l.type,
    horarios: l.businessHours || [], horariosEspeciais: l.specialAttentionHours || [],
    endereco: l.address || l.fullAddress || null,
  }));
}

export async function dadosDaFilial(branchId) {
  return (await localidades()).find((l) => Number(l.branchId) === Number(branchId)) || null;
}

// ---------- disponibilidade ----------
export async function disponibilidade({ branchId, retirada, devolucao }) {
  const d = await chamar('GET', '/availabilities/external', {
    query: {
      pickUpBranchId: branchId, dropOffBranchId: branchId,
      pickUpDate: retirada.date, pickUpTime: retirada.time,
      dropOffDate: devolucao.date, dropOffTime: devolucao.time,
    },
  });
  return lista(d).map((g) => ({
    fleetId: g.fleetId ?? g.fleet?.fleetId ?? g.id,
    grupo: g.name || g.fleetName || g.fleet?.name || g.group,
    sipp: g.sippCode || g.fleet?.sippCode || null,
    exemplos: g.models || g.description || g.fleet?.description || null,
    passageiros: g.passengers ?? g.fleet?.passengers ?? null,
    portas: g.doors ?? g.fleet?.doors ?? null,
    cambio: g.transmission ?? g.fleet?.transmission ?? null,
    diaria: num(g.dailyRate ?? g.price?.dailyRate ?? g.baseDailyRate),
    total: num(g.totalAmount ?? g.price?.totalAmount ?? g.total),
    disponivel: g.available !== false,
  })).filter((g) => g.fleetId != null && g.disponivel);
}

// ---------- preço ----------
export async function calcularPreco({ branchId, fleetId, retirada, devolucao, protecoes = [], adicionais = [] }) {
  const d = await chamar('POST', '/prices/calculate', {
    corpo: {
      fleetId, pickUp: { branchId, date: retirada.date, time: retirada.time }, dropOff: { branchId, date: devolucao.date, time: devolucao.time },
      protections: protecoes, additionalServices: adicionais,
    },
  });
  const p = d?.priceBreakdown || d;
  return {
    total: num(p?.totalAmount ?? d?.totalAmount ?? d?.value),
    diaria: num(p?.baseDailyRate ?? p?.dailyRate),
    diarias: num(d?.duration ?? p?.days),
    taxas: num(p?.administrationTax),
    protecoes: lista(d?.protections || d?.reservationDetails?.protections).map((x) => ({ codigo: x.code, nome: x.name || x.description, valor: num(x.value ?? x.price), incluida: !!x.included })),
    bruto: d,
  };
}

// ---------- reservas ----------
export async function criarReserva({ branchId, fleetId, retirada, devolucao, protecoes = [], cliente }) {
  const d = await chamar('POST', '/reservations/new', {
    corpo: {
      fleetId, billingType: 'LOCAL_PAYMENT',
      pickUp: { branchId, date: retirada.date, time: retirada.time },
      dropOff: { branchId, date: devolucao.date, time: devolucao.time },
      protections: protecoes,
      customer: { name: cliente.nome, cpf: cliente.cpf, cnh: cliente.cnh, phone: cliente.telefone, email: cliente.email },
    },
  });
  return normalizarReserva(d?.reservation || d);
}

export async function buscarReserva(codigo) {
  const d = await chamar('GET', '/reservations', { query: { reservationCode: codigo, size: 5 } });
  const achada = lista(d).find((r) => String(r.reservationCode).toUpperCase() === String(codigo).toUpperCase());
  return achada ? normalizarReserva(achada) : null;
}

export async function cancelarReserva(codigo, motivo) {
  await chamar('POST', '/reservations/cancel', { corpo: { reservationCode: codigo, cancellationReason: motivo || 'Cancelada pelo cliente via WhatsApp' } });
  return true;
}

export function normalizarReserva(r) {
  if (!r) return null;
  const ret = r.dates?.pickUp, dev = r.dates?.dropOff;
  return {
    codigo: r.reservationCode || r.code || null,
    status: r.status?.reservation || r.status || null,
    pagamento: r.status?.payment || null,
    retirada: ret ? `${ret.date}T${ret.time || '00:00'}` : null,
    devolucao: dev ? `${dev.date}T${dev.time || '00:00'}` : null,
    branchId: r.locations?.pickUp?.branchId ?? null,
    grupo: r.fleet?.name || null,
    valor: num(r.value ?? r.priceBreakdown?.totalAmount),
    protecoes: (r.reservationDetails?.protections || []).map((p) => p.name || p.code),
    cliente: r.customer ? { nome: r.customer.name, email: r.customer.email } : null,
  };
}

// ---------- diagnóstico (painel da administração) ----------
export async function diagnostico(branchId) {
  const resultado = {};
  const amanha = new Date(Date.now() + 2 * 86_400_000); const depois = new Date(Date.now() + 4 * 86_400_000);
  for (const [nome, fn] of Object.entries({
    locality: () => chamar('GET', '/locality'),
    availabilities: () => chamar('GET', '/availabilities/external', { query: { pickUpBranchId: branchId, dropOffBranchId: branchId, pickUpDate: dataHora(amanha).date, pickUpTime: '10:00', dropOffDate: dataHora(depois).date, dropOffTime: '10:00' } }),
    reservations: () => chamar('GET', '/reservations', { query: { size: 1 } }),
  })) {
    try { const d = await fn(); resultado[nome] = { ok: true, amostra: JSON.stringify(d).slice(0, 1500) }; }
    catch (e) { resultado[nome] = { ok: false, status: e.status || null, erro: e.message, resposta: JSON.stringify(e.resposta || '').slice(0, 600) }; }
  }
  return resultado;
}
