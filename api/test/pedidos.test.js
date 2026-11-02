// v14 Parte B — pedidos do cliente (cancelamento, alteração, multa) registrados pela Lia; ela nunca cancela
import './ambiente.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ferramentasDaLoja, ASSISTENTE_CANCELA } from '../src/servicos/locarx/ferramentas.js';
import { montarSistema } from '../src/servicos/ia/assistente.js';

const base = { lojaId: 'l', branchId: 1, locarxDisponivel: true, simulacao: true };

test('cancelar_reserva não vai para a IA em nenhum canal; registrar_pedido vai, mesmo sem a API LocarX', () => {
  assert.equal(ASSISTENTE_CANCELA, false);
  for (const ctx of [base, { ...base, canal: 'instagram' }, { ...base, canalSite: true }, { ...base, locarxDisponivel: false }]) {
    const nomes = ferramentasDaLoja(ctx).map((f) => f.nome);
    assert.ok(!nomes.includes('cancelar_reserva'), 'cancelar_reserva não pode aparecer');
    assert.ok(nomes.includes('registrar_pedido'), 'registrar_pedido precisa aparecer');
    assert.ok(nomes.includes('chamar_atendente'));
  }
});

test('registrar_pedido em simulação: não toca no banco e orienta a não prometer', async () => {
  const f = ferramentasDaLoja(base).find((x) => x.nome === 'registrar_pedido');
  assert.deepEqual(f.parametros.properties.tipo.enum, ['cancelamento', 'alteracao', 'multa', 'outro']);
  const r = await f.executar({ tipo: 'cancelamento', codigo_reserva: 'SSA123', detalhes: 'viagem adiada' });
  assert.equal(r.registrado, true); assert.equal(r.simulacao, true); assert.match(r.instrucao, /Não prometa/);
});

test('prompt: cancelamento e alteração vão por registrar_pedido; a Lia nunca cancela', () => {
  const s = montarSistema({ loja: { nome: 'Loja', cidade: 'Salvador', uf: 'BA' }, a: { nome: 'Lia', instrucoes: '', boas_vindas: '' }, rede: {}, contato: { nome: 'Ana' }, historicoReservas: [{ codigo: 'SSA1', grupo: 'B', retirada: new Date(Date.now() + 86_400_000), devolucao: new Date(Date.now() + 2 * 86_400_000), futura: true }], crm: null });
  assert.match(s, /CANCELAMENTO de reserva: você NUNCA cancela/);
  assert.match(s, /registrar_pedido com tipo "cancelamento"/);
  assert.match(s, /registrar_pedido com tipo "alteracao"/);
  assert.match(s, /NÃO chame criar_reserva — a equipe confirma a alteração/);
  assert.doesNotMatch(s, /cancelar_reserva/);
});
