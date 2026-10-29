// Adaptador da API LocarX (portal de reservas).
// TODA chamada à API LocarX passa por este arquivo. Se o formato de algum endpoint mudar,
// ajuste só aqui. O botão "Testar API LocarX" (painel da administração) mostra a resposta crua
// de cada endpoint para conferir os nomes dos campos.
//
// Formatos conforme a documentação LocarX e respostas reais (out/2026):
// /locality, /availabilities/external, /prices/calculate, /reservations/new, /reservations, /reservations/cancel/{id}.
import { config } from '../../config.js';

// Códigos de erro documentados pela LocarX (API para integradores) → o que dizer para a equipe e para o assistente
export const CODIGOS_LOCARX = {
  OUTSIDE_BUSINESS_HOURS: { equipe: 'Retirada ou devolução fora do horário de atendimento da filial (ou sem janela de atendimento especial).', assistente: 'O horário de retirada ou devolução está fora do horário de atendimento da loja. Use dados_da_loja para ver os horários e peça ao cliente outro horário dentro do expediente (não chame atendente por isso).' },
  BRANCH_HOLIDAY: { equipe: 'A filial não atende nessa data (feriado cadastrado).', assistente: 'A loja não atende nessa data (feriado). Avise o cliente e pergunte se pode ser em outro dia; só consulte de novo se ele pedir.' },
  ADVANCE_BOOKING_REQUIRED: { equipe: 'O portal exige retirada com pelo menos 24 horas de antecedência.', assistente: 'O portal só aceita reserva com retirada a partir de 24 horas. Avise o cliente e use chamar_atendente com o motivo "retirada em menos de 24 h".' },
  PROTECTION_REQUIRED: { equipe: 'Toda reserva precisa da Proteção X ou da Super X (nunca as duas).', assistente: 'Faltou a proteção básica. Refaça com PROTECAO_X ou PROTECAO_SUPER_X.' },
  NOT_AVAILABILITY_STCOK: { equipe: 'Sem carro em algum dia do período (o portal informa os dias em falta).', assistente: 'O portal não tem carro deste grupo em todos os dias do período. Avise o cliente e ofereça outra opção das já mostradas; NÃO procure outras datas por conta própria. Se não houver, use chamar_atendente com o motivo "sem disponibilidade".' },
  PRICE_OUT_OF_VALIDITY: { equipe: 'A tabela de preços não vale na data de retirada. Consulte a disponibilidade de novo.', assistente: 'A tabela de preços mudou. Consulte a disponibilidade de novo (consultar_disponibilidade) e refaça o cálculo antes de reservar.' },
  NOT_FOUND_PRICE: { equipe: 'priceFleetId inexistente. Consulte a disponibilidade de novo.', assistente: 'O grupo escolhido não vale mais. Consulte a disponibilidade de novo e peça ao cliente para escolher de novo.' },
  PRICE_NOT_FOUND_FOR_CRITERIA: { equipe: 'Nenhuma tabela vigente para este grupo nesta filial.', assistente: 'Este grupo não está disponível nesta loja agora. Ofereça outra opção das mostradas.' },
  NOT_FOUND_BRANCH: { equipe: 'Filial de retirada inexistente neste ambiente da API (homologação × produção). Confira o vínculo da loja.', assistente: 'O sistema de reservas está com um problema de configuração. Diga ao cliente que um atendente vai concluir e use chamar_atendente.' },
  BASE_PROTECTION_REQUIRED: { equipe: 'Falta a proteção básica (X ou Super X).', assistente: 'Faltou a proteção básica. Refaça com PROTECAO_X ou PROTECAO_SUPER_X.' },
  MULTIPLE_BASE_PROTECTIONS_NOT_ALLOWED: { equipe: 'Proteção X e Super X não podem ir juntas.', assistente: 'Escolha só uma proteção básica: PROTECAO_X ou PROTECAO_SUPER_X.' },
  DUPLICATE_PROTECTIONS_NOT_ALLOWED: { equipe: 'Proteção repetida.', assistente: 'Não repita proteções.' },
  INVALID_PROTECTION_CODES: { equipe: 'Proteção não oferecida para esta frota.', assistente: 'Use só as proteções listadas em protecoes_disponiveis para este grupo.' },
  PRICE_NOT_ACCESSIBLE: { equipe: 'Tabela de preço não vinculada à sua empresa nesta filial. Fale com a LocarX.', assistente: 'Este grupo não está liberado para reserva por aqui. Ofereça outra opção ou use chamar_atendente.' },
  PRICE_FLEET_INACTIVE: { equipe: 'Tabela de preço inativa ou encerrada. Consulte a disponibilidade de novo.', assistente: 'A tabela de preços mudou. Consulte a disponibilidade de novo e refaça o cálculo.' },
  ERRO_INTERNO_PORTAL: { equipe: 'Falha inesperada no portal LocarX. Tente de novo em instantes; se persistir, envie a requisição ao suporte da LocarX.', assistente: 'O portal falhou momentaneamente. Tente a mesma operação UMA vez de novo; se falhar, diga ao cliente que um atendente vai concluir e use chamar_atendente.' },
  INVALID_DATE_RANGE: { equipe: 'Devolução antes da retirada.', assistente: 'A devolução ficou antes da retirada. Confira as datas com o cliente.' },
  INVALID_DATE_FORMAT: { equipe: 'Formato de data inválido enviado ao portal.', assistente: 'Datas no formato errado. Use AAAA-MM-DD e HH:MM.' },
  COMPANY_VALIDATION_FAILED: { equipe: 'Token do outro ambiente (homologação em produção ou vice-versa) ou empresa desativada na LocarX. Confira LOCARX_API_URL e LOCARX_API_TOKEN.', assistente: 'O sistema de reservas está indisponível no momento. Diga ao cliente que um atendente vai concluir e use chamar_atendente.' },
  COMPANY_NOT_FOUND: { equipe: 'A empresa do token não existe mais na LocarX. Peça um token novo.', assistente: 'O sistema de reservas está indisponível no momento. Diga ao cliente que um atendente vai concluir e use chamar_atendente.' },
  INVALID_TOKEN_PAYLOAD: { equipe: 'Token da API LocarX mal formado. Confira LOCARX_API_TOKEN (sem espaços ou aspas).', assistente: 'O sistema de reservas está indisponível no momento. Diga ao cliente que um atendente vai concluir e use chamar_atendente.' },
  INVALID_INTEGRATOR_ID: { equipe: 'Token sem identificação de integrador válida. Peça um token novo à LocarX.', assistente: 'O sistema de reservas está indisponível no momento. Diga ao cliente que um atendente vai concluir e use chamar_atendente.' },
  NOT_FOUND_RESERVATION: { equipe: 'Reserva não encontrada no portal (id inexistente).', assistente: 'Não encontrei essa reserva. Peça para o cliente conferir o código.' },
  RESERVATION_CANCELED: { equipe: 'Esta reserva já estava cancelada.', assistente: 'Essa reserva já estava cancelada. Avise o cliente.' },
  COMPANY_CANNOT_CANCEL_RESERVATION: { equipe: 'Esta reserva não foi criada pelo Conecta; só quem criou pode cancelar pela API. Cancele no portal.', assistente: 'Essa reserva não foi feita por aqui e não pode ser cancelada pelo WhatsApp. Use chamar_atendente com o motivo "cancelamento de reserva feita fora do Conecta".' },
  ADDITIONAL_SERVICE_NOT_FOUND: { equipe: 'Serviço adicional inexistente.', assistente: 'Serviço adicional inválido. Refaça sem ele.' },
  DUPLICATE_ADDITIONAL_SERVICES: { equipe: 'Serviço adicional repetido.', assistente: 'Serviço adicional repetido. Refaça sem repetir.' },
  INVALID_SERVICE_QUANTITY: { equipe: 'Quantidade de serviço adicional inválida.', assistente: 'Quantidade de serviço inválida.' },
  SERVICE_QUANTITY_EXCEEDED: { equipe: 'Quantidade de serviço adicional acima do máximo.', assistente: 'Quantidade de serviço acima do permitido.' },
  FORBIDDEN: { equipe: 'Token da API LocarX ausente, inválido, vencido ou de outro ambiente (homologação × produção). Confira LOCARX_API_TOKEN e LOCARX_API_URL.', assistente: 'O sistema de reservas está indisponível no momento. Diga ao cliente que um atendente vai concluir e use chamar_atendente.' },
  TOKEN_REVOKED: { equipe: 'O token da API LocarX foi renovado pela LocarX e o antigo deixou de valer. Troque LOCARX_API_TOKEN no servidor.', assistente: 'O sistema de reservas está indisponível no momento. Diga ao cliente que um atendente vai concluir e use chamar_atendente.' },
};

export class ErroLocarx extends Error {
  constructor(mensagem, status, resposta) {
    super(mensagem); this.status = status; this.resposta = resposta;
    this.codigo = codigoDaResposta(resposta, status);
    this.mensagemApi = motivoBruto(resposta);   // o que o portal escreveu (ex.: "Business hours on terça: 08:00-18:00")
    const conhecido = this.codigo && CODIGOS_LOCARX[this.codigo];
    this.motivo = conhecido ? `${conhecido.equipe}${this.mensagemApi && this.codigo !== 'FORBIDDEN' ? ` Portal: ${this.mensagemApi}` : ''}` : this.mensagemApi;
    this.dicaAssistente = conhecido ? `${conhecido.assistente}${this.mensagemApi && this.codigo !== 'FORBIDDEN' ? ` (o portal informou: ${this.mensagemApi})` : ''}` : null;
  }
}

// acha o código documentado (ex.: OUTSIDE_BUSINESS_HOURS) em qualquer lugar da resposta de erro
function codigoDaResposta(resposta, status) {
  if (!resposta) return status === 403 ? 'FORBIDDEN' : null;
  const texto = JSON.stringify(resposta);
  for (const c of Object.keys(CODIGOS_LOCARX)) if (texto.includes(c)) return c;
  const direto = resposta.code || resposta.errorCode || (typeof resposta.error === 'string' && /^[A-Z_]{4,}$/.test(resposta.error) ? resposta.error : null);
  if (direto) return direto;
  // erros documentados "sem code": identifica pela mensagem
  if (/Price Fleet \d+ not accessible/i.test(texto)) return 'PRICE_NOT_ACCESSIBLE';
  if (/Price Fleet \d+ not found/i.test(texto)) return 'PRICE_FLEET_INACTIVE';
  if (/Branch \d+ not found/i.test(texto)) return 'NOT_FOUND_BRANCH';
  if (/Protection \d+ is not available for fleet/i.test(texto)) return 'INVALID_PROTECTION_CODES';
  if (status === 500 || /Internal server error|unexpected error/i.test(texto)) return 'ERRO_INTERNO_PORTAL';
  return status === 403 ? 'FORBIDDEN' : null;
}
function motivoBruto(resposta) {
  if (!resposta) return '';
  const junta = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : x?.message || x?.defaultMessage || JSON.stringify(x))).join('; ') : v);
  // "lista de validação" (400): message vem como lista de frases; erros de regra vêm com code + message (+ days)
  const m = junta(resposta.message) || junta(resposta.mensagem) || junta(resposta.errors) || resposta.error || resposta.bruto;
  const dias = Array.isArray(resposta.days) && resposta.days.length ? ` Dias sem carro: ${resposta.days.join(', ')}.` : '';
  return m ? String(typeof m === 'string' ? m : JSON.stringify(m)).slice(0, 240) + dias : dias.trim();
}

// Telefone no formato que o portal valida ("telefone brasileiro, até 16 caracteres"), ex.: (71) 99999-0000.
// O WhatsApp entrega 5571999990000: tira o 55 e formata. Sem DDD reconhecível, manda só os dígitos.
// Só dígitos nacionais (DDD + número), com o nono dígito garantido em celulares.
// O WhatsApp entrega muitos números antigos sem o 9 (ex.: 557181002541): "(71) 8100-2541" não é um telefone válido hoje.
export function digitosBr(v) {
  let d = String(v || '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length === 10 && /[6-9]/.test(d[2])) d = d.slice(0, 2) + '9' + d.slice(2);   // celular sem o 9
  return d;
}
export function telefoneBr(v) {
  const d = digitosBr(v);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d.slice(0, 16);
}
// formato internacional, usado como segunda tentativa se o portal recusar o formato nacional
export const telefoneE164 = (v) => { const d = digitosBr(v); return d.length >= 10 ? `+55${d}` : d; };

async function chamar(metodo, caminho, { query, corpo } = {}, tentativa = 1) {
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
  if (!r.ok) {
    // documentação: em caso de 500, repita a chamada uma vez (só em consultas e cálculo — nunca na criação, para não duplicar reserva)
    if (r.status >= 500 && tentativa === 1 && !/\/reservations\/(new|cancel)/.test(caminho)) {
      await new Promise((ok) => setTimeout(ok, 800));
      return chamar(metodo, caminho, { query, corpo }, 2);
    }
    throw new ErroLocarx(`API LocarX ${metodo} ${caminho} respondeu ${r.status}`, r.status, dados);
  }
  return dados;
}

const lista = (d) => (Array.isArray(d) ? d : d?.content || d?.data || d?.items || d?.results || []);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const dataHora = (iso) => { const d = new Date(iso); return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) }; };

// Datas: o assistente trabalha no horário de Salvador; a API recebe data e hora locais da loja.
export function separarDataHora(data, hora) { return { date: data, time: hora }; }

// ---------- lojas ----------
// GET /locality — todas as filiais ativas, ou uma com ?branchId= / ?branchCode= / ?state= (no máximo um filtro).
// businessHours sempre com os 7 dias (dayOfWeek 1 segunda … 7 domingo, open=false = não atende);
// specialAttentionHours = janelas fora do horário em que a filial atende cobrando `amount` por retirada/devolução.
const DIAS_SEMANA = { 1: 'segunda', 2: 'terça', 3: 'quarta', 4: 'quinta', 5: 'sexta', 6: 'sábado', 7: 'domingo' };
const DIAS_CURTOS = { 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sáb', 7: 'dom' };

// "seg a sex 08:00–18:00 · sáb 08:00–13:00 · dom fechado"
export function horariosTexto(businessHours = []) {
  const dias = [...businessHours].sort((a, b) => a.dayOfWeek - b.dayOfWeek).map((h) => ({ d: h.dayOfWeek, txt: h.open === false ? 'fechado' : `${h.openingHour}–${h.closingHour}` }));
  if (!dias.length) return null;
  const grupos = [];
  for (const x of dias) {
    const g = grupos.at(-1);
    if (g && g.txt === x.txt && g.fim === x.d - 1) g.fim = x.d; else grupos.push({ ini: x.d, fim: x.d, txt: x.txt });
  }
  return grupos.map((g) => `${g.ini === g.fim ? DIAS_CURTOS[g.ini] : `${DIAS_CURTOS[g.ini]} a ${DIAS_CURTOS[g.fim]}`} ${g.txt}`).join(' · ');
}

export function normalizarFilial(l) {
  return {
    branchId: l.branchId, nome: l.displayName || l.name, nomeCompleto: l.name, local: l.placeName || null, cidade: l.city, uf: l.state,
    codigo: l.branchCode, iata: l.iataCode, cityCode: l.cityCode, tipo: l.typeLabel || l.type,
    endereco: l.address || l.fullAddress || null, latitude: l.latitude || null, longitude: l.longitude || null,
    horarios: l.businessHours || [], horariosTexto: horariosTexto(l.businessHours),
    horariosEspeciais: l.specialAttentionHours || [],
    especiaisTexto: (l.specialAttentionHours || []).map((e) => `${DIAS_SEMANA[e.dayOfWeek] || e.dayOfWeek} ${e.rangeFrom}–${e.rangeTo} (+R$ ${Number(e.amount ?? e.price ?? 0).toFixed(2).replace('.', ',')})`).join(' · ') || null,
  };
}

export async function localidades(filtro = {}) {
  return lista(await chamar('GET', '/locality', { query: filtro })).map(normalizarFilial);
}

// uma filial pelo id; null quando não existe neste ambiente (homologação × produção)
const cacheFilial = new Map();   // branchId → { em, dados } (1 h): nome, endereço e horários do portal mudam pouco
export async function dadosDaFilial(branchId, { semCache = false } = {}) {
  const k = String(branchId);
  const c = cacheFilial.get(k);
  if (!semCache && c && Date.now() - c.em < 3_600_000) return c.dados;
  const achadas = await localidades({ branchId: Number(branchId) });
  const dados = achadas.find((l) => Number(l.branchId) === Number(branchId)) || null;
  if (dados) cacheFilial.set(k, { em: Date.now(), dados });
  return dados;
}

// ---------- políticas do portal (para a Base da rede) ----------
// A disponibilidade traz o bloco comum: policies por categoria, mileageInfo, proteções e serviços com preço.
// Vira itens de conhecimento da rede (pendentes) para a administração aprovar.
export async function politicasDoPortal(branchId) {
  const ini = new Date(Date.now() + 3 * 86_400_000), fim = new Date(Date.now() + 6 * 86_400_000);
  const d = await disponibilidadeCompleta({ branchId, retirada: { date: dataHora(ini).date, time: '10:00' }, devolucao: { date: dataHora(fim).date, time: '10:00' } });
  const reais = (v) => (v == null ? null : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const itens = d.politicas.filter((p) => p.texto).map((p) => ({ titulo: `Política LocarX — ${p.categoria}`.slice(0, 200), conteudo: String(p.texto).trim().slice(0, 6000) }));
  if (d.km) itens.push({ titulo: 'Quilometragem (franquia de km)', conteudo: String(d.km) });
  const prot = d.grupos[0]?.protecoes || [];
  if (prot.length) {
    itens.push({ titulo: 'Proteções disponíveis e caução', conteudo: prot.map((x) => `${x.nome}${x.base ? ' (básica)' : ' (opcional)'}${x.diaria != null ? ` — ${reais(x.diaria)} por diária` : ''}${x.caucao != null ? ` — caução (pré-autorização no cartão): ${reais(x.caucao)}` : ''}${x.descricao ? `. ${x.descricao}` : ''}`).join('\n\n')
      + '\n\nToda reserva tem a Proteção X ou a Proteção Super X (nunca as duas). Os valores por diária podem variar por filial e tabela; o total exato vem na cotação.' });
  }
  if (d.adicionais.length) {
    itens.push({ titulo: 'Serviços adicionais (cadeirinha, condutor adicional…)', conteudo: d.adicionais.map((a) => `${a.nome}${a.diaria != null ? ` — ${reais(a.diaria)} por diária` : ''}${a.maximo ? ` (até ${a.maximo} por reserva)` : ''}`).join('\n') + '\n\nOs serviços adicionais são contratados na loja, na retirada.' });
  }
  return itens;
}

// ---------- políticas por filial (cache 1 h) ----------
// Orientações oficiais do portal para enviar ao cliente depois da reserva (validade, pagamento, o que levar, cancelamento).
const cachePoliticas = new Map();
export async function politicasDaFilial(branchId) {
  const c = cachePoliticas.get(String(branchId));
  if (c && Date.now() - c.em < 3_600_000) return c.dados;
  const ini = new Date(Date.now() + 3 * 86_400_000), fim = new Date(Date.now() + 5 * 86_400_000);
  const d = await disponibilidadeCompleta({ branchId, retirada: { date: dataHora(ini).date, time: '10:00' }, devolucao: { date: dataHora(fim).date, time: '10:00' } });
  const dados = { politicas: d.politicas, km: d.km };
  cachePoliticas.set(String(branchId), { em: Date.now(), dados });
  return dados;
}

// ---------- foto do grupo ----------
// O portal manda a imagem do grupo (campo "image" no catálogo; aceitamos variações do nome por segurança).
// Endereço relativo é completado com LOCARX_IMAGENS_BASE (ou o domínio da API). Só https.
const CHAVES_FOTO = ['image', 'imageUrl', 'image_url', 'urlImage', 'photo', 'photoUrl', 'picture', 'pictureUrl', 'thumbnail', 'thumbnailUrl'];
export function acharFoto(f) {
  const candidatos = [f, ...(Array.isArray(f?.vehicleModels) ? f.vehicleModels : [])];
  for (const o of candidatos) {
    for (const k of CHAVES_FOTO) {
      const v = o?.[k];
      const t = typeof v === 'string' ? v.trim() : typeof v?.url === 'string' ? v.url.trim() : '';
      if (!t) continue;
      try {
        const base = (process.env.LOCARX_IMAGENS_BASE || '').trim() || (config.locarx?.url ? new URL(config.locarx.url).origin : undefined);
        const u = new URL(t, base);
        if (u.protocol === 'https:') return u.toString();
      } catch { /* endereço inválido: tenta o próximo */ }
    }
  }
  return null;
}
const fotosVistas = new Map();      // fleetId → endereço (vindo da disponibilidade, quando o catálogo não traz)
export async function fotoDoGrupo(fleetId) {
  const id = String(fleetId);
  const doCatalogo = (await catalogoFrotas().catch(() => [])).find((x) => String(x.fleetId) === id)?.foto;
  return doCatalogo || fotosVistas.get(id) || null;
}

// ---------- catálogo de frotas (grupos) ----------
// GET /fleets/catalog — todos os grupos, sem preço nem estoque. Muda pouco: cache de 1 hora.
// Atenção às grafias do portal: transmitionType (catálogo) × transmissionType (disponibilidade).
let cacheCatalogo = { em: 0, itens: null };
export async function catalogoFrotas() {
  if (cacheCatalogo.itens && Date.now() - cacheCatalogo.em < 3_600_000) return cacheCatalogo.itens;
  const itens = lista(await chamar('GET', '/fleets/catalog'))
    .filter((f) => !/DESATIVAD/i.test(f.name || ''))
    .map((f) => ({
      fleetId: f.fleetId, grupo: f.name, sipp: f.sippCode || null, portas: f.doors ?? null, passageiros: f.passengers ?? null, malas: f.baggages ?? null,
      cambio: f.transmitionType || f.transmissionType || null, foto: acharFoto(f),
      exemplos: (f.vehicleModels || []).map((m) => [m.brand, m.model].filter(Boolean).join(' ')).filter(Boolean).join(', ') || null,
      categorias: [...new Set((f.vehicleModels || []).map((m) => m.category).filter(Boolean))],
      tipos: [...new Set((f.vehicleModels || []).map((m) => m.type).filter(Boolean))],
      itens: f.characteristics || [],
    }));
  cacheCatalogo = { em: Date.now(), itens };
  return itens;
}

// ---------- disponibilidade ----------
// GET /availabilities/external?branchId=&dateFrom=&dateTo=  (datas YYYY-MM-DDTHH:mm:ss, sem fuso = horário de Brasília)
// Resposta: array; um item traz { branch: { fleets: [...] } } e outro { additionalServices, protections, policies, mileageInfo }.
// Retirada com menos de 24 h (ou no passado) não dá erro: volta [].
const dataHoraApi = (p) => `${p.date}T${p.time}:00`;

function grupoDaApi(f, extras) {
  const pr = f.price || {};
  const foto = acharFoto(f);
  if (foto && f.fleetId != null) fotosVistas.set(String(f.fleetId), foto);
  return {
    fleetId: f.fleetId,
    foto,
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
      caucao: num(x.guaranteeValue ?? x.guaranteeValueBooking),   // caução em reais, por proteção
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
// Acha o grupo pelo fleetId numérico ou, se a IA mandar a letra ("C") ou o nome ("Compacto especial"), por eles.
export function acharGrupo(grupos, ref) {
  const r = String(ref ?? '').trim();
  if (!r) return null;
  const porId = grupos.find((x) => String(x.fleetId) === r);
  if (porId) return porId;
  const letra = (g) => (String(g.grupo || '').match(/^\s*([A-Z0-9]{1,3})\s*[-–.]/i) || [])[1]?.toUpperCase();
  const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const q = semAcento(r);
  return grupos.find((g) => letra(g) === r.toUpperCase())
    || grupos.find((g) => semAcento(g.grupo) === q || semAcento(g.grupo).replace(/^[a-z0-9]{1,3}\s*[-–.]\s*/i, '') === q)
    || grupos.find((g) => q.length >= 4 && (semAcento(g.grupo).includes(q) || semAcento(g.exemplos).includes(q)))
    || null;
}

async function prepararGrupo({ branchId, fleetId, retirada, devolucao, protecoes = [] }) {
  const grupos = await disponibilidade({ branchId, retirada, devolucao });
  const g = acharGrupo(grupos, fleetId);
  if (!g) {
    const e = new ErroLocarx(grupos.length
      ? `Grupo "${fleetId}" não encontrado entre os disponíveis para essas datas (${grupos.map((x) => x.grupo).join('; ')}). Use o fleet_id ou a letra de uma opção da consulta.`
      : 'Nenhum grupo disponível para essas datas (a consulta voltou vazia).', 409);
    e.codigo = grupos.length ? 'GRUPO_NAO_ENCONTRADO' : 'SEM_DISPONIBILIDADE';
    e.motivo = e.message;
    e.dicaAssistente = grupos.length
      ? `O grupo "${fleetId}" não bate com as opções disponíveis: ${grupos.map((x) => x.grupo).join('; ')}. Informe o fleet_id (número) ou a letra exata da opção escolhida e tente de novo. NÃO diga ao cliente que o carro acabou.`
      : 'A consulta voltou sem carros para essas datas. Avise o cliente e use chamar_atendente com o motivo "sem disponibilidade"; não procure outras datas por conta própria.';
    throw e;
  }
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
    fleetId: g.fleetId,
    protecoes: g.protecoes.filter((p) => protecoes.includes(p.codigo)).map((p) => ({ codigo: p.codigo, nome: p.nome, caucao: p.caucao })),
    caucao: g.protecoes.find((p) => protecoes.includes(p.codigo) && p.base)?.caucao ?? g.protecoes.find((p) => protecoes.includes(p.codigo))?.caucao ?? null,
    bruto: d,
  };
}

// ---------- reservas ----------
// POST /reservations/new — pagamento na loja (LOCAL_PAYMENT); a API recalcula o preço sozinha.
export async function criarReserva({ branchId, fleetId, retirada, devolucao, protecoes = [], cliente }) {
  const { g, ids } = await prepararGrupo({ branchId, fleetId, retirada, devolucao, protecoes });
  const corpo = (phone) => ({
      priceFleetId: g.priceFleetId,
      pickUpLocationBranchId: Number(branchId), dropOffLocationBranchId: Number(branchId),
      pickUpDate: retirada.date, pickUpTime: retirada.time, dropOffDate: devolucao.date, dropOffTime: devolucao.time,
      billingType: 'LOCAL_PAYMENT', reservationType: 'RESERVATION', reservationStatus: 'CONFIRMED',
      // customer: só o que a documentação valida; CNH, e-mail e endereço entram apenas quando existem
      customer: {
        name: String(cliente.nome || '').slice(0, 100), cpf: cliente.cpf, phone,
        ...(cliente.email ? { email: cliente.email } : {}),
        ...(cliente.cnh ? { cnh: cliente.cnh } : {}),
      },
      protections: ids.map((id) => ({ fleetProtectionId: id })),
      additionalServices: [],
      observations: cliente.observacoes || 'Reserva feita pelo Conecta LocarX (WhatsApp).',
      ...(cliente.referencia ? { assistanceNumber: String(cliente.referencia).slice(0, 60) } : {}),
  });
  let d;
  try { d = await chamar('POST', '/reservations/new', { corpo: corpo(telefoneBr(cliente.telefone)) }); }
  catch (e) {
    // o portal recusou só o telefone no formato nacional: tenta uma vez no internacional (+55…). Nada foi criado ainda.
    const soTelefone = e.status === 400 && !e.codigo && /customer\.phone/.test(JSON.stringify(e.resposta || '')) && !/customer\.(cpf|name|email)/.test(JSON.stringify(e.resposta || ''));
    if (!soTelefone) throw e;
    d = await chamar('POST', '/reservations/new', { corpo: corpo(telefoneE164(cliente.telefone)) });
  }
  const r = normalizarReserva(d?.reservation || d?.data || d);
  // o portal respondeu OK mas sem reserva reconhecível: melhor avisar do que seguir com código vazio
  if (!r || (!r.codigo && r.id == null)) throw new ErroLocarx('O portal LocarX não devolveu o código da reserva (formato de resposta inesperado).', 502, d);
  return r;
}

// GET /reservations — só as reservas criadas pelo nosso token. Filtros: search (nome, código ou CPF de 11 dígitos),
// customerCpf, reservationStatus (CONFIRMED,PENDING,INPROGRESS,COMPLETED,CANCELED), startDate/endDate, assistanceNumber,
// branchId, createdDateStart/End, page/size/sort. Lista sem envelope; total em X-Total-Count.
export async function listarReservas(filtros = {}) {
  const d = await chamar('GET', '/reservations', { query: { size: 50, sort: 'createdDate,DESC', ...filtros } });
  return lista(d).map(normalizarReserva);
}

export async function buscarReserva(codigo) {
  const cod = String(codigo || '').toUpperCase().trim();
  if (!cod) return null;
  const achadas = await listarReservas({ search: cod, size: 5 });
  return achadas.find((r) => String(r.codigo).toUpperCase() === cod) || null;
}

// reservas de um cliente pelo CPF (para "quais são minhas reservas?")
export async function reservasDoCpf(cpf, { soAtivas = true } = {}) {
  const d = String(cpf || '').replace(/\D/g, '');
  if (d.length !== 11) return [];
  return listarReservas({ customerCpf: d, ...(soAtivas ? { reservationStatus: 'CONFIRMED,PENDING,INPROGRESS' } : {}), size: 20 });
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
    faturamento: r.billingType || null,   // LOCAL_PAYMENT (na loja), PARTIAL_BILLING ou TOTAL_BILLING — o portal pode sobrescrever pelo contrato do integrador
    motivoCancelamento: r.status?.cancellationReason || null,
    criadaEm: r.createdDate || null,
    referencia: r.assistanceNumber || null,
    retirada: ret ? `${ret.date}T${hora(ret.time)}` : null,
    devolucao: dev ? `${dev.date}T${hora(dev.time)}` : null,
    branchId: r.locations?.pickUp?.branchId ?? null,
    grupo: r.fleet?.name || null,
    cambio: r.fleet?.transmission || r.fleet?.transmissionType || null,
    valor: num(r.value ?? r.priceBreakdown?.totalAmount),
    protecoes: (r.reservationDetails?.protections || []).map((p) => p.name || p.code),
    caucao: num((r.reservationDetails?.protections || []).find((p) => /PROTECAO_(SUPER_)?X/.test(p.code || ''))?.guaranteeValueBooking ?? (r.reservationDetails?.protections || [])[0]?.guaranteeValueBooking),
    cliente: r.customer ? { nome: r.customer.name, email: r.customer.email } : null,
  };
}

// ---------- diagnóstico (painel da administração) ----------
// Mostra a resposta crua de cada endpoint. Com `reservaTeste` (só na homologação) cria uma reserva de teste
// com cliente fictício e a cancela em seguida — prova o caminho de escrita de ponta a ponta.
export const ehHomologacao = () => /hml|homolog|sandbox|test/i.test(config.locarx?.url || '');

// Datas do teste: retirada de segunda a quarta (a partir de 2 dias à frente, calendário de Salvador, UTC-3) e devolução 2 dias depois
// (quarta a sexta), sempre às 10:00. Assim o teste nunca cai em domingo/feriado de fim de semana, quando a filial não opera.
export function datasDoDiagnostico(agora = Date.now()) {
  const ini = new Date(agora - 3 * 3_600_000 + 2 * 86_400_000);
  while (![1, 2, 3].includes(ini.getUTCDay())) ini.setUTCDate(ini.getUTCDate() + 1);
  const fim = new Date(ini.getTime() + 2 * 86_400_000);
  const dia = (d) => d.toISOString().slice(0, 10);
  return { retirada: { date: dia(ini), time: '10:00' }, devolucao: { date: dia(fim), time: '10:00' } };
}

export async function diagnostico(branchId, { reservaTeste = false } = {}) {
  const resultado = { ambiente: { ok: true, amostra: JSON.stringify({ url: config.locarx?.url || null, homologacao: ehHomologacao(), token: config.locarx?.token ? `…${config.locarx.token.slice(-4)}` : null }) } };
  const { retirada, devolucao } = datasDoDiagnostico();
  let grupo = null;
  const passos = {
    locality: async () => { const f = await dadosDaFilial(branchId); if (!f) throw new ErroLocarx(`Filial ${branchId} não existe neste ambiente da API (${config.locarx.url}). Confira o vínculo da loja: os ids mudam entre homologação e produção.`, 404, null); return { filial: f.nome, endereco: f.endereco, horarios: f.horariosTexto, especiais: f.especiaisTexto, iata: f.iata, cityCode: f.cityCode }; },
    // retirada daqui a 2 dias (a API não devolve nada com menos de 24 h)
    availabilities: async () => { const g = await disponibilidade({ branchId, retirada, devolucao }); grupo = g[0] || null; return { grupos: g.length, exemplo: g.slice(0, 3).map((x) => ({ fleetId: x.fleetId, priceFleetId: x.priceFleetId, grupo: x.grupo, diaria: x.diaria, total: x.total, protecoes: x.protecoes.map((p) => p.codigo) })) }; },
    prices_calculate: async () => {
      if (!grupo) throw new ErroLocarx('Sem grupo disponível para calcular.', 409);
      const r = await calcularPreco({ branchId, fleetId: grupo.fleetId, retirada, devolucao, protecoes: ['PROTECAO_X'] });
      return { grupo: r.grupo, total: r.total, diaria: r.diaria, diarias: r.diarias, bruto: r.bruto };
    },
    reservations: async () => { const r = await listarReservas({ size: 3 }); return { total_amostra: r.length, exemplo: r.map((x) => ({ codigo: x.codigo, status: x.status, pagamento: x.pagamento, retirada: x.retirada, referencia: x.referencia })) }; },
  };
  if (reservaTeste) {
    passos.reservations_new_TESTE = async () => {
      if (!ehHomologacao()) throw new ErroLocarx('Reserva de teste só na homologação (LOCARX_API_URL de produção).', 409);
      if (!grupo) throw new ErroLocarx('Sem grupo disponível para reservar.', 409);
      const r = await criarReserva({ branchId, fleetId: grupo.fleetId, retirada, devolucao, protecoes: ['PROTECAO_X'],
        cliente: { nome: 'Teste Conecta LocarX', cpf: '52998224725', cnh: '', email: 'teste-conecta@exemplo.com', telefone: '5571999999999' } });
      let cancelada = null;
      try { await cancelarReserva(r.codigo, 'Reserva de teste do Conecta — cancelada automaticamente'); cancelada = true; } catch (e) { cancelada = `NÃO cancelada: ${e.message}`; }
      return { criada: r, cancelada };
    };
  }
  for (const [nome, fn] of Object.entries(passos)) {
    try { const d = await fn(); resultado[nome] = { ok: true, amostra: JSON.stringify(d).slice(0, 2500) }; }
    catch (e) { resultado[nome] = { ok: false, status: e.status || null, erro: e.message, resposta: JSON.stringify(e.resposta || '').slice(0, 1500) }; }
  }
  return resultado;
}
