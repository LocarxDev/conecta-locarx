// Envio de mensagem ao cliente fora do ciclo do assistente (ex.: confirmação de pagamento vinda do webhook).
// Grava na conversa como mensagem do assistente e atualiza a prévia, igual ao motor faz.
import { comoSistema } from '../../banco/conexao.js';
import { evolution } from './evolution.js';

const provedores = { evolution };

export async function enviarAoCliente(conversaId, texto, { autor = 'assistente', evento = null } = {}) {
  return comoSistema(async (c) => {
    const cv = (await c.query('SELECT cv.id, cv.loja_id, ct.telefone FROM conversas cv JOIN contatos ct ON ct.id = cv.contato_id WHERE cv.id = $1', [conversaId])).rows[0];
    if (!cv) return false;
    const canal = (await c.query('SELECT * FROM canais WHERE loja_id = $1', [cv.loja_id])).rows[0];
    if (evento) {
      await c.query(`INSERT INTO mensagens (conversa_id, loja_id, direcao, autor, tipo, texto) VALUES ($1, $2, 'interna', 'sistema', 'evento', $3)`, [cv.id, cv.loja_id, String(evento).slice(0, 500)]);
    }
    if (!texto) return true;
    if (!canal || canal.status !== 'conectado') {
      await c.query(`INSERT INTO mensagens (conversa_id, loja_id, direcao, autor, tipo, texto) VALUES ($1, $2, 'interna', 'sistema', 'evento', $3)`, [cv.id, cv.loja_id, 'WhatsApp desconectado: a mensagem ao cliente não foi enviada — ' + String(texto).slice(0, 200)]);
      return false;
    }
    const partes = String(texto).match(/[\s\S]{1,3800}(?=\s|$)|[\s\S]{1,3800}/g) || [];
    for (const parte of partes) {
      const externoId = await provedores[canal.provedor].enviarTexto(canal.instancia, cv.telefone, parte.trim());
      await c.query(`INSERT INTO mensagens (conversa_id, loja_id, direcao, autor, tipo, texto, externo_id) VALUES ($1, $2, 'saida', $3, 'texto', $4, $5)`, [cv.id, cv.loja_id, autor, parte.trim(), externoId]);
    }
    await c.query(`UPDATE conversas SET ultima_previa = $2, ultima_mensagem_em = now(), atualizada_em = now() WHERE id = $1`, [cv.id, String(texto).slice(0, 140)]);
    return true;
  });
}
