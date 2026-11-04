// v14.8 — Cliente da API Pagar.me (core v5) para a assinatura do Conecta pelos franqueados.
// Referência: https://docs.pagar.me/reference (clientes, cartões, assinaturas, pedidos, webhooks).
// Com PAGARME_SIMULADO=1 (fora de produção) nada sai para a Pagar.me: as respostas são simuladas, com ids "sim_…".
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../../config.js';
import { soDigitos } from '../cnpj.js';

export class ErroPagarme extends Error {
  constructor(mensagem, { status, corpo } = {}) { super(mensagem); this.name = 'ErroPagarme'; this.status = status; this.corpo = corpo; }
}
const cfg = () => config.pagarme;
export const ligado = () => !!cfg();
export const simulado = () => !!cfg()?.simulado;
const idSim = (prefixo) => `${prefixo}_sim_${randomBytes(6).toString('hex')}`;

async function chamar(metodo, caminho, corpo) {
  const c = cfg();
  if (!c?.chave) throw new ErroPagarme('Pagar.me não configurada (PAGARME_SECRET_KEY).');
  const r = await fetch(c.url + caminho, {
    method: metodo,
    headers: { Authorization: 'Basic ' + Buffer.from(c.chave + ':').toString('base64'), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const texto = await r.text();
  let json = null; try { json = texto ? JSON.parse(texto) : null; } catch { /* não era JSON */ }
  if (!r.ok) {
    // junta o motivo real: { errors: { "card.exp_year": ["..."] } } → "card.exp_year: ..."
    const detalhes = json?.errors && typeof json.errors === 'object' ? Object.entries(json.errors).map(([k, v]) => `${k}: ${[].concat(v).join(', ')}`).join(' · ') : '';
    const msg = [json?.message, detalhes].filter(Boolean).join(' — ') || texto.slice(0, 200) || `HTTP ${r.status}`;
    throw new ErroPagarme(`Pagar.me: ${msg}`, { status: r.status, corpo: json });
  }
  return json;
}

const telefone = (t) => { const d = soDigitos(t); if (d.length < 10) return undefined; const n = d.length > 11 ? d.slice(-11) : d; return { country_code: '55', area_code: n.slice(0, 2), number: n.slice(2) }; };

/** Cliente (a loja, pessoa jurídica) na Pagar.me. */
export async function criarCliente({ nome, email, cnpj, telefone: tel, endereco, cep, codigo }) {
  if (simulado()) return { id: idSim('cus') };
  const r = await chamar('POST', '/customers', {
    name: nome, email, code: codigo, type: 'company', document: soDigitos(cnpj), document_type: 'CNPJ',
    phones: tel && telefone(tel) ? { mobile_phone: telefone(tel) } : undefined,
    address: endereco ? { line_1: String(endereco).slice(0, 256), zip_code: soDigitos(cep) || '00000000', city: endereco.cidade || '', state: endereco.uf || '', country: 'BR' } : undefined,
  });
  return { id: r.id };
}

/** Guarda o cartão (token gerado no navegador com a chave pública) no cliente e devolve o card_id. */
export async function salvarCartao(clienteId, token) {
  if (simulado()) return { id: idSim('card'), final: token?.slice(-4) || '0000', bandeira: 'Visa' };
  const r = await chamar('POST', `/customers/${encodeURIComponent(clienteId)}/cards`, { token });
  return { id: r.id, final: r.last_four_digits, bandeira: r.brand };
}

/** Assinatura recorrente (cartão ou boleto). Anual = 1 ciclo por ano. */
export async function criarAssinatura({ clienteId, cartaoId, forma, valorCentavos, descricao, ciclo, codigo, metadata }) {
  if (simulado()) return { id: idSim('sub'), status: forma === 'cartao' ? 'active' : 'future', proximaCobranca: null, boleto: forma === 'boleto' ? { url: 'https://exemplo.pagar.me/boleto-simulado.pdf', linha: '34191.79001 01043.510047 91020.150008 1 00000000010000' } : null };
  const r = await chamar('POST', '/subscriptions', {
    code: codigo, customer_id: clienteId,
    payment_method: forma === 'cartao' ? 'credit_card' : 'boleto',
    card_id: forma === 'cartao' ? cartaoId : undefined,   // cartão já salvo no cliente (POST /customers/:id/cards)
    boleto_due_days: forma === 'boleto' ? 3 : undefined,
    interval: ciclo === 'anual' ? 'year' : 'month', interval_count: 1, billing_type: 'prepaid', installments: 1,
    statement_descriptor: cfg().descricaoFatura,
    items: [{ description: descricao, quantity: 1, pricing_scheme: { scheme_type: 'unit', price: valorCentavos } }],
    metadata,
  });
  const cobranca = r.current_cycle?.charges?.[0] || r.charges?.[0];
  return { id: r.id, status: r.status, proximaCobranca: r.next_billing_at || null, boleto: cobranca?.last_transaction?.url ? { url: cobranca.last_transaction.url, linha: cobranca.last_transaction.line } : null, bruto: r };
}

export async function cancelarAssinatura(assinaturaId) {
  if (simulado()) return { ok: true };
  await chamar('DELETE', `/subscriptions/${encodeURIComponent(assinaturaId)}`, { cancel_pending_invoices: true });
  return { ok: true };
}

/** Pedido avulso com Pix (um por ciclo — a Pagar.me não renova Pix sozinha) ou boleto avulso. */
export async function criarPedido({ clienteId, forma, valorCentavos, descricao, codigo, validadeSegundos = 1800, venceEm, metadata }) {
  if (simulado()) {
    const id = idSim('or'), ch = idSim('ch');
    return forma === 'pix'
      ? { id, cobrancaId: ch, status: 'pending', pix: { codigo: `00020126580014br.gov.bcb.pix0136${ch}5204000053039865406${(valorCentavos / 100).toFixed(2)}5802BR5913PAGARME SIMUL6009SAO PAULO62070503***6304ABCD`, qrUrl: null, expiraEm: new Date(Date.now() + validadeSegundos * 1000).toISOString() } }
      : { id, cobrancaId: ch, status: 'pending', boleto: { url: 'https://exemplo.pagar.me/boleto-simulado.pdf', linha: '34191.79001 01043.510047 91020.150008 1 00000000010000' } };
  }
  const pagamento = forma === 'pix'
    ? { payment_method: 'pix', pix: { expires_in: validadeSegundos } }
    : { payment_method: 'boleto', boleto: { due_at: venceEm ? `${venceEm}T23:59:59Z` : undefined, instructions: 'Assinatura do Conecta LocarX. Não receber após o vencimento.' } };
  const r = await chamar('POST', '/orders', { code: codigo, customer_id: clienteId, closed: true, items: [{ amount: valorCentavos, description: descricao, quantity: 1, code: codigo }], payments: [pagamento], metadata });
  const ch = r.charges?.[0]; const t = ch?.last_transaction || {};
  return {
    id: r.id, cobrancaId: ch?.id || null, status: ch?.status || r.status,
    pix: forma === 'pix' ? { codigo: t.qr_code || null, qrUrl: t.qr_code_url || null, expiraEm: t.expires_at || null } : null,
    boleto: forma === 'boleto' ? { url: t.url || t.pdf || null, linha: t.line || null } : null,
    bruto: r,
  };
}

export async function consultarCobranca(cobrancaId) {
  if (simulado()) return { id: cobrancaId, status: 'pending' };
  const r = await chamar('GET', `/charges/${encodeURIComponent(cobrancaId)}`);
  return { id: r.id, status: r.status, pagaEm: r.paid_at || null };
}

/** Confere a autenticação Basic do webhook (usuário/senha cadastrados no painel da Pagar.me). */
export function webhookAutorizado(cabecalho) {
  const c = cfg();
  if (!c?.webhookUsuario || !c?.webhookSenha) return c?.simulado === true;   // em simulado aceita sem senha
  const esperado = Buffer.from('Basic ' + Buffer.from(`${c.webhookUsuario}:${c.webhookSenha}`).toString('base64'));
  const recebido = Buffer.from(String(cabecalho || ''));
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}
