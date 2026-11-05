// v14.8 — Assinatura do Conecta pelos franqueados: contratar, confirmar pagamento, cancelar, isentar, webhook da Pagar.me,
// ciclos do Pix e atraso. Ao ficar ativa, a assinatura aplica os módulos do plano na loja (pix e mcp continuam extras do admin).
import { comoSistema } from '../../banco/conexao.js';
import { erro } from '../../http.js';
import { config } from '../../config.js';
import { normalizarModulos } from '../modulos.js';
import { emailComprovanteAssinatura, emailFaturaAssinatura, emailAviso } from '../email.js';
import * as pagarme from './pagarme.js';
import { ErroPagarme } from './pagarme.js';
import { PLANOS, FORMAS, valorDoPlano, modulosComPlano, referenciaDe, somarCiclo, planosPublicos, dataISO } from './planos.js';

const hoje = () => new Date().toISOString().slice(0, 10);
const PIX_VALIDADE_SEGUNDOS = 5 * 24 * 3600;   // o código Pix da fatura vale 5 dias
const DIAS_ANTES_DO_VENCIMENTO = 5;           // o Conecta gera a fatura Pix 5 dias antes
const DIAS_TOLERANCIA = 5;                    // depois do vencimento sem pagar → "atrasada" (aviso)
const diasBloqueio = () => config.pagarme?.diasBloqueio ?? 10;   // depois do vencimento sem pagar → "suspensa" (trava)

export const faturaPublica = (f) => !f ? null : ({
  id: f.id, referencia: f.referencia, valor: f.valor_centavos / 100, forma: f.forma, formaNome: FORMAS[f.forma] || f.forma, status: f.status,
  venceEm: f.vence_em ? dataISO(f.vence_em) : null, pagaEm: f.paga_em, criadaEm: f.criada_em,
  pix: f.pix_codigo ? { codigo: f.pix_codigo, qrUrl: f.pix_qr_url, expiraEm: f.pix_expira_em } : null,
  boleto: f.boleto_url || f.boleto_linha ? { url: f.boleto_url, linha: f.boleto_linha } : null,
});
export const assinaturaPublica = (a) => a ? ({
  id: a.id, lojaId: a.loja_id, plano: a.plano, planoNome: PLANOS[a.plano]?.nome || a.plano, ciclo: a.ciclo, forma: a.forma, formaNome: FORMAS[a.forma] || a.forma,
  status: a.status, valor: a.valor_centavos / 100, cartao: a.cartao_final ? { final: a.cartao_final, bandeira: a.cartao_bandeira } : null,
  inicioEm: a.inicio_em, proximaCobranca: a.proxima_cobranca ? dataISO(a.proxima_cobranca) : null, canceladaEm: a.cancelada_em, observacao: a.observacao || null, atualizadaEm: a.atualizada_em,
  isentaAte: a.isenta_ate ? dataISO(a.isenta_ate) : null,   // v14.11 — isenção com prazo (null = sem prazo)
  entrada: a.entrada_valor_centavos != null || a.entrada_referencia ? { valor: (a.entrada_valor_centavos || 0) / 100, referencia: a.entrada_referencia || null, em: a.entrada_em } : null,
}) : null;

export const ligada = () => pagarme.ligado();
export const obrigatoria = () => !!config.pagarme?.obrigatoria;
/** true se a loja pode usar o Conecta (assinatura em dia, isenta, ou cobrança desligada/opcional). */
export const lojaLiberada = (a) => !obrigatoria() || ['ativa', 'atrasada', 'isenta'].includes(a?.status);

export async function situacao(c, lojaId) {
  const a = (await c.query('SELECT * FROM assinaturas WHERE loja_id = $1', [lojaId])).rows[0] || null;
  const faturas = a ? (await c.query('SELECT * FROM faturas_assinatura WHERE assinatura_id = $1 ORDER BY criada_em DESC LIMIT 24', [a.id])).rows : [];
  return {
    ligada: ligada(), simulado: pagarme.simulado(), obrigatoria: obrigatoria(), chavePublica: config.pagarme?.chavePublica || null,
    assinatura: assinaturaPublica(a), faturas: faturas.map(faturaPublica), faturaAberta: faturaPublica(faturas.find((f) => f.status === 'pendente')) || null,
    planos: planosPublicos(), liberada: lojaLiberada(a),
  };
}

const erroCampos = (mensagem, campos) => erro(422, mensagem, campos);

/** Contratação pelo gestor (ou pela administração dentro da loja). */
export async function contratar(c, { loja, usuario, plano, ciclo = 'mensal', forma, cardToken }) {
  if (!PLANOS[plano]) throw erroCampos('Plano inválido.', { plano: 'Escolha um plano.' });
  if (!['cartao', 'pix', 'boleto'].includes(forma)) throw erroCampos('Forma de pagamento inválida.', { forma: 'Escolha cartão, Pix ou boleto.' });
  if (forma === 'cartao' && !cardToken) throw erroCampos('Faltam os dados do cartão.', { cartao: 'Informe o cartão.' });
  if (!ligada()) throw erro(503, 'A assinatura online ainda não está disponível. Fale com a administração da rede.');
  if (!loja.cnpj || !loja.razao_social || !(loja.financeiro_email || loja.responsavel_email)) {
    throw erro(422, 'Antes de assinar, a loja precisa ter CNPJ, razão social e e-mail de cobrança no cadastro. Peça à administração da rede para completar.', { cadastro: 'Cadastro fiscal incompleto.' });
  }
  const atual = (await c.query('SELECT * FROM assinaturas WHERE loja_id = $1', [loja.id])).rows[0];
  if (atual && ['ativa', 'atrasada', 'suspensa', 'isenta'].includes(atual.status)) throw erro(409, 'Esta loja já tem uma assinatura. Para trocar o plano, cancele a atual ou fale com a administração.');

  const valor = valorDoPlano(plano, ciclo);
  const descricao = `Conecta LocarX — ${PLANOS[plano].nome} (${ciclo})`;
  const codigo = `conecta-${loja.id.slice(0, 8)}-${Date.now().toString(36)}`;
  let clienteId = atual?.pagarme_cliente_id || null;
  if (!clienteId) clienteId = (await pagarme.criarCliente({ nome: loja.razao_social, email: loja.financeiro_email || loja.responsavel_email, cnpj: loja.cnpj, telefone: loja.responsavel_telefone, endereco: loja.endereco ? { line_1: loja.endereco, cidade: loja.cidade, uf: loja.uf } : null, cep: loja.cep, codigo: loja.id })).id;

  let cartao = null, sub = null, pedido = null;
  try {
    if (forma === 'cartao') {
      cartao = await pagarme.salvarCartao(clienteId, cardToken);
      sub = await pagarme.criarAssinatura({ clienteId, cartaoId: cartao.id, forma, valorCentavos: valor, descricao, ciclo, codigo, metadata: { loja_id: loja.id, plano, ciclo } });
    } else if (forma === 'boleto') {
      sub = await pagarme.criarAssinatura({ clienteId, forma, valorCentavos: valor, descricao, ciclo, codigo, metadata: { loja_id: loja.id, plano, ciclo } });
    } else {
      pedido = await pagarme.criarPedido({ clienteId, forma: 'pix', valorCentavos: valor, descricao, codigo, validadeSegundos: PIX_VALIDADE_SEGUNDOS, metadata: { loja_id: loja.id, plano, ciclo } });
    }
  } catch (err) {
    // guarda o cliente já criado para não duplicar na próxima tentativa; devolve o motivo da Pagar.me ao gestor
    if (!atual?.pagarme_cliente_id) await c.query(`INSERT INTO assinaturas (loja_id, plano, ciclo, forma, status, valor_centavos, pagarme_cliente_id, criada_por) VALUES ($1, $2, $3, $4, 'cancelada', $5, $6, $7) ON CONFLICT (loja_id) DO UPDATE SET pagarme_cliente_id = EXCLUDED.pagarme_cliente_id`, [loja.id, plano, ciclo, forma, valor, clienteId, usuario?.id || null]).catch(() => {});
    if (err instanceof ErroPagarme) { console.error('[assinatura] Pagar.me recusou:', err.message, JSON.stringify(err.corpo?.errors || {})); throw erro(422, err.message); }
    throw err;
  }
  const ativaJa = forma === 'cartao' && sub?.status === 'active';
  const inicio = hoje();
  const a = (await c.query(
    `INSERT INTO assinaturas (loja_id, plano, ciclo, forma, status, valor_centavos, pagarme_cliente_id, pagarme_assinatura_id, pagarme_cartao_id, cartao_final, cartao_bandeira, inicio_em, proxima_cobranca, criada_por, observacao, cancelada_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NULL, NULL)
     ON CONFLICT (loja_id) DO UPDATE SET plano = EXCLUDED.plano, ciclo = EXCLUDED.ciclo, forma = EXCLUDED.forma, status = EXCLUDED.status, valor_centavos = EXCLUDED.valor_centavos,
       pagarme_cliente_id = EXCLUDED.pagarme_cliente_id, pagarme_assinatura_id = EXCLUDED.pagarme_assinatura_id, pagarme_cartao_id = EXCLUDED.pagarme_cartao_id, cartao_final = EXCLUDED.cartao_final, cartao_bandeira = EXCLUDED.cartao_bandeira,
       inicio_em = EXCLUDED.inicio_em, proxima_cobranca = EXCLUDED.proxima_cobranca, criada_por = EXCLUDED.criada_por, observacao = NULL, cancelada_em = NULL, atualizada_em = now()
     RETURNING *`,
    [loja.id, plano, ciclo, forma, ativaJa ? 'ativa' : 'pendente', valor, clienteId, sub?.id || null, cartao?.id || null, cartao?.final || null, cartao?.bandeira || null, ativaJa ? new Date() : null, ativaJa ? somarCiclo(inicio, ciclo) : inicio, usuario?.id || null])).rows[0];
  // fatura do primeiro ciclo
  const ref = referenciaDe(new Date(), ciclo);
  await c.query('DELETE FROM faturas_assinatura WHERE assinatura_id = $1 AND status = $2', [a.id, 'pendente']).catch(() => {});
  const f = (await c.query(
    `INSERT INTO faturas_assinatura (assinatura_id, loja_id, referencia, valor_centavos, forma, status, pagarme_pedido_id, pagarme_cobranca_id, pagarme_fatura_id, pix_codigo, pix_qr_url, pix_expira_em, boleto_url, boleto_linha, vence_em, paga_em, detalhes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     ON CONFLICT (assinatura_id, referencia) DO UPDATE SET valor_centavos = EXCLUDED.valor_centavos, forma = EXCLUDED.forma, status = EXCLUDED.status, pagarme_pedido_id = EXCLUDED.pagarme_pedido_id, pagarme_cobranca_id = EXCLUDED.pagarme_cobranca_id,
       pix_codigo = EXCLUDED.pix_codigo, pix_qr_url = EXCLUDED.pix_qr_url, pix_expira_em = EXCLUDED.pix_expira_em, boleto_url = EXCLUDED.boleto_url, boleto_linha = EXCLUDED.boleto_linha, vence_em = EXCLUDED.vence_em, paga_em = EXCLUDED.paga_em, detalhes = EXCLUDED.detalhes
     RETURNING *`,
    [a.id, loja.id, ref, valor, forma, ativaJa ? 'paga' : 'pendente', pedido?.id || null, pedido?.cobrancaId || null, sub?.id || null,
      pedido?.pix?.codigo || null, pedido?.pix?.qrUrl || null, pedido?.pix?.expiraEm || null, pedido?.boleto?.url || sub?.boleto?.url || null, pedido?.boleto?.linha || sub?.boleto?.linha || null,
      forma === 'pix' ? somarDias(inicio, DIAS_ANTES_DO_VENCIMENTO) : forma === 'boleto' ? somarDias(inicio, 3) : inicio, ativaJa ? new Date() : null, JSON.stringify({ origem: 'contratacao', simulado: pagarme.simulado() })])).rows[0];
  if (ativaJa) { await aplicarPlano(c, loja.id, plano, { primeiraVez: !atual?.inicio_em }); await avisarPagamento(c, a, f); }
  else await avisarFatura(c, a, f);
  return { assinatura: a, fatura: f };
}

const somarDias = (dataISO, n) => { const d = new Date(dataISO + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Liga os módulos do plano na loja. v14.8.6: só na PRIMEIRA ativação — depois, o que a administração ligar ou desligar
 *  em Lojas → Módulos vale (o plano é o teto do que a loja pode ter; a administração pode deixar menos). pix e mcp nunca mudam aqui. */
export async function aplicarPlano(c, lojaId, plano, { primeiraVez = true } = {}) {
  if (!primeiraVez) return null;
  const l = (await c.query('SELECT modulos FROM lojas WHERE id = $1', [lojaId])).rows[0];
  const novos = normalizarModulos(modulosComPlano(normalizarModulos(l?.modulos), plano));
  await c.query('UPDATE lojas SET modulos = $2 WHERE id = $1', [lojaId, JSON.stringify(novos)]);
  return novos;
}

// e-mails da assinatura (Resend; se não estiver configurado, só avisa no log). Nunca derrubam a operação.
async function dadosParaEmail(c, a) {
  const l = (await c.query('SELECT nome, financeiro_email, responsavel_email FROM lojas WHERE id = $1', [a.loja_id])).rows[0];
  const para = l?.financeiro_email || l?.responsavel_email || null;
  return para ? { para, loja: l.nome, plano: PLANOS[a.plano]?.nome || a.plano, link: `${config.appUrl}/#/assinatura` } : null;
}
async function avisarPagamento(c, a, f) {
  try { const d = await dadosParaEmail(c, a); if (d) await emailComprovanteAssinatura({ ...d, ciclo: a.ciclo, forma: FORMAS[f.forma] || f.forma, valorCentavos: f.valor_centavos, referencia: f.referencia, pagoEm: f.paga_em || new Date(), proximaCobranca: a.proxima_cobranca }); }
  catch (err) { console.warn('[assinatura] e-mail do comprovante falhou:', err.message); }
}
async function avisarFatura(c, a, f) {
  try { const d = await dadosParaEmail(c, a); if (d && (f.forma === 'pix' || f.forma === 'boleto') && f.status === 'pendente') await emailFaturaAssinatura({ ...d, forma: f.forma, valorCentavos: f.valor_centavos, referencia: f.referencia, venceEm: f.vence_em, pixCodigo: f.pix_codigo, boletoLinha: f.boleto_linha, boletoUrl: f.boleto_url }); }
  catch (err) { console.warn('[assinatura] e-mail da fatura falhou:', err.message); }
}

/** Fatura paga (webhook, cartão na hora, ou confirmação manual da administração). */
export async function confirmarFatura(c, fatura, { por = null, detalhes = null } = {}) {
  if (fatura.status === 'paga') return fatura;
  const f = (await c.query(`UPDATE faturas_assinatura SET status = 'paga', paga_em = now(), confirmada_por = $2, detalhes = coalesce(detalhes, '{}'::jsonb) || $3::jsonb WHERE id = $1 RETURNING *`, [fatura.id, por, JSON.stringify(detalhes || {})])).rows[0];
  const a = (await c.query('SELECT * FROM assinaturas WHERE id = $1', [f.assinatura_id])).rows[0];
  const base = f.vence_em ? dataISO(f.vence_em) : hoje();
  const proxima = somarCiclo(base < hoje() ? hoje() : base, a.ciclo);
  await c.query(`UPDATE assinaturas SET status = 'ativa', inicio_em = coalesce(inicio_em, now()), proxima_cobranca = $2, atualizada_em = now() WHERE id = $1`, [a.id, proxima]);
  await aplicarPlano(c, a.loja_id, a.plano, { primeiraVez: !a.inicio_em });
  await avisarPagamento(c, { ...a, proxima_cobranca: proxima }, f);
  return f;
}

export async function cancelar(c, lojaId, { por = null, motivo = null } = {}) {
  const a = (await c.query('SELECT * FROM assinaturas WHERE loja_id = $1', [lojaId])).rows[0];
  if (!a || a.status === 'cancelada') throw erro(404, 'Esta loja não tem assinatura ativa.');
  if (a.pagarme_assinatura_id) { try { await pagarme.cancelarAssinatura(a.pagarme_assinatura_id); } catch (err) { console.warn('[assinatura] cancelar na Pagar.me falhou:', err.message); } }
  await c.query(`UPDATE faturas_assinatura SET status = 'cancelada' WHERE assinatura_id = $1 AND status = 'pendente'`, [a.id]);
  return (await c.query(`UPDATE assinaturas SET status = 'cancelada', cancelada_em = now(), observacao = $2, atualizada_em = now() WHERE id = $1 RETURNING *`, [a.id, motivo])).rows[0];
}

/** Administração: isenta a loja (cortesia sem prazo, ou "liberada até" uma data — v14.11, p. ex. entrada paga na landing page) ou tira a isenção. */
export async function isentar(c, lojaId, { isenta, plano = 'basico', observacao = null, por = null, ate = null, entrada = null }) {
  if (isenta) {
    if (ate && ate <= hoje()) throw erroCampos('A data precisa ser depois de hoje.', { ate: 'Escolha uma data futura.' });
    const a = (await c.query(
      `INSERT INTO assinaturas (loja_id, plano, ciclo, forma, status, valor_centavos, inicio_em, proxima_cobranca, observacao, criada_por, isenta_ate, entrada_valor_centavos, entrada_referencia, entrada_em)
       VALUES ($1, $2, 'mensal', 'isenta', 'isenta', 0, now(), $5, $3, $4, $5, $6, $7, CASE WHEN $6::int IS NULL AND $7::text IS NULL THEN NULL ELSE now() END)
       ON CONFLICT (loja_id) DO UPDATE SET plano = EXCLUDED.plano, forma = 'isenta', status = 'isenta', valor_centavos = 0, observacao = EXCLUDED.observacao, cancelada_em = NULL, atualizada_em = now(),
         proxima_cobranca = EXCLUDED.proxima_cobranca, isenta_ate = EXCLUDED.isenta_ate,
         entrada_valor_centavos = coalesce(EXCLUDED.entrada_valor_centavos, assinaturas.entrada_valor_centavos), entrada_referencia = coalesce(EXCLUDED.entrada_referencia, assinaturas.entrada_referencia), entrada_em = coalesce(EXCLUDED.entrada_em, assinaturas.entrada_em)
       RETURNING *`, [lojaId, plano, observacao, por, ate || null, entrada?.valorCentavos ?? null, entrada?.referencia || null])).rows[0];
    await aplicarPlano(c, lojaId, plano, { primeiraVez: true });
    return a;
  }
  return (await c.query(`UPDATE assinaturas SET status = 'cancelada', cancelada_em = now(), observacao = $2, isenta_ate = NULL, proxima_cobranca = NULL, atualizada_em = now() WHERE loja_id = $1 AND status = 'isenta' RETURNING *`, [lojaId, observacao])).rows[0] || null;
}

/** v14.11 — isenções com prazo vencido viram 'pendente' (a loja volta à tela de assinatura para escolher a forma de pagamento). Avisa o e-mail de cobrança. */
export async function encerrarIsencoesVencidas(c) {
  const rows = (await c.query(`UPDATE assinaturas SET status = 'pendente', proxima_cobranca = NULL, atualizada_em = now() WHERE status = 'isenta' AND isenta_ate IS NOT NULL AND isenta_ate < $1::date RETURNING *`, [hoje()])).rows;
  for (const a of rows) {
    try { const d = await dadosParaEmail(c, a); if (d) await emailAviso({ para: d.para, nome: d.loja, assunto: 'Seu período liberado terminou', texto: `O período liberado da loja ${d.loja} no Conecta LocarX terminou em ${new Date(a.isenta_ate).toLocaleDateString('pt-BR')}. Para continuar usando, escolha a forma de pagamento da assinatura (cartão, Pix ou boleto) em ${d.link}. Qualquer dúvida, fale com a administração da rede.` }); }
    catch (err) { console.warn('[assinatura] aviso de isenção encerrada falhou:', err.message); }
  }
  return rows.length;
}

/** Pix novo para a fatura em aberto mais antiga (código vencido, ou loja atrasada/suspensa). */
export async function novoPix(c, lojaId) {
  const a = (await c.query('SELECT * FROM assinaturas WHERE loja_id = $1', [lojaId])).rows[0];
  if (!a || !['pendente', 'ativa', 'atrasada', 'suspensa'].includes(a.status)) throw erro(404, 'Esta loja não tem assinatura em aberto.');
  const f = (await c.query(`SELECT * FROM faturas_assinatura WHERE assinatura_id = $1 AND status IN ('pendente', 'vencida', 'falhou') ORDER BY vence_em NULLS LAST, criada_em LIMIT 1`, [a.id])).rows[0];
  if (!f) throw erro(404, 'Não há fatura em aberto.');
  const pedido = await pagarme.criarPedido({ clienteId: a.pagarme_cliente_id, forma: 'pix', valorCentavos: f.valor_centavos, descricao: `Conecta LocarX — ${PLANOS[a.plano].nome} (${f.referencia})`, codigo: `conecta-${a.loja_id.slice(0, 8)}-${f.referencia}-${Date.now().toString(36)}`, validadeSegundos: PIX_VALIDADE_SEGUNDOS, metadata: { loja_id: a.loja_id, referencia: f.referencia } });
  const nova = (await c.query(`UPDATE faturas_assinatura SET forma = 'pix', status = 'pendente', pagarme_pedido_id = $2, pagarme_cobranca_id = $3, pix_codigo = $4, pix_qr_url = $5, pix_expira_em = $6, boleto_url = NULL, boleto_linha = NULL WHERE id = $1 RETURNING *`,
    [f.id, pedido.id, pedido.cobrancaId, pedido.pix?.codigo || null, pedido.pix?.qrUrl || null, pedido.pix?.expiraEm || null])).rows[0];
  await avisarFatura(c, a, nova);
  return nova;
}

// ---------- webhook da Pagar.me ----------
/** Trata um evento (charge.paid, order.paid, invoice.paid, charge.payment_failed, invoice.payment_failed, subscription.canceled). Idempotente. */
export async function processarEvento(evento) {
  const tipo = evento?.type || ''; const d = evento?.data || {};
  return comoSistema(async (c) => {
    if (/^(charge|order)\.paid$/.test(tipo) || tipo === 'invoice.paid') {
      const cobrancaId = tipo.startsWith('charge') ? d.id : d.charges?.[0]?.id || d.charge?.id || null;
      const subId = d.subscription?.id || d.subscription_id || d.invoice?.subscription?.id || null;
      let f = cobrancaId ? (await c.query('SELECT * FROM faturas_assinatura WHERE pagarme_cobranca_id = $1', [cobrancaId])).rows[0] : null;
      if (!f && subId) {
        // renovação de assinatura (cartão/boleto): cria a fatura do ciclo se ainda não existe
        const a = (await c.query('SELECT * FROM assinaturas WHERE pagarme_assinatura_id = $1', [subId])).rows[0];
        if (!a) return { ignorado: 'assinatura desconhecida' };
        const ref = referenciaDe(d.paid_at || d.created_at || new Date(), a.ciclo);
        f = (await c.query(
          `INSERT INTO faturas_assinatura (assinatura_id, loja_id, referencia, valor_centavos, forma, status, pagarme_cobranca_id, pagarme_fatura_id, vence_em, detalhes)
           VALUES ($1, $2, $3, $4, $5, 'pendente', $6, $7, $8, $9) ON CONFLICT (assinatura_id, referencia) DO UPDATE SET pagarme_cobranca_id = coalesce(faturas_assinatura.pagarme_cobranca_id, EXCLUDED.pagarme_cobranca_id) RETURNING *`,
          [a.id, a.loja_id, ref, d.amount || a.valor_centavos, a.forma, cobrancaId, d.invoice?.id || (tipo === 'invoice.paid' ? d.id : null), hoje(), JSON.stringify({ evento: tipo })])).rows[0];
      }
      if (!f && cobrancaId) {
        // v14.12 — entrada da adesão (página pública) paga por Pix
        const ad = (await c.query('SELECT * FROM adesoes WHERE pagarme_cobranca_id = $1', [cobrancaId])).rows[0];
        if (ad) { const { marcarPaga } = await import('./adesao.js'); await marcarPaga(c, ad, { detalhes: { evento: tipo, pagarme_id: d.id } }); return { ok: true, adesao: ad.id }; }
      }
      if (!f) return { ignorado: 'cobrança desconhecida' };
      await confirmarFatura(c, f, { detalhes: { evento: tipo, pagarme_id: d.id } });
      return { ok: true, fatura: f.id };
    }
    if (/\.(payment_failed|refused)$/.test(tipo) || tipo === 'charge.underpaid') {
      const cobrancaId = d.id || d.charges?.[0]?.id;
      if (cobrancaId) await c.query(`UPDATE adesoes SET status = 'falhou', observacao = $2, atualizada_em = now() WHERE pagarme_cobranca_id = $1 AND status = 'aguardando'`, [cobrancaId, tipo]).catch(() => {});   // v14.12
      const f = cobrancaId ? (await c.query(`UPDATE faturas_assinatura SET status = 'falhou', detalhes = coalesce(detalhes, '{}'::jsonb) || $2::jsonb WHERE pagarme_cobranca_id = $1 AND status <> 'paga' RETURNING *`, [cobrancaId, JSON.stringify({ evento: tipo })])).rows[0] : null;
      const subId = d.subscription?.id || d.subscription_id || null;
      if (f) await c.query(`UPDATE assinaturas SET status = 'atrasada', atualizada_em = now() WHERE id = $1 AND status = 'ativa'`, [f.assinatura_id]);
      else if (subId) await c.query(`UPDATE assinaturas SET status = 'atrasada', atualizada_em = now() WHERE pagarme_assinatura_id = $1 AND status = 'ativa'`, [subId]);
      return { ok: true, falhou: true };
    }
    if (tipo === 'subscription.canceled') {
      await c.query(`UPDATE assinaturas SET status = 'cancelada', cancelada_em = now(), observacao = coalesce(observacao, 'Cancelada na Pagar.me'), atualizada_em = now() WHERE pagarme_assinatura_id = $1 AND status <> 'cancelada'`, [d.id]);
      return { ok: true };
    }
    return { ignorado: tipo };
  });
}

// ---------- rotina diária: faturas Pix e atraso ----------
export async function rodarCiclos() {
  let geradas = 0, atrasadas = 0, suspensas = 0, isencoes = 0;
  await comoSistema(async (c) => { isencoes = await encerrarIsencoesVencidas(c); const { expirarAntigas } = await import('./adesao.js'); await expirarAntigas(c); });   // v14.11/14.12 — roda mesmo sem a Pagar.me ligada
  if (!ligada()) return { geradas, atrasadas, suspensas, isencoes };
  await comoSistema(async (c) => {
    // Pix: gera a fatura do próximo ciclo 5 dias antes do vencimento
    const pix = (await c.query(`SELECT a.*, l.razao_social FROM assinaturas a JOIN lojas l ON l.id = a.loja_id WHERE a.status IN ('ativa', 'atrasada') AND a.forma = 'pix' AND a.proxima_cobranca <= ($1::date + $2::int)`, [hoje(), DIAS_ANTES_DO_VENCIMENTO])).rows;
    for (const a of pix) {
      const ref = referenciaDe(dataISO(a.proxima_cobranca), a.ciclo);
      const existe = (await c.query('SELECT 1 FROM faturas_assinatura WHERE assinatura_id = $1 AND referencia = $2', [a.id, ref])).rowCount;
      if (existe) continue;
      try {
        const pedido = await pagarme.criarPedido({ clienteId: a.pagarme_cliente_id, forma: 'pix', valorCentavos: a.valor_centavos, descricao: `Conecta LocarX — ${PLANOS[a.plano].nome} (${ref})`, codigo: `conecta-${a.loja_id.slice(0, 8)}-${ref}`, validadeSegundos: PIX_VALIDADE_SEGUNDOS, metadata: { loja_id: a.loja_id, referencia: ref } });
        await c.query(`INSERT INTO faturas_assinatura (assinatura_id, loja_id, referencia, valor_centavos, forma, status, pagarme_pedido_id, pagarme_cobranca_id, pix_codigo, pix_qr_url, pix_expira_em, vence_em, detalhes) VALUES ($1, $2, $3, $4, 'pix', 'pendente', $5, $6, $7, $8, $9, $10, $11)`,
          [a.id, a.loja_id, ref, a.valor_centavos, pedido.id, pedido.cobrancaId, pedido.pix?.codigo || null, pedido.pix?.qrUrl || null, pedido.pix?.expiraEm || null, a.proxima_cobranca, JSON.stringify({ origem: 'ciclo' })]);
        geradas++;
        await avisarFatura(c, a, { forma: 'pix', status: 'pendente', valor_centavos: a.valor_centavos, referencia: ref, vence_em: a.proxima_cobranca, pix_codigo: pedido.pix?.codigo || null });
      } catch (err) { console.warn('[assinatura] fatura Pix não gerada:', a.loja_id, err.message); }
    }
    // atraso: fatura pendente vencida há mais de 5 dias → assinatura atrasada (fatura marcada vencida)
    const r = await c.query(`UPDATE faturas_assinatura SET status = 'vencida' WHERE status = 'pendente' AND vence_em < ($1::date - $2::int) RETURNING assinatura_id`, [hoje(), DIAS_TOLERANCIA]);
    for (const row of r.rows) { await c.query(`UPDATE assinaturas SET status = 'atrasada', atualizada_em = now() WHERE id = $1 AND status = 'ativa'`, [row.assinatura_id]); atrasadas++; }
    // suspensão: fatura vencida/falhou há mais de N dias sem pagamento → suspensa (a loja cai na tela de assinatura até pagar)
    const s = await c.query(`UPDATE assinaturas a SET status = 'suspensa', atualizada_em = now()
       WHERE a.status = 'atrasada' AND EXISTS (SELECT 1 FROM faturas_assinatura f WHERE f.assinatura_id = a.id AND f.status IN ('vencida', 'falhou', 'pendente') AND f.vence_em < ($1::date - $2::int))
       RETURNING a.id`, [hoje(), diasBloqueio()]);
    suspensas = s.rowCount;
  });
  return { geradas, atrasadas, suspensas, isencoes };
}
