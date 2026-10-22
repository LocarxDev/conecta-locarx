// LocarX Tools — as ferramentas que o assistente usa. Cada ferramenta só enxerga a loja da conversa.
// As mesmas definições são publicadas no servidor MCP (rotas/mcp.js) para outros sistemas.
import { comoSistema } from '../../banco/conexao.js';
import { buscarConhecimento } from '../ia/conhecimento.js';
import * as locarx from './api-locarx.js';
import { cifrar } from '../seguranca.js';

export function cpfValido(cpf) {
  const d = String(cpf || '').replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

const reais = (v) => (v == null ? 'a confirmar' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/, RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function validarPeriodo(a) {
  for (const [c, re] of [['data_retirada', RE_DATA], ['hora_retirada', RE_HORA], ['data_devolucao', RE_DATA], ['hora_devolucao', RE_HORA]]) {
    if (!re.test(String(a[c] || ''))) throw new Error(`Informe ${c.replace('_', ' ')} no formato ${re === RE_DATA ? 'AAAA-MM-DD' : 'HH:MM'}.`);
  }
  // horário de Salvador (UTC-3, sem horário de verão)
  const ini = new Date(`${a.data_retirada}T${a.hora_retirada}:00-03:00`), fim = new Date(`${a.data_devolucao}T${a.hora_devolucao}:00-03:00`);
  if (ini < new Date(Date.now() + 60 * 60_000)) throw new Error('A retirada precisa ser pelo menos 1 hora a partir de agora.');
  if (fim <= ini) throw new Error('A devolução precisa ser depois da retirada.');
  if (fim - ini > 90 * 86_400_000) throw new Error('Períodos acima de 90 dias precisam ser tratados com um atendente.');
  return { retirada: { date: a.data_retirada, time: a.hora_retirada }, devolucao: { date: a.data_devolucao, time: a.hora_devolucao }, ini, fim };
}

const PERIODO = {
  data_retirada: { type: 'string', description: 'Data de retirada, AAAA-MM-DD' },
  hora_retirada: { type: 'string', description: 'Hora de retirada, HH:MM (24h)' },
  data_devolucao: { type: 'string', description: 'Data de devolução, AAAA-MM-DD' },
  hora_devolucao: { type: 'string', description: 'Hora de devolução, HH:MM (24h)' },
};

/**
 * @param {object} ctx { lojaId, branchId, conversaId, contatoId, simulacao, aoChamarAtendente(motivo) }
 */
export function ferramentasDaLoja(ctx) {
  const lista = [
    {
      nome: 'buscar_informacoes',
      descricao: 'Busca regras e informações oficiais da LocarX e desta loja (documentos, idade mínima, caução, quilometragem, proteções, endereço, horários, formas de pagamento, políticas). Use antes de responder qualquer dúvida sobre regras.',
      parametros: { type: 'object', properties: { pergunta: { type: 'string', description: 'A dúvida do cliente, em poucas palavras' } }, required: ['pergunta'] },
      executar: async ({ pergunta }) => {
        const achados = await comoSistema((c) => buscarConhecimento(c, ctx.lojaId, pergunta));
        if (!achados.length) return 'Nada encontrado na base oficial. Não invente: diga que vai confirmar com um atendente e use chamar_atendente com sem_resposta = true.';
        return achados.map((a) => `### ${a.titulo}\n${a.conteudo}`).join('\n\n');
      },
    },
    {
      nome: 'dados_da_loja',
      descricao: 'Nome, endereço e horários de funcionamento desta loja LocarX.',
      parametros: { type: 'object', properties: {} },
      executar: async () => {
        const loja = await comoSistema(async (c) => (await c.query('SELECT nome, cidade, uf FROM lojas WHERE id = $1', [ctx.lojaId])).rows[0]);
        let filial = null;
        try { filial = await locarx.dadosDaFilial(ctx.branchId); } catch { /* sem API: segue com o cadastro */ }
        return { loja: loja?.nome, cidade: `${loja?.cidade}/${loja?.uf}`, endereco: filial?.endereco || 'consultar buscar_informacoes', horarios: filial?.horarios || 'consultar buscar_informacoes', tipo: filial?.tipo || null };
      },
    },
    {
      nome: 'consultar_disponibilidade',
      descricao: 'Lista os grupos de carros disponíveis nesta loja para o período. Retirada e devolução são sempre nesta loja.',
      parametros: { type: 'object', properties: PERIODO, required: Object.keys(PERIODO) },
      executar: async (a) => {
        const p = validarPeriodo(a);
        const grupos = await locarx.disponibilidade({ branchId: ctx.branchId, ...p });
        if (!grupos.length) return 'Nenhum carro disponível neste período nesta loja. Ofereça outras datas ou chame um atendente.';
        await marcarEtapa(ctx, 'cotacao');
        return grupos.slice(0, 12).map((g) => ({ fleet_id: g.fleetId, grupo: g.grupo, exemplos: g.exemplos, passageiros: g.passageiros, cambio: g.cambio, diaria: reais(g.diaria), total_estimado: reais(g.total) }));
      },
    },
    {
      nome: 'calcular_preco',
      descricao: 'Calcula o valor total da locação de um grupo com as proteções escolhidas. Use o fleet_id que veio de consultar_disponibilidade. Proteções possíveis: PROTECAO_X ou PROTECAO_SUPER_X (uma das duas é obrigatória), TERCEIROS, VIDROS ou VIDROS_E_PNEUS (opcionais; VIDROS e VIDROS_E_PNEUS não podem ir juntas).',
      parametros: { type: 'object', properties: { fleet_id: { type: ['integer', 'string'] }, ...PERIODO, protecoes: { type: 'array', items: { type: 'string' } } }, required: ['fleet_id', ...Object.keys(PERIODO)] },
      executar: async (a) => {
        const p = validarPeriodo(a);
        const protecoes = normalizarProtecoes(a.protecoes);
        const r = await locarx.calcularPreco({ branchId: ctx.branchId, fleetId: a.fleet_id, ...p, protecoes });
        await marcarEtapa(ctx, 'cotacao', r.total);
        return { total: reais(r.total), diaria: reais(r.diaria), diarias: r.diarias, protecoes: r.protecoes.length ? r.protecoes : protecoes, pagamento: 'na loja, na retirada' };
      },
    },
    {
      nome: 'criar_reserva',
      descricao: 'Cria a reserva no portal LocarX com pagamento na loja. SÓ use depois de mostrar o resumo (datas, grupo, proteções e valor total) e o cliente confirmar claramente. Exige nome completo, CPF, CNH, telefone e e-mail do condutor.',
      parametros: {
        type: 'object',
        properties: {
          fleet_id: { type: ['integer', 'string'] }, ...PERIODO, protecoes: { type: 'array', items: { type: 'string' } },
          nome: { type: 'string' }, cpf: { type: 'string' }, cnh: { type: 'string' }, email: { type: 'string' }, telefone: { type: 'string' },
          cliente_confirmou: { type: 'boolean', description: 'true somente se o cliente confirmou o resumo explicitamente nesta conversa' },
        },
        required: ['fleet_id', ...Object.keys(PERIODO), 'nome', 'cpf', 'cnh', 'email', 'cliente_confirmou'],
      },
      executar: async (a) => {
        if (a.cliente_confirmou !== true) return 'Reserva NÃO criada: mostre o resumo e peça a confirmação do cliente antes.';
        const p = validarPeriodo(a);
        if (!a.nome || String(a.nome).trim().split(/\s+/).length < 2) return 'Peça o nome completo do condutor.';
        if (!cpfValido(a.cpf)) return 'CPF inválido. Peça para o cliente conferir o CPF.';
        if (!/^\d{9,11}$/.test(String(a.cnh || '').replace(/\D/g, ''))) return 'Número da CNH inválido. Peça para conferir (só números, 11 dígitos).';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(a.email || ''))) return 'E-mail inválido. Peça para conferir.';
        const protecoes = normalizarProtecoes(a.protecoes);
        const telefone = String(a.telefone || ctx.telefone || '').replace(/\D/g, '');
        const cliente = { nome: String(a.nome).trim().slice(0, 120), cpf: String(a.cpf).replace(/\D/g, ''), cnh: String(a.cnh).replace(/\D/g, ''), email: String(a.email).trim().toLowerCase(), telefone };
        let reserva;
        if (ctx.simulacao) reserva = { codigo: 'TESTE' + Math.floor(Math.random() * 1e5), status: 'SIMULACAO', grupo: null, valor: null };
        else reserva = await locarx.criarReserva({ branchId: ctx.branchId, fleetId: a.fleet_id, ...p, protecoes, cliente });
        if (!ctx.simulacao) await registrarReserva(ctx, reserva, p, cliente, { fleetId: a.fleet_id, protecoes });
        return { reserva_criada: true, codigo: reserva.codigo, pagamento: 'na loja, na retirada', proximo_passo: 'Informe o código ao cliente e avise que um atendente da loja vai dar sequência.' };
      },
    },
    {
      nome: 'consultar_reserva',
      descricao: 'Consulta uma reserva desta loja pelo código (ex.: SSA586587).',
      parametros: { type: 'object', properties: { codigo: { type: 'string' } }, required: ['codigo'] },
      executar: async ({ codigo }) => {
        const cod = String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
        const r = await locarx.buscarReserva(cod);
        if (!r || (r.branchId != null && Number(r.branchId) !== Number(ctx.branchId))) return 'Não encontrei essa reserva nesta loja. Peça para o cliente conferir o código.';
        return { codigo: r.codigo, situacao: r.status, retirada: r.retirada, devolucao: r.devolucao, grupo: r.grupo, valor: reais(r.valor), protecoes: r.protecoes };
      },
    },
    {
      nome: 'cancelar_reserva',
      descricao: 'Cancela uma reserva desta loja. Só use se o cliente pediu o cancelamento e confirmou claramente o código.',
      parametros: { type: 'object', properties: { codigo: { type: 'string' }, cliente_confirmou: { type: 'boolean' }, motivo: { type: 'string' } }, required: ['codigo', 'cliente_confirmou'] },
      executar: async ({ codigo, cliente_confirmou, motivo }) => {
        if (cliente_confirmou !== true) return 'Peça para o cliente confirmar o cancelamento antes.';
        const cod = String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
        const r = await locarx.buscarReserva(cod);
        if (!r || (r.branchId != null && Number(r.branchId) !== Number(ctx.branchId))) return 'Não encontrei essa reserva nesta loja.';
        if (ctx.simulacao) return { cancelada: true, simulacao: true };
        await locarx.cancelarReserva(cod, String(motivo || '').slice(0, 200));
        await comoSistema((c) => c.query(`UPDATE reservas SET status = 'cancelada', atualizada_em = now() WHERE loja_id = $1 AND codigo = $2`, [ctx.lojaId, cod]));
        return { cancelada: true, codigo: cod };
      },
    },
    {
      nome: 'chamar_atendente',
      descricao: 'Passa a conversa para um atendente humano da loja. Use quando o cliente pedir, quando não houver informação oficial, em reclamações, multas, acidentes, cobranças, contratos, ou depois de criar uma reserva.',
      parametros: { type: 'object', properties: { motivo: { type: 'string' }, sem_resposta: { type: 'boolean', description: 'true se for porque a informação não estava na base' }, pergunta: { type: 'string', description: 'a pergunta que ficou sem resposta' } }, required: ['motivo'] },
      executar: async (a) => {
        await ctx.aoChamarAtendente?.(a);
        return 'Atendente avisado. Diga ao cliente, em uma frase, que um atendente da loja vai continuar o atendimento em breve.';
      },
    },
  ];
  // sem API LocarX configurada, as ferramentas de reserva não são oferecidas ao assistente
  if (!ctx.locarxDisponivel) return lista.filter((f) => ['buscar_informacoes', 'dados_da_loja', 'chamar_atendente'].includes(f.nome));
  return lista;
}

function normalizarProtecoes(lista) {
  const validas = ['PROTECAO_X', 'PROTECAO_SUPER_X', 'TERCEIROS', 'VIDROS', 'VIDROS_E_PNEUS'];
  let p = [...new Set((Array.isArray(lista) ? lista : []).map((x) => String(x).toUpperCase().replace(/[^A-Z_]/g, '')).filter((x) => validas.includes(x)))];
  if (!p.includes('PROTECAO_X') && !p.includes('PROTECAO_SUPER_X')) p.unshift('PROTECAO_X');
  if (p.includes('PROTECAO_X') && p.includes('PROTECAO_SUPER_X')) p = p.filter((x) => x !== 'PROTECAO_X');
  if (p.includes('VIDROS') && p.includes('VIDROS_E_PNEUS')) p = p.filter((x) => x !== 'VIDROS');
  return p;
}

async function marcarEtapa(ctx, etapa, valor) {
  if (ctx.simulacao || !ctx.contatoId) return;
  const ordem = ['novo', 'cotacao', 'reserva', 'retirada', 'concluido'];
  await comoSistema(async (c) => {
    const o = (await c.query(`SELECT * FROM oportunidades WHERE contato_id = $1 AND etapa NOT IN ('concluido', 'perdido')`, [ctx.contatoId])).rows[0];
    if (!o) {
      await c.query(`INSERT INTO oportunidades (loja_id, contato_id, conversa_id, etapa, valor_previsto) VALUES ($1, $2, $3, $4, $5)`, [ctx.lojaId, ctx.contatoId, ctx.conversaId, etapa, valor ?? null]);
    } else if (ordem.indexOf(etapa) >= ordem.indexOf(o.etapa)) {
      await c.query(`UPDATE oportunidades SET etapa = $2, valor_previsto = coalesce($3, valor_previsto), atualizada_em = now() WHERE id = $1`, [o.id, etapa, valor ?? null]);
    }
  });
}

async function registrarReserva(ctx, reserva, p, cliente, extra) {
  await comoSistema(async (c) => {
    const r = (await c.query(
      `INSERT INTO reservas (loja_id, contato_id, conversa_id, codigo, status, retirada, devolucao, grupo, valor, origem, detalhes)
       VALUES ($1, $2, $3, $4, 'confirmada', $5, $6, $7, $8, 'assistente', $9)
       ON CONFLICT (loja_id, codigo) WHERE codigo IS NOT NULL DO UPDATE SET atualizada_em = now() RETURNING id`,
      [ctx.lojaId, ctx.contatoId, ctx.conversaId, reserva.codigo, p.ini, p.fim, reserva.grupo, reserva.valor, { ...extra, cliente: { nome: cliente.nome, email: cliente.email } }])).rows[0];
    if (ctx.contatoId) {
      await c.query(
        `UPDATE contatos SET nome = coalesce(nome, $2), email = coalesce(email, $3), cpf_cifrado = coalesce(cpf_cifrado, $4), cpf_final = coalesce(cpf_final, $5), atualizado_em = now() WHERE id = $1`,
        [ctx.contatoId, cliente.nome, cliente.email, cifrar(cliente.cpf), cliente.cpf.slice(-2)]);
      const o = (await c.query(`SELECT id FROM oportunidades WHERE contato_id = $1 AND etapa NOT IN ('concluido', 'perdido')`, [ctx.contatoId])).rows[0];
      if (o) await c.query(`UPDATE oportunidades SET etapa = 'reserva', reserva_id = $2, valor_previsto = coalesce($3, valor_previsto), atualizada_em = now() WHERE id = $1`, [o.id, r.id, reserva.valor]);
      else await c.query(`INSERT INTO oportunidades (loja_id, contato_id, conversa_id, reserva_id, etapa, valor_previsto) VALUES ($1, $2, $3, $4, 'reserva', $5)`, [ctx.lojaId, ctx.contatoId, ctx.conversaId, r.id, reserva.valor]);
    }
  });
}
