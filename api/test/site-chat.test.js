// Chat do site sem banco: textos (telefone, máscara), proteção das rotas públicas e comportamento com o chat desligado.
import './ambiente.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.SITE_ORIGENS = 'https://www.locarx.com.br';
process.env.SITE_CHAVE_TESTE = 'chave-de-teste-123';
const { mascarar, telefoneBr, telefoneMascarado, primeiroNome } = await import('../src/servicos/site/texto.js');
const { amigavel } = await import('../src/servicos/site/chat.js');
const { descreverUi } = await import('../src/servicos/site/ui.js');
const { criarApp } = await import('../src/app.js');

let servidor, base;
before(() => { servidor = criarApp().listen(0); base = `http://127.0.0.1:${servidor.address().port}`; });
after(() => servidor.close());

const SITE = 'https://www.locarx.com.br';
const chamar = (metodo, caminho, { origem, corpo, token, chave } = {}) => fetch(base + caminho, {
  method: metodo,
  headers: { 'Content-Type': 'application/json', ...(origem ? { Origin: origem } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(chave ? { 'X-Site-Chave': chave } : {}) },
  body: corpo ? JSON.stringify(corpo) : undefined,
});

test('telefoneBr aceita formatos comuns e recusa números impossíveis', () => {
  assert.equal(telefoneBr('(71) 98888-7777'), '5571988887777');
  assert.equal(telefoneBr('71988887777'), '5571988887777');
  assert.equal(telefoneBr('+55 71 98888-7777'), '5571988887777');
  assert.equal(telefoneBr('0 71 98888 7777'), '5571988887777');
  assert.equal(telefoneBr('7133334444'), '557133334444');
  for (const ruim of ['', 'abc', '12345', '(71) 88888-7777', '(10) 98888-7777', '71999999999999', null]) assert.equal(telefoneBr(ruim), null, String(ruim));
});

test('telefone mascarado mostra só o final e nome vira primeiro nome', () => {
  assert.equal(telefoneMascarado('5571988887777'), '(71) •••••-7777');
  assert.equal(telefoneMascarado(''), '');
  assert.equal(primeiroNome('  Ana Paula Souza '), 'Ana');
  assert.equal(primeiroNome(null), '');
});

test('mascarar esconde CPF, e-mail e celular digitados', () => {
  assert.equal(mascarar('meu cpf é 123.456.789-09'), 'meu cpf é •••.•••.•••-09');
  assert.equal(mascarar('123 456 789 09'), '•••.•••.•••-09');
  assert.equal(mascarar('ana.souza@gmail.com'), 'a•••@gmail.com');
  assert.equal(mascarar('liga 98888-7777'), 'liga •••••-7777');
  assert.equal(mascarar('Quero retirar dia 12/11'), 'Quero retirar dia 12/11');
});

test('amigavel troca o texto técnico dos cliques pelo que o cliente entende', () => {
  assert.equal(amigavel('[Datas escolhidas: retirada 12/11/2026 às 10:00; devolução 15/11/2026 às 10:00] (data_retirada 2026-11-12 10:00; data_devolucao 2026-11-15 10:00)'), '📅 retirada 12/11 às 10:00 · devolução 15/11 às 10:00');
  assert.equal(amigavel('[Escolhi o grupo B – Compacto (fleet_id 42)]'), 'Quero o B – Compacto');
  assert.equal(amigavel('Oi'), 'Oi');
  assert.equal(amigavel(null), '');
});

test('descreverUi resume componentes para a IA e a equipe', () => {
  assert.equal(descreverUi(null), '');
  assert.equal(typeof descreverUi([{ tipo: 'botoes', botoes: [{ rotulo: 'Sim', texto: 'sim' }] }]), 'string');
});

test('rotas do chat exigem site autorizado (Origin) e não vazam nada sem token', async () => {
  assert.equal((await chamar('POST', '/api/site/sessao')).status, 403, 'sem origem');
  assert.equal((await chamar('POST', '/api/site/sessao', { origem: 'https://site-falso.com' })).status, 403, 'origem de fora');
  assert.equal((await chamar('POST', '/api/site/mensagem', { origem: 'https://site-falso.com', corpo: { texto: 'oi' } })).status, 403);
  assert.equal((await chamar('POST', '/api/site/verificar', { corpo: { codigo: '123456' } })).status, 403);
  for (const [m, c] of [['POST', '/mensagem'], ['POST', '/cadastro'], ['POST', '/verificar'], ['POST', '/encerrar']]) {
    const r = await chamar(m, '/api/site' + c, { origem: SITE, corpo: {}, token: 'curto' });
    assert.equal(r.status, 401, c);
  }
  assert.equal((await chamar('GET', '/api/site/mensagens', { origem: SITE })).status, 401);
  assert.equal((await chamar('GET', '/api/site/mensagens', { origem: SITE, token: 'curto' })).status, 401);
});

test('CORS só libera o site autorizado e a chave de teste é exigida para abrir sessão', async () => {
  const ok = await chamar('OPTIONS', '/api/site/mensagem', { origem: SITE });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), SITE);
  assert.equal(ok.headers.get('access-control-allow-credentials'), null);
  assert.equal((await chamar('OPTIONS', '/api/site/mensagem', { origem: 'https://site-falso.com' })).status, 403);
  const semChave = await chamar('POST', '/api/site/sessao', { origem: SITE });
  assert.equal(semChave.status, 403);
  assert.equal((await chamar('POST', '/api/site/sessao', { origem: SITE, chave: 'errada' })).status, 403);
});

test('rotas de administração do chat exigem login', async () => {
  assert.equal((await chamar('GET', '/api/admin/site-chat', { origem: 'https://conecta.locarx.com.br' })).status, 401);
  assert.equal((await chamar('PUT', '/api/admin/lojas/00000000-0000-0000-0000-000000000000/site-chat', { origem: 'https://conecta.locarx.com.br', corpo: { ativo: true } })).status, 401);
});

test('acharFoto lê a imagem do grupo (image e variações), só https, e completa endereço relativo', async () => {
  const { acharFoto } = await import('../src/servicos/locarx/api-locarx.js');
  assert.equal(acharFoto({ image: 'https://cdn.locarx.com.br/fleets/1.png' }), 'https://cdn.locarx.com.br/fleets/1.png');
  assert.equal(acharFoto({ imageUrl: ' https://cdn.locarx.com.br/a.jpg ' }), 'https://cdn.locarx.com.br/a.jpg');
  assert.equal(acharFoto({ image: { url: 'https://cdn.locarx.com.br/b.webp' } }), 'https://cdn.locarx.com.br/b.webp');
  assert.equal(acharFoto({ vehicleModels: [{ model: 'Mobi' }, { image: 'https://cdn.locarx.com.br/mobi.png' }] }), 'https://cdn.locarx.com.br/mobi.png');
  assert.ok(acharFoto({ image: '/media/g1.png' })?.startsWith('https://') && acharFoto({ image: '/media/g1.png' }).endsWith('/media/g1.png'));
  assert.equal(acharFoto({ image: 'http://inseguro.com/x.png' }), null);
  assert.equal(acharFoto({ image: 'javascript:alert(1)' }), null);
  assert.equal(acharFoto({ name: 'sem foto' }), null);
  assert.equal(acharFoto(null), null);
});

test('rota de foto: fleetId inválido não vai ao portal', async () => {
  assert.equal((await fetch(`${base}/api/site/foto/abc`)).status, 404);
  assert.equal((await fetch(`${base}/api/site/foto/1%20or%201`)).status, 404);
});

test('paraWhatsApp remove anotações "[na tela: …]" que a IA copia do histórico', async () => {
  const { paraWhatsApp } = await import('../src/servicos/ia/assistente.js');
  assert.equal(paraWhatsApp('Quer manter a Proteção X? [na tela: botões — Proteção X | Super X]'), 'Quer manter a Proteção X?');
  assert.equal(paraWhatsApp('[na tela: cartões dos carros — A Econômico (fleet_id 1)] Escolha um carro'), 'Escolha um carro');
  assert.equal(paraWhatsApp('Veja [o link](https://x.com)'), 'Veja o link https://x.com');
});
