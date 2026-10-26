// Adaptador da API LocarX (portal de reservas).
// TODA chamada à API LocarX passa por este arquivo. Se o formato de algum endpoint mudar,
// ajuste só aqui. O botão "Testar API LocarX" (painel da administração) mostra a resposta crua
// de cada endpoint para conferir os nomes dos campos.
//
// Formatos conforme a documentação LocarX e respostas reais (out/2026):
// /locality, /availabilities/external, /prices/calculate, /reservations/new, /reservations, /reservations/cancel/{id}.
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
// GET /availabilities/external?branchId=&dateFrom=&dateTo=  (datas YYYY-MM-DDTHH:mm:ss, sem fuso = horário de Brasília)
// Resposta: array; um item traz { branch: { fleets: [...] } } e outro { additionalServices, protections, policies, mileageInfo }.
// Retirada com menos de 24 h (ou no passado) não dá erro: volta [].
const dataHoraApi = (p) => `${p.date}T${p.time}:00`;

function grupoDaApi(f, extras) {
  const pr = f.price || {};
  return {
    fleetId: f.fleetId,
    priceFleetId: pr.priceFleetId ?? null,
    grupo: f.name,
    sipp: f.sipCode || f.sippCode || null,
    exemplos: (f.vehicleModels || []).map((m) => [m.brand, m.model].filter(Boolean).join(' ')).filter(Boolean).join(', ') || null,
    passageiros: f.passengers ?? null,
    portas: f.doors ?? null,
    malas: f.baggages ?? null,
    cambio: f.transmissionType || f.transmission || null,
    itens: (f.vehicleAdditionals || []).map((x) => x.name).filter(Boolean),
    km: f.mileageInfo || extras?.mileageInfo || null,
    diaria: num(pr.period?.baseDailyRate),
    diarias: num(pr.period?.baseDays),
    total: num(pr.summary?.totalWithTax),
    protecoes: (f.availableProtections || f.protections || []).map((x) => ({
      id: x.id ?? x.fleetProtectionId, codigo: x.code || null, nome: x.name, descricao: x.description || null,
      diaria: num(x.price), total: num(x.calculatedPrice), base: !!x.baseProtection, padrao: !!x.selected,
    })),
  };
}

export async function disponibilidadeCompleta({ branchId, retirada, devolucao }) {
  const d = await chamar('GET', '/availabilities/external', { query: { branchId, dateFrom: dataHoraApi(retirada), dateTo: dataHoraApi(devolucao) } });
  const itens = Array.isArray(d) ? d : [];
  const extras = itens.find((x) => x && !x.branch) || {};
  const fleets = itens.flatMap((x) => x?.branch?.fleets || []);
  return {
    grupos: fleets.map((f) => grupoDaApi(f, extras)).filter((g) => g.fleetId != null && g.priceFleetId != null),
    adicionais: (extras.additionalServices || []).map((x) => ({ id: x.additionalServiceId, nome: x.name, diaria: num(x.price), maximo: x.maxQuantity ?? null })),
    politicas: (extras.policies || []).map((x) => ({ categoria: x.category, texto: x.policy })),
    km: extras.mileageInfo || null,
  };
}

export async function disponibilidade(args) {
  return (await disponibilidadeCompleta(args)).grupos;
}

// acha o grupo (pelo fleetId, que é estável) e traduz os códigos das proteções para os ids da API
async function prepararGrupo({ branchId, fleetId, retirada, devolucao, protecoes = [] }) {
  const grupos = await disponibilidade({ branchId, retirada, devolucao });
  const g = grupos.find((x) => String(x.fleetId) === String(fleetId));
  if (!g) throw new ErroLocarx('Este grupo não está mais disponível para essas datas.', 409);
  const ids = protecoes.map((c) => g.protecoes.find((p) => p.codigo === c)?.id).filter((x) => x != null);
  return { g, ids };
}

// ---------- preço ----------
// POST /prices/calculate { dateFrom, dateTo, priceFleetId, branchId, protections: [{ id }], additionalServices: [{ id, qtd }] }
export async function calcularPreco({ branchId, fleetId, retirada, devolucao, protecoes = [] }) {
  const { g, ids } = await prepararGrupo({ branchId, fleetId, retirada, devolucao, protecoes });
  const d = await chamar('POST', '/prices/calculate', {
    corpo: { dateFrom: dataHoraApi(retirada), dateTo: dataHoraApi(devolucao), priceFleetId: g.priceFleetId, branchId: Number(branchId), protections: ids.map((id) => ({ id })), additionalServices: [] },
  });
  return {
    total: num(d?.summary?.totalWithTax),
    diaria: num(d?.period?.baseDailyRate),
    diarias: num(d?.period?.baseDays),
    taxas: num(d?.summary?.administrationTax),
    grupo: g.grupo,
    protecoes: g.protecoes.filter((p) => protecoes.includes(p.codigo)).map((p) => ({ codigo: p.codigo, nome: p.nome })),
    bruto: d,
  };
}

// ---------- reservas ----------
// POST /reservations/new — pagamento na loja (LOCAL_PAYMENT); a API recalcula o preço sozinha.
export async function criarReserva({ branchId, fleetId, retirada, devolucao, protecoes = [], cliente }) {
  const { g, ids } = await prepararGrupo({ branchId, fleetId, retirada, devolucao, protecoes });
  const d = await chamar('POST', '/reservations/new', {
    corpo: {
      priceFleetId: g.priceFleetId,
      pickUpLocationBranchId: Number(branchId), dropOffLocationBranchId: Number(branchId),
      pickUpDate: retirada.date, pickUpTime: retirada.time, dropOffDate: devolucao.date, dropOffTime: devolucao.time,
      billingType: 'LOCAL_PAYMENT', reservationType: 'RESERVATION', reservationStatus: 'CONFIRMED',
      customer: {
        name: cliente.nome, cpf: cliente.cpf, phone: cliente.telefone, email: cliente.email, cnh: cliente.cnh || '',
        address: { cep: '', street: '', number: null, neighborhood: '', complement: '', city: '', state: '', referencePoint: '' },
      },
      protections: ids.map((id) => ({ fleetProtectionId: id })),
      additionalServices: [],
      observations: 'Reserva feita pelo assistente virtual do WhatsApp (Conecta LocarX).',
    },
  });
  const r = normalizarReserva(d?.reservation || d?.data || d);
  // o portal respondeu OK mas sem reserva reconhecível: melhor avisar do que seguir com código vazio
  if (!r || (!r.codigo && r.id == null)) throw new ErroLocarx('O portal LocarX não devolveu o código da reserva (formato de resposta inesperado).', 502, d);
  return r;
}

export async function buscarReserva(codigo) {
  const d = await chamar('GET', '/reservations', { query: { reservationCode: codigo, size: 100 } });
  const achada = lista(d).find((r) => String(r.reservationCode).toUpperCase() === String(codigo).toUpperCase());
  return achada ? normalizarReserva(achada) : null;
}

// POST /reservations/cancel/{id} { reason } — o id é o número interno da reserva, achado pelo código
export async function cancelarReserva(codigo, motivo) {
  const r = await buscarReserva(codigo);
  if (!r?.id) throw new ErroLocarx('Reserva não encontrada na API LocarX.', 404);
  await chamar('POST', `/reservations/cancel/${encodeURIComponent(r.id)}`, { corpo: { reason: motivo || 'Cancelada pelo cliente via WhatsApp' } });
  return true;
}

export function normalizarReserva(r) {
  if (!r) return null;
  const ret = r.dates?.pickUp, dev = r.dates?.dropOff;
  const hora = (t) => String(t || '00:00').slice(0, 5);
  return {
    id: r.id ?? null,
    codigo: r.reservationCode || r.code || null,
    status: r.status?.reservation || r.status || null,
    pagamento: r.status?.payment || null,
    retirada: ret ? `${ret.date}T${hora(ret.time)}` : null,
    devolucao: dev ? `${dev.date}T${hora(dev.time)}` : null,
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
    // retirada daqui a 2 dias (a API não devolve nada com menos de 24 h)
    availabilities: async () => { const g = await disponibilidade({ branchId, retirada: { date: dataHora(amanha).date, time: '10:00' }, devolucao: { date: dataHora(depois).date, time: '10:00' } }); return { grupos: g.length, exemplo: g.slice(0, 3).map((x) => ({ fleetId: x.fleetId, priceFleetId: x.priceFleetId, grupo: x.grupo, diaria: x.diaria, total: x.total, protecoes: x.protecoes.map((p) => p.codigo) })) }; },
    reservations: () => chamar('GET', '/reservations', { query: { size: 1 } }),
  })) {
    try { const d = await fn(); resultado[nome] = { ok: true, amostra: JSON.stringify(d).slice(0, 1500) }; }
    catch (e) { resultado[nome] = { ok: false, status: e.status || null, erro: e.message, resposta: JSON.stringify(e.resposta || '').slice(0, 600) }; }
  }
  return resultado;
}
