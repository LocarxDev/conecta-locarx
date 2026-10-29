// Central de Reservas: a loja marcada como "central" reserva em qualquer filial da rede LocarX.
// Quando a filial de retirada pertence a uma loja do Conecta, essa loja é AVISADA (tarefa no CRM + WhatsApp) — não precisa aprovar nada.
import { comoSistema } from '../banco/conexao.js';
import { evolution } from './canais/evolution.js';

const dataBr = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// Qual loja do Conecta é dona da filial (branch) de retirada? Procura na loja principal e nas filiais cadastradas.
export async function lojaDaFilial(c, branchId, ignorarLojaId) {
  if (!branchId) return null;
  const r = await c.query(
    `SELECT id FROM (
        SELECT l.id, l.nome FROM lojas l WHERE l.branch_id = $1 AND l.ativa
        UNION ALL
        SELECT l.id, l.nome FROM filiais f JOIN lojas l ON l.id = f.loja_id WHERE f.branch_id = $1 AND f.ativa AND l.ativa
     ) x WHERE id <> $2::uuid LIMIT 1`, [branchId, ignorarLojaId || '00000000-0000-0000-0000-000000000000']);
  return r.rows[0]?.id || null;
}

export async function ehCentral(c, lojaId) {
  return !!(await c.query('SELECT central FROM lojas WHERE id = $1', [lojaId])).rows[0]?.central;
}

// Cria a tarefa na loja de destino e tenta mandar um WhatsApp pelo número da Central para o número da loja. Nunca lança erro.
export async function avisarLojaDestino({ centralId, destinoId, reservaId, codigo, grupo, retirada, devolucao, clienteNome, filialNome }) {
  try {
    const dados = await comoSistema(async (c) => {
      const d = (await c.query('SELECT nome FROM lojas WHERE id = $1', [destinoId])).rows[0];
      const cen = (await c.query('SELECT l.nome, ca.instancia, ca.status FROM lojas l LEFT JOIN canais ca ON ca.loja_id = l.id WHERE l.id = $1', [centralId])).rows[0];
      const dest = (await c.query('SELECT numero FROM canais WHERE loja_id = $1', [destinoId])).rows[0];
      return { destino: d, central: cen, numeroDestino: dest?.numero || null };
    });
    if (!dados.destino) return;
    const quando = `${dataBr(retirada)}${devolucao ? ` → ${dataBr(devolucao)}` : ''}`;
    const titulo = `Reserva da Central ${codigo || ''} · ${grupo || 'carro'} · retirada ${quando}${clienteNome ? ` · ${clienteNome}` : ''}`.replace(/\s+/g, ' ').trim().slice(0, 200);
    await comoSistema(async (c) => {
      await c.query(
        `INSERT INTO tarefas (loja_id, titulo, vence_em, automatica) VALUES ($1, $2, $3, true)`,
        [destinoId, titulo, new Date(retirada)]);
    });
    if (dados.central?.instancia && dados.central.status === 'conectado' && dados.numeroDestino && /^[0-9]{8,15}$/.test(dados.numeroDestino)) {
      const texto = `📣 *Nova reserva da Central de Reservas LocarX*\nCódigo: ${codigo || '—'}\nCarro: ${grupo || '—'}\nRetirada: ${quando}${filialNome ? `\nFilial: ${filialNome}` : ''}${clienteNome ? `\nCliente: ${clienteNome}` : ''}\nNão precisa aprovar nada: é só se preparar para a retirada.`;
      await evolution.enviarTexto(dados.central.instancia, dados.numeroDestino, texto).catch((e) => console.error('[central] aviso por WhatsApp falhou:', e.message));
    }
  } catch (e) { console.error('[central] não foi possível avisar a loja de destino:', e.message); }
}
