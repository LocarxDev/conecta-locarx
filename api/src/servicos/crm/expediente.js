// Expediente da loja: horário por dia da semana (assistentes.horario), dias fechados e feriados (assistentes.dias_fechados)
// e se há alguém da equipe disponível agora. Tudo no fuso de Salvador (America/Bahia, sem horário de verão: UTC-3).
//
// horario:       { seg: ['08:00','18:00'], ter: [...], dom: null } — vazio = sempre aberto.
// dias_fechados: [{ de: 'AAAA-MM-DD', ate: 'AAAA-MM-DD', motivo, abre: 'HH:MM'|null, fecha: 'HH:MM'|null }]
//                com abre e fecha → horário especial naquele(s) dia(s); sem eles → fechado.

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const DIAS_POR_EXTENSO = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const DIAS_CURTOS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const UM_DIA = 86_400_000;
const FUSO_MS = 3 * 3_600_000;

/** Data/hora de agora em Salvador, em pedaços prontos para o prompt e para as regras de horário. */
export function agoraBahia(instante = Date.now()) {
  const d = new Date(instante - FUSO_MS);
  const ano = d.getUTCFullYear();
  return {
    dia: DIAS[d.getUTCDay()], hhmm: d.toISOString().slice(11, 16), iso: d.toISOString().slice(0, 16).replace('T', ' '), hora: d.getUTCHours(),
    ano, data: d.toISOString().slice(0, 10), dataBr: d.toISOString().slice(0, 10).split('-').reverse().join('/'), porExtenso: DIAS_POR_EXTENSO[d.getUTCDay()],
    diasParaFimDoAno: Math.round((Date.UTC(ano, 11, 31) - Date.UTC(ano, d.getUTCMonth(), d.getUTCDate())) / UM_DIA),
  };
}

const horaValida = (h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h || ''));
const dataValida = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** O item de dias_fechados que cobre a data (AAAA-MM-DD), ou null. */
export function diaFechadoEm(diasFechados, data) {
  for (const f of Array.isArray(diasFechados) ? diasFechados : []) {
    if (!f || !dataValida(f.de)) continue;
    const ate = dataValida(f.ate) ? f.ate : f.de;
    if (data >= f.de && data <= ate) return f;
  }
  return null;
}

/**
 * Faixa de expediente de um dia: ['HH:MM','HH:MM'], ou null se fechado.
 * Ordem: dia fechado/feriado com horário especial → esse horário; sem horário → fechado; senão a grade da semana;
 * grade vazia → aberto o dia inteiro.
 */
export function faixaDoDia(horario, diasFechados, data, diaSemana) {
  const especial = diaFechadoEm(diasFechados, data);
  if (especial) return horaValida(especial.abre) && horaValida(especial.fecha) && especial.abre < especial.fecha ? [especial.abre, especial.fecha] : null;
  if (!horario || !Object.keys(horario).length) return ['00:00', '24:00'];
  const f = horario[diaSemana];
  return Array.isArray(f) && f.length === 2 ? [f[0], f[1]] : null;
}

/** A loja está no horário de atendimento agora? (`horario` vazio e nenhum dia fechado hoje = sempre aberto) */
export function dentroDoHorario(horario, diasFechados = [], agora = Date.now()) {
  const { dia, hhmm, data } = agoraBahia(agora);
  const faixa = faixaDoDia(horario, diasFechados, data, dia);
  if (!faixa) return false;
  return hhmm >= faixa[0] && hhmm < faixa[1];
}

// 'AAAA-MM-DD' + 'HH:MM' em Salvador → Date
const instanteBahia = (data, hhmm) => new Date(Date.parse(`${data}T${hhmm === '24:00' ? '23:59' : hhmm}:00Z`) + FUSO_MS);

function textoDe(data, hhmm, hojeData) {
  const d = new Date(`${data}T00:00:00Z`);
  const quando = `${DIAS_CURTOS[d.getUTCDay()]}, ${data.slice(8, 10)}/${data.slice(5, 7)}`;
  const amanha = new Date(Date.parse(`${hojeData}T00:00:00Z`) + UM_DIA).toISOString().slice(0, 10);
  const hora = hhmm === '00:00' ? '' : `, às ${hhmm}`;
  if (data === hojeData) return `hoje${hora}`;
  if (data === amanha) return `amanhã (${quando})${hora}`;
  return `${quando}${hora}`;
}

/**
 * Próximo início de expediente a partir de agora, olhando até 14 dias à frente.
 * Devolve { em: Date, data, hora, texto } — ex.: texto "terça, 04/11, às 08:00" — ou null se nada abrir em 14 dias.
 * Se a loja está aberta agora, devolve o momento atual com texto "agora" (abertoAgora = true).
 */
export function proximaAbertura(horario, diasFechados = [], agora = Date.now()) {
  const hoje = agoraBahia(agora);
  if (dentroDoHorario(horario, diasFechados, agora)) return { em: new Date(agora), data: hoje.data, hora: hoje.hhmm, texto: 'agora', abertoAgora: true };
  for (let i = 0; i <= 14; i++) {
    const d = new Date(Date.parse(`${hoje.data}T00:00:00Z`) + i * UM_DIA);
    const data = d.toISOString().slice(0, 10);
    const faixa = faixaDoDia(horario, diasFechados, data, DIAS[d.getUTCDay()]);
    if (!faixa) continue;
    if (i === 0 && faixa[0] <= hoje.hhmm) continue;   // hoje já passou do início (estamos depois do fechamento)
    return { em: instanteBahia(data, faixa[0]), data, hora: faixa[0], texto: textoDe(data, faixa[0], hoje.data), abertoAgora: false };
  }
  return null;
}

/** Pessoas da loja aptas a receber conversa agora: ativas, "Disponível", na roleta e com o Conecta aberto nos últimos 5 min. */
export async function candidatos(c, lojaId) {
  return (await c.query(
    `SELECT u.id, u.nome,
            (SELECT count(*) FROM conversas cv WHERE cv.atendente_id = u.id AND cv.estado = 'humano')::int AS em_andamento
       FROM usuarios u
      WHERE u.loja_id = $1 AND u.status = 'ativo' AND u.perfil IN ('dono', 'atendente')
        AND u.disponivel AND u.na_roleta AND u.visto_em > now() - interval '5 minutes'
      ORDER BY u.criado_em, u.id`, [lojaId])).rows;
}

/**
 * Situação da equipe da loja agora. `a` (linha de assistentes) é opcional: se não vier, é lida do banco.
 * { abertoAgora, equipeDisponivel, continuarSemEquipe, proximaAbertura, pessoas }
 */
export async function situacaoDaEquipe(c, lojaId, a = null, agora = Date.now()) {
  const cfg = a || (await c.query('SELECT horario, dias_fechados, continuar_sem_equipe FROM assistentes WHERE loja_id = $1', [lojaId])).rows[0] || {};
  const horario = cfg.horario || {}, dias = cfg.dias_fechados || [];
  const abertoAgora = dentroDoHorario(horario, dias, agora);
  const pessoas = abertoAgora ? await candidatos(c, lojaId) : [];
  return {
    abertoAgora, equipeDisponivel: abertoAgora && pessoas.length > 0, pessoas: pessoas.length,
    continuarSemEquipe: cfg.continuar_sem_equipe !== false,
    proximaAbertura: proximaAbertura(horario, dias, agora),
  };
}

/** Verdadeiro se a loja está no horário E há alguém da equipe disponível (mesmo critério da roleta). */
export async function equipeDisponivel(c, lojaId, a = null) {
  return (await situacaoDaEquipe(c, lojaId, a)).equipeDisponivel;
}

/** Texto curto para a Lia e para a equipe: quando o próximo atendimento acontece. */
export function textoProximoAtendimento(sit) {
  if (!sit) return 'em breve';
  if (sit.abertoAgora) return 'hoje mesmo, assim que um atendente ficar livre';
  if (!sit.proximaAbertura) return 'assim que a loja reabrir (a próxima abertura ainda não está definida)';
  return sit.proximaAbertura.texto;
}

/** Quando uma tarefa de retorno deve vencer: próxima abertura + 1 h (ou agora + 1 h se a loja já está aberta). */
export function venceRetorno(sit, agora = Date.now()) {
  const base = sit?.proximaAbertura && !sit.abertoAgora ? sit.proximaAbertura.em.getTime() : agora;
  return new Date(base + 3_600_000);
}
