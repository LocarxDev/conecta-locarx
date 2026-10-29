// Presença do visitante no chat do site: o widget consulta o servidor a cada poucos segundos; quem consultou há pouco está "na tela".
// Quem está na tela recebe a resposta ali; quem saiu recebe também no WhatsApp (já confirmado por código).
export const JANELA_PRESENCA_S = 60;

export async function visitanteAtivo(c, conversaId) {
  const r = await c.query(
    `SELECT 1 FROM site_sessoes WHERE conversa_id = $1 AND ultimo_poll > now() - make_interval(secs => $2) LIMIT 1`, [conversaId, JANELA_PRESENCA_S]);
  return r.rowCount > 0;
}
