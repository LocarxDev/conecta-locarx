// Envio de mensagem ao cliente fora do ciclo do assistente (ex.: confirmação de pagamento vinda do webhook).
// Grava na conversa como mensagem do assistente e atualiza a prévia, igual ao motor faz.
import { comoSistema } from '../../banco/conexao.js';
import { destinoDaConversa, enviarTexto, enviarMidia, mensagemCanalIndisponivel, limiteTexto, quebrar } from './saida.js';

export async function enviarAoCliente(conversaId, texto, { autor = 'assistente', evento = null } = {}) {
  return comoSistema(async (c) => {
    const d = await destinoDaConversa(c, conversaId);
    if (!d) return false;
    if (evento) {
      await c.query(`INSERT INTO mensagens (conversa_id, loja_id, direcao, autor, tipo, texto) VALUES ($1, $2, 'interna', 'sistema', 'evento', $3)`, [d.id, d.loja_id, String(evento).slice(0, 500)]);
    }
    if (!texto) return true;
    if (!d.pronto) {
      await c.query(`INSERT INTO mensagens (conversa_id, loja_id, direcao, autor, tipo, texto) VALUES ($1, $2, 'interna', 'sistema', 'evento', $3)`, [d.id, d.loja_id, mensagemCanalIndisponivel(d)]);
      return false;
    }
    for (const parte of quebrar(texto, limiteTexto(d))) {
      const externoId = await enviarTexto(d, parte.trim(), { humano: autor === 'atendente' });
      await c.query(`INSERT INTO mensagens (conversa_id, loja_id, direcao, autor, tipo, texto, externo_id) VALUES ($1, $2, 'saida', $3, 'texto', $4, $5)`, [d.id, d.loja_id, autor, parte.trim(), externoId]);
    }
    await c.query(`UPDATE conversas SET ultima_previa = $2, ultima_mensagem_em = now(), atualizada_em = now() WHERE id = $1`, [d.id, String(texto).slice(0, 140)]);
    return true;
  });
}

// Envia um documento (ex.: comprovante em PDF) ao cliente e registra na conversa.
export async function enviarDocumentoAoCliente(conversaId, { buffer, mimetype = 'application/pdf', nomeArquivo, legenda = '' }, { autor = 'assistente' } = {}) {
  return comoSistema(async (c) => {
    const d = await destinoDaConversa(c, conversaId);
    if (!d || !d.pronto || d.tipo === 'instagram') return false;   // Instagram não recebe documentos pela API de mensagens
    const externoId = await enviarMidia(d, { tipo: 'documento', mimetype, base64: buffer.toString('base64'), nomeArquivo, legenda });
    await c.query(`INSERT INTO mensagens (conversa_id, loja_id, direcao, autor, tipo, texto, externo_id, midia) VALUES ($1, $2, 'saida', $3, 'documento', $4, $5, $6)`,
      [d.id, d.loja_id, autor, legenda || nomeArquivo, externoId, { mimetype, nome: nomeArquivo, tamanho: buffer.length }]);
    await c.query(`UPDATE conversas SET ultima_previa = $2, ultima_mensagem_em = now(), atualizada_em = now() WHERE id = $1`, [d.id, `📎 ${nomeArquivo}`]);
    return true;
  });
}
