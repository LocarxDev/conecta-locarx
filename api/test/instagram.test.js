import './ambiente.js';
process.env.INSTAGRAM_APP_ID = '123'; process.env.INSTAGRAM_APP_SECRET = 'segredo-teste'; process.env.INSTAGRAM_CONFIG_ID = '456'; process.env.INSTAGRAM_VERIFY_TOKEN = 'v';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
const ig = await import('../src/servicos/canais/instagram.js');

test('instagram: state assinado identifica a loja e recusa forjado/vencido', () => {
  const st = ig.gerarState({ lojaId: 'loja-1', usuarioId: 'u1', origem: 'https://conecta.locarx.com.br' });
  assert.deepEqual(ig.lerState(st), { lojaId: 'loja-1', usuarioId: 'u1', origem: 'https://conecta.locarx.com.br' });
  assert.equal(ig.lerState(st.slice(0, -2) + 'xx'), null);
  assert.equal(ig.lerState('abc'), null);
  const [corpo] = st.split('.');
  assert.equal(ig.lerState(corpo + '.' + 'a'.repeat(43)), null);
});

test('instagram: URL de login usa app, configuração e retorno certos', () => {
  const u = new URL(ig.urlDeLogin({ state: 's', origem: 'https://conectahmml.netlify.app' }));
  assert.equal(u.searchParams.get('client_id'), '123'); assert.equal(u.searchParams.get('config_id'), '456');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://conectahmml.netlify.app/api/instagram/retorno');
  assert.match(u.searchParams.get('scope'), /instagram_manage_messages/);
});

test('instagram: assinatura do webhook', () => {
  const corpo = Buffer.from('{"a":1}');
  const ok = 'sha256=' + createHmac('sha256', 'segredo-teste').update(corpo).digest('hex');
  assert.equal(ig.verificarAssinatura(corpo, ok), true);
  assert.equal(ig.verificarAssinatura(corpo, 'sha256=' + 'f'.repeat(64)), false);
  assert.equal(ig.verificarAssinatura(corpo, undefined), false);
});

test('instagram: leitura de eventos (texto, anexo, eco, reação)', () => {
  assert.deepEqual(ig.lerMensagem({ sender: { id: '9' }, message: { mid: 'm1', text: 'oi' } }).texto, 'oi');
  assert.equal(ig.lerMensagem({ sender: { id: '9' }, message: { mid: 'm2', text: 'eco', is_echo: true } }), null);
  const img = ig.lerMensagem({ sender: { id: '9' }, message: { mid: 'm3', attachments: [{ type: 'image', payload: { url: 'https://x/y.jpg' } }] } });
  assert.equal(img.tipo, 'imagem'); assert.equal(img.midia.url, 'https://x/y.jpg');
  assert.equal(ig.lerMensagem({ sender: { id: '9' }, reaction: { emoji: '❤' } }), null);
});
