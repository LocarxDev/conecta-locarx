// v14.12 — Adesão pela página pública: o franqueado preenche os dados da loja e dos acessos e paga a entrada
// (cartão → assinatura recorrente na Pagar.me já criada; Pix → pedido avulso). Sem login: a página consulta a situação
// com uma chave aleatória devolvida na criação. A administração cria a loja a partir da adesão e "vincula": a assinatura
// nasce ativa (com os ids da Pagar.me), a fatura do 1º ciclo fica paga e os convites do gestor e do atendente saem.
import { createHash, randomBytes } from 'node:crypto';
import { erro } from '../../http.js';
import { config } from '../../config.js';
import { cnpjValido, soDigitos } from '../cnpj.js';
import { emailAviso } from '../email.js';
import * as pagarme from './pagarme.js';
import { ErroPagarme } from './pagarme.js';
import { PLANOS, FORMAS, valorDoPlano, referenciaDe, somarCiclo, planosPublicos } from './planos.js';
import { aplicarPlano } from './index.js';

const PIX_VALIDADE_SEGUNDOS = 2 * 24 * 3600;   // Pix da adesão vale 2 dias
const hoje = () => new Date().toISOString().slice(0, 10);
const hash = (s) => createHash('sha256').update(String(s)).digest('hex');
const UFS = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);

export const adesaoPublica = (a, { completa = false } = {}) => a ? ({
  id: a.id, status: a.status, nomeLoja: a.nome_loja, ciclo: a.ciclo, forma: a.forma, formaNome: FORMAS[a.forma] || a.forma, valor: a.valor_centavos / 100,
  plano: a.plano, planoNome: PLANOS[a.plano]?.nome || a.plano, pagaEm: a.paga_em, criadaEm: a.criada_em,
  pix: a.forma === 'pix' && a.pix_codigo && a.status === 'aguardando' ? { codigo: a.pix_codigo, qrUrl: a.pix_qr_url, expiraEm: a.pix_expira_em } : null,
  cartao: a.cartao_final ? { final: a.cartao_final, bandeira: a.cartao_bandeira } : null,
  gestorEmail: a.gestor_email,
  ...(completa ? {
    cnpj: a.cnpj, razaoSocial: a.razao_social, endereco: a.endereco, cep: a.cep, cidade: a.cidade, uf: a.uf, whatsapp: a.whatsapp,
    gestorNome: a.gestor_nome, atendenteNome: a.atendente_nome, atendenteEmail: a.atendente_email, particularidades: a.particularidades,
    lojaId: a.loja_id, observacao: a.observacao, pagarme: { clienteId: a.pagarme_cliente_id, assinaturaId: a.pagarme_assinatura_id, pedidoId: a.pagarme_pedido_id, cobrancaId: a.pagarme_cobranca_id }, ip: a.ip, atualizadaEm: a.atualizada_em,
  } : {}),
}) : null;

/** O que a página pública precisa para montar o formulário. */
export function dadosPublicos() {
  return { ligada: pagarme.ligado(), simulado: pagarme.simulado(), chavePublica: config.pagarme?.chavePublica || null, turnstile: config.adesao?.turnstileSecret ? config.adesao.turnstileChave : null, planos: planosPublicos(), formas: ['cartao', 'pix'] };
}

async function verificarDesafio(token, ip) {
  if (!config.adesao?.turnstileSecret) return true;
  if (!token) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: config.adesao.turnstileSecret, response: String(token).slice(0, 2100), remoteip: ip || '' }), signal: AbortSignal.timeout(8000),
    });
    return !!(await r.json()).success;
  } catch { return false; }
}

/** Separa "Cidade / UF" ou "Cidade - UF" quando vier assim; senão deixa para a administração. */
export function cidadeUfDe(texto) {
  const m = String(texto || '').match(/^(.{2,80}?)\s*[\/\-–,]\s*([A-Za-z]{2})\s*$/);
  if (m && UFS.has(m[2].toUpperCase())) return { cidade: m[1].trim(), uf: m[2].toUpperCase() };
  return { cidade: null, uf: null };
}

/** Cria a adesão e cobra a entrada. `d` já validado pela rota. */
export async function criar(c, d, { ip, desafio } = {}) {
  if (!pagarme.ligado()) throw erro(503, 'A adesão online ainda não está disponível. Fale com a administração da rede.');
  if (!(await verificarDesafio(desafio, ip))) throw erro(422, 'Não foi possível confirmar que você não é um robô. Recarregue a página e tente de novo.', { desafio: 'Confirmação pendente.' });
  const cnpj = soDigitos(d.cnpj);
  if (!cnpjValido(cnpj)) throw erro(422, 'Confira os campos destacados.', { cnpj: 'CNPJ inválido.' });
  const jaLoja = (await c.query('SELECT nome FROM lojas WHERE cnpj = $1', [cnpj])).rows[0];
  if (jaLoja) throw erro(409, 'Já existe uma loja com este CNPJ no Conecta. Se você é o gestor dela, entre com seu acesso; se precisar de ajuda, fale com a administração da rede.', { cnpj: 'CNPJ já cadastrado.' });
  const pendente = (await c.query(`SELECT * FROM adesoes WHERE cnpj = $1 AND status IN ('paga', 'loja_criada') ORDER BY criada_em DESC LIMIT 1`, [cnpj])).rows[0];
  if (pendente) throw erro(409, 'Já recebemos uma adesão paga para este CNPJ. A administração vai criar o acesso em até 1 dia útil; se já passou, fale com a rede.', { cnpj: 'Adesão já paga.' });
  const emailGestor = d.gestorEmail.toLowerCase();
  if ((await c.query('SELECT 1 FROM usuarios WHERE email = $1', [emailGestor])).rowCount) throw erro(422, 'Confira os campos destacados.', { gestorEmail: 'Este e-mail já tem acesso ao Conecta. Entre com ele ou informe outro.' });
  if (d.atendenteEmail && d.atendenteEmail.toLowerCase() === emailGestor) throw erro(422, 'Confira os campos destacados.', { atendenteEmail: 'Use um e-mail diferente do gestor.' });

  const plano = 'basico', valor = valorDoPlano(plano, d.ciclo);
  const descricao = `Conecta LocarX — ${PLANOS[plano].nome} (${d.ciclo}) — adesão`;
  const { cidade, uf } = cidadeUfDe(d.cidadeUf || '');
  const chave = randomBytes(24).toString('base64url');
  // reaproveita cliente da Pagar.me de uma tentativa anterior do mesmo CNPJ (falhou/expirou)
  const anterior = (await c.query(`SELECT pagarme_cliente_id FROM adesoes WHERE cnpj = $1 AND pagarme_cliente_id IS NOT NULL ORDER BY criada_em DESC LIMIT 1`, [cnpj])).rows[0];
  const a = (await c.query(
    `INSERT INTO adesoes (chave_hash, nome_loja, cnpj, razao_social, endereco, cep, cidade, uf, whatsapp, gestor_nome, gestor_email, atendente_nome, atendente_email, particularidades, plano, ciclo, forma, valor_centavos, status, pagarme_cliente_id, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'aguardando', $19, $20) RETURNING *`,
    [hash(chave), d.nomeLoja, cnpj, d.razaoSocial, d.endereco, soDigitos(d.cep), cidade, uf, soDigitos(d.whatsapp), d.gestorNome, emailGestor, d.atendenteNome || null, d.atendenteEmail?.toLowerCase() || null, d.particularidades || null, plano, d.ciclo, d.forma, valor, anterior?.pagarme_cliente_id || null, ip || null])).rows[0];

  let clienteId = a.pagarme_cliente_id, cartao = null, sub = null, pedido = null;
  try {
    if (!clienteId) clienteId = (await pagarme.criarCliente({ nome: d.razaoSocial, email: emailGestor, cnpj, telefone: d.whatsapp, endereco: { line_1: d.endereco, cidade: cidade || '', uf: uf || '' }, cep: d.cep, codigo: `adesao-${a.id}` })).id;
    const codigo = `adesao-${a.id.slice(0, 8)}-${Date.now().toString(36)}`;
    if (d.forma === 'cartao') {
      cartao = await pagarme.salvarCartao(clienteId, d.cardToken);
      sub = await pagarme.criarAssinatura({ clienteId, cartaoId: cartao.id, forma: 'cartao', valorCentavos: valor, descricao, ciclo: d.ciclo, codigo, metadata: { adesao_id: a.id, plano, ciclo: d.ciclo } });
    } else {
      pedido = await pagarme.criarPedido({ clienteId, forma: 'pix', valorCentavos: valor, descricao, codigo, validadeSegundos: PIX_VALIDADE_SEGUNDOS, metadata: { adesao_id: a.id, plano, ciclo: d.ciclo } });
    }
  } catch (err) {
    await c.query(`UPDATE adesoes SET status = 'falhou', pagarme_cliente_id = $2, observacao = $3, atualizada_em = now() WHERE id = $1`, [a.id, clienteId, String(err.message).slice(0, 300)]).catch(() => {});
    if (err instanceof ErroPagarme) { console.error('[adesao] Pagar.me recusou:', err.message, JSON.stringify(err.corpo?.errors || {})); throw erro(422, err.message); }
    throw err;
  }
  const ativaJa = d.forma === 'cartao' && sub?.status === 'active';
  const atual = (await c.query(
    `UPDATE adesoes SET status = $2, pagarme_cliente_id = $3, pagarme_assinatura_id = $4, pagarme_cartao_id = $5, cartao_final = $6, cartao_bandeira = $7, pagarme_pedido_id = $8, pagarme_cobranca_id = $9, pix_codigo = $10, pix_qr_url = $11, pix_expira_em = $12, paga_em = $13, atualizada_em = now() WHERE id = $1 RETURNING *`,
    [a.id, ativaJa ? 'paga' : 'aguardando', clienteId, sub?.id || null, cartao?.id || null, cartao?.final || null, cartao?.bandeira || null, pedido?.id || null, pedido?.cobrancaId || null, pedido?.pix?.codigo || null, pedido?.pix?.qrUrl || null, pedido?.pix?.expiraEm || null, ativaJa ? new Date() : null])).rows[0];
  if (ativaJa) await avisarPaga(c, atual);
  return { adesao: atual, chave };
}

/** Consulta sem login: só com a chave devolvida na criação. */
export async function consultar(c, id, chave) {
  const a = (await c.query('SELECT * FROM adesoes WHERE id = $1', [id])).rows[0];
  if (!a || !chave || a.chave_hash !== hash(chave)) throw erro(404, 'Adesão não encontrada.');
  return a;
}

/** Marca a adesão como paga a partir do webhook (Pix) ou da confirmação manual. Idempotente. */
export async function marcarPaga(c, a, { detalhes = null } = {}) {
  if (a.status === 'paga' || a.status === 'loja_criada') return a;
  const atual = (await c.query(`UPDATE adesoes SET status = 'paga', paga_em = coalesce(paga_em, now()), observacao = coalesce($2, observacao), atualizada_em = now() WHERE id = $1 RETURNING *`, [a.id, detalhes ? JSON.stringify(detalhes).slice(0, 300) : null])).rows[0];
  await avisarPaga(c, atual);
  return atual;
}

async function avisarPaga(c, a) {
  const linkEntrar = `${config.appUrl}/#/login`;
  try {
    await emailAviso({ para: a.gestor_email, nome: a.gestor_nome, assunto: 'Recebemos sua adesão ao Conecta LocarX',
      texto: `Recebemos o pagamento da adesão da loja ${a.nome_loja} (${PLANOS[a.plano]?.nome || a.plano}, ${a.ciclo}). A administração da rede vai criar o acesso da sua loja em até 1 dia útil e você recebe o convite neste e-mail (${a.gestor_email}). Enquanto isso, separe o celular que vai ficar com o WhatsApp da loja (número exclusivo, sem outras ferramentas) e desligue as mensagens automáticas do aparelho. Já tem acesso? Entre em ${linkEntrar}.` });
  } catch (err) { console.warn('[adesao] e-mail ao gestor falhou:', err.message); }
  try {
    const admins = (await c.query(`SELECT email, nome FROM usuarios WHERE perfil = 'admin' AND status = 'ativo'`)).rows;
    for (const ad of admins) {
      await emailAviso({ para: ad.email, nome: ad.nome, assunto: `Nova adesão paga: ${a.nome_loja}`,
        texto: `${a.nome_loja} (CNPJ ${a.cnpj}) pagou a adesão — ${PLANOS[a.plano]?.nome || a.plano}, ${a.ciclo}, ${FORMAS[a.forma] || a.forma}, R$ ${(a.valor_centavos / 100).toFixed(2).replace('.', ',')}. Gestor: ${a.gestor_nome} <${a.gestor_email}>. Crie a loja em ${config.appUrl}/#/adesoes.` }).catch(() => {});
    }
  } catch (err) { console.warn('[adesao] aviso aos administradores falhou:', err.message); }
}

/** Administração: liga a adesão paga a uma loja já criada — assinatura ativa com os ids da Pagar.me, 1ª fatura paga, convites. */
export async function vincular(c, adesaoId, lojaId, { gerarConvite, emailConvite, por = null } = {}) {
  const a = (await c.query('SELECT * FROM adesoes WHERE id = $1', [adesaoId])).rows[0];
  if (!a) throw erro(404, 'Adesão não encontrada.');
  if (a.status === 'loja_criada') throw erro(409, 'Esta adesão já virou loja.');
  if (a.status !== 'paga') throw erro(409, 'Esta adesão ainda não foi paga. Se o pagamento já caiu, use "Marcar como paga" antes.');
  const loja = (await c.query('SELECT * FROM lojas WHERE id = $1', [lojaId])).rows[0];
  if (!loja) throw erro(404, 'Loja não encontrada.');
  const outra = (await c.query('SELECT * FROM assinaturas WHERE loja_id = $1', [lojaId])).rows[0];
  if (outra && ['ativa', 'atrasada', 'suspensa', 'isenta', 'pendente'].includes(outra.status)) throw erro(409, 'Esta loja já tem assinatura. Escolha a loja criada para esta adesão.');

  const inicio = a.paga_em ? new Date(a.paga_em).toISOString().slice(0, 10) : hoje();
  const prox = somarCiclo(inicio, a.ciclo);
  const ass = (await c.query(
    `INSERT INTO assinaturas (loja_id, plano, ciclo, forma, status, valor_centavos, pagarme_cliente_id, pagarme_assinatura_id, pagarme_cartao_id, cartao_final, cartao_bandeira, inicio_em, proxima_cobranca, criada_por, observacao, entrada_valor_centavos, entrada_referencia, entrada_em)
     VALUES ($1, $2, $3, $4, 'ativa', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $5, $15, $16)
     ON CONFLICT (loja_id) DO UPDATE SET plano = EXCLUDED.plano, ciclo = EXCLUDED.ciclo, forma = EXCLUDED.forma, status = 'ativa', valor_centavos = EXCLUDED.valor_centavos,
       pagarme_cliente_id = EXCLUDED.pagarme_cliente_id, pagarme_assinatura_id = EXCLUDED.pagarme_assinatura_id, pagarme_cartao_id = EXCLUDED.pagarme_cartao_id, cartao_final = EXCLUDED.cartao_final, cartao_bandeira = EXCLUDED.cartao_bandeira,
       inicio_em = EXCLUDED.inicio_em, proxima_cobranca = EXCLUDED.proxima_cobranca, criada_por = EXCLUDED.criada_por, observacao = EXCLUDED.observacao, cancelada_em = NULL, isenta_ate = NULL,
       entrada_valor_centavos = EXCLUDED.entrada_valor_centavos, entrada_referencia = EXCLUDED.entrada_referencia, entrada_em = EXCLUDED.entrada_em, atualizada_em = now()
     RETURNING *`,
    [lojaId, a.plano, a.ciclo, a.forma, a.valor_centavos, a.pagarme_cliente_id, a.pagarme_assinatura_id, a.pagarme_cartao_id, a.cartao_final, a.cartao_bandeira, a.paga_em || new Date(), prox, por, 'adesão pela página pública', a.pagarme_cobranca_id || a.pagarme_assinatura_id || null, a.paga_em || new Date()])).rows[0];
  const ref = referenciaDe(inicio, a.ciclo);
  await c.query(
    `INSERT INTO faturas_assinatura (assinatura_id, loja_id, referencia, valor_centavos, forma, status, pagarme_pedido_id, pagarme_cobranca_id, pagarme_fatura_id, vence_em, paga_em, detalhes)
     VALUES ($1, $2, $3, $4, $5, 'paga', $6, $7, $8, $9, $10, $11)
     ON CONFLICT (assinatura_id, referencia) DO UPDATE SET status = 'paga', paga_em = EXCLUDED.paga_em, pagarme_cobranca_id = coalesce(faturas_assinatura.pagarme_cobranca_id, EXCLUDED.pagarme_cobranca_id)`,
    [ass.id, lojaId, ref, a.valor_centavos, a.forma, a.pagarme_pedido_id, a.pagarme_cobranca_id, a.pagarme_assinatura_id, inicio, a.paga_em || new Date(), JSON.stringify({ origem: 'adesao', adesao_id: a.id })]);
  await aplicarPlano(c, lojaId, a.plano, { primeiraVez: true });

  // convites (gestor e atendente); e-mail já usado → só registra o aviso
  const convites = [];
  const convidar = async (nome, email, perfil) => {
    if (!email) return;
    const existe = (await c.query('SELECT id FROM usuarios WHERE email = $1', [email])).rows[0];
    if (existe) { convites.push({ email, perfil, aviso: 'já tinha acesso; não convidado' }); return; }
    const novo = (await c.query(`INSERT INTO usuarios (nome, email, perfil, loja_id, status) VALUES ($1, $2, $3, $4, 'convidado') RETURNING *`, [nome, email, perfil, lojaId])).rows[0];
    await c.query('INSERT INTO usuario_lojas (usuario_id, loja_id, perfil) VALUES ($1, $2, $3) ON CONFLICT (usuario_id, loja_id) DO UPDATE SET perfil = EXCLUDED.perfil', [novo.id, lojaId, perfil]);
    const link = await gerarConvite(c, novo.id);
    const enviado = await emailConvite({ para: email, nome, link, loja: loja.nome }).catch(() => false);
    convites.push({ email, perfil, link, emailEnviado: enviado });
  };
  await convidar(a.gestor_nome, a.gestor_email, 'dono');
  await convidar(a.atendente_nome || 'Atendente', a.atendente_email, 'atendente');

  const fim = (await c.query(`UPDATE adesoes SET status = 'loja_criada', loja_id = $2, atualizada_em = now() WHERE id = $1 RETURNING *`, [a.id, lojaId])).rows[0];
  return { adesao: fim, assinatura: ass, convites };
}

/** Rotina: Pix da adesão vencido há mais de 2 dias → expirada (a pessoa pode aderir de novo). */
export async function expirarAntigas(c) {
  return (await c.query(`UPDATE adesoes SET status = 'expirada', atualizada_em = now() WHERE status = 'aguardando' AND forma = 'pix' AND coalesce(pix_expira_em, criada_em + interval '2 days') < now() - interval '2 days'`)).rowCount;
}
