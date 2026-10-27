// Rotas novas sem banco: validação de entrada e proteção de acesso (o que dá para conferir sem PostgreSQL).
import './ambiente.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { criarApp } from '../src/app.js';

let servidor, base;
before(() => { servidor = criarApp().listen(0); base = `http://127.0.0.1:${servidor.address().port}`; });
after(() => servidor.close());

const post = (caminho, corpo, cabecalhos = {}) => fetch(base + caminho, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://conecta.locarx.com.br', ...cabecalhos }, body: JSON.stringify(corpo) });
const get = (caminho) => fetch(base + caminho);

test('rotas novas existem e exigem login', async () => {
  for (const c of ['/api/loja/cotacao', '/api/loja/cotacao/preco', '/api/loja/reservas', '/api/admin/whatsapp/00000000-0000-0000-0000-000000000000/conectar']) {
    const r = await post(c, {});
    assert.equal(r.status, 401, c);
  }
  assert.equal((await get('/api/admin/whatsapp')).status, 401);
  assert.equal((await get('/api/admin/whatsapp/x/qr')).status, 401);
});

test('POST sem origem permitida é bloqueado antes de tudo', async () => {
  const r = await fetch(base + '/api/loja/reservas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
});

test('webhook e MCP continuam no lugar', async () => {
  assert.equal((await post('/api/webhooks/evolution/segredo-errado', {})).status, 404);
  assert.equal((await post('/api/mcp', { jsonrpc: '2.0', method: 'initialize' })).status, 401);
});

test('mensagem do atendente sai assinada com o primeiro nome', async () => {
  const { assinar } = await import('../src/rotas/conversas.js');
  assert.equal(assinar({ nome: 'Carla Souza' }, 'Bom dia! Já vi sua reserva.'), '*Carla:* Bom dia! Já vi sua reserva.');
  assert.equal(assinar({ nome: '' }, 'oi'), 'oi');
});

test('regras do funil: validação e padrão', async () => {
  const { zRegrasFunil, REGRAS_PADRAO } = await import('../src/servicos/crm/funis.js');
  assert.equal(REGRAS_PADRAO.perdidoSemRespostaHoras, 48);
  assert.ok(zRegrasFunil.safeParse({ perdidoSemRespostaHoras: 24, perdidoPeloAssistente: false, concluidoAoPagar: true, concluidoNaRetirada: true }).success);
  assert.ok(!zRegrasFunil.safeParse({ perdidoSemRespostaHoras: -1, perdidoPeloAssistente: true, concluidoAoPagar: true, concluidoNaRetirada: true }).success);
  assert.equal((await fetch(base + '/api/crm/funis/regras')).status, 401);
});

test('módulos por loja: ausente = ligado; desligado bloqueia; administração passa', async () => {
  const { normalizarModulos, moduloLigado, CHAVES } = await import('../src/servicos/modulos.js');
  assert.ok(CHAVES.includes('pix') && CHAVES.includes('assistente'));
  assert.equal(moduloLigado(null, 'pix'), true);
  assert.equal(moduloLigado({ pix: false }, 'pix'), false);
  assert.equal(normalizarModulos({ pix: false, lixo: true }).lixo, undefined);
  const { exigirModulo } = await import('../src/http.js');
  const chama = (usuario) => new Promise((resolve) => exigirModulo('pix')({ usuario }, {}, (e) => resolve(e ? e.status : 'ok')));
  assert.equal(await chama({ loja_id: 'l1', loja_modulos: { pix: false } }), 403);
  assert.equal(await chama({ loja_id: 'l1', loja_modulos: {} }), 'ok');
  assert.equal(await chama({ loja_id: null, perfil: 'admin' }), 'ok');
  assert.equal((await get('/api/admin/modulos')).status, 401);
});

test('multiloja: rotas de troca de loja, transferência e acessos exigem login', async () => {
  assert.equal((await get('/api/eu/lojas')).status, 401);
  assert.equal((await post('/api/eu/loja', { lojaId: '00000000-0000-0000-0000-000000000000' })).status, 401);
  assert.equal((await get('/api/conversas/lojas-destino')).status, 401);
  assert.equal((await post('/api/conversas/00000000-0000-0000-0000-000000000000/transferir-loja', { lojaId: '00000000-0000-0000-0000-000000000000' })).status, 401);
  assert.equal((await get('/api/admin/lojas/00000000-0000-0000-0000-000000000000/acessos')).status, 401);
});
