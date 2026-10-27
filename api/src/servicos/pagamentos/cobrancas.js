// Cobranças Pix (AbacatePay): gerar, confirmar (webhook/consulta/simulação), expirar.
// Regra da rede: o pagamento é confirmado ANTES de criar a reserva no portal; o pagamento vai nas `observations`
// da reserva (a API LocarX ainda não tem função de pagamento). Tudo cai na conta do franqueador (chave única da rede).
import { config } from '../../config.js';
import { comoSistema } from '../../banco/conexao.js';
import { cifrar, decifrar } from '../seguranca.js';
import * as abacate from './abacatepay.js';
import * as locarx from '../locarx/api-locarx.js';
import { registrarReserva } from '../locarx/ferramentas.js';
import { reais, dataBr, rotuloGrupo } from '../locarx/cotacao.js';
import { enviarAoCliente } from '../canais/envio.js';
import { registrarOcorrencia, detalhesDoErro } from '../ocorrencias.js';
import { distribuir } from '../crm/roleta.js';

export const pixDisponivel = () => !!config.abacatepay;

const fmtDataHora = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Gera a cobrança Pix e guarda tudo o que for preciso para criar a reserva depois do pagamento.
 * @param {object} o { lojaId, branchId, lojaNome, conversaId, contatoId, usuarioId, origem, cotacao, cliente }
 *   cotacao: { fleetId, grupo, retirada {date,time}, devolucao {date,time}, protecoes[], nomesProtecoes[], total, caucao }
 *   cliente: { nome, cpf (só dígitos), email, cnh, telefone }
 */
export async function gerarCobranca(o) {
  if (!config.abacatepay) throw Object.assign(new Error('Pagamento Pix não configurado.'), { status: 503 });
  const validade = config.abacatepay.validadeMinutos;
  const detalhes = {
    cotacao: o.cotacao, branchId: o.branchId, lojaNome: o.lojaNome,
    cliente: { nome: o.cliente.nome, email: o.cliente.email, cnh: o.cliente.cnh || '', telefone: o.cliente.telefone, cpf_cifrado: cifrar(o.cliente.cpf), cpf_final: String(o.cliente.cpf).slice(-2) },
  };
  // 1) registro local (pendente), que vira o externalId/metadata da cobrança
  const cobranca = await comoSistema(async (c) => (await c.query(
    `INSERT INTO cobrancas (loja_id, conversa_id, contato_id, usuario_id, origem, valor, expira_em, detalhes)
     VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(mins => $7), $8) RETURNING *`,
    [o.lojaId, o.conversaId || null, o.contatoId || null, o.usuarioId || null, o.origem, o.cotacao.total, validade, detalhes])).rows[0]);
  // 2) cobrança no AbacatePay
  const rg = rotuloGrupo({ grupo: o.cotacao.grupo }, 1);
  let pix;
  try {
    pix = await abacate.criarPix({
      valor: o.cotacao.total,
      descricao: `Reserva LocarX ${o.lojaNome} — ${rg.letra} ${rg.nome}, ${dataBr(o.cotacao.retirada)} a ${dataBr(o.cotacao.devolucao)}`,
      validadeSegundos: validade * 60,
      cliente: { nome: o.cliente.nome, cpf: o.cliente.cpf, email: o.cliente.email, telefone: locarx.telefoneBr(o.cliente.telefone) },
      referencia: cobranca.id,
      metadata: { cobrancaId: cobranca.id, lojaId: o.lojaId, origem: 'conecta' },
    });
  } catch (e) {
    await comoSistema((c) => c.query(`UPDATE cobrancas SET status = 'falhou', erro = $2, atualizada_em = now() WHERE id = $1`, [cobranca.id, String(e.message).slice(0, 300)]));
    await registrarOcorrencia({ lojaId: o.lojaId, usuarioId: o.usuarioId, conversaId: o.conversaId, origem: o.origem, tipo: 'reserva', nivel: 'erro', mensagem: `Pix não gerado: ${String(e.message).slice(0, 200)}`, detalhes: detalhesDoErro(e, { cobrancaId: cobranca.id, valor: o.cotacao.total }) });
    throw e;
  }
  const atual = await comoSistema(async (c) => (await c.query(
    `UPDATE cobrancas SET externo_id = $2, br_code = $3, qr_base64 = $4, expira_em = coalesce($5, expira_em), dev_mode = $6, taxa = $7, atualizada_em = now() WHERE id = $1 RETURNING *`,
    [cobranca.id, pix.externoId, pix.brCode, pix.qrBase64, pix.expiraEm, pix.devMode, pix.bruto?.platformFee != null ? Number(pix.bruto.platformFee) / 100 : null])).rows[0]);
  if (o.conversaId) {
    await enviarAoCliente(o.conversaId, null, { evento: `Pix de ${reais(atual.valor)} gerado${o.origem === 'equipe' ? ' pela equipe' : ' pelo assistente'} (vence ${fmtDataHora(atual.expira_em)})${atual.dev_mode ? ' — AMBIENTE DE TESTE' : ''}` });
  }
  await registrarOcorrencia({ lojaId: o.lojaId, usuarioId: o.usuarioId, conversaId: o.conversaId, origem: o.origem, tipo: 'reserva', nivel: 'info', mensagem: `Pix de ${reais(atual.valor)} gerado (${atual.dev_mode ? 'teste' : 'real'}), vence ${fmtDataHora(atual.expira_em)}`, detalhes: { cobrancaId: atual.id, externoId: atual.externo_id } });
  return atual;
}

// mensagens para o cliente: explicação + o código sozinho (para copiar fácil)
export function mensagensPix(cobranca) {
  const d = cobranca.detalhes || {};
  const rg = rotuloGrupo({ grupo: d.cotacao?.grupo }, 1);
  return [
    `💠 *Pagamento via Pix*\nValor: *${reais(cobranca.valor)}* — ${rg.letra} ${rg.nome}, ${d.cotacao ? dataBr(d.cotacao.retirada) + ' a ' + dataBr(d.cotacao.devolucao) : ''}\nVálido até ${fmtDataHora(cobranca.expira_em)}.\n\nCopie o código abaixo e cole no app do seu banco em *Pix → Pix Copia e Cola*. Assim que o pagamento for confirmado eu te mando o código da reserva por aqui.${cobranca.dev_mode ? '\n\n⚠️ Ambiente de teste: nenhum valor real é cobrado.' : ''}`,
    cobranca.br_code,
  ];
}

/**
 * Confirma o pagamento e cria a reserva no portal. Idempotente: só a primeira chamada age (trava na linha).
 * @param {string} cobrancaId
 * @param {object} o { via: 'webhook'|'consulta'|'simulacao', comprovanteUrl?, pagaEm?, eventoId? }
 */
export async function confirmarPagamento(cobrancaId, o = {}) {
  const cob = await comoSistema(async (c) => {
    const x = (await c.query('SELECT * FROM cobrancas WHERE id = $1 FOR UPDATE', [cobrancaId])).rows[0];
    if (!x) return null;
    if (x.status !== 'pendente' && x.status !== 'expirada') return { ja: true, cobranca: x };   // já tratada
    const atual = (await c.query(`UPDATE cobrancas SET status = 'paga', paga_em = coalesce($2, now()), comprovante_url = coalesce($3, comprovante_url), atualizada_em = now() WHERE id = $1 RETURNING *`,
      [x.id, o.pagaEm || null, o.comprovanteUrl || null])).rows[0];
    return { ja: false, cobranca: atual };
  });
  if (!cob) throw Object.assign(new Error('Cobrança não encontrada.'), { status: 404 });
  if (cob.ja) return cob.cobranca;
  const cobranca = cob.cobranca;
  const d = cobranca.detalhes || {};
  const cliente = { nome: d.cliente.nome, email: d.cliente.email, cnh: d.cliente.cnh || '', telefone: d.cliente.telefone, cpf: decifrar(d.cliente.cpf_cifrado) };
  const cot = d.cotacao;
  const rg = rotuloGrupo({ grupo: cot.grupo }, 1);
  const quando = fmtDataHora(cobranca.paga_em || new Date().toISOString());
  const observacoes = `PAGO VIA PIX (AbacatePay) em ${quando} — ${reais(cobranca.valor)} — cobrança ${cobranca.externo_id || cobranca.id}${cobranca.comprovante_url ? ` — comprovante: ${cobranca.comprovante_url}` : ''}${cobranca.dev_mode ? ' — AMBIENTE DE TESTE' : ''}. Reserva feita pelo Conecta LocarX (WhatsApp${cobranca.origem === 'equipe' ? ', equipe da loja' : ', assistente virtual'}).`;

  // 2) reserva no portal (o pagamento já está confirmado: se falhar aqui, a equipe assume — nunca perde o pagamento)
  let reserva = null, erroPortal = null;
  try {
    reserva = await locarx.criarReserva({
      branchId: d.branchId, fleetId: cot.fleetId, retirada: cot.retirada, devolucao: cot.devolucao, protecoes: cot.protecoes,
      cliente: { ...cliente, observacoes: observacoes.slice(0, 1200), referencia: cobranca.conversa_id ? `CONECTA-${String(cobranca.conversa_id).slice(0, 8)}` : `CONECTA-PIX-${String(cobranca.id).slice(0, 8)}` },
    });
    if (reserva.valor == null) reserva.valor = cot.total;
    if (!reserva.grupo) reserva.grupo = cot.grupo;
  } catch (e) { erroPortal = e; }

  if (erroPortal) {
    const motivo = erroPortal.motivo || erroPortal.message;
    await comoSistema((c) => c.query(`UPDATE cobrancas SET erro = $2, atualizada_em = now() WHERE id = $1`, [cobranca.id, `Pago, mas a reserva não foi criada no portal: ${String(motivo).slice(0, 250)}`]));
    await registrarOcorrencia({ lojaId: cobranca.loja_id, conversaId: cobranca.conversa_id, origem: cobranca.origem, tipo: 'reserva', nivel: 'erro', mensagem: `PIX PAGO (${reais(cobranca.valor)}) mas a reserva NÃO foi criada no portal: ${String(motivo).slice(0, 200)}. A equipe precisa criar a reserva manualmente ou estornar.`, detalhes: detalhesDoErro(erroPortal, { cobrancaId: cobranca.id, externoId: cobranca.externo_id, fleetId: cot.fleetId, periodo: { retirada: cot.retirada, devolucao: cot.devolucao } }) });
    if (cobranca.conversa_id) {
      await enviarAoCliente(cobranca.conversa_id, `✅ Recebemos seu pagamento de *${reais(cobranca.valor)}*! Um atendente da loja vai concluir a sua reserva e te mandar o código em instantes.`, { evento: `PIX PAGO (${reais(cobranca.valor)}) — reserva NÃO criada no portal: ${String(motivo).slice(0, 160)}. Criar manualmente ou estornar.` });
      await comoSistema(async (c) => { await c.query(`UPDATE conversas SET estado = 'aguardando', atendente_id = NULL, atualizada_em = now() WHERE id = $1`, [cobranca.conversa_id]); await distribuir(c, cobranca.conversa_id); });
    }
    return { ...cobranca, reserva: null, erroPortal: motivo };
  }

  // 3) registro no Conecta (histórico, ficha, funil) e limpeza do estado da conversa
  const reservaId = await registrarReserva(
    { lojaId: cobranca.loja_id, contatoId: cobranca.contato_id, conversaId: cobranca.conversa_id, origem: cobranca.origem, pagamento: 'pix', cobrancaId: cobranca.id },
    reserva, { ini: new Date(`${cot.retirada.date}T${cot.retirada.time}:00-03:00`), fim: new Date(`${cot.devolucao.date}T${cot.devolucao.time}:00-03:00`) }, cliente,
    { fleetId: cot.fleetId, protecoes: cot.protecoes, pix: { cobrancaId: cobranca.id, externoId: cobranca.externo_id, comprovante: cobranca.comprovante_url } },
  ).catch(async (e) => { console.error('[pix] reserva criada no portal mas falhou ao gravar no Conecta:', reserva.codigo, e); return null; });
  await comoSistema(async (c) => {
    await c.query(`UPDATE cobrancas SET reserva_id = $2, atualizada_em = now() WHERE id = $1`, [cobranca.id, reservaId]);
    if (cobranca.conversa_id) await c.query('UPDATE conversas SET cotacao = NULL, resumo_enviado_em = NULL, opcoes = NULL, atualizada_em = now() WHERE id = $1', [cobranca.conversa_id]);
  });
  await registrarOcorrencia({ lojaId: cobranca.loja_id, conversaId: cobranca.conversa_id, origem: cobranca.origem, tipo: 'reserva', nivel: 'info', mensagem: `Pix pago (${reais(cobranca.valor)}, via ${o.via || 'webhook'}) e reserva ${reserva.codigo || ''} criada no portal`, detalhes: { cobrancaId: cobranca.id, codigo: reserva.codigo, faturamento: reserva.faturamento } });

  // 4) avisa o cliente (e a equipe, pelo evento na conversa)
  if (cobranca.conversa_id) {
    const nomes = cot.nomesProtecoes?.length ? cot.nomesProtecoes : cot.protecoes;
    await enviarAoCliente(cobranca.conversa_id,
      `✅ *Pagamento confirmado e reserva criada!*\nCódigo: *${reserva.codigo || '—'}*\n🚗 ${rg.letra} – ${rg.nome}\n📅 Retirada: ${dataBr(cot.retirada)}\n📅 Devolução: ${dataBr(cot.devolucao)}\n🛡️ ${nomes.join(', ')}\n💰 Pago via Pix: *${reais(cobranca.valor)}*${cot.caucao != null ? `\n💳 Caução: ${reais(cot.caucao)} (pré-autorização no cartão, na retirada)` : ''}\n\nNa retirada, apresente CNH válida e o cartão de crédito para a caução. Qualquer dúvida é só chamar por aqui!`,
      { evento: `Pagamento Pix confirmado (${reais(cobranca.valor)}) — reserva ${reserva.codigo || ''} criada no portal` });
  }
  return { ...cobranca, status: 'paga', reserva, reserva_id: reservaId };
}

// estorno recebido pelo webhook (feito no painel do AbacatePay ou pela API): registra e avisa a equipe
export async function registrarEstorno(cob) {
  await registrarOcorrencia({ lojaId: cob.loja_id, conversaId: cob.conversa_id, origem: 'sistema', tipo: 'reserva', nivel: 'aviso', mensagem: `Pix de ${reais(cob.valor)} estornado no AbacatePay${cob.reserva_id ? ' — a reserva correspondente precisa ser cancelada no portal' : ''}`, detalhes: { cobrancaId: cob.id, externoId: cob.externo_id, reservaId: cob.reserva_id } });
  if (cob.conversa_id) await enviarAoCliente(cob.conversa_id, null, { evento: `Pix de ${reais(cob.valor)} estornado no AbacatePay${cob.reserva_id ? ' — cancelar a reserva no portal' : ''}` });
}

// consulta o provedor e confirma se já estiver pago (usado por "verificar pagamento" e pela varredura)
export async function verificarCobranca(cobrancaId) {
  const cob = await comoSistema(async (c) => (await c.query('SELECT * FROM cobrancas WHERE id = $1', [cobrancaId])).rows[0]);
  if (!cob) throw Object.assign(new Error('Cobrança não encontrada.'), { status: 404 });
  if (cob.status === 'paga') return cob;
  if (!cob.externo_id) return cob;
  const r = await abacate.consultarPix(cob.externo_id);
  if (['PAID', 'COMPLETE', 'APPROVED'].includes(String(r.status || '').toUpperCase())) return confirmarPagamento(cob.id, { via: 'consulta', comprovanteUrl: r.comprovanteUrl, pagaEm: r.pagaEm });
  if (['EXPIRED', 'CANCELLED'].includes(String(r.status || '').toUpperCase()) && cob.status === 'pendente') return expirar(cob, r.status === 'CANCELLED' ? 'cancelada' : 'expirada');
  return cob;
}

async function expirar(cob, status = 'expirada') {
  const atual = await comoSistema(async (c) => (await c.query(`UPDATE cobrancas SET status = $2, atualizada_em = now() WHERE id = $1 AND status = 'pendente' RETURNING *`, [cob.id, status])).rows[0]);
  if (!atual) return cob;
  if (atual.conversa_id) {
    await enviarAoCliente(atual.conversa_id, status === 'expirada'
      ? `⏰ O Pix de *${reais(atual.valor)}* venceu e ainda não recebemos o pagamento. Quer que eu gere um novo código, ou prefere pagar na loja, na retirada? (A reserva ainda não foi feita.)`
      : null, { evento: `Pix de ${reais(atual.valor)} ${status === 'expirada' ? 'venceu sem pagamento' : 'cancelado no provedor'}` });
  }
  return atual;
}

// cobrança pendente mais recente da conversa (para o assistente e para a equipe)
export async function cobrancaPendenteDaConversa(conversaId) {
  return comoSistema(async (c) => (await c.query(`SELECT * FROM cobrancas WHERE conversa_id = $1 AND status = 'pendente' ORDER BY criada_em DESC LIMIT 1`, [conversaId])).rows[0] || null);
}

// ---------- varredura: expira pendentes (conferindo antes no provedor, caso o webhook tenha se perdido) ----------
export function iniciarVarreduraPix() {
  if (!config.abacatepay) return;
  setInterval(() => comoSistema(async (c) => (await c.query(`SELECT id FROM cobrancas WHERE status = 'pendente' AND expira_em < now() - interval '1 minute' LIMIT 20`)).rows)
    .then(async (rows) => { for (const r of rows) await verificarCobranca(r.id).catch((e) => console.error('[pix] varredura:', e.message)); })
    .catch((e) => console.error('[pix] varredura:', e.message)), 60_000).unref();
}
