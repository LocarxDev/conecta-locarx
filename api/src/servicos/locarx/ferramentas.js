// LocarX Tools — as ferramentas que o assistente usa. Cada ferramenta só enxerga a loja da conversa.
// As mesmas definições são publicadas no servidor MCP (rotas/mcp.js) para outros sistemas.
import { comoSistema } from '../../banco/conexao.js';
import { buscarConhecimento } from '../ia/conhecimento.js';
import * as locarx from './api-locarx.js';
import { cifrar, decifrar } from '../seguranca.js';
import { registrarEvento } from '../crm/funis.js';
import { normalizarValor } from '../crm/personalizacao.js';
import { registrarOcorrencia } from '../ocorrencias.js';
import * as cobrancas from '../pagamentos/cobrancas.js';
import { reais, validarPeriodo, normalizarProtecoes, periodoTexto, dataBr, rotuloGrupo, ordenarPorPreco, textoOpcoes } from './cotacao.js';

export function cpfValido(cpf) {
  const d = String(cpf || '').replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

// Por decisão da rede (26/10/2026), cancelamento de reserva é sempre com atendente: o assistente não cancela.
// A ferramenta cancelar_reserva continua implementada; para religar, basta mudar para true.
export const ASSISTENTE_CANCELA = false;

const SITUACAO = { CONFIRMED: 'confirmada', PENDING: 'pendente', INPROGRESS: 'em andamento (carro retirado)', COMPLETED: 'concluída (carro devolvido)', CANCELED: 'cancelada' };

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
      descricao: 'Nome, endereço, horário de atendimento (por dia da semana) e janelas de atendimento especial (fora do horário, com taxa) desta loja LocarX, direto do portal. Use para responder horário/endereço e quando a consulta recusar um horário (OUTSIDE_BUSINESS_HOURS).',
      parametros: { type: 'object', properties: {} },
      executar: async () => {
        const loja = await comoSistema(async (c) => (await c.query('SELECT nome, cidade, uf FROM lojas WHERE id = $1', [ctx.lojaId])).rows[0]);
        let filial = null;
        try { filial = await locarx.dadosDaFilial(ctx.branchId); } catch { /* sem API: segue com o cadastro */ }
        return {
          loja: loja?.nome, cidade: `${loja?.cidade}/${loja?.uf}`, tipo: filial?.tipo || null,
          endereco: filial?.endereco || 'consultar buscar_informacoes',
          horario_de_atendimento: filial?.horariosTexto || 'consultar buscar_informacoes',
          atendimento_especial: filial?.especiaisTexto || 'nenhum (fora do horário a loja não atende)',
          observacao: 'Retirada e devolução precisam cair no horário de atendimento ou numa janela de atendimento especial (que tem taxa, já incluída no total da consulta).',
        };
      },
    },
    {
      nome: 'descrever_grupo',
      descricao: 'Descreve um grupo de carros do catálogo LocarX (modelos de referência, lugares, malas, portas, câmbio, itens de série). Use quando o cliente perguntar "o que é o grupo B", "cabe 5 pessoas?", "qual é automático?". NÃO tem preço nem disponibilidade: para isso use consultar_disponibilidade.',
      parametros: { type: 'object', properties: { grupo: { type: 'string', description: 'letra (ex.: B), nome (ex.: SUV) ou modelo (ex.: Renegade). Vazio = lista resumida de todos' } } },
      executar: async ({ grupo }) => {
        const todos = await locarx.catalogoFrotas();
        const q = String(grupo || '').trim().toLowerCase();
        const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const achados = !q ? todos : todos.filter((g) => {
          const r = rotuloGrupo(g, 0);
          return r.letra.toLowerCase() === q || semAcento(g.grupo).includes(semAcento(q)) || semAcento(g.exemplos).includes(semAcento(q)) || g.tipos.some((t) => semAcento(t).includes(semAcento(q)));
        });
        if (!achados.length) return 'Nenhum grupo com esse nome no catálogo. Peça ao cliente a letra ou consulte a disponibilidade para o período.';
        return {
          aviso: 'Catálogo geral: sem preço e sem garantia de carro na loja. Para valores e disponibilidade use consultar_disponibilidade.',
          grupos: achados.slice(0, 8).map((g) => { const r = rotuloGrupo(g, 0); return { letra: r.letra, nome: r.nome, modelos: g.exemplos, lugares: g.passageiros, malas: g.malas, portas: g.portas, cambio: g.cambio ? String(g.cambio).toLowerCase().replace('automatic', 'automático') : null, itens: g.itens.slice(0, 8) }; }),
        };
      },
    },
    {
      nome: 'consultar_disponibilidade',
      descricao: 'Lista os grupos de carros disponíveis nesta loja para o período, do mais barato para o mais caro (3 por vez). Retirada e devolução são sempre nesta loja. Devolve texto_para_cliente pronto: envie esse texto ao cliente.',
      parametros: {
        type: 'object',
        properties: {
          ...PERIODO,
          cambio: { type: 'string', enum: ['qualquer', 'manual', 'automatico'], description: 'Só se o cliente pedir um tipo de câmbio' },
          mais_opcoes: { type: 'boolean', description: 'true quando o cliente pedir para ver outras opções além das já mostradas' },
        },
        required: Object.keys(PERIODO),
      },
      executar: async (a) => {
        // trava: no máximo 3 consultas por resposta (evita a IA "varrer" datas sozinha)
        ctx.consultas = (ctx.consultas || 0) + 1;
        if (ctx.consultas > 3) return 'Limite de consultas atingido. Não consulte mais: avise o cliente e use chamar_atendente com o motivo "sem disponibilidade".';
        const p = validarPeriodo(a);
        const periodo = periodoTexto(a);
        let grupos;
        try { grupos = await locarx.disponibilidade({ branchId: ctx.branchId, ...p }); }
        catch (e) { if (e.dicaAssistente) return `Consulta para ${periodo} recusada pelo portal (${e.codigo}): ${e.dicaAssistente}`; throw e; }
        if (!grupos.length) {
          await etiquetarSemDisponibilidade(ctx);
          return `Nenhum carro disponível no sistema para ${periodo} nesta loja. NÃO procure outras datas por conta própria: avise o cliente em uma frase e use chamar_atendente com o motivo "sem disponibilidade para ${periodo}". Só consulte outra data se o próprio cliente pedir.`;
        }
        if (a.cambio === 'automatico') grupos = grupos.filter((g) => /AUTO/i.test(g.cambio || ''));
        if (a.cambio === 'manual') grupos = grupos.filter((g) => /MANUAL/i.test(g.cambio || ''));
        if (!grupos.length) return `Não há carro com câmbio ${a.cambio} disponível para ${periodo}. Avise o cliente e ofereça as outras opções (consulte de novo sem o filtro de câmbio) ou chame um atendente.`;
        grupos = ordenarPorPreco(grupos);
        const mostrar = a.mais_opcoes ? grupos.slice(3, 8) : grupos.slice(0, 3);
        if (!mostrar.length) return 'Não há mais opções além das já mostradas. Pergunte qual das opções o cliente prefere ou chame um atendente.';
        await marcarEtapa(ctx, 'cotacao');
        const texto = textoOpcoes(mostrar, { periodo, inicio: a.mais_opcoes ? 4 : 1, haMais: grupos.length > 3 && !a.mais_opcoes });
        // guarda as opções na conversa: na próxima mensagem a IA recebe letra → fleet_id no prompt (ela não vê o resultado da ferramenta depois)
        if (!ctx.simulacao && ctx.conversaId) {
          const opcoes = { periodo: { data_retirada: a.data_retirada, hora_retirada: a.hora_retirada, data_devolucao: a.data_devolucao, hora_devolucao: a.hora_devolucao }, em: new Date().toISOString(),
            grupos: [...(a.mais_opcoes ? (ctx.opcoesAnteriores || []) : []), ...mostrar.map((g, i) => ({ letra: rotuloGrupo(g, i + (a.mais_opcoes ? 4 : 1)).letra, fleet_id: g.fleetId, grupo: g.grupo, total: g.total }))] };
          await comoSistema((c) => c.query('UPDATE conversas SET opcoes = $2 WHERE id = $1', [ctx.conversaId, opcoes]));
        }
        return {
          texto_para_cliente: texto,
          grupos: mostrar.map((g, i) => ({ letra: rotuloGrupo(g, i + (a.mais_opcoes ? 4 : 1)).letra, fleet_id: g.fleetId, grupo: g.grupo, cambio: g.cambio, total: reais(g.total) })),
          protecoes_disponiveis: (mostrar[0].protecoes || []).map((x) => ({ codigo: x.codigo, nome: x.nome, diaria: reais(x.diaria), basica: x.base, caucao: x.caucao != null ? reais(x.caucao) : null })),
          caucao: mostrar[0].protecoes?.find((x) => x.base && x.padrao)?.caucao != null ? `Caução (pré-autorização no cartão de crédito, liberada após a devolução): ${reais(mostrar[0].protecoes.find((x) => x.base && x.padrao).caucao)} com a Proteção X. Informe se o cliente perguntar.` : null,
          ha_mais_opcoes: !a.mais_opcoes && grupos.length > 3,
        };
      },
    },
    {
      nome: 'calcular_preco',
      descricao: 'Calcula o valor total da locação do grupo escolhido com as proteções. Use o fleet_id da opção que o cliente escolheu. Proteções: PROTECAO_X ou PROTECAO_SUPER_X (uma das duas é obrigatória), TERCEIROS, VIDROS ou VIDROS_E_PNEUS (opcionais; VIDROS e VIDROS_E_PNEUS não podem ir juntas). Esta cotação fica guardada e é a que será reservada.',
      parametros: { type: 'object', properties: { fleet_id: { type: ['integer', 'string'], description: 'fleet_id numérico da opção escolhida (a letra da opção, ex.: "B", também é aceita)' }, ...PERIODO, protecoes: { type: 'array', items: { type: 'string' } } }, required: ['fleet_id', ...Object.keys(PERIODO)] },
      executar: async (a) => {
        const p = validarPeriodo(a);
        const protecoes = normalizarProtecoes(a.protecoes);
        let r;
        try { r = await locarx.calcularPreco({ branchId: ctx.branchId, fleetId: a.fleet_id, ...p, protecoes }); }
        catch (e) { if (e.dicaAssistente) return `Cálculo recusado pelo portal (${e.codigo}): ${e.dicaAssistente}`; throw e; }
        const cotacao = { fleetId: r.fleetId ?? a.fleet_id, grupo: r.grupo, caucao: r.caucao ?? null, retirada: p.retirada, devolucao: p.devolucao, protecoes, nomesProtecoes: r.protecoes.map((x) => x.nome), total: r.total, diaria: r.diaria, diarias: r.diarias, em: new Date().toISOString() };
        ctx.cotacao = cotacao;
        if (!ctx.simulacao && ctx.conversaId) {
          await comoSistema((c) => c.query('UPDATE conversas SET cotacao = $2, resumo_enviado_em = NULL WHERE id = $1', [ctx.conversaId, cotacao]));
        }
        await marcarEtapa(ctx, 'cotacao', r.total);
        return { grupo: r.grupo, fleet_id: r.fleetId, total: reais(r.total), diaria: reais(r.diaria), diarias: r.diarias, protecoes: r.protecoes.length ? r.protecoes.map((x) => x.nome) : protecoes, caucao: r.caucao != null ? `${reais(r.caucao)} (pré-autorização no cartão, liberada após a devolução; não entra no total)` : null, pagamento: 'na loja, na retirada', proximo_passo: 'Informe o total ao cliente. Para fechar, peça nome completo, CPF e e-mail (se ainda não tiver) e chame criar_reserva.' };
      },
    },
    {
      nome: 'criar_reserva',
      descricao: 'Reserva no portal LocarX a ÚLTIMA cotação calculada (calcular_preco). Precisa de nome completo, CPF e e-mail; a CNH é opcional e o telefone é o do WhatsApp. Na primeira chamada devolve o RESUMO para você enviar ao cliente; só chame de novo depois que o cliente responder confirmando. forma_pagamento: "loja" (paga na retirada) ou "pix" (gera o Pix pelo WhatsApp; a reserva é criada automaticamente quando o pagamento cair).',
      parametros: {
        type: 'object',
        properties: {
          nome: { type: 'string' }, cpf: { type: 'string' }, email: { type: 'string' },
          cnh: { type: 'string', description: 'opcional' }, telefone: { type: 'string', description: 'opcional; só se o cliente pedir outro número' },
          cliente_confirmou: { type: 'boolean', description: 'true somente se o cliente respondeu ao RESUMO confirmando' },
          forma_pagamento: { type: 'string', enum: ['loja', 'pix'], description: 'como o cliente escolheu pagar (pergunte antes dos dados do condutor quando o Pix estiver disponível)' },
          fleet_id: { type: ['integer', 'string'], description: 'só se ainda não calculou o preço: grupo escolhido (número ou letra)' },
          ...PERIODO, protecoes: { type: 'array', items: { type: 'string' }, description: 'só se ainda não calculou o preço' },
        },
        required: [],
      },
      executar: async (a) => {
        // dados que faltarem na chamada são completados com os já informados nesta conversa
        if (!ctx.simulacao && ctx.conversaId && (!a.nome || !a.cpf || !a.email)) {
          const guardado = await comoSistema(async (c) => (await c.query('SELECT condutor FROM conversas WHERE id = $1', [ctx.conversaId])).rows[0]?.condutor);
          if (guardado) { a = { ...a, nome: a.nome || guardado.nome, email: a.email || guardado.email, cpf: a.cpf || (guardado.cpf_cifrado ? decifrar(guardado.cpf_cifrado) : null), cnh: a.cnh || guardado.cnh || '' }; }
        }
        if (!a.nome || String(a.nome).trim().split(/\s+/).length < 2) return 'Peça o nome completo do condutor.';
        if (!cpfValido(a.cpf)) return 'CPF inválido. Peça para o cliente conferir o CPF.';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(a.email || '').trim())) return 'E-mail inválido. Peça para o cliente conferir.';
        const cnh = String(a.cnh || '').replace(/\D/g, '');
        if (cnh && !/^\d{9,11}$/.test(cnh)) return 'O número da CNH parece incompleto. Peça para conferir ou siga sem a CNH (ela é opcional).';
        const telefone = String(a.telefone || ctx.telefone || '').replace(/\D/g, '');
        // dados do condutor ficam na conversa (CPF cifrado): se o cliente trocar de grupo, a IA não precisa pedir de novo
        if (!ctx.simulacao && ctx.conversaId) {
          await comoSistema((c) => c.query('UPDATE conversas SET condutor = $2 WHERE id = $1', [ctx.conversaId, { nome: String(a.nome).trim().slice(0, 100), email: String(a.email).trim().toLowerCase(), cpf_cifrado: cifrar(String(a.cpf).replace(/\D/g, '')), cpf_final: String(a.cpf).replace(/\D/g, '').slice(-2), cnh: cnh || null, em: new Date().toISOString() }]));
        }
        const cliente = { nome: String(a.nome).trim().slice(0, 100), cpf: String(a.cpf).replace(/\D/g, ''), cnh, email: String(a.email).trim().toLowerCase(), telefone, observacoes: 'Reserva feita pelo assistente virtual do WhatsApp (Conecta LocarX).', referencia: ctx.conversaId ? `CONECTA-${String(ctx.conversaId).slice(0, 8)}` : null };

        // cotação guardada (o que o cliente viu) e controle do resumo
        let cv = null;
        if (!ctx.simulacao && ctx.conversaId) {
          cv = await comoSistema(async (c) => (await c.query('SELECT cotacao, resumo_enviado_em, ultima_do_cliente FROM conversas WHERE id = $1', [ctx.conversaId])).rows[0]);
        }
        let cotacao = cv?.cotacao || ctx.cotacao;
        // sem cotação guardada: se a IA mandou grupo e período, calcula aqui mesmo (igual a calcular_preco)
        if (!cotacao && a.fleet_id && a.data_retirada) {
          const calc = lista.find((f) => f.nome === 'calcular_preco');
          const r = await calc.executar({ fleet_id: a.fleet_id, data_retirada: a.data_retirada, hora_retirada: a.hora_retirada, data_devolucao: a.data_devolucao, hora_devolucao: a.hora_devolucao, protecoes: a.protecoes });
          if (typeof r === 'string') return r;   // recusa/erro do cálculo, já com orientação
          cotacao = ctx.cotacao;
          cv = cv && { ...cv, cotacao, resumo_enviado_em: null };
        }
        if (!cotacao) return 'Ainda não há cotação. Chame calcular_preco com o fleet_id (ou a letra) do grupo escolhido, o período e as proteções — ou chame criar_reserva de novo informando fleet_id, datas, horas e proteções junto com os dados do cliente.';
        const rg = rotuloGrupo({ grupo: cotacao.grupo }, 1);
        const pixOk = ctx.pixDisponivel && !ctx.simulacao;
        const forma = pixOk && a.forma_pagamento === 'pix' ? 'pix' : 'loja';
        if (a.forma_pagamento === 'pix' && !pixOk) return 'Pagamento via Pix não está disponível nesta loja. Siga com pagamento na loja, na retirada (forma_pagamento = "loja").';
        const resumo = `*Resumo da reserva*\n🚗 ${cotacao.grupo ? `${rg.letra} – ${rg.nome}` : 'Grupo escolhido'}\n📅 Retirada: ${dataBr(cotacao.retirada)}\n📅 Devolução: ${dataBr(cotacao.devolucao)}\n🛡️ Proteção: ${(cotacao.nomesProtecoes?.length ? cotacao.nomesProtecoes : cotacao.protecoes).join(', ')}\n💰 Total: *${reais(cotacao.total)}* (${forma === 'pix' ? 'pagamento via Pix por aqui' : 'pagamento na loja, na retirada'})${cotacao.caucao != null ? `\n💳 Caução: ${reais(cotacao.caucao)} (pré-autorização no cartão, liberada após a devolução)` : ''}\n👤 ${cliente.nome} · CPF final ${cliente.cpf.slice(-2)} · ${cliente.email}`;
        const assinatura = `${cliente.cpf}|${cliente.email}|${cotacao.em}|${forma}`;

        // passo 1: o resumo precisa ter sido enviado e o cliente precisa ter respondido depois dele
        const respondeuDepois = cv?.resumo_enviado_em && cv?.ultima_do_cliente && new Date(cv.ultima_do_cliente) > new Date(cv.resumo_enviado_em);
        const mesmoResumo = ctx.simulacao ? !!ctx.resumoAssinatura && ctx.resumoAssinatura === assinatura : cotacao.resumoAssinatura === assinatura;
        if (!ctx.simulacao ? !(respondeuDepois && mesmoResumo) : !mesmoResumo) {
          if (!ctx.simulacao && ctx.conversaId) {
            await comoSistema((c) => c.query('UPDATE conversas SET resumo_enviado_em = now(), cotacao = cotacao || $2::jsonb WHERE id = $1', [ctx.conversaId, { resumoAssinatura: assinatura }]));
          }
          ctx.resumoAssinatura = assinatura;
          return `RESERVA AINDA NÃO CRIADA. Envie ao cliente exatamente este resumo e pergunte: "Posso confirmar a reserva?". Só chame criar_reserva de novo depois que o cliente responder que sim.\n\n${resumo}`;
        }
        if (a.cliente_confirmou !== true) return 'O cliente ainda não confirmou o resumo. Pergunte se pode confirmar a reserva.';

        // passo 2 (Pix): gera a cobrança; a reserva no portal é criada quando o pagamento for confirmado (webhook)
        if (forma === 'pix') {
          const pendente = ctx.conversaId ? await cobrancas.cobrancaPendenteDaConversa(ctx.conversaId) : null;
          if (pendente) return { pix_ja_gerado: true, valor: reais(pendente.valor), vence_em: pendente.expira_em, instrucao: 'Já existe um Pix pendente para esta reserva. Diga ao cliente para usar o código já enviado (ou use verificar_pagamento se ele disser que pagou).' };
          const loja = await comoSistema(async (c) => (await c.query('SELECT nome FROM lojas WHERE id = $1', [ctx.lojaId])).rows[0]);
          let cob;
          try {
            cob = await cobrancas.gerarCobranca({ lojaId: ctx.lojaId, branchId: ctx.branchId, lojaNome: loja?.nome || 'LocarX', conversaId: ctx.conversaId, contatoId: ctx.contatoId, origem: 'assistente', cotacao, cliente });
          } catch (e) { return `Não foi possível gerar o Pix agora (${String(e.message).slice(0, 120)}). Ofereça ao cliente pagar na loja (chame criar_reserva de novo com forma_pagamento = "loja") ou use chamar_atendente.`; }
          const [explicacao, codigo] = cobrancas.mensagensPix(cob);
          // o código vai em mensagem separada, enviada pelo sistema logo depois da sua resposta (para o cliente copiar fácil)
          ctx.enviarDepois = [...(ctx.enviarDepois || []), explicacao, codigo];
          return { pix_gerado: true, valor: reais(cob.valor), vence_em: cob.expira_em, instrucao: 'O sistema vai enviar ao cliente a explicação e o código Pix em mensagens separadas logo após a sua. Responda só uma frase curta (ex.: "Perfeito! Vou te mandar o Pix agora."). NÃO escreva o código nem o valor você mesmo. A reserva será criada automaticamente quando o pagamento for confirmado, e o cliente receberá o código da reserva por aqui.' };
        }

        // passo 2: reserva
        const p = { retirada: cotacao.retirada, devolucao: cotacao.devolucao, ini: new Date(`${cotacao.retirada.date}T${cotacao.retirada.time}:00-03:00`), fim: new Date(`${cotacao.devolucao.date}T${cotacao.devolucao.time}:00-03:00`) };
        let reserva;
        if (ctx.simulacao) reserva = { codigo: 'TESTE' + Math.floor(Math.random() * 1e5), status: 'SIMULACAO', grupo: cotacao.grupo, valor: cotacao.total };
        else {
          try { reserva = await locarx.criarReserva({ branchId: ctx.branchId, fleetId: cotacao.fleetId, retirada: p.retirada, devolucao: p.devolucao, protecoes: cotacao.protecoes, cliente }); }
          catch (e) {
            // erro conhecido do portal: a IA recebe a orientação (e o Monitor recebe o erro pelo evento da ferramenta)
            if (e.dicaAssistente) { e.message = `Reserva NÃO criada — portal recusou (${e.codigo}): ${e.dicaAssistente}`; }
            throw e;
          }
          if (reserva.valor == null) reserva.valor = cotacao.total;
          // a reserva já existe no portal: se a gravação no Conecta falhar, o cliente ainda recebe o código
          try {
            await registrarReserva(ctx, reserva, p, cliente, { fleetId: cotacao.fleetId, protecoes: cotacao.protecoes });
            await comoSistema((c) => c.query('UPDATE conversas SET cotacao = NULL, resumo_enviado_em = NULL, opcoes = NULL WHERE id = $1', [ctx.conversaId]));
          } catch (e) {
            console.error('[criar_reserva] criada no portal mas falhou ao gravar no Conecta:', reserva.codigo, e);
            reserva.avisoGravacao = 'A reserva foi criada no portal, mas não ficou registrada no Conecta. Informe o código ao cliente e avise a equipe no chamar_atendente.';
          }
        }
        const divergente = reserva.valor != null && cotacao.total != null && Math.abs(reserva.valor - cotacao.total) > 1;
        if (!ctx.simulacao && reserva.faturamento && reserva.faturamento !== 'LOCAL_PAYMENT') {
          await registrarOcorrencia({ lojaId: ctx.lojaId, conversaId: ctx.conversaId, origem: 'assistente', tipo: 'reserva', nivel: 'aviso', mensagem: `Reserva ${reserva.codigo || ''} gravada no portal como ${reserva.faturamento} apesar de enviarmos LOCAL_PAYMENT: contrato do integrador na LocarX. Pedir ajuste do cadastro da empresa do token.`, detalhes: { codigo: reserva.codigo, faturamento: reserva.faturamento } });
        }
        // orientações oficiais do portal para passar ao cliente junto com o código (sem inventar)
        let orientacoes = null;
        if (!ctx.simulacao) {
          try {
            const pol = await locarx.politicasDaFilial(ctx.branchId);
            const quer = /validade|pagamento|cadastr|cancelamento/i;
            const itens = pol.politicas.filter((x) => quer.test(x.categoria || '')).map((x) => `${x.categoria}: ${String(x.texto).slice(0, 400)}`);
            if (pol.km) itens.push(`Quilometragem: ${pol.km}`);
            if (itens.length) orientacoes = itens;
          } catch { /* sem políticas: segue só com o código */ }
        }
        return { reserva_criada: true, codigo: reserva.codigo, total: reais(reserva.valor ?? cotacao.total), ...(reserva.avisoGravacao ? { atencao: reserva.avisoGravacao } : {}),
          ...(cotacao.caucao != null ? { caucao: reais(cotacao.caucao) } : {}),
          ...(orientacoes ? { orientacoes_oficiais: orientacoes, como_usar: 'Depois do código, resuma em até 4 linhas curtas o que o cliente precisa saber (validade da reserva, pagamento na loja, documentos/cartão, cancelamento). Não copie os textos inteiros.' } : {}), ...(divergente ? { atencao: `O portal fechou a reserva em ${reais(reserva.valor)} (a cotação mostrava ${reais(cotacao.total)}). Informe o valor do portal ao cliente e avise a equipe.` } : {}), pagamento: 'na loja, na retirada', proximo_passo: 'Informe o código ao cliente e avise que um atendente da loja vai dar sequência.' };
      },
    },
    {
      nome: 'verificar_pagamento',
      descricao: 'Confere no provedor se o Pix pendente desta conversa já foi pago (use quando o cliente disser "paguei", "já fiz o Pix"). Se estiver pago, a reserva é criada na hora e o cliente recebe o código automaticamente.',
      parametros: { type: 'object', properties: {} },
      executar: async () => {
        if (!ctx.conversaId || ctx.simulacao) return 'Sem cobrança pendente nesta conversa.';
        const pendente = await cobrancas.cobrancaPendenteDaConversa(ctx.conversaId);
        if (!pendente) return 'Não há Pix pendente nesta conversa. Se o cliente pagou, a reserva já foi criada e o código enviado; confira com consultar_reserva se precisar.';
        let r;
        try { r = await cobrancas.verificarCobranca(pendente.id); } catch (e) { return `Não consegui consultar o pagamento agora (${String(e.message).slice(0, 100)}). Peça ao cliente para aguardar um instante; a confirmação chega sozinha.`; }
        if (r.status === 'paga') return { pago: true, reserva: r.reserva?.codigo || null, instrucao: r.reserva ? 'Pagamento confirmado e reserva criada; o sistema já enviou o código ao cliente. Apenas confirme em uma frase.' : 'Pagamento confirmado, mas a reserva ficou para a equipe concluir (o sistema já avisou o cliente).' };
        if (r.status === 'expirada') return { pago: false, expirado: true, instrucao: 'O Pix venceu sem pagamento. Pergunte se o cliente quer um novo código (chame criar_reserva de novo com forma_pagamento = "pix" e cliente_confirmou = true) ou pagar na loja.' };
        return { pago: false, vence_em: r.expira_em, instrucao: 'Ainda não consta pagamento. Diga ao cliente que, assim que o banco confirmar (normalmente em segundos), o código da reserva chega por aqui.' };
      },
    },
    {
      nome: 'consultar_reserva',
      descricao: 'Consulta reservas desta loja. Com o código (ex.: SSA586587) traz aquela reserva; sem código, lista as reservas ativas do cliente desta conversa pelo CPF que ele já informou em reserva anterior.',
      parametros: { type: 'object', properties: { codigo: { type: 'string', description: 'código da reserva; vazio para listar as do cliente' } } },
      executar: async ({ codigo }) => {
        const cod = String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
        const resumo = (r) => ({ codigo: r.codigo, situacao: SITUACAO[r.status] || r.status, pagamento: r.pagamento === 'PAID' ? 'pago' : 'pagamento na loja (pendente)', retirada: r.retirada, devolucao: r.devolucao, grupo: r.grupo, valor: reais(r.valor), protecoes: r.protecoes, ...(r.motivoCancelamento ? { motivo_cancelamento: r.motivoCancelamento } : {}) });
        if (cod) {
          const r = await locarx.buscarReserva(cod);
          if (!r || (r.branchId != null && Number(r.branchId) !== Number(ctx.branchId))) return 'Não encontrei essa reserva nesta loja. Peça para o cliente conferir o código (ou peça o CPF e consulte sem código).';
          return resumo(r);
        }
        // sem código: pelo CPF guardado na ficha do cliente (só o próprio cliente da conversa)
        if (!ctx.contatoId) return 'Peça o código da reserva ao cliente.';
        const cpf = await comoSistema(async (c) => { const x = (await c.query('SELECT cpf_cifrado FROM contatos WHERE id = $1', [ctx.contatoId])).rows[0]; return x?.cpf_cifrado ? decifrar(x.cpf_cifrado) : null; });
        if (!cpf) return 'Ainda não tenho o CPF deste cliente. Peça o código da reserva (ou o CPF, e tente de novo depois de anotar).';
        const lista = (await locarx.reservasDoCpf(cpf)).filter((r) => r.branchId == null || Number(r.branchId) === Number(ctx.branchId));
        if (!lista.length) return 'Nenhuma reserva ativa deste cliente nesta loja.';
        return { reservas: lista.slice(0, 5).map(resumo) };
      },
    },
    {
      nome: 'cancelar_reserva',
      descricao: 'Cancela uma reserva desta loja feita pelo Conecta. Só use se o cliente pediu o cancelamento e confirmou claramente o código. Não cancela reserva já retirada (carro na rua) nem concluída.',
      parametros: { type: 'object', properties: { codigo: { type: 'string' }, cliente_confirmou: { type: 'boolean' }, motivo: { type: 'string', description: 'motivo dito pelo cliente, curto' } }, required: ['codigo', 'cliente_confirmou'] },
      executar: async ({ codigo, cliente_confirmou, motivo }) => {
        if (cliente_confirmou !== true) return 'Peça para o cliente confirmar o cancelamento antes.';
        const cod = String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
        const r = await locarx.buscarReserva(cod);
        if (!r || (r.branchId != null && Number(r.branchId) !== Number(ctx.branchId))) return 'Não encontrei essa reserva nesta loja.';
        if (/CANCEL/i.test(r.status || '')) return 'Essa reserva já estava cancelada. Avise o cliente.';
        if (/INPROGRESS|COMPLETED/i.test(r.status || '')) return 'Essa reserva já teve o carro retirado; não dá para cancelar pelo WhatsApp. Use chamar_atendente com o motivo "cancelamento após retirada".';
        if (r.retirada && new Date(`${r.retirada}:00-03:00`) < new Date()) return 'O horário de retirada já passou. Pela política, o cancelamento precisa ser antes da retirada: use chamar_atendente com o motivo "cancelamento após o horário de retirada".';
        if (ctx.simulacao) return { cancelada: true, simulacao: true };
        try { await locarx.cancelarReserva(cod, String(motivo || 'Cancelada pelo cliente via WhatsApp').slice(0, 250)); }
        catch (e) { if (e.dicaAssistente) return `Cancelamento recusado pelo portal (${e.codigo}): ${e.dicaAssistente}`; throw e; }
        // o funil marca "perdido" sozinho na próxima rodada das automações (reserva cancelada)
        await comoSistema((c) => c.query(`UPDATE reservas SET status = 'cancelada', atualizada_em = now() WHERE loja_id = $1 AND codigo = $2`, [ctx.lojaId, cod]));
        return { cancelada: true, codigo: cod, aviso: 'Cancelamento definitivo. Se o cliente mudar de ideia, é preciso fazer uma reserva nova.' };
      },
    },
    {
      nome: 'salvar_informacoes',
      descricao: 'Guarda na ficha do cliente as informações que ele contou na conversa (veja a lista INFORMAÇÕES PARA ANOTAR). Use assim que o cliente informar, sem interromper o atendimento. Só as chaves da lista.',
      parametros: {
        type: 'object',
        properties: { informacoes: { type: 'object', description: 'chave → valor, ex.: {"periodo": "12/11 10h a 15/11 18h"}', additionalProperties: { type: 'string' } } },
        required: ['informacoes'],
      },
      executar: async ({ informacoes }) => {
        const campos = (ctx.campos || []).filter((x) => x.instrucao_bot);
        const salvos = [], problemas = [];
        const valores = [];
        for (const [chave, bruto] of Object.entries(informacoes && typeof informacoes === 'object' ? informacoes : {}).slice(0, 20)) {
          const campo = campos.find((x) => x.chave === chave);
          if (!campo) { problemas.push(`"${chave}" não está na lista`); continue; }
          try { const v = normalizarValor(campo, bruto); if (v != null) { valores.push([campo, v]); salvos.push(campo.nome); } } catch (e) { problemas.push(e.message); }
        }
        if (valores.length && !ctx.simulacao && ctx.contatoId) {
          await comoSistema(async (c) => {
            for (const [campo, v] of valores) {
              await c.query(
                `INSERT INTO valores_campos (contato_id, campo_id, loja_id, valor, pelo_assistente) VALUES ($1, $2, $3, $4, true)
                 ON CONFLICT (contato_id, campo_id) DO UPDATE SET valor = EXCLUDED.valor, pelo_assistente = true, atualizado_em = now()`,
                [ctx.contatoId, campo.id, ctx.lojaId, v]);
            }
            if (ctx.conversaId) await c.query('UPDATE conversas SET atualizada_em = now() WHERE id = $1', [ctx.conversaId]);
          });
        }
        return `Anotado: ${salvos.join(', ') || 'nada'}.${problemas.length ? ' Não anotado: ' + problemas.join('; ') + '.' : ''} Continue o atendimento normalmente (não comente que anotou).`;
      },
    },
    {
      nome: 'aplicar_etiqueta',
      descricao: 'Marca o cliente com etiquetas da loja (veja a lista ETIQUETAS). Use quando a situação da etiqueta acontecer. Não comente com o cliente.',
      parametros: { type: 'object', properties: { etiquetas: { type: 'array', items: { type: 'string' }, description: 'nomes exatos das etiquetas da lista' } }, required: ['etiquetas'] },
      executar: async ({ etiquetas }) => {
        const permitidas = (ctx.etiquetas || []).filter((e) => e.descricao_bot);
        const nomes = (Array.isArray(etiquetas) ? etiquetas : [etiquetas]).map((x) => String(x || '').trim().toLowerCase()).slice(0, 10);
        const achadas = permitidas.filter((e) => nomes.includes(e.nome.toLowerCase()));
        if (achadas.length && !ctx.simulacao && ctx.contatoId) {
          await comoSistema(async (c) => {
            for (const e of achadas) {
              await c.query(`INSERT INTO contato_etiquetas (contato_id, etiqueta_id, loja_id, pelo_assistente) VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING`, [ctx.contatoId, e.id, ctx.lojaId]);
            }
            if (ctx.conversaId) await c.query('UPDATE conversas SET atualizada_em = now() WHERE id = $1', [ctx.conversaId]);
          });
        }
        return achadas.length ? `Etiqueta(s) aplicada(s): ${achadas.map((e) => e.nome).join(', ')}. Continue o atendimento normalmente.` : 'Nenhuma etiqueta da lista corresponde. Use só os nomes da lista ETIQUETAS.';
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
  // ferramentas de CRM só aparecem quando a loja/rede cadastrou o que o assistente deve anotar ou etiquetar
  const semCrm = new Set();
  if (!(ctx.campos || []).some((x) => x.instrucao_bot)) semCrm.add('salvar_informacoes');
  if (!(ctx.etiquetas || []).some((e) => e.descricao_bot)) semCrm.add('aplicar_etiqueta');
  if (!ASSISTENTE_CANCELA) semCrm.add('cancelar_reserva');
  if (!ctx.pixDisponivel || ctx.simulacao) semCrm.add('verificar_pagamento');
  const disponiveis = lista.filter((f) => !semCrm.has(f.nome));
  // sem API LocarX configurada, as ferramentas de reserva não são oferecidas ao assistente
  if (!ctx.locarxDisponivel) return disponiveis.filter((f) => ['buscar_informacoes', 'dados_da_loja', 'salvar_informacoes', 'aplicar_etiqueta', 'chamar_atendente'].includes(f.nome));
  return disponiveis;
}

// cliente pediu e não havia carro: etiqueta "Sem disponibilidade" (o dono enxerga a demanda perdida)
async function etiquetarSemDisponibilidade(ctx) {
  if (ctx.simulacao || !ctx.contatoId) return;
  await comoSistema((c) => c.query(
    `INSERT INTO contato_etiquetas (contato_id, etiqueta_id, loja_id, pelo_assistente)
     SELECT $1, id, $2, true FROM etiquetas WHERE loja_id IS NULL AND nome = 'Sem disponibilidade' ON CONFLICT DO NOTHING`, [ctx.contatoId, ctx.lojaId])).catch(() => {});
}

async function marcarEtapa(ctx, evento, valor) {
  if (ctx.simulacao || !ctx.contatoId) return;
  await comoSistema((c) => registrarEvento(c, { lojaId: ctx.lojaId, contatoId: ctx.contatoId, conversaId: ctx.conversaId, evento, valor: valor ?? null }));
}

// Grava a reserva no Conecta (histórico, ficha do cliente e funil). Usada pelo assistente e pela equipe (rota de reservas).
export async function registrarReserva(ctx, reserva, p, cliente, extra) {
  return comoSistema(async (c) => {
    const r = (await c.query(
      `INSERT INTO reservas (loja_id, contato_id, conversa_id, codigo, status, retirada, devolucao, grupo, valor, origem, detalhes, pagamento, cobranca_id)
       VALUES ($1, $2, $3, $4, 'confirmada', $5, $6, $7, $8, $10, $9, $11, $12)
       ON CONFLICT (loja_id, codigo) WHERE codigo IS NOT NULL DO UPDATE SET atualizada_em = now() RETURNING id`,
      [ctx.lojaId, ctx.contatoId, ctx.conversaId, reserva.codigo, p.ini, p.fim, reserva.grupo, reserva.valor, { ...extra, cliente: { nome: cliente.nome, email: cliente.email } }, ctx.origem || 'assistente', ctx.pagamento || 'loja', ctx.cobrancaId || null])).rows[0];
    if (ctx.contatoId) {
      await c.query(
        `UPDATE contatos SET nome = coalesce(nome, $2), email = coalesce(email, $3), cpf_cifrado = coalesce(cpf_cifrado, $4), cpf_final = coalesce(cpf_final, $5), atualizado_em = now() WHERE id = $1`,
        [ctx.contatoId, cliente.nome, cliente.email, cifrar(cliente.cpf), cliente.cpf.slice(-2)]);
      await registrarEvento(c, { lojaId: ctx.lojaId, contatoId: ctx.contatoId, conversaId: ctx.conversaId, evento: 'reserva', valor: reserva.valor, reservaId: r.id });
    }
    return r.id;
  });
}
