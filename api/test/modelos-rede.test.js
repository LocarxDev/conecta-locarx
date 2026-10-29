import './ambiente.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { quandoTexto, MODELOS_PADRAO } from '../src/servicos/crm/modelos.js';

test('quandoTexto descreve o momento do envio', () => {
  assert.equal(quandoTexto({ automatico: true, gatilho: 'retirada', deslocamento_horas: -24 }), '1 dia antes da retirada');
  assert.equal(quandoTexto({ automatico: true, gatilho: 'retirada', deslocamento_horas: -48 }), '2 dias antes da retirada');
  assert.equal(quandoTexto({ automatico: true, gatilho: 'devolucao', deslocamento_horas: 5 }), '5 horas depois da devolução');
  assert.equal(quandoTexto({ automatico: true, gatilho: 'devolucao', deslocamento_horas: -1 }), '1 hora antes da devolução');
  assert.equal(quandoTexto({ automatico: true, gatilho: 'retirada', deslocamento_horas: 0 }), 'No horário da retirada');
  assert.equal(quandoTexto({ automatico: false }), 'Enviar manualmente');
});

test('os modelos automáticos que vêm com o sistema têm momento definido', () => {
  for (const [k, m] of Object.entries(MODELOS_PADRAO)) assert.equal(!!m.automatico, !!m.gatilho, k);
});
