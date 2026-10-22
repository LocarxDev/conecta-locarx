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
  // Em desenvolvimento local (http://localhost) o cookie não pode ter o prefixo __Host- nem Secure.
  cookieSeguro: process.env.COOKIE_INSEGURO_LOCAL !== '1',
};
