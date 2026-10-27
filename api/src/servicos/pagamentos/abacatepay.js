// Adaptador do AbacatePay (checkout transparente, só Pix). Toda chamada ao AbacatePay passa por aqui.
// Documentação: docs.abacatepay.com — autenticação Bearer; o ambiente (sandbox × produção) vem da chave, não da URL.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../../config.js';

export class ErroAbacatePay extends Error {
  constructor(mensagem, status, resposta) { super(mensagem); this.status = status; this.resposta = resposta; }
}

async function chamar(metodo, caminho, { query, corpo } = {}) {
  if (!config.abacatepay) throw new ErroAbacatePay('Pagamento Pix não configurado no servidor (ABACATEPAY_API_KEY).', 503);
  const url = new URL(config.abacatepay.url + caminho);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const r = await fetch(url, {
    method: metodo,
    headers: { Authorization: `Bearer ${config.abacatepay.chave}`, Accept: 'application/json', ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const texto = await r.text();
  let dados = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch { dados = { bruto: texto.slice(0, 300) }; }
  if (!r.ok || dados?.success === false) {
    const motivo = typeof dados?.error === 'string' ? dados.error : dados?.error?.message || dados?.message || '';
    throw new ErroAbacatePay(`AbacatePay ${metodo} ${caminho} respondeu ${r.status}${motivo ? ': ' + String(motivo).slice(0, 200) : ''}`, r.status, dados);
  }
  return dados?.data ?? dados;
}

export const centavos = (reais) => Math.round(Number(reais) * 100);

/**
 * POST /transparents/create (method PIX). Valor em reais; `referencia` é o nosso id (externalId, idempotência).
 * `cliente` é opcional; se enviado, o AbacatePay exige name, taxId, email e cellphone.
 */
export async function criarPix({ valor, descricao, validadeSegundos, cliente, referencia, metadata }) {
  const amount = centavos(valor);
  if (!Number.isFinite(amount) || amount < 100) throw new ErroAbacatePay('Valor do Pix precisa ser de pelo menos R$ 1,00.', 422);
  const d = await chamar('POST', '/transparents/create', {
    corpo: {
      method: 'PIX',
      data: {
        amount, description: String(descricao || '').slice(0, 500), expiresIn: validadeSegundos,
        ...(cliente?.nome && cliente?.cpf && cliente?.email && cliente?.telefone ? { customer: { name: cliente.nome, taxId: cliente.cpf, email: cliente.email, cellphone: cliente.telefone } } : {}),
        ...(referencia ? { externalId: String(referencia) } : {}),
        ...(metadata ? { metadata } : {}),
      },
    },
  });
  return normalizar(d);
}

// GET /transparents/check?id= → status atual (PENDING | PAID | EXPIRED | CANCELLED | REFUNDED | …)
export async function consultarPix(externoId) {
  return normalizar(await chamar('GET', '/transparents/check', { query: { id: externoId } }));
}

// POST /transparents/simulate-payment?id= — só com chave de sandbox (devMode)
export async function simularPagamento(externoId) {
  return normalizar(await chamar('POST', '/transparents/simulate-payment', { query: { id: externoId } }));
}

// POST /transparents/refund { id, reason } — sempre integral
export async function estornar(externoId, motivo) {
  return chamar('POST', '/transparents/refund', { corpo: { id: externoId, reason: String(motivo || 'Estorno solicitado pela loja').slice(0, 500) } });
}

export function normalizar(d) {
  if (!d) return null;
  return {
    externoId: d.id || null, status: d.status || null, valor: d.amount != null ? Number(d.amount) / 100 : null,
    brCode: d.brCode || null, qrBase64: d.brCodeBase64 || null, expiraEm: d.expiresAt || null, pagaEm: d.paidAt || null,
    comprovanteUrl: d.receiptUrl || null, devMode: !!d.devMode, metadata: d.metadata || null, bruto: d,
  };
}

// ---------- webhook ----------
// Duas camadas: segredo na URL (?webhookSecret=) e assinatura HMAC-SHA256 base64 do corpo bruto no header X-Webhook-Signature,
// calculada com a chave pública da AbacatePay (ABACATEPAY_PUBLIC_KEY). Sem a chave pública configurada, só o segredo é conferido.
export function segredoWebhookValido(enviado) {
  const s = config.abacatepay?.segredoWebhook;
  if (!s || !enviado) return false;
  const a = Buffer.from(String(enviado)), b = Buffer.from(s);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function assinaturaValida(corpoBruto, assinatura) {
  const chave = config.abacatepay?.chavePublica;
  if (!chave) return null;   // não configurada: não dá para conferir
  if (!assinatura) return false;
  const esperada = createHmac('sha256', chave).update(Buffer.isBuffer(corpoBruto) ? corpoBruto : Buffer.from(String(corpoBruto), 'utf8')).digest('base64');
  const a = Buffer.from(String(assinatura)), b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

// lê o envelope v2: { id: "log_…", event, apiVersion, devMode, data: { transparent, customer, payerInformation } }
export function lerEvento(corpo) {
  const t = corpo?.data?.transparent || corpo?.data?.pixQrCode || corpo?.data?.billing || null;
  return {
    eventoId: corpo?.id || null,
    evento: String(corpo?.event || '').toLowerCase(),
    devMode: !!corpo?.devMode,
    cobranca: t ? normalizar(t) : null,
    metodo: corpo?.data?.payerInformation?.method || null,
  };
}
