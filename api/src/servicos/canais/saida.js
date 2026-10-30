// Saída unificada: entrega uma mensagem ao cliente pelo canal da conversa (WhatsApp pela Evolution, Instagram pela Meta).
// Quem chama não precisa saber o canal: passa a conversa (com loja_id, canal, telefone, ig_id) e o texto.
import { evolution } from './evolution.js';
import * as instagram from './instagram.js';

const provedoresWa = { evolution };

/** Dados de entrega da conversa: canal, telefone/ig_id do contato e o canal da loja (WhatsApp ou Instagram). */
export async function destinoDaConversa(c, conversaId) {
  const cv = (await c.query(
    `SELECT cv.id, cv.loja_id, cv.canal, cv.loja_atendimento_id, ct.telefone, ct.ig_id FROM conversas cv JOIN contatos ct ON ct.id = cv.contato_id WHERE cv.id = $1`, [conversaId])).rows[0];
  if (!cv) return null;
  if (cv.canal === 'instagram') {
    const ig = (await c.query('SELECT * FROM canais_instagram WHERE loja_id = $1', [cv.loja_id])).rows[0];
    return { ...cv, tipo: 'instagram', ig, pronto: !!ig && ig.status === 'conectado' && !!cv.ig_id };
  }
  const wa = (await c.query('SELECT * FROM canais WHERE loja_id = $1', [cv.loja_id])).rows[0];
  return { ...cv, tipo: cv.canal === 'site' ? 'site' : 'whatsapp', wa, pronto: !!wa && wa.status === 'conectado' && !!cv.telefone };
}

export const mensagemCanalIndisponivel = (d) => (d?.tipo === 'instagram'
  ? (d.ig ? 'O Instagram da loja está desconectado: a mensagem ao cliente não foi enviada.' : 'A loja não tem Instagram conectado.')
  : 'WhatsApp desconectado: a mensagem ao cliente não foi enviada.');

/** Envia texto pelo canal certo. `humano` = mensagem de atendente (no Instagram permite responder fora da janela de 24 h). Devolve o id externo. */
export async function enviarTexto(d, texto, { humano = false } = {}) {
  if (d.tipo === 'instagram') {
    return humano ? instagram.enviarTextoHumano(d.ig, d.ig_id, texto) : instagram.enviarTexto(d.ig, d.ig_id, texto);
  }
  return provedoresWa[d.wa.provedor].enviarTexto(d.wa.instancia, d.telefone, texto);
}

/** Envia mídia. Instagram: só imagem por URL pública; outros tipos não são suportados pela API de mensagens. */
export async function enviarMidia(d, { tipo, mimetype, base64, nomeArquivo, legenda, url }) {
  if (d.tipo === 'instagram') {
    if (tipo === 'imagem' && url) return instagram.enviarImagem(d.ig, d.ig_id, url);
    const e = new Error('O Instagram só aceita imagens por aqui. Envie documentos e áudios pelo WhatsApp do cliente.'); e.status = 422; throw e;
  }
  return provedoresWa[d.wa.provedor].enviarMidia(d.wa.instancia, d.telefone, { tipo, mimetype, base64, nomeArquivo, legenda });
}

// Limite de tamanho por mensagem no canal
export const limiteTexto = (d) => (d?.tipo === 'instagram' ? 950 : 3800);
export const quebrar = (texto, limite) => String(texto).match(new RegExp(`[\\s\\S]{1,${limite}}(?=\\s|$)|[\\s\\S]{1,${limite}}`, 'g')) || [];
