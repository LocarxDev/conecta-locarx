// Adaptador da Evolution API (v2). Toda conversa com a Evolution passa por aqui.
// Quando a loja migrar para a API oficial, entra um "oficial.js" com as mesmas funções.
import { config } from '../../config.js';

async function chamar(metodo, caminho, corpo) {
  if (!config.evolution) throw Object.assign(new Error('Evolution API não configurada.'), { status: 503 });
  const r = await fetch(config.evolution.url + caminho, {
    method: metodo,
    headers: { apikey: config.evolution.chave, 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(20_000),
  });
  const texto = await r.text();
  let dados = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch { dados = { bruto: texto.slice(0, 300) }; }
  if (!r.ok) {
    const e = new Error(`Evolution ${metodo} ${caminho.split('/').slice(0, 3).join('/')} → ${r.status}`);
    e.status = r.status; e.resposta = dados;
    throw e;
  }
  return dados;
}

const EVENTOS = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'];
const enc = encodeURIComponent;

function urlWebhook() {
  return `${config.evolution.webhookBase}/api/webhooks/evolution/${config.evolution.segredoWebhook}`;
}

async function configurarWebhook(instancia) {
  const url = urlWebhook();
  try {
    // formato atual (v2.2+)
    await chamar('POST', `/webhook/set/${enc(instancia)}`, { webhook: { enabled: true, url, byEvents: false, base64: false, events: EVENTOS } });
  } catch (e) {
    if (e.status !== 400) throw e;
    // formato antigo (documentação v2.0)
    await chamar('POST', `/webhook/set/${enc(instancia)}`, { enabled: true, url, webhookByEvents: false, webhookBase64: false, events: EVENTOS });
  }
}

export const evolution = {
  nome: 'evolution',

  async criar(instancia) {
    try {
      await chamar('POST', '/instance/create', {
        instanceName: instancia, integration: 'WHATSAPP-BAILEYS', qrcode: true,
        groupsIgnore: true, readMessages: false, alwaysOnline: false, rejectCall: false, syncFullHistory: false,
      });
    } catch (e) {
      // já existe: segue (reaproveita a instância)
      if (![403, 409].includes(e.status) && !JSON.stringify(e.resposta || '').toLowerCase().includes('already')) throw e;
    }
    await configurarWebhook(instancia);
  },

  // devolve { qr: 'data:image/png;base64,…' } ou { conectado: true }
  async qr(instancia) {
    const d = await chamar('GET', `/instance/connect/${enc(instancia)}`);
    if (d?.instance?.state === 'open') return { conectado: true };
    const base64 = d?.base64 || d?.qrcode?.base64 || null;
    return { qr: base64 && (base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`), codigo: d?.pairingCode || null };
  },

  async estado(instancia) {
    const d = await chamar('GET', `/instance/connectionState/${enc(instancia)}`);
    const s = d?.instance?.state || d?.state;
    return s === 'open' ? 'conectado' : s === 'connecting' ? 'conectando' : 'desconectado';
  },

  async desconectar(instancia) {
    await chamar('DELETE', `/instance/logout/${enc(instancia)}`).catch((e) => { if (e.status !== 404 && e.status !== 400) throw e; });
  },

  async enviarTexto(instancia, telefone, texto) {
    const d = await chamar('POST', `/message/sendText/${enc(instancia)}`, { number: telefone, text: texto });
    return d?.key?.id || null;
  },

  async enviarMidia(instancia, telefone, { tipo, mimetype, base64, nomeArquivo, legenda }) {
    const d = await chamar('POST', `/message/sendMedia/${enc(instancia)}`, {
      number: telefone, mediatype: tipo === 'imagem' ? 'image' : tipo === 'video' ? 'video' : 'document',
      mimetype, media: base64, fileName: nomeArquivo || 'arquivo', caption: legenda || '',
    });
    return d?.key?.id || null;
  },

  async baixarMidia(instancia, externoId) {
    const d = await chamar('POST', `/chat/getBase64FromMediaMessage/${enc(instancia)}`, { message: { key: { id: externoId } }, convertToMp4: false });
    if (!d?.base64) return null;
    return { buffer: Buffer.from(d.base64, 'base64'), mimetype: d.mimetype || 'application/octet-stream', nome: d.fileName || null };
  },
};

// ---------- leitura do webhook (formato Evolution → formato do Conecta) ----------
const so = (s) => String(s || '').replace(/\D/g, '');

export function lerMensagemEvolution(data) {
  const key = data?.key || {};
  const jid = String(key.remoteJid || '');
  if (!jid.endsWith('@s.whatsapp.net')) return null; // ignora grupos, status e canais
  const telefone = so(jid.split('@')[0]);
  if (telefone.length < 8 || telefone.length > 15) return null;
  const m = data.message || {};
  let tipo = 'outro', texto = null, midia = null;
  if (m.conversation || m.extendedTextMessage) { tipo = 'texto'; texto = m.conversation || m.extendedTextMessage?.text || ''; }
  else if (m.imageMessage) { tipo = 'imagem'; texto = m.imageMessage.caption || null; midia = { mimetype: m.imageMessage.mimetype }; }
  else if (m.audioMessage) { tipo = 'audio'; midia = { mimetype: m.audioMessage.mimetype, segundos: m.audioMessage.seconds }; }
  else if (m.videoMessage) { tipo = 'video'; texto = m.videoMessage.caption || null; midia = { mimetype: m.videoMessage.mimetype }; }
  else if (m.documentMessage || m.documentWithCaptionMessage) {
    const doc = m.documentMessage || m.documentWithCaptionMessage?.message?.documentMessage || {};
    tipo = 'documento'; texto = doc.caption || null; midia = { mimetype: doc.mimetype, nome: doc.fileName || doc.title || 'documento' };
  }
  else if (m.locationMessage) { tipo = 'localizacao'; midia = { lat: m.locationMessage.degreesLatitude, lng: m.locationMessage.degreesLongitude, nome: m.locationMessage.name || null }; }
  else if (m.stickerMessage) { tipo = 'figurinha'; midia = { mimetype: m.stickerMessage.mimetype }; }
  else if (m.reactionMessage || m.protocolMessage || m.senderKeyDistributionMessage) return null;
  return {
    externoId: key.id || null,
    deMim: !!key.fromMe,
    telefone,
    nome: data.pushName && !key.fromMe ? String(data.pushName).slice(0, 120) : null,
    tipo,
    texto: texto ? String(texto).slice(0, 8000) : null,
    midia,
    quando: data.messageTimestamp ? new Date(Number(data.messageTimestamp) * 1000) : new Date(),
  };
}
