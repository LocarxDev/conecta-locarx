// LocarX Tools — as ferramentas que o assistente usa. Cada ferramenta só enxerga a loja da conversa.
// As mesmas definições são publicadas no servidor MCP (rotas/mcp.js) para outros sistemas.
import { comoSistema } from '../../banco/conexao.js';
import { buscarConhecimento } from '../ia/conhecimento.js';
import * as locarx from './api-locarx.js';
import { cifrar } from '../seguranca.js';
import { registrarEvento } from '../crm/funis.js';
import { normalizarValor } from '../crm/personalizacao.js';
import { reais, validarPeriodo, normalizarProtecoes, periodoTexto, dataBr, rotuloGrupo, ordenarPorPreco, textoOpcoes } from './cotacao.js';

export function cpfValido(cpf) {
  const d = String(cpf || '').replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
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
        let grupos = await locarx.disponibilidade({ branchId: ctx.branchId, ...p });
        const periodo = periodoTexto(a);
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
        return {
          texto_para_cliente: texto,
          grupos: mostrar.map((g, i) => ({ letra: rotuloGrupo(g, i + (a.mais_opcoes ? 4 : 1)).letra, fleet_id: g.fleetId, grupo: g.grupo, cambio: g.cambio, total: reais(g.total) })),
          protecoes_disponiveis: (mostrar[0].protecoes || []).map((x) => ({ codigo: x.codigo, nome: x.nome, diaria: reais(x.diaria), basica: x.base })),
          ha_mais_opcoes: !a.mais_opcoes && grupos.length > 3,
        };
      },
    },
    {
      nome: 'calcular_preco',
      descricao: 'Calcula o valor total da locação do grupo escolhido com as proteções. Use o fleet_id da opção que o cliente escolheu. Proteções: PROTECAO_X ou PROTECAO_SUPER_X (uma das duas é obrigatória), TERCEIROS, VIDROS ou VIDROS_E_PNEUS (opcionais; VIDROS e VIDROS_E_PNEUS não podem ir juntas). Esta cotação fica guardada e é a que será reservada.',
      parametros: { type: 'object', properties: { fleet_id: { type: ['integer', 'string'] }, ...PERIODO, protecoes: { type: 'array', items: { type: 'string' } } }, required: ['fleet_id', ...Object.keys(PERIODO)] },
      executar: async (a) => {
        const p = validarPeriodo(a);
        const protecoes = normalizarProtecoes(a.protecoes);
        const r = await locarx.calcularPreco({ branchId: ctx.branchId, fleetId: a.fleet_id, ...p, protecoes });
        const cotacao = { fleetId: a.fleet_id, grupo: r.grupo, retirada: p.retirada, devolucao: p.devolucao, protecoes, nomesProtecoes: r.protecoes.map((x) => x.nome), total: r.total, diaria: r.diaria, diarias: r.diarias, em: new Date().toISOString() };
        ctx.cotacao = cotacao;
        if (!ctx.simulacao && ctx.conversaId) {
          await comoSistema((c) => c.query('UPDATE conversas SET cotacao = $2, resumo_enviado_em = NULL WHERE id = $1', [ctx.conversaId, cotacao]));
        }
        await marcarEtapa(ctx, 'cotacao', r.total);
        return { grupo: r.grupo, total: reais(r.total), diaria: reais(r.diaria), diarias: r.diarias, protecoes: r.protecoes.length ? r.protecoes.map((x) => x.nome) : protecoes, pagamento: 'na loja, na retirada' };
      },
    },
    {
      nome: 'criar_reserva',
      descricao: 'Reserva no portal LocarX a ÚLTIMA cotação calculada (calcular_preco), com pagamento na loja. Precisa de nome completo, CPF e e-mail; a CNH é opcional e o telefone é o do WhatsApp. Na primeira chamada devolve o RESUMO para você enviar ao cliente; só chame de novo depois que o cliente responder confirmando.',
      parametros: {
        type: 'object',
        properties: {
          nome: { type: 'string' }, cpf: { type: 'string' }, email: { type: 'string' },
          cnh: { type: 'string', description: 'opcional' }, telefone: { type: 'string', description: 'opcional; só se o cliente pedir outro número' },
          cliente_confirmou: { type: 'boolean', description: 'true somente se o cliente respondeu ao RESUMO confirmando' },
        },
        required: ['nome', 'cpf', 'email'],
      },
      executar: async (a) => {
        if (!a.nome || String(a.nome).trim().split(/\s+/).length < 2) return 'Peça o nome completo do condutor.';
        if (!cpfValido(a.cpf)) return 'CPF inválido. Peça para o cliente conferir o CPF.';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(a.email || '').trim())) return 'E-mail inválido. Peça para o cliente conferir.';
        const cnh = String(a.cnh || '').replace(/\D/g, '');
        if (cnh && !/^\d{9,11}$/.test(cnh)) return 'O número da CNH parece incompleto. Peça para conferir ou siga sem a CNH (ela é opcional).';
        const telefone = String(a.telefone || ctx.telefone || '').replace(/\D/g, '');
        const cliente = { nome: String(a.nome).trim().slice(0, 120), cpf: String(a.cpf).replace(/\D/g, ''), cnh, email: String(a.email).trim().toLowerCase(), telefone };

        // cotação guardada (o que o cliente viu) e controle do resumo
        let cv = null;
        if (!ctx.simulacao && ctx.conversaId) {
          cv = await comoSistema(async (c) => (await c.query('SELECT cotacao, resumo_enviado_em, ultima_do_cliente FROM conversas WHERE id = $1', [ctx.conversaId])).rows[0]);
        }
        const cotacao = cv?.cotacao || ctx.cotacao;
        if (!cotacao) return 'Ainda não há cotação. Calcule o preço do grupo escolhido com calcular_preco antes de reservar.';
        const rg = rotuloGrupo({ grupo: cotacao.grupo }, 1);
        const resumo = `*Resumo da reserva*\n🚗 ${cotacao.grupo ? `${rg.letra} – ${rg.nome}` : 'Grupo escolhido'}\n📅 Retirada: ${dataBr(cotacao.retirada)}\n📅 Devolução: ${dataBr(cotacao.devolucao)}\n🛡️ Proteção: ${(cotacao.nomesProtecoes?.length ? cotacao.nomesProtecoes : cotacao.protecoes).join(', ')}\n💰 Total: *${reais(cotacao.total)}* (pagamento na loja, na retirada)\n👤 ${cliente.nome} · CPF final ${cliente.cpf.slice(-2)} · ${cliente.email}`;
        const assinatura = `${cliente.cpf}|${cliente.email}|${cotacao.em}`;

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

        // passo 2: reserva
        const p = { retirada: cotacao.retirada, devolucao: cotacao.devolucao, ini: new Date(`${cotacao.retirada.date}T${cotacao.retirada.time}:00-03:00`), fim: new Date(`${cotacao.devolucao.date}T${cotacao.devolucao.time}:00-03:00`) };
        let reserva;
        if (ctx.simulacao) reserva = { codigo: 'TESTE' + Math.floor(Math.random() * 1e5), status: 'SIMULACAO', grupo: cotacao.grupo, valor: cotacao.total };
        else {
          reserva = await locarx.criarReserva({ branchId: ctx.branchId, fleetId: cotacao.fleetId, retirada: p.retirada, devolucao: p.devolucao, protecoes: cotacao.protecoes, cliente });
          if (reserva.valor == null) reserva.valor = cotacao.total;
          // a reserva já existe no portal: se a gravação no Conecta falhar, o cliente ainda recebe o código
          try {
            await registrarReserva(ctx, reserva, p, cliente, { fleetId: cotacao.fleetId, protecoes: cotacao.protecoes });
            await comoSistema((c) => c.query('UPDATE conversas SET cotacao = NULL, resumo_enviado_em = NULL WHERE id = $1', [ctx.conversaId]));
          } catch (e) {
            console.error('[criar_reserva] criada no portal mas falhou ao gravar no Conecta:', reserva.codigo, e);
            reserva.avisoGravacao = 'A reserva foi criada no portal, mas não ficou registrada no Conecta. Informe o código ao cliente e avise a equipe no chamar_atendente.';
          }
        }
        const divergente = reserva.valor != null && cotacao.total != null && Math.abs(reserva.valor - cotacao.total) > 1;
        return { reserva_criada: true, codigo: reserva.codigo, total: reais(reserva.valor ?? cotacao.total), ...(reserva.avisoGravacao ? { atencao: reserva.avisoGravacao } : {}), ...(divergente ? { atencao: `O portal fechou a reserva em ${reais(reserva.valor)} (a cotação mostrava ${reais(cotacao.total)}). Informe o valor do portal ao cliente e avise a equipe.` } : {}), pagamento: 'na loja, na retirada', proximo_passo: 'Informe o código ao cliente e avise que um atendente da loja vai dar sequência.' };
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
      `INSERT INTO reservas (loja_id, contato_id, conversa_id, codigo, status, retirada, devolucao, grupo, valor, origem, detalhes)
       VALUES ($1, $2, $3, $4, 'confirmada', $5, $6, $7, $8, $10, $9)
       ON CONFLICT (loja_id, codigo) WHERE codigo IS NOT NULL DO UPDATE SET atualizada_em = now() RETURNING id`,
      [ctx.lojaId, ctx.contatoId, ctx.conversaId, reserva.codigo, p.ini, p.fim, reserva.grupo, reserva.valor, { ...extra, cliente: { nome: cliente.nome, email: cliente.email } }, ctx.origem || 'assistente'])).rows[0];
    if (ctx.contatoId) {
      await c.query(
        `UPDATE contatos SET nome = coalesce(nome, $2), email = coalesce(email, $3), cpf_cifrado = coalesce(cpf_cifrado, $4), cpf_final = coalesce(cpf_final, $5), atualizado_em = now() WHERE id = $1`,
        [ctx.contatoId, cliente.nome, cliente.email, cifrar(cliente.cpf), cliente.cpf.slice(-2)]);
      await registrarEvento(c, { lojaId: ctx.lojaId, contatoId: ctx.contatoId, conversaId: ctx.conversaId, evento: 'reserva', valor: reserva.valor, reservaId: r.id });
    }
    return r.id;
  });
}
