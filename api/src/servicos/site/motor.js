// Lia no chat do site ANTES da confirmação do WhatsApp: conversa e consulta (lojas, disponibilidade, preço), sem gravar nada no CRM
// nem no portal. O estado (loja, opções mostradas, cotação) fica em site_sessoes e vai para a conversa real quando o número é confirmado.
import { config } from '../../config.js';
import { comoSistema } from '../../banco/conexao.js';
import { decifrar } from '../seguranca.js';
import { conversarComIa } from '../ia/provedores.js';
import { simularIa } from '../ia/simulada.js';
import { montarSistema, paraWhatsApp } from '../ia/assistente.js';
import { ferramentasDaLoja } from '../locarx/ferramentas.js';
import { filiaisComPortal, filialPublica } from '../locarx/filiais.js';
import { registrarOcorrencia } from '../ocorrencias.js';
import { ferramentasDoSite, PERMITIDAS_ANTES } from './ferramentas-site.js';
import { descreverUi } from './ui.js';
import { lojasDoSite, cartoesDeLojas, cidadesDoSite, cidadesParaOSite, iaDoDiaEsgotada, registrarUsoIa } from './chat.js';

const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const rodando = new Set();
const MAX_MSG_SESSAO = 120;

export async function processarSite(sessaoId) {
  if (rodando.has(sessaoId)) { const { agendarSite } = await import('./chat.js'); return agendarSite(sessaoId, 1500); }
  rodando.add(sessaoId);
  try { await rodar(sessaoId); } finally { rodando.delete(sessaoId); }
}

async function responder(sessaoId, texto, ui, estado = null) {
  await comoSistema(async (c) => {
    await c.query(`INSERT INTO site_mensagens (sessao_id, papel, texto, ui) VALUES ($1, 'assistente', $2, $3)`, [sessaoId, texto || null, ui?.length ? JSON.stringify(ui) : null]);
    await c.query(
      `UPDATE site_sessoes SET respondida_em = now(),
              opcoes = CASE WHEN $2::boolean THEN $3::jsonb ELSE opcoes END,
              cotacao = CASE WHEN $4::boolean THEN $5::jsonb ELSE cotacao END,
              loja_id = coalesce($6, loja_id) WHERE id = $1`,
      [sessaoId, !!estado?.mudouOpcoes, estado?.opcoes ?? null, !!estado?.mudouCotacao, estado?.cotacao ?? null, estado?.lojaId ?? null]);
  });
}

async function rodar(sessaoId) {
  const prep = await comoSistema(async (c) => {
    const s = (await c.query('SELECT * FROM site_sessoes WHERE id = $1', [sessaoId])).rows[0];
    if (!s || s.conversa_id) return null;                              // já virou conversa: o motor normal cuida
    if (!s.pendente_desde || (s.respondida_em && s.respondida_em >= s.pendente_desde)) return null;   // nada novo
    const lojas = await lojasDoSite(c);
    const base = lojas.find((l) => l.id === s.loja_id) || lojas[0];
    if (!base) return { s, aviso: 'O chat está indisponível no momento.' };
    if (await iaDoDiaEsgotada(c)) return { s, aviso: 'Estamos com muitos atendimentos agora. Tente de novo em alguns minutos ou fale com a loja pelo WhatsApp.' };
    const nCliente = (await c.query(`SELECT count(*)::int AS n FROM site_mensagens WHERE sessao_id = $1 AND papel = 'cliente'`, [sessaoId])).rows[0].n;
    if (nCliente > MAX_MSG_SESSAO) return { s, aviso: 'Esta conversa ficou longa. Toque em "Nova conversa" para recomeçar ou fale com a loja pelo WhatsApp.' };
    const loja = (await c.query('SELECT * FROM lojas WHERE id = $1', [base.id])).rows[0];
    const a = (await c.query('SELECT * FROM assistentes WHERE loja_id = $1', [base.id])).rows[0];
    if (!a?.ativo || (!a.chave_cifrada && !config.iaSimulada)) return { s, aviso: 'O atendimento automático está indisponível agora. Fale com a loja pelo WhatsApp.' };
    const rede = (await c.query('SELECT * FROM rede_config LIMIT 1')).rows[0] || {};
    const filiais = (await filiaisComPortal(c, base.id)).map(filialPublica);
    const msgs = (await c.query(`SELECT papel, texto, ui FROM (SELECT papel, texto, ui, criada_em FROM site_mensagens WHERE sessao_id = $1 ORDER BY criada_em DESC LIMIT 30) x ORDER BY criada_em`, [sessaoId])).rows;
    return { s, loja, a, rede, filiais, msgs, lojasSite: lojas };
  });
  if (!prep) return;
  if (prep.aviso) { await responder(sessaoId, prep.aviso, null); return; }

  const { s, loja, a, rede, filiais, msgs, lojasSite } = prep;
  const estado = { opcoes: s.opcoes || null, cotacao: s.cotacao || null, lojaId: s.loja_id || (loja.central ? loja.id : null), mudouOpcoes: false, mudouCotacao: false };
  let lojaAtual = loja;

  const ctx = {
    lojaId: loja.id, branchId: s.opcoes?.branchId || loja.branch_id, branchEscolhido: !!s.opcoes?.branchId, filialNome: s.opcoes?.filialNome || null, filiais,
    conversaId: null, contatoId: null, telefone: null, locarxDisponivel: !!config.locarx, pixDisponivel: false, simulacao: true,
    campos: [], etiquetas: [], opcoesAnteriores: s.opcoes?.grupos || [], cotacao: s.cotacao || undefined, enviarDepois: [],
    canalSite: true, preVerificacao: true, ui: [], central: !!loja.central,
    aoMostrar: (u) => ctx.ui.push(u),
    aoGuardar: (tipo, valor) => {
      if (tipo === 'opcoes') { estado.opcoes = valor; estado.mudouOpcoes = true; }
      else if (tipo === 'opcoes_mesclar') { estado.opcoes = { ...(estado.opcoes || {}), ...valor }; estado.mudouOpcoes = true; }
      else if (tipo === 'cotacao') { estado.cotacao = valor; estado.mudouCotacao = true; }
    },
    aoChamarAtendente: async () => { if (!ctx.ui.some((u) => u.tipo === 'cadastro')) ctx.ui.push({ tipo: 'cadastro' }); },
    listarLojas: (cidade) => comoSistema((c) => cartoesDeLojas(c, cidade)),
    listarCidades: async () => (await comoSistema((c) => cidadesParaOSite(c))).map((x) => x.cidade),
    escolherLoja: async (nome) => {
      const q = semAcento(nome);
      const l = lojasSite.find((x) => semAcento(x.nome) === q) || lojasSite.find((x) => semAcento(x.nome).includes(q) || q.includes(semAcento(x.nome)));
      if (!l) return { ok: false, mensagem: `Loja "${nome}" não encontrada. Lojas do chat: ${lojasSite.map((x) => x.nome).join(', ')}.` };
      if (estado.lojaId !== l.id) { estado.opcoes = null; estado.cotacao = null; estado.mudouOpcoes = true; estado.mudouCotacao = true; ctx.cotacao = undefined; ctx.opcoesAnteriores = []; }
      estado.lojaId = l.id;
      ctx.lojaId = l.id; ctx.branchId = l.branch_id; ctx.branchEscolhido = false; ctx.filialNome = null;
      lojaAtual = (await comoSistema((c) => c.query('SELECT * FROM lojas WHERE id = $1', [l.id]))).rows[0] || lojaAtual;
      ctx.filiais = (await comoSistema(async (c) => filiaisComPortal(c, l.id))).map(filialPublica);
      return { ok: true, nome: l.nome };
    },
  };

  const SEM_LOJA = 'O cliente ainda não escolheu a loja de retirada. Chame mostrar_na_tela com tipo "lojas" (ou pergunte a cidade) e só consulte depois que ele escolher.';
  const ferramentas = ferramentasDaLoja(ctx)
    .filter((f) => PERMITIDAS_ANTES.includes(f.nome))
    .map((f) => (['consultar_disponibilidade', 'calcular_preco', 'dados_da_loja'].includes(f.nome)
      ? { ...f, executar: async (args) => (estado.lojaId ? f.executar(args) : SEM_LOJA) } : f));
  ferramentas.push(...ferramentasDoSite(ctx));
  ferramentas.push({
    nome: 'chamar_atendente',
    descricao: 'Quando o cliente quiser falar com uma pessoa ou o assunto exigir a equipe. Antes disso o cliente precisa confirmar o WhatsApp: esta ferramenta mostra o formulário de cadastro.',
    parametros: { type: 'object', properties: { motivo: { type: 'string' } }, required: ['motivo'] },
    executar: async () => { await ctx.aoChamarAtendente(); return 'O formulário de nome e WhatsApp foi mostrado na tela. Diga em uma frase que, depois de confirmar o número com o código, um atendente continua com ele.'; },
  });

  const cidadesSite = loja.central ? [] : cidadesDoSite(lojasSite).map((x) => x.cidade);   // Central: a lista é a da rede inteira (a Lia usa buscar_filiais)
  const historico = msgs.map((m) => ({ papel: m.papel === 'cliente' ? 'cliente' : 'assistente', texto: [m.texto, descreverUi(m.ui)].filter(Boolean).join(' ') })).filter((h) => h.texto);
  const inicio = Date.now();
  let resposta, erroIa = null;
  try {
    const sistema = montarSistema({
      loja: lojaAtual, a, rede, contato: { nome: null }, historicoReservas: [], crm: null,
      conversa: { opcoes: estado.opcoes, cotacao: estado.cotacao }, pix: false, filiais: ctx.filiais,
      site: { antes: true, lojaEscolhida: loja.central ? (estado.opcoes?.filialNome || null) : (estado.lojaId ? lojaAtual.nome : null), cidadesDisponiveis: cidadesSite },
    });
    const opcoes = { provedor: a.provedor, modelo: a.modelo, chave: a.chave_cifrada ? decifrar(a.chave_cifrada) : null, sistema, historico, ferramentas };
    resposta = config.iaSimulada ? await simularIa(opcoes) : await conversarComIa(opcoes);
  } catch (e) { erroIa = e; console.error('[site] IA:', e.message); }

  const eventos = resposta?.eventos || [];
  const falhas = eventos.filter((e) => e.erro);
  for (const e of falhas) {
    await registrarOcorrencia({ lojaId: lojaAtual.id, origem: 'assistente', tipo: e.tipo === 'ferramenta' && /disponibilidade|preco/.test(e.nome) ? 'cotacao' : 'ia', nivel: 'erro', mensagem: `[chat do site] ${e.tipo === 'ferramenta' ? `${e.nome} falhou: ${e.erro}` : e.erro}`, detalhes: e });
  }
  if (erroIa) await registrarOcorrencia({ lojaId: lojaAtual.id, origem: 'assistente', tipo: 'ia', nivel: 'erro', mensagem: `[chat do site] IA indisponível: ${String(erroIa.message).slice(0, 200)}`, detalhes: { provedor: a.provedor, modelo: a.modelo, status: erroIa.status || null } });
  await comoSistema(async (c) => {
    await registrarUsoIa(c);
    await c.query(
      `INSERT INTO uso_ia (loja_id, conversa_id, provedor, modelo, tokens_in, tokens_out, ferramentas, ok) VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)`,
      [lojaAtual.id, a.provedor, a.modelo, resposta?.uso?.entrada || 0, resposta?.uso?.saida || 0, resposta?.usadas || [], !erroIa && !falhas.length]);
  });

  let texto = resposta?.texto ? paraWhatsApp(resposta.texto) : '';
  if (erroIa || (!texto && !ctx.ui.length)) {
    texto = 'Desculpe, tive um problema para responder agora. Pode tentar de novo em instantes? Se preferir, fale com a loja pelo WhatsApp.';
  }
  await responder(sessaoId, texto, ctx.ui, estado);
}
