import './ambiente.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarProtecoes, nomesDasProtecoes } from '../src/servicos/locarx/cotacao.js';

test('proteção: toda reserva leva a Proteção X ou a Super X, mesmo se o cliente pedir "sem proteção"', () => {
  for (const pedido of [[], ['SEM_PROTECAO'], ['sem proteção'], ['NENHUMA'], null, undefined]) {
    assert.deepEqual(normalizarProtecoes(pedido), ['PROTECAO_X'], JSON.stringify(pedido));
  }
});

test('proteção: Super X substitui a X; opcionais somam com qualquer uma das duas; vidros não se repetem', () => {
  assert.deepEqual(normalizarProtecoes(['PROTECAO_SUPER_X', 'PROTECAO_X']), ['PROTECAO_SUPER_X']);
  assert.deepEqual(normalizarProtecoes(['TERCEIROS']), ['PROTECAO_X', 'TERCEIROS']);
  assert.deepEqual(normalizarProtecoes(['PROTECAO_SUPER_X', 'TERCEIROS', 'VIDROS_E_PNEUS']), ['PROTECAO_SUPER_X', 'TERCEIROS', 'VIDROS_E_PNEUS']);
  assert.deepEqual(normalizarProtecoes(['PROTECAO_X', 'VIDROS', 'VIDROS_E_PNEUS']), ['PROTECAO_X', 'VIDROS_E_PNEUS']);
});

test('proteção: o texto do resumo vem dos códigos reservados e nunca diz "sem proteção"', () => {
  for (const pedido of [[], ['SEM_PROTECAO'], ['PROTECAO_X'], ['PROTECAO_SUPER_X', 'TERCEIROS']]) {
    const texto = nomesDasProtecoes(pedido).join(', ');
    assert.doesNotMatch(texto, /sem prote/i);
    assert.match(texto, /Prote.{1,2}o X|Super X/);
  }
  assert.equal(nomesDasProtecoes([]).join(', '), 'Proteção X (inclusa no total)');
  assert.equal(nomesDasProtecoes(['PROTECAO_SUPER_X', 'TERCEIROS']).join(', '), 'Super X, Terceiros');
});
