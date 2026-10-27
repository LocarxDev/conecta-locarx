// Pagamento Pix (AbacatePay): adaptador, verificação do webhook e o que muda no assistente. Sem banco e sem rede.
import './ambiente.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import * as abacate from '../src/servicos/pagamentos/abacatepay.js';
import { montarSistema, textoReservaEmAndamento } from '../src/servicos/ia/assistente.js';
import { ferramentasDaLoja } from '../src/servicos/locarx/ferramentas.js';
import { criarApp } from '../src/app.js';

test('criarPix: corpo conforme a documentação (centavos, PIX, customer completo, externalId, metadata)', async (t) => {
  const original = globalThis.fetch; const chamadas = [];
  globalThis.fetch = async (url, init) => { chamadas.push({ url: String(url), init }); return Response.json({ success: true, error: null, data: { id: 'pix_char_abc', amount: 85800, status: 'PENDING', devMode: true, brCode: '000201…', brCodeBase64: 'data:image/png;base64,AAA', expiresAt: '2026-10-27T00:00:00.000Z', metadata: { cobrancaId: 'c1' } } }); };
  t.after(() => { globalThis.fetch = original; });
  const r = await abacate.criarPix({ valor: 858, descricao: 'Reserva LocarX', validadeSegundos: 1800, cliente: { nome: 'Silas Moreira', cpf: '52998224725', email: 's@x.com', telefone: '(71) 98100-2541' }, referencia: 'c1', metadata: { cobrancaId: 'c1' } });
  const c = chamadas[0]; const corpo = JSON.parse(c.init.body);
  assert.equal(c.url, 'https://api.abacatepay.com/v2/transparents/create');
  assert.equal(c.init.headers.Authorization, 'Bearer chave-sandbox-teste');
  assert.equal(corpo.method, 'PIX'); assert.equal(corpo.data.amount, 85800); assert.equal(corpo.data.expiresIn, 1800);
  assert.deepEqual(corpo.data.customer, { name: 'Silas Moreira', taxId: '52998224725', email: 's@x.com', cellphone: '(71) 98100-2541' });
  assert.equal(corpo.data.externalId, 'c1');
  assert.equal(r.externoId, 'pix_char_abc'); assert.equal(r.valor, 858); assert.equal(r.devMode, true); assert.equal(r.brCode, '000201…');
  await assert.rejects(() => abacate.criarPix({ valor: 0.5 }), /pelo menos R\$ 1,00/);
});

test('criarPix: sem todos os dados do cliente, customer não vai (o AbacatePay exige os 4 juntos)', async (t) => {
  const original = globalThis.fetch; let corpo;
  globalThis.fetch = async (url, init) => { corpo = JSON.parse(init.body); return Response.json({ success: true, data: { id: 'pix_char_x', amount: 100, status: 'PENDING' } }); };
  t.after(() => { globalThis.fetch = original; });
  await abacate.criarPix({ valor: 1, cliente: { nome: 'A', cpf: '1' } });
  assert.equal(corpo.data.customer, undefined);
});

test('webhook: segredo e assinatura HMAC-SHA256 base64 sobre o corpo bruto', () => {
  assert.equal(abacate.segredoWebhookValido('segredo-de-teste-com-32-caracteres-ok'), true);
  assert.equal(abacate.segredoWebhookValido('outro'), false);
  assert.equal(abacate.segredoWebhookValido(''), false);
  const corpo = Buffer.from(JSON.stringify({ id: 'log_1', event: 'transparent.completed' }));
  const assinatura = createHmac('sha256', 'chave-publica-de-teste').update(corpo).digest('base64');
  assert.equal(abacate.assinaturaValida(corpo, assinatura), true);
  assert.equal(abacate.assinaturaValida(corpo, 'errada'), false);
  assert.equal(abacate.assinaturaValida(corpo, null), false);
});

test('lerEvento: envelope v2 do transparent.completed', () => {
  const ev = abacate.lerEvento({ id: 'log_Qw8', event: 'transparent.completed', apiVersion: 2, devMode: false, data: { transparent: { id: 'pix_char_m', amount: 5000, status: 'PAID', receiptUrl: 'https://app.abacatepay.com/receipt/1', metadata: { cobrancaId: 'c9' } }, customer: { taxId: '529.***.247-**' }, payerInformation: { method: 'PIX' } } });
  assert.equal(ev.eventoId, 'log_Qw8'); assert.equal(ev.evento, 'transparent.completed'); assert.equal(ev.metodo, 'PIX');
  assert.equal(ev.cobranca.externoId, 'pix_char_m'); assert.equal(ev.cobranca.status, 'PAID'); assert.equal(ev.cobranca.valor, 50); assert.equal(ev.cobranca.metadata.cobrancaId, 'c9');
});

test('rota do webhook: 404 sem config? não — com config: 401 sem segredo, 401 assinatura errada, 400 sem id', async () => {
  const s = criarApp().listen(0); const base = `http://127.0.0.1:${s.address().port}`;
  try {
    const seg = 'segredo-de-teste-com-32-caracteres-ok';
    const corpo = JSON.stringify({ id: 'log_1', event: 'transparent.completed', data: { transparent: { id: 'pix_char_z' } } });
    const assin = createHmac('sha256', 'chave-publica-de-teste').update(corpo).digest('base64');
    assert.equal((await fetch(`${base}/api/webhooks/abacatepay/${seg}`, { method: 'POST', body: corpo })).status, 401);                       // sem ?webhookSecret
    assert.equal((await fetch(`${base}/api/webhooks/abacatepay/${seg}?webhookSecret=${seg}`, { method: 'POST', headers: { 'X-Webhook-Signature': 'x' }, body: corpo })).status, 401);   // assinatura errada
    assert.equal((await fetch(`${base}/api/webhooks/abacatepay/${seg}?webhookSecret=${seg}`, { method: 'POST', headers: { 'X-Webhook-Signature': createHmac('sha256', 'chave-publica-de-teste').update('{}').digest('base64') }, body: '{}' })).status, 400);  // sem id
    void assin;
  } finally { s.close(); }
});

test('assistente com Pix: passo de forma de pagamento no roteiro, ferramenta verificar_pagamento e estado do Pix pendente', () => {
  const base = { loja: { nome: 'L', cidade: 'S', uf: 'BA' }, a: { nome: 'Lia', instrucoes: '', boas_vindas: '' }, rede: {}, contato: { nome: 'Ana' }, historicoReservas: [], crm: null };
  const comPix = montarSistema({ ...base, pix: true }), semPix = montarSistema({ ...base, pix: false });
  assert.match(comPix, /Passo 4b — Forma de pagamento/); assert.match(comPix, /Passo 7b — Pix/); assert.match(comPix, /Não há pagamento com cartão/);
  assert.doesNotMatch(semPix, /Passo 4b/);
  const nomes = (ctx) => ferramentasDaLoja({ lojaId: 'l', branchId: 1, locarxDisponivel: true, ...ctx }).map((f) => f.nome);
  assert.ok(nomes({ pixDisponivel: true, simulacao: false }).includes('verificar_pagamento'));
  assert.ok(!nomes({ pixDisponivel: false, simulacao: false }).includes('verificar_pagamento'));
  assert.ok(!nomes({ pixDisponivel: true, simulacao: true }).includes('verificar_pagamento'));   // teste do painel não gera Pix
  const estado = textoReservaEmAndamento({ pixPendente: { valor: 858, expira_em: '2026-10-27T00:30:00Z', dev_mode: true } });
  assert.match(estado, /Pix PENDENTE de R\$ 858,00/); assert.match(estado, /verificar_pagamento/);
});
