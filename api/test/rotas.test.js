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
