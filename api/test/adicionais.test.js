// v14 Parte C — serviços adicionais (cadeirinha, condutor adicional…) na cotação, no cálculo e na reserva
import './ambiente.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import * as locarx from '../src/servicos/locarx/api-locarx.js';
import { ferramentasDaLoja } from '../src/servicos/locarx/ferramentas.js';

const DISPONIBILIDADE = [
  { branch: { fleets: [{ fleetId: 5, name: 'A - ECONÔMICO', price: { priceFleetId: 50, period: { baseDailyRate: 100, baseDays: 3 }, summary: { totalWithTax: 330 } }, availableProtections: [{ id: 11, code: 'PROTECAO_X', name: 'Proteção X', baseProtection: true, selected: true, guaranteeValue: 800 }, { id: 12, code: 'PROTECAO_SUPER_X', name: 'Super X', price: 30 }] }] } },
  { additionalServices: [{ additionalServiceId: 3, name: 'Cadeirinha infantil', price: 15, maxQuantity: 2 }, { additionalServiceId: 4, name: 'Condutor adicional', price: 20, maxQuantity: 1 }, { additionalServiceId: 9, name: 'GPS', price: 10 }] },
];
const periodo = { retirada: { date: '2026-11-15', time: '10:00' }, devolucao: { date: '2026-11-18', time: '10:00' } };

function stub(t, respostas) {
  const original = globalThis.fetch, chamadas = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url); chamadas.push({ url: u, corpo: init?.body ? JSON.parse(init.body) : null });
    if (u.includes('/availabilities/external')) return Response.json(DISPONIBILIDADE);
    if (u.includes('/prices/calculate')) return Response.json(respostas?.preco || { summary: { totalWithTax: 405 }, period: { baseDailyRate: 100, baseDays: 3 } });
    return Response.json({ reservation: { id: 1, reservationCode: 'SSA777', status: { reservation: 'CONFIRMED' }, value: 405, fleet: { name: 'A - ECONÔMICO' } } });
  };
  t.after(() => { globalThis.fetch = original; });
  return chamadas;
}

test('resolverAdicionais: por id, por nome sem acento/trecho, quantidade limitada ao máximo, sem repetir', () => {
  const lista = [{ id: 3, nome: 'Cadeirinha infantil', diaria: 15, maximo: 2 }, { id: 4, nome: 'Condutor adicional', diaria: 20, maximo: 1 }];
  const r = locarx.resolverAdicionais([{ nome: 'cadeirinha', qtd: 5 }, { id: 4, qtd: 1 }, { nome: 'Cadeirinha Infantil' }, { nome: 'wifi' }], lista);
  assert.deepEqual(r.map((x) => [x.id, x.qtd]), [[3, 2], [4, 1]]);
  assert.equal(r[0].nome, 'Cadeirinha infantil'); assert.equal(r[0].valor, 15);
  assert.deepEqual(locarx.resolverAdicionais(null, lista), []);
});

test('calcularPreco manda additionalServices [{ id, qtd }] e devolve os adicionais usados e os disponíveis', async (t) => {
  const chamadas = stub(t);
  const r = await locarx.calcularPreco({ branchId: 12, fleetId: 5, ...periodo, protecoes: ['PROTECAO_X'], adicionais: [{ nome: 'cadeirinha', qtd: 2 }, { nome: 'gps' }] });
  const corpo = chamadas.find((c) => c.url.includes('/prices/calculate')).corpo;
  assert.deepEqual(corpo.additionalServices, [{ id: 3, qtd: 2 }, { id: 9, qtd: 1 }]);
  assert.deepEqual(corpo.protections, [{ id: 11 }]);
  assert.equal(r.total, 405);
  assert.deepEqual(r.adicionais.map((x) => x.nome), ['Cadeirinha infantil', 'GPS']);
  assert.equal(r.adicionaisDisponiveis.length, 3);
});

test('criarReserva: sem LOCARX_RESERVA_ADICIONAIS os adicionais vão nas observações; com a flag, no additionalServices (additionalServiceId/quantity) e também nas observações', async (t) => {
  const cliente = { nome: 'Ana Souza', cpf: '52998224725', cnh: '', email: 'ana@exemplo.com', telefone: '5571999990000', observacoes: 'Pagamento: na loja.' };
  let chamadas = stub(t);
  await locarx.criarReserva({ branchId: 12, fleetId: 5, ...periodo, protecoes: ['PROTECAO_X'], adicionais: [{ id: 3, qtd: 2 }], cliente });
  let corpo = chamadas.find((c) => c.url.includes('/reservations/new')).corpo;
  assert.deepEqual(corpo.additionalServices, []);
  assert.match(corpo.observations, /SERVIÇOS ADICIONAIS SOLICITADOS .*Cadeirinha infantil x2/);

  config.locarx.reservaAdicionais = true;
  t.after(() => { config.locarx.reservaAdicionais = false; });
  chamadas = stub(t);
  await locarx.criarReserva({ branchId: 12, fleetId: 5, ...periodo, protecoes: ['PROTECAO_X'], adicionais: [{ id: 3, qtd: 2 }], cliente });
  corpo = chamadas.find((c) => c.url.includes('/reservations/new')).corpo;
  // formato que o portal exige na criação (resposta de 02/11): additionalServiceId + quantity
  assert.deepEqual(corpo.additionalServices, [{ additionalServiceId: 3, quantity: 2 }]);
  // e sempre também nas observações, para a equipe ver mesmo se o portal não gravar
  assert.match(corpo.observations, /SERVIÇOS ADICIONAIS SOLICITADOS \(enviados ao portal.*Cadeirinha infantil x2/);
});

test('ferramentas: consultar_disponibilidade expõe adicionais_disponiveis; calcular_preco aceita adicionais e põe no texto', async (t) => {
  stub(t);
  let guardado = {};
  const ctx = { lojaId: 'l', branchId: 12, locarxDisponivel: true, simulacao: true, aoGuardar: (tipo, v) => { guardado[tipo] = v; } };
  const fs = ferramentasDaLoja(ctx);
  const cons = await fs.find((f) => f.nome === 'consultar_disponibilidade').executar({ data_retirada: '2026-11-15', hora_retirada: '10:00', data_devolucao: '2026-11-18', hora_devolucao: '10:00' });
  assert.equal(cons.adicionais_disponiveis.length, 3);
  assert.equal(cons.adicionais_disponiveis[0].valor.replace(/ /g, ' '), 'R$ 15,00');
  assert.match(cons.instrucao_adicionais, /só estes/);
  const calc = fs.find((f) => f.nome === 'calcular_preco');
  assert.equal(calc.parametros.properties.adicionais.items.required[0], 'nome');
  const r = await calc.executar({ fleet_id: 5, data_retirada: '2026-11-15', hora_retirada: '10:00', data_devolucao: '2026-11-18', hora_devolucao: '10:00', protecoes: ['PROTECAO_X'], adicionais: [{ nome: 'Cadeirinha infantil', qtd: 2 }, { nome: 'wifi' }] });
  assert.deepEqual(r.adicionais, ['Cadeirinha infantil x2']);
  assert.match(r.aviso_adicionais, /Não encontrei: wifi/);
  assert.match(r.texto_para_cliente, /➕ Adicionais: Cadeirinha infantil x2/);
  assert.match(r.texto_para_cliente, /já com proteção, adicionais e taxas/);
  assert.deepEqual(guardado.cotacao.adicionais.map((x) => x.id), [3]);
});

test('criarReserva com a flag ligada: se o portal recusar additionalServices (400), reenvia sem eles e põe nas observações', async (t) => {
  config.locarx.reservaAdicionais = true;
  t.after(() => { config.locarx.reservaAdicionais = false; });
  const original = globalThis.fetch, corpos = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/availabilities/external')) return Response.json(DISPONIBILIDADE);
    const corpo = JSON.parse(init.body); corpos.push(corpo);
    if (corpo.additionalServices.length) return new Response(JSON.stringify({ message: 'additionalServices[0].id: unknown field' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    return Response.json({ reservation: { id: 1, reservationCode: 'SSA778', status: { reservation: 'CONFIRMED' }, value: 405 } });
  };
  t.after(() => { globalThis.fetch = original; });
  const r = await locarx.criarReserva({ branchId: 12, fleetId: 5, ...periodo, protecoes: ['PROTECAO_X'], adicionais: [{ id: 3, qtd: 1 }], cliente: { nome: 'Ana Souza', cpf: '52998224725', cnh: '', email: 'ana@exemplo.com', telefone: '5571999990000' } });
  assert.equal(r.codigo, 'SSA778');
  assert.equal(corpos.length, 2);
  assert.deepEqual(corpos[1].additionalServices, []);
  assert.match(corpos[1].observations, /SOLICITADOS .*Cadeirinha infantil x1/);
});
