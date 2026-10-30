// Instagram das lojas — API oficial da Meta (Graph API / Instagram Messaging).
// Um app da LocarX para a rede inteira; cada loja autoriza a própria conta profissional (vinculada a uma Página do Facebook)
// pelo "Login do Facebook para Empresas". Guardamos, por loja, o token da Página (cifrado) e o ID da conta do Instagram.
// Um webhook só recebe as mensagens de todas as contas; o ID da conta diz de qual loja é.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../../config.js';
import { cifrar, decifrar } from '../seguranca.js';

const cfg = () => config.instagram;
const GRAPH = () => `https://graph.facebook.com/${cfg().versaoGraph}`;
const PERMISSOES = ['instagram_basic', 'instagram_manage_messages', 'pages_show_list', 'pages_manage_metadata', 'business_management'];

export const instagramConfigurado = () => !!cfg();

async function graph(metodo, caminho, { token, corpo, query } = {}) {
  const url = new URL(`${GRAPH()}${caminho}`);
  for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, String(v));
  if (token) url.searchParams.set('access_token', token);
  const r = await fetch(url, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const texto = await r.text();
  let d = null; try { d = texto ? JSON.parse(texto) : null; } catch { d = { bruto: texto.slice(0, 300) }; }
  if (!r.ok) {
    const e = new Error(d?.error?.message || `Meta respondeu ${r.status}`);
    e.status = r.status; e.codigo = d?.error?.code || null; e.subcodigo = d?.error?.error_subcode || null; e.resposta = d;
    throw e;
  }
  return d;
}

// ---------- login da loja (OAuth) ----------
// `state` assinado: diz qual loja está autorizando e expira em 15 min — o retorno não aceita state forjado.
function assinar(texto) { return createHmac('sha256', cfg().appSecret).update(texto).digest('base64url'); }
export function gerarState({ lojaId, usuarioId, origem }) {
  const corpo = Buffer.from(JSON.stringify({ l: lojaId, u: usuarioId, o: origem, e: Date.now() + 15 * 60_000, n: randomBytes(6).toString('hex') })).toString('base64url');
  return `${corpo}.${assinar(corpo)}`;
}
export function lerState(state) {
  const [corpo, ass] = String(state || '').split('.');
  if (!corpo || !ass) return null;
  const esperado = assinar(corpo);
  if (esperado.length !== ass.length || !timingSafeEqual(Buffer.from(esperado), Buffer.from(ass))) return null;
  try {
    const d = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
    if (!d.l || !d.e || d.e < Date.now()) return null;
    return { lojaId: d.l, usuarioId: d.u || null, origem: d.o || null };
  } catch { return null; }
}

export function urlDeRetorno(origem) { return `${origem || config.appUrl}/api/instagram/retorno`; }

export function urlDeLogin({ state, origem }) {
  const u = new URL('https://www.facebook.com/dialog/oauth');
  u.searchParams.set('client_id', cfg().appId);
  if (cfg().configId) u.searchParams.set('config_id', cfg().configId);
  u.searchParams.set('redirect_uri', urlDeRetorno(origem));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', state);
  u.searchParams.set('scope', PERMISSOES.join(','));
  return u.toString();
}

// code → token do usuário (curto) → token longo (60 dias) → Páginas do usuário com a conta do Instagram ligada.
export async function trocarCodigo({ code, origem }) {
  const curto = await graph('GET', '/oauth/access_token', { query: { client_id: cfg().appId, client_secret: cfg().appSecret, redirect_uri: urlDeRetorno(origem), code } });
  const longo = await graph('GET', '/oauth/access_token', { query: { grant_type: 'fb_exchange_token', client_id: cfg().appId, client_secret: cfg().appSecret, fb_exchange_token: curto.access_token } });
  const tokenUsuario = longo.access_token || curto.access_token;
  const paginas = await graph('GET', '/me/accounts', { token: tokenUsuario, query: { fields: 'id,name,access_token,instagram_business_account{id,username}', limit: 50 } });
  const comIg = (paginas.data || []).filter((p) => p.instagram_business_account?.id);
  return { tokenUsuario, paginas: comIg.map((p) => ({ paginaId: p.id, paginaNome: p.name, tokenPagina: p.access_token, igUserId: p.instagram_business_account.id, igUsername: p.instagram_business_account.username || null })) };
}

// Assina a Página no app para receber os eventos de mensagem do Instagram
export async function assinarPagina({ paginaId, tokenPagina }) {
  return graph('POST', `/${paginaId}/subscribed_apps`, { token: tokenPagina, query: { subscribed_fields: 'messages,messaging_postbacks' } });
}

// Token da Página não expira enquanto a Página existir e o usuário continuar com acesso (quando vem de um token longo).
export const guardarToken = (tokenPagina) => cifrar(tokenPagina);
const tokenDe = (canal) => decifrar(canal.token_cifrado);

// ---------- envio ----------
export async function enviarTexto(canal, igsidDestino, texto) {
  const d = await graph('POST', `/${canal.ig_user_id}/messages`, { token: tokenDe(canal), corpo: { recipient: { id: igsidDestino }, message: { text: String(texto).slice(0, 1000) } } });
  return d?.message_id || null;
}
// fora da janela de 24 h a Meta exige a tag de atendimento humano (só a equipe usa; vale por 7 dias)
export async function enviarTextoHumano(canal, igsidDestino, texto) {
  const d = await graph('POST', `/${canal.ig_user_id}/messages`, { token: tokenDe(canal), corpo: { recipient: { id: igsidDestino }, message: { text: String(texto).slice(0, 1000) }, messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' } });
  return d?.message_id || null;
}
export async function enviarImagem(canal, igsidDestino, url) {
  const d = await graph('POST', `/${canal.ig_user_id}/messages`, { token: tokenDe(canal), corpo: { recipient: { id: igsidDestino }, message: { attachment: { type: 'image', payload: { url } } } } });
  return d?.message_id || null;
}

// nome/usuário de quem escreveu (para o contato no CRM)
export async function perfilDoCliente(canal, igsid) {
  try { return await graph('GET', `/${igsid}`, { token: tokenDe(canal), query: { fields: 'name,username' } }); }
  catch { return null; }
}

// ---------- webhook ----------
export function verificarAssinatura(corpoBruto, cabecalho) {
  if (!cabecalho || !cabecalho.startsWith('sha256=')) return false;
  const esperado = 'sha256=' + createHmac('sha256', cfg().appSecret).update(corpoBruto).digest('hex');
  return esperado.length === cabecalho.length && timingSafeEqual(Buffer.from(esperado), Buffer.from(cabecalho));
}

/** Converte um evento `messaging` do webhook em mensagem do Conecta. Devolve null para o que não interessa (eco, leitura, reação). */
export function lerMensagem(ev) {
  if (!ev?.sender?.id || !ev.message) return null;
  if (ev.message.is_echo) return null;                 // mensagem que a própria loja enviou (pela API ou pelo app do Instagram)
  if (ev.message.is_deleted || ev.message.is_unsupported) return null;
  const base = { igId: String(ev.sender.id), externoId: ev.message.mid || null, deMim: false, telefone: null, nome: null };
  const anexo = ev.message.attachments?.[0];
  if (ev.message.text) return { ...base, tipo: 'texto', texto: String(ev.message.text).slice(0, 4000), midia: null };
  if (anexo) {
    const tipo = { image: 'imagem', video: 'video', audio: 'audio', file: 'documento', story_mention: 'imagem', share: 'outro', ig_reel: 'video' }[anexo.type] || 'outro';
    return { ...base, tipo, texto: anexo.type === 'story_mention' ? '[mencionou a loja em um story]' : null, midia: anexo.payload?.url ? { url: anexo.payload.url, tipo: anexo.type } : null };
  }
  return null;
}

// Avisos amigáveis para erros comuns da Meta
export function explicarErro(e) {
  if (e?.codigo === 190) return 'A autorização do Instagram venceu ou foi removida. Conecte o Instagram de novo.';
  if (e?.codigo === 10 && /outside/i.test(e.message || '')) return 'Fora da janela de 24 h do Instagram: só é possível responder depois que o cliente escrever de novo.';
  if (e?.codigo === 551) return 'Esta pessoa não está disponível no Instagram agora.';
  return e?.message || 'Falha ao falar com o Instagram.';
}
