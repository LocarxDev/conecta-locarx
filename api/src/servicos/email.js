// Envio de e-mail pelo Resend (convites e redefinição de senha).
import { config } from '../config.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function modelo({ titulo, texto, botao, link, rodape }) {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F6F5F3;font-family:Arial,Helvetica,sans-serif;color:#1D1D1B">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E4E1DD">
    <tr><td style="background:#1D1D1B;padding:20px 28px;color:#fff;font-size:20px;font-weight:bold">locar<span style="color:#DA291C">X</span> <span style="font-weight:normal;font-size:14px;color:#B5B1AB">Conecta</span></td></tr>
    <tr><td style="padding:28px">
      <h1 style="font-size:20px;margin:0 0 12px">${esc(titulo)}</h1>
      <p style="font-size:15px;line-height:1.5;margin:0 0 24px;color:#5E5A55">${esc(texto)}</p>
      <a href="${esc(link)}" style="display:inline-block;background:#DA291C;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">${esc(botao)}</a>
      <p style="font-size:13px;line-height:1.5;margin:24px 0 0;color:#8A857F">${esc(rodape)}</p>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

async function enviar({ para, assunto, html, texto }) {
  if (!config.resendKey) {
    console.warn(`[email] RESEND_API_KEY não configurada — e-mail para ${para} NÃO foi enviado (${assunto}).`);
    return false;
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.emailRemetente, to: [para], subject: assunto, html, text: texto }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) {
    console.error('[email] falha no Resend:', r.status, (await r.text()).slice(0, 300));
    return false;
  }
  return true;
}

export function emailConvite({ para, nome, link, loja }) {
  const texto = `${nome.split(' ')[0]}, você foi convidado(a) para o Conecta LocarX${loja ? ` na ${loja}` : ''}. Crie sua senha para entrar.`;
  return enviar({
    para,
    assunto: 'Seu acesso ao Conecta LocarX',
    html: modelo({ titulo: 'Bem-vindo(a) ao Conecta LocarX', texto, botao: 'Criar minha senha', link, rodape: 'O link vale por 72 horas. Se você não esperava este convite, ignore este e-mail.' }),
    texto: `${texto}\n\nCrie sua senha: ${link}\n\nO link vale por 72 horas.`,
  });
}

export function emailRedefinicao({ para, nome, link }) {
  const texto = `${nome.split(' ')[0]}, recebemos um pedido para criar uma nova senha do seu acesso ao Conecta LocarX.`;
  return enviar({
    para,
    assunto: 'Nova senha do Conecta LocarX',
    html: modelo({ titulo: 'Criar nova senha', texto, botao: 'Criar nova senha', link, rodape: 'O link vale por 1 hora. Se não foi você que pediu, ignore este e-mail: sua senha atual continua valendo.' }),
    texto: `${texto}\n\nCrie a nova senha: ${link}\n\nO link vale por 1 hora.`,
  });
}

// Aviso operacional para a administração (ex.: WhatsApp de uma loja em loop). Sem dados de cliente.
export function emailAviso({ para, nome, assunto, texto }) {
  return enviar({
    para, assunto: `[Conecta LocarX] ${assunto}`,
    html: modelo({ titulo: assunto, texto: `${(nome || '').split(' ')[0] ? (nome || '').split(' ')[0] + ', ' : ''}${texto}`, botao: 'Abrir o Conecta', link: `${config.appUrl}/#/whatsapp-rede`, rodape: 'Aviso automático do Conecta LocarX.' }),
    texto: `${assunto}\n\n${texto}\n\n${config.appUrl}/#/whatsapp-rede`,
  });
}
