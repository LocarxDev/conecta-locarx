// Monta a API: segurança primeiro, depois as rotas.
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { cors, verificarOrigem, carregarSessao, exigirLogin, exigirCsrf, exigirModulo, tratarErros, erro } from './http.js';
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
import { relatorioLoja, relatorioRede } from './rotas/relatorios.js';
import { webhookAbacatePay, pagamentosLoja, pagamentosAdmin } from './rotas/pagamentos.js';

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

  // webhook da Evolution: chega servidor-a-servidor (sem navegador, sem login), protegido por segredo na URL
  app.use('/api/webhooks', express.json({ limit: '2mb' }), webhooks);

  // webhook do AbacatePay: corpo BRUTO (a assinatura HMAC é calculada sobre os bytes originais)
  app.use('/api/webhooks/abacatepay', express.raw({ type: () => true, limit: '200kb' }), webhookAbacatePay);

  // MCP (LocarX Tools): servidor-a-servidor, protegido por token próprio
  app.use('/api/mcp', express.json({ limit: '100kb' }), mcp);

  app.use('/api', cors);
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 900, standardHeaders: 'draft-7', legacyHeaders: false, message: { mensagem: 'Muitas requisições. Aguarde um minuto.' } }));
  app.use('/api', verificarOrigem);
  app.use('/api/conversas/:id/midia', express.json({ limit: '12mb' }));
  app.use('/api/conhecimento/importar', express.json({ limit: '15mb' }));
  app.use('/api/conhecimento/lote', express.json({ limit: '1mb' }));
  app.use(express.json({ limit: '50kb' }));
  app.use(cookieParser());
  app.use('/api', carregarSessao);

  app.use('/api/auth', auth);

  // daqui para baixo: precisa estar logado e mandar o token CSRF nas ações que alteram dados
  app.use('/api', exigirLogin, exigirCsrf);
  // módulos liberados por loja (plano): a administração liga/desliga em Lojas; o front esconde o menu e aqui a API barra
  app.use(['/api/loja/cotacao', '/api/loja/reservas'], (req, res, next) => (req.method === 'GET' && req.path === '/' ? next() : exigirModulo('cotacao')(req, res, next)));
  app.use(['/api/loja/pagamentos', '/api/loja/cobrancas'], exigirModulo('pix'));
  app.use(['/api/crm/funil', '/api/crm/oportunidades', '/api/crm/tarefas', '/api/crm/funis'], exigirModulo('funil'));
  app.use('/api/crm/contatos.csv', exigirModulo('clientes'));
  app.use('/api/loja/relatorio', exigirModulo('relatorios'));
  app.use(['/api/loja/respostas', '/api/crm/modelos'], exigirModulo('automacoes'));
  app.use(['/api/loja/assistente', '/api/loja/perguntas'], exigirModulo('assistente'));
  app.use('/api/admin', admin, equipeAdmin, rede, locarxAdmin, relatorioRede, personalizacaoRede, canalAdmin, pagamentosAdmin);
  app.use('/api/loja', loja, equipeLoja, canal, respostas, assistente, reservas, relatorioLoja, pagamentosLoja);
  app.use('/api/crm', crm, personalizacaoLoja);
  app.use('/api/conhecimento', conhecimento);
  app.use('/api/conversas', conversas);
  app.use('/api/usuarios', usuarios);
  app.use('/api/eu', eu);

  app.use('/api', (req, res, next) => next(erro(404, 'Endereço não encontrado.')));
  app.use(tratarErros);
  return app;
}
