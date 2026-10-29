// Inicialização: prepara o banco, cria o primeiro administrador (se configurado) e sobe a API.
import { config } from './config.js';
import { migrar, comoSistema, pool } from './banco/conexao.js';
import { novoToken, hashToken } from './servicos/seguranca.js';
import { emailConvite } from './servicos/email.js';
import { criarApp } from './app.js';
import { iniciarVarreduras } from './servicos/ia/assistente.js';
import { iniciarAutomacoes, semearModelosRede, sincronizarModelos } from './servicos/crm/modelos.js';
import { iniciarVarreduraPix } from './servicos/pagamentos/cobrancas.js';
import { aplicarRegrasFunil } from './servicos/crm/funis.js';
import { iniciarLimpezaSite } from './servicos/site/chat.js';

async function criarAdminInicial() {
  if (!config.adminInicial) return;
  const r = await comoSistema(async (c) => {
    const temAdmin = (await c.query(`SELECT 1 FROM usuarios WHERE perfil = 'admin' LIMIT 1`)).rowCount;
    if (temAdmin) return null;
    const u = (await c.query(
      `INSERT INTO usuarios (nome, email, perfil, status) VALUES ($1, $2, 'admin', 'convidado') RETURNING id, nome, email`,
      [config.adminInicial.nome, config.adminInicial.email])).rows[0];
    const token = novoToken();
    await c.query(`INSERT INTO tokens_senha (usuario_id, token_hash, tipo, expira_em) VALUES ($1, $2, 'convite', now() + interval '72 hours')`, [u.id, hashToken(token)]);
    return { u, link: `${config.appUrl}/#/definir-senha?token=${token}` };
  });
  if (!r) return;
  const enviado = await emailConvite({ para: r.u.email, nome: r.u.nome, link: r.link }).catch(() => false);
  console.log(`[inicio] Administrador inicial criado: ${r.u.email}. ${enviado ? 'Convite enviado por e-mail.' : `Link para criar a senha (válido 72h, use uma vez): ${r.link}`}`);
}

async function iniciar() {
  await migrar();
  // padrões de mensagem da rede (uma vez) e cópia para as lojas; falha aqui não impede a API de subir
  await comoSistema(async (c) => { await semearModelosRede(c); await sincronizarModelos(c, null); }).catch((e) => console.error('[inicio] modelos de mensagem:', e.message));
  await criarAdminInicial();
  iniciarVarreduras();
  iniciarAutomacoes();
  iniciarVarreduraPix();
  if (config.site) iniciarLimpezaSite();
  // regras automáticas do funil (perdido sem resposta / concluído na retirada): a cada 10 min
  const funil = () => comoSistema(aplicarRegrasFunil).then((f) => { if (f.perdidas || f.concluidas) console.log(`[funil] automático: ${f.perdidas} perdida(s), ${f.concluidas} concluída(s)`); }).catch((e) => console.error('[funil] regras:', e.message));
  setTimeout(funil, 20_000); setInterval(funil, 10 * 60_000).unref();
  const servidor = criarApp().listen(config.porta, () => console.log(`[inicio] Conecta LocarX API na porta ${config.porta}`));
  const encerrar = () => { servidor.close(() => pool.end().then(() => process.exit(0))); setTimeout(() => process.exit(1), 10_000).unref(); };
  process.on('SIGTERM', encerrar);
  process.on('SIGINT', encerrar);
  // limpeza diária de sessões e links vencidos
  setInterval(() => comoSistema(async (c) => {
    await c.query(`DELETE FROM sessoes WHERE expira_em < now() OR ultimo_uso < now() - interval '30 days'`);
    await c.query(`DELETE FROM tokens_senha WHERE expira_em < now() - interval '30 days'`);
  }).catch((e) => console.error('[limpeza]', e.message)), 6 * 3_600_000).unref();
}

iniciar().catch((e) => { console.error('[inicio] falhou:', e); process.exit(1); });
