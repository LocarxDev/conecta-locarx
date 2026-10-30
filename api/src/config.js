// Configuração lida das variáveis de ambiente (Railway → Variables).
// Nenhum segredo fica no código: se faltar algo obrigatório, a API nem sobe.

function obrigatoria(nome) {
  const v = process.env[nome];
  if (!v || !v.trim()) throw new Error(`Variável de ambiente ${nome} não configurada.`);
  return v.trim();
}

const producao = process.env.NODE_ENV === 'production';

const chave = Buffer.from(obrigatoria('CHAVE_CRIPTOGRAFIA'), 'base64');
if (chave.length !== 32) throw new Error('CHAVE_CRIPTOGRAFIA precisa ter 32 bytes em base64 (gere com: openssl rand -base64 32).');

export const config = {
  producao,
  porta: Number(process.env.PORT) || 3000,
  bancoUrl: obrigatoria('DATABASE_URL'),
  bancoSsl: process.env.PGSSL === 'disable' ? false : (process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : false),
  chaveCriptografia: chave,
  appUrl: obrigatoria('APP_URL').replace(/\/+$/, ''),
  origensPermitidas: obrigatoria('FRONTEND_ORIGINS').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean),
  confiarProxy: Number(process.env.TRUST_PROXY ?? 2),
  resendKey: process.env.RESEND_API_KEY?.trim() || null,
  emailRemetente: process.env.EMAIL_FROM?.trim() || 'Conecta LocarX <nao-responder@send.locarx.com.br>',
  sessaoInatividadeHoras: Number(process.env.SESSAO_INATIVIDADE_HORAS) || 12,
  sessaoMaximaDias: Number(process.env.SESSAO_MAXIMA_DIAS) || 7,
  adminInicial: process.env.ADMIN_INICIAL_EMAIL
    ? { email: process.env.ADMIN_INICIAL_EMAIL.trim().toLowerCase(), nome: process.env.ADMIN_INICIAL_NOME?.trim() || 'Administrador' }
    : null,
  // WhatsApp pela Evolution API (etapa 2). Sem EVOLUTION_URL, as telas de WhatsApp avisam que não está configurado.
  evolution: process.env.EVOLUTION_URL ? {
    url: process.env.EVOLUTION_URL.trim().replace(/\/+$/, ''),
    chave: obrigatoria('EVOLUTION_API_KEY'),
    // endereço pelo qual a Evolution enxerga esta API (rede interna do Railway)
    webhookBase: obrigatoria('WEBHOOK_BASE_URL').replace(/\/+$/, ''),
    segredoWebhook: (() => {
      const s = obrigatoria('WEBHOOK_SEGREDO');
      if (s.length < 32 || !/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('WEBHOOK_SEGREDO precisa ter 32+ caracteres (letras, números, - ou _). Gere com: openssl rand -hex 32');
      return s;
    })(),
  } : null,
  // API LocarX (etapa 4): um token só para todas as lojas, com acesso de parceiro
  locarx: process.env.LOCARX_API_TOKEN ? {
    url: (process.env.LOCARX_API_URL || 'https://api.locarx.com.br/api').trim().replace(/\/+$/, ''),
    token: process.env.LOCARX_API_TOKEN.trim(),
  } : null,
  // Pagamento Pix pelo WhatsApp (AbacatePay). Uma chave da REDE: tudo cai na conta do franqueador, que repassa às lojas.
  // Sem ABACATEPAY_API_KEY o pagamento online fica desligado (o assistente nem oferece).
  // Também é possível cada loja ter a própria conta AbacatePay (chave cadastrada no Conecta, cifrada): aí a chave da rede
  // é opcional, mas o ABACATEPAY_WEBHOOK_SECRET continua obrigatório (o webhook é um só, cadastrado em cada conta).
  abacatepay: process.env.ABACATEPAY_API_KEY || process.env.ABACATEPAY_WEBHOOK_SECRET ? {
    chave: process.env.ABACATEPAY_API_KEY?.trim() || null,
    url: (process.env.ABACATEPAY_URL || 'https://api.abacatepay.com/v2').trim().replace(/\/+$/, ''),
    // segredo do webhook: vai na URL cadastrada no painel do AbacatePay (…/api/webhooks/abacatepay/<segredo>?webhookSecret=<segredo>)
    segredoWebhook: (() => {
      const s = obrigatoria('ABACATEPAY_WEBHOOK_SECRET');
      if (s.length < 32 || !/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('ABACATEPAY_WEBHOOK_SECRET precisa ter 32+ caracteres (letras, números, - ou _). Gere com: openssl rand -hex 32');
      return s;
    })(),
    // chave pública da AbacatePay para conferir o header X-Webhook-Signature (HMAC-SHA256 base64) — copiada da documentação de webhooks.
    // Opcional: sem ela só o segredo da URL é conferido (e o log avisa).
    chavePublica: process.env.ABACATEPAY_PUBLIC_KEY?.trim() || null,
    validadeMinutos: Number(process.env.PIX_VALIDADE_MINUTOS) || 30,
  } : null,
  // Servidor MCP (LocarX Tools para outros sistemas, ex.: Lia I.A. e chat do site). Desligado sem MCP_TOKEN.
  mcpToken: process.env.MCP_TOKEN && process.env.MCP_TOKEN.length >= 32 ? process.env.MCP_TOKEN : null,
  // Chat do site (widget no site da LocarX). Origens dos sites que podem abrir o chat (ex.: https://www.locarx.com.br,https://teste.exemplo.com).
  // Sem SITE_ORIGENS o chat do site fica desligado. TURNSTILE_SECRET (Cloudflare) é opcional: com ele, o código por WhatsApp só sai para quem passou no desafio.
  site: process.env.SITE_ORIGENS ? {
    origens: process.env.SITE_ORIGENS.split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean),
    turnstileSecret: process.env.TURNSTILE_SECRET?.trim() || null,
    turnstileChave: process.env.TURNSTILE_SITEKEY?.trim() || null,
    limiteIaDia: Number(process.env.SITE_LIMITE_IA_DIA) || 1500,
    limiteCodigosDia: Number(process.env.SITE_LIMITE_CODIGOS_DIA) || 300,
    diasSessao: Number(process.env.SITE_DIAS_SESSAO) || 30,
  } : null,
  // Instagram das lojas (API oficial da Meta). Um app da LocarX para a rede; cada loja conecta a própria conta.
  // Desligado sem INSTAGRAM_APP_ID + INSTAGRAM_APP_SECRET. INSTAGRAM_VERIFY_TOKEN é o "Verificar token" do webhook (você escolhe).
  instagram: process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET ? {
    appId: process.env.INSTAGRAM_APP_ID.trim(),
    appSecret: process.env.INSTAGRAM_APP_SECRET.trim(),
    configId: process.env.INSTAGRAM_CONFIG_ID?.trim() || null,
    verifyToken: process.env.INSTAGRAM_VERIFY_TOKEN?.trim() || null,
    versaoGraph: process.env.INSTAGRAM_GRAPH_VERSION?.trim() || 'v21.0',
  } : null,
  // Só para testes no computador: IA simulada, sem chamar Anthropic/OpenAI
  iaSimulada: process.env.IA_SIMULADA === '1' && !producao,
  // Em desenvolvimento local (http://localhost) o cookie não pode ter o prefixo __Host- nem Secure.
  cookieSeguro: process.env.COOKIE_INSEGURO_LOCAL !== '1',
};
