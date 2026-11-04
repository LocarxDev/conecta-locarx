// Monta a API: segurança primeiro, depois as rotas.
import express, { Router } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { cors, verificarOrigem, carregarSessao, exigirLogin, exigirCsrf, exigirTermosAceitos, exigirAssinatura, exigirModulo, tratarErros, erro, rota, zUuid } from './http.js';
import { comoSistema } from './banco/conexao.js';
import { auth } from './rotas/auth.js';
import { admin, loja } from './rotas/lojas.js';
import { usuarios, equipeAdmin, equipeLoja } from './rotas/usuarios.js';
import { eu } from './rotas/eu.js';
import { canal, canalAdmin, webhooks } from './rotas/whatsapp.js';
import { conversas, respostas } from './rotas/conversas.js';
import { assistente, conhecimento, rede } from './rotas/assistente.js';
import { reservas, locarxAdmin, mcp } from './rotas/reservas.js';
import { crm } from './rotas/crm.js';
import { personalizacaoLoja, personalizacaoRede } from './rotas/personalizacao.js';
import { termos, termosAdmin } from './rotas/termos.js';
import { relatorioLoja, relatorioRede } from './rotas/relatorios.js';
import { webhookAbacatePay, pagamentosLoja, pagamentosAdmin } from './rotas/pagamentos.js';
import { assinaturaLoja, assinaturaAdmin, webhookPagarme } from './rotas/assinatura.js';
import { site, siteAdmin, corsDoSite } from './rotas/site.js';
import { instagramLoja, instagramPublico, webhookInstagram } from './rotas/instagram.js';

export function criarApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.confiarProxy);

  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: { maxAge: 63_072_000, includeSubDomains: true, preload: true },
  }));
  app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  // saúde (Railway healthcheck) — não revela nada
  app.get('/api/saude', (req, res) => res.json({ ok: true }));

  // Instagram (Meta): webhook com corpo BRUTO (a assinatura HMAC é sobre os bytes originais) — antes do parser JSON dos outros webhooks
  app.use('/api/webhooks/instagram', express.raw({ type: () => true, limit: '1mb' }), webhookInstagram);
  // retorno do login do Instagram (sem cookies; a loja vem no state assinado)
  app.use('/api/instagram', rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false }), instagramPublico);

  // v14.8 — webhook da Pagar.me (assinatura dos franqueados): autenticação Basic cadastrada no painel
  app.use('/api/webhooks/pagarme', express.json({ limit: '1mb' }), webhookPagarme);
  // webhook da Evolution: chega servidor-a-servidor (sem navegador, sem login), protegido por segredo na URL
  app.use('/api/webhooks', express.json({ limit: '2mb' }), webhooks);

  // webhook do AbacatePay: corpo BRUTO (a assinatura HMAC é calculada sobre os bytes originais)
  app.use('/api/webhooks/abacatepay', express.raw({ type: () => true, limit: '200kb' }), webhookAbacatePay);

  // MCP (LocarX Tools): servidor-a-servidor, protegido por token próprio
  app.use('/api/mcp', express.json({ limit: '100kb' }), mcp);

  // chat do site (widget no site da LocarX): público, sem cookies, com CORS e limites próprios
  app.use('/api/site', corsDoSite, express.json({ limit: '20kb' }), site);

  app.use('/api', cors);
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 900, standardHeaders: 'draft-7', legacyHeaders: false, message: { mensagem: 'Muitas requisições. Aguarde um minuto.' } }));
  app.use('/api', verificarOrigem);
  app.use('/api/conversas/:id/midia', express.json({ limit: '12mb' }));
  app.use('/api/conhecimento/importar', express.json({ limit: '15mb' }));
  app.use('/api/conhecimento/lote', express.json({ limit: '1mb' }));
  app.use('/api/admin/termos/converter-docx', express.json({ limit: '12mb' }));   // v14.8.4: Word em base64
  app.use('/api/admin/termos', express.json({ limit: '1mb' }));                    // termo em HTML pode passar de 50 kB
  app.use(express.json({ limit: '50kb' }));
  app.use(cookieParser());
  app.use('/api', carregarSessao);

  app.use('/api/auth', auth);

  // daqui para baixo: precisa estar logado e mandar o token CSRF nas ações que alteram dados
  app.use('/api', exigirLogin, exigirCsrf, exigirTermosAceitos, exigirAssinatura);   // termos pendentes (v14.5): só /termos, /auth e /eu passam
  app.use('/api/termos', termos);
  // módulos liberados por loja (plano): a administração liga/desliga em Lojas; o front esconde o menu e aqui a API barra
  app.use(['/api/loja/cotacao', '/api/loja/reservas'], (req, res, next) => (req.method === 'GET' && req.path === '/' ? next() : exigirModulo('cotacao')(req, res, next)));
  // cartão "Cotação da Lia" no painel da conversa (v14): segue o mesmo módulo "Cotação ao vivo e Reservar pela equipe"
  app.use('/api/loja/conversas', exigirModulo('cotacao'));
  app.use(['/api/loja/pagamentos', '/api/loja/cobrancas'], exigirModulo('pix'));
  app.use(['/api/crm/funil', '/api/crm/oportunidades', '/api/crm/tarefas', '/api/crm/funis'], exigirModulo('funil'));
  app.use('/api/crm/contatos.csv', exigirModulo('clientes'));
  app.use('/api/loja/relatorio', exigirModulo('relatorios'));
  app.use(['/api/loja/respostas', '/api/crm/modelos'], exigirModulo('automacoes'));
  app.use(['/api/loja/assistente', '/api/loja/perguntas'], exigirModulo('assistente'));
  // v14.7 — a administração configurando UMA loja: /api/admin/na-loja/:lojaId/<mesmos endereços da loja>.
  // A sessão continua sendo do admin (RLS de admin); só a loja em uso passa a ser a escolhida. Assim as telas da loja
  // (assistente, base, pagamentos, canais…) funcionam para o admin sem rotas duplicadas.
  const naLoja = Router({ mergeParams: true });
  naLoja.use(rota(async (req, res, next) => {
    if (req.usuario?.perfil !== 'admin') throw erro(403, 'Você não tem acesso a esta área.');
    if (!zUuid.safeParse(req.params.lojaId).success) throw erro(404, 'Loja não encontrada.');
    const l = await comoSistema(async (c) => (await c.query('SELECT id, nome, cidade, uf, ativa, modulos FROM lojas WHERE id = $1', [req.params.lojaId])).rows[0]);
    if (!l) throw erro(404, 'Loja não encontrada.');
    req.usuario = { ...req.usuario, loja_id: l.id, loja_nome: l.nome, loja_cidade: l.cidade, loja_uf: l.uf, loja_ativa: l.ativa, loja_modulos: l.modulos, atuandoNaLoja: true };
    next();
  }));
  naLoja.use('/loja', loja, equipeLoja, canal, instagramLoja, respostas, assistente, reservas, relatorioLoja, pagamentosLoja, assinaturaLoja);
  naLoja.use('/crm', crm, personalizacaoLoja);
  naLoja.use('/conhecimento', conhecimento);
  naLoja.use('/conversas', conversas);
  naLoja.use('/usuarios', usuarios);
  app.use('/api/admin/na-loja/:lojaId', naLoja);
  app.use('/api/admin', admin, equipeAdmin, rede, locarxAdmin, relatorioRede, personalizacaoRede, canalAdmin, pagamentosAdmin, siteAdmin, termosAdmin, assinaturaAdmin);
  app.use('/api/loja', loja, equipeLoja, canal, instagramLoja, respostas, assistente, reservas, relatorioLoja, pagamentosLoja, assinaturaLoja);
  app.use('/api/crm', crm, personalizacaoLoja);
  app.use('/api/conhecimento', conhecimento);
  app.use('/api/conversas', conversas);
  app.use('/api/usuarios', usuarios);
  app.use('/api/eu', eu);

  app.use('/api', (req, res, next) => next(erro(404, 'Endereço não encontrado.')));
  app.use(tratarErros);
  return app;
}
