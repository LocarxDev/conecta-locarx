// Modelos de mensagem da loja (mensagens ativas e automações) e as automações ligadas às reservas.
import { comoSistema } from '../../banco/conexao.js';
import { evolution } from '../canais/evolution.js';
import { agoraBahia } from '../ia/assistente.js';

export const MODELOS_PADRAO = {
  lembrete_retirada: { nome: 'Lembrete de retirada', automatico: true, quando: 'Na véspera da retirada', texto: 'Olá, {nome}! Passando para lembrar que sua reserva {codigo} na {loja} tem retirada em {data_retirada} às {hora_retirada}. Traga CNH, documento com foto e cartão de crédito do condutor. Qualquer dúvida, é só responder aqui.' },
  aviso_devolucao: { nome: 'Aviso de devolução', automatico: true, quando: 'No dia da devolução', texto: 'Olá, {nome}! Hoje é o dia da devolução do carro da reserva {codigo}, às {hora_devolucao}, na {loja}. Lembre-se de devolver com o mesmo nível de combustível. Boa viagem!' },
  pesquisa_satisfacao: { nome: 'Pesquisa de satisfação', automatico: true, quando: 'No dia seguinte à devolução', texto: 'Olá, {nome}! Obrigado por alugar com a {loja}. De 0 a 10, quanto você recomendaria a LocarX para um amigo? Sua resposta ajuda muito a gente.' },
  confirmacao_reserva: { nome: 'Confirmação de reserva', automatico: false, quando: 'Enviar manualmente', texto: 'Olá, {nome}! Sua reserva {codigo} na {loja} está confirmada: retirada em {data_retirada} às {hora_retirada}. O pagamento é feito na loja, na retirada.' },
  retomar_cotacao: { nome: 'Retomar cotação', automatico: false, quando: 'Enviar manualmente', texto: 'Olá, {nome}! Ainda posso ajudar com a sua locação na {loja}? Se quiser, confirmo a disponibilidade e o valor para as suas datas.' },
  contrato: { nome: 'Contrato', automatico: false, quando: 'Enviar manualmente', texto: 'Olá, {nome}! Aqui é da {loja}. Precisamos falar sobre o contrato da sua locação. Pode responder esta mensagem quando puder?' },
  multa: { nome: 'Aviso de multa', automatico: false, quando: 'Enviar manualmente', texto: 'Olá, {nome}! Aqui é da {loja}. Recebemos uma notificação de multa referente à sua locação. Pode responder esta mensagem para tratarmos a indicação do condutor?' },
  cobranca: { nome: 'Pagamento pendente', automatico: false, quando: 'Enviar manualmente', texto: 'Olá, {nome}! Aqui é da {loja}. Identificamos um valor pendente referente à sua locação. Pode responder esta mensagem para combinarmos?' },
};

export async function garantirModelos(c, lojaId) {
  for (const [chave, m] of Object.entries(MODELOS_PADRAO)) {
    await c.query(`INSERT INTO modelos_mensagem (loja_id, chave, nome, texto, automatico) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (loja_id, chave) DO NOTHING`,
      [lojaId, chave, m.nome, m.texto, m.automatico]);
  }
  return (await c.query('SELECT * FROM modelos_mensagem WHERE loja_id = $1 ORDER BY automatico DESC, nome', [lojaId])).rows;
}

export function preencherModelo(texto, vars) {
  return texto.replace(/\{([a-z_]+)\}/g, (todo, k) => (vars[k] != null && String(vars[k]).trim() ? String(vars[k]).slice(0, 200) : todo));
}

const dataBr = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit' });
const horaBr = (d) => new Date(d).toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', minute: '2-digit' });

function emSilencio(a) {
  const h = agoraBahia().hora, ini = a?.silencio_inicio ?? 21, fim = a?.silencio_fim ?? 8;
  return ini > fim ? (h >= ini || h < fim) : (h >= ini && h < fim);
}

// automações: lembrete, aviso de devolução, pesquisa; etapas do funil; cotação esquecida
export async function rodarAutomacoes() {
  const tarefas = await comoSistema(async (c) => {
    // funil acompanha a reserva (nas etapas que a loja configurou para cada acontecimento)
    await c.query(`UPDATE oportunidades o SET etapa_id = er.id, atualizada_em = now()
      FROM reservas r, etapas_funil ea, etapas_funil er
      WHERE o.reserva_id = r.id AND o.fechada_em IS NULL AND r.status <> 'cancelada' AND r.retirada < now()
        AND ea.id = o.etapa_id AND ea.tipo = 'aberta' AND er.funil_id = o.funil_id AND er.evento = 'retirada' AND er.ordem > ea.ordem`);
    await c.query(`UPDATE oportunidades o SET etapa_id = eg.id, resultado = 'ganho', fechada_em = now(), atualizada_em = now()
      FROM reservas r, etapas_funil eg
      WHERE o.reserva_id = r.id AND o.fechada_em IS NULL AND r.status <> 'cancelada' AND r.devolucao < now() - interval '2 hours'
        AND eg.funil_id = o.funil_id AND eg.tipo = 'ganho'`);
    await c.query(`UPDATE oportunidades o SET etapa_id = ep.id, resultado = 'perdido', motivo_perda = 'Reserva cancelada', fechada_em = now(), atualizada_em = now()
      FROM reservas r, etapas_funil ep
      WHERE o.reserva_id = r.id AND o.fechada_em IS NULL AND r.status = 'cancelada'
        AND ep.funil_id = o.funil_id AND ep.tipo = 'perdido'`);
    // cotação sem resposta há 24 h vira tarefa para a equipe
    await c.query(`INSERT INTO tarefas (loja_id, contato_id, conversa_id, titulo, vence_em, automatica)
      SELECT o.loja_id, o.contato_id, o.conversa_id, 'Retomar cotação de ' || coalesce(k.nome, '+' || k.telefone), now(), true
        FROM oportunidades o JOIN contatos k ON k.id = o.contato_id JOIN etapas_funil e ON e.id = o.etapa_id AND e.evento = 'cotacao'
       WHERE o.fechada_em IS NULL AND o.atualizada_em < now() - interval '24 hours' AND o.atualizada_em > now() - interval '7 days'
         AND NOT EXISTS (SELECT 1 FROM tarefas t WHERE t.contato_id = o.contato_id AND t.automatica AND t.criada_em > o.atualizada_em)`);
    // mensagens automáticas devidas
    return (await c.query(`
      SELECT r.id AS reserva_id, r.codigo, r.retirada, r.devolucao, r.loja_id, k.telefone, k.nome, l.nome AS loja_nome, t.tipo, m.texto,
             a.silencio_inicio, a.silencio_fim, cn.instancia, cn.provedor, cn.status AS canal_status, cv.id AS conversa_id
        FROM reservas r
        JOIN contatos k ON k.id = r.contato_id AND NOT k.optout
        JOIN lojas l ON l.id = r.loja_id AND l.ativa
        JOIN canais cn ON cn.loja_id = r.loja_id
        LEFT JOIN assistentes a ON a.loja_id = r.loja_id
        LEFT JOIN conversas cv ON cv.contato_id = k.id
        CROSS JOIN LATERAL (VALUES
          ('lembrete_retirada', r.retirada BETWEEN now() + interval '10 hours' AND now() + interval '36 hours'),
          ('aviso_devolucao', r.devolucao BETWEEN now() AND now() + interval '10 hours'),
          ('pesquisa_satisfacao', r.devolucao BETWEEN now() - interval '30 hours' AND now() - interval '12 hours')
        ) AS t(tipo, devido)
        JOIN modelos_mensagem m ON m.loja_id = r.loja_id AND m.chave = t.tipo AND m.ativo
       WHERE t.devido AND r.status NOT IN ('cancelada') AND r.codigo IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM automacoes_enviadas e WHERE e.reserva_id = r.id AND e.tipo = t.tipo)
       LIMIT 100`)).rows;
  });
  for (const t of tarefas) {
    if (t.canal_status !== 'conectado' || emSilencio(t)) continue;
    const texto = preencherModelo(t.texto, {
      nome: (t.nome || '').split(' ')[0] || 'cliente', loja: t.loja_nome, codigo: t.codigo,
      data_retirada: dataBr(t.retirada), hora_retirada: horaBr(t.retirada), data_devolucao: dataBr(t.devolucao), hora_devolucao: horaBr(t.devolucao),
    });
    try {
      // registra antes de enviar: nunca manda duas vezes, mesmo se o envio der erro
      const novo = await comoSistema(async (c) => (await c.query(`INSERT INTO automacoes_enviadas (reserva_id, tipo) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [t.reserva_id, t.tipo])).rowCount);
      if (!novo) continue;
      const externoId = await evolution.enviarTexto(t.instancia, t.telefone, texto);
      if (t.conversa_id) {
        await comoSistema((c) => c.query(`INSERT INTO mensagens (conversa_id, loja_id, direcao, autor, tipo, texto, externo_id) VALUES ($1, $2, 'saida', 'assistente', 'texto', $3, $4)`,
          [t.conversa_id, t.loja_id, texto, externoId]));
      }
    } catch (e) { console.error('[automação]', t.tipo, e.message); }
  }
}

export function iniciarAutomacoes() {
  setInterval(() => rodarAutomacoes().catch((e) => console.error('[automações]', e.message)), 10 * 60_000).unref();
}
