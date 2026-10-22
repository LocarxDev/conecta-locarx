// Roleta de atendimento: quando a conversa precisa de uma pessoa (o assistente repassou, ou chegou sem assistente),
// ela vai para alguém da equipe que está "Disponível", em sequência.
// Modos: rodizio (um de cada vez, na ordem), menos_ocupado (quem tem menos conversas em andamento) ou desligada
// (a conversa fica em "Aguardando" para quem pegar primeiro).
// Só entra quem marcou "Disponível", participa da roleta e está com o Conecta aberto (visto nos últimos 5 minutos).

export const MODOS = ['rodizio', 'menos_ocupado', 'desligada'];

export async function configDaRoleta(c, lojaId) {
  const r = (await c.query('SELECT * FROM distribuicao WHERE loja_id = $1', [lojaId])).rows[0];
  return { modo: r?.modo || 'rodizio', limite: r?.limite ?? 0, ultimoUsuarioId: r?.ultimo_usuario_id || null };
}

async function candidatos(c, lojaId) {
  return (await c.query(
    `SELECT u.id, u.nome,
            (SELECT count(*) FROM conversas cv WHERE cv.atendente_id = u.id AND cv.estado = 'humano')::int AS em_andamento
       FROM usuarios u
      WHERE u.loja_id = $1 AND u.status = 'ativo' AND u.perfil IN ('dono', 'atendente')
        AND u.disponivel AND u.na_roleta AND u.visto_em > now() - interval '5 minutes'
      ORDER BY u.criado_em, u.id`, [lojaId])).rows;
}

/** Escolhe a próxima pessoa (ou null). Trava a configuração da loja para duas conversas não caírem na mesma vez. */
async function escolher(c, lojaId) {
  await c.query('INSERT INTO distribuicao (loja_id) VALUES ($1) ON CONFLICT DO NOTHING', [lojaId]);
  const cfg = (await c.query('SELECT * FROM distribuicao WHERE loja_id = $1 FOR UPDATE', [lojaId])).rows[0];
  if (cfg.modo === 'desligada') return null;
  let lista = await candidatos(c, lojaId);
  if (cfg.limite > 0) lista = lista.filter((u) => u.em_andamento < cfg.limite);
  if (!lista.length) return null;
  // ordem circular começando logo depois de quem recebeu a última
  const i = lista.findIndex((u) => u.id === cfg.ultimo_usuario_id);
  const fila = i >= 0 ? [...lista.slice(i + 1), ...lista.slice(0, i + 1)] : lista;
  const escolhido = cfg.modo === 'menos_ocupado'
    ? fila.reduce((m, u) => (u.em_andamento < m.em_andamento ? u : m), fila[0])
    : fila[0];
  await c.query('UPDATE distribuicao SET ultimo_usuario_id = $2, atualizada_em = now() WHERE loja_id = $1', [lojaId, escolhido.id]);
  return escolhido;
}

/**
 * Entrega uma conversa em "Aguardando" para a próxima pessoa disponível.
 * Precisa rodar em contexto de sistema. Devolve a pessoa escolhida ou null.
 */
export async function distribuir(c, conversaId) {
  const cv = (await c.query(`SELECT id, loja_id, estado, atendente_id FROM conversas WHERE id = $1 FOR UPDATE`, [conversaId])).rows[0];
  if (!cv || cv.estado !== 'aguardando' || cv.atendente_id) return null;
  const u = await escolher(c, cv.loja_id);
  if (!u) return null;
  await c.query(`UPDATE conversas SET estado = 'humano', atendente_id = $2, atribuida_em = now(), atualizada_em = now() WHERE id = $1`, [cv.id, u.id]);
  await c.query(`INSERT INTO mensagens (conversa_id, loja_id, direcao, autor, tipo, texto) VALUES ($1, $2, 'interna', 'sistema', 'evento', $3)`,
    [cv.id, cv.loja_id, `Roleta de atendimento: conversa entregue para ${u.nome}`]);
  return u;
}

/** Quando alguém fica disponível (ou a configuração muda), distribui as conversas que estavam esperando. */
export async function distribuirPendentes(c, lojaId, maximo = 20) {
  const pendentes = (await c.query(
    `SELECT id FROM conversas WHERE loja_id = $1 AND estado = 'aguardando' AND atendente_id IS NULL
        AND ultima_do_cliente > now() - interval '3 days' ORDER BY ultima_do_cliente LIMIT $2`, [lojaId, maximo])).rows;
  let n = 0;
  for (const p of pendentes) { if (await distribuir(c, p.id)) n++; else break; }
  return n;
}
