import './ambiente.js';
import test from 'node:test';
import assert from 'node:assert/strict';
const { datasDoDiagnostico } = await import('../src/servicos/locarx/api-locarx.js');

const diaDaSemana = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();   // 0 = domingo

test('diagnóstico: retirada seg-qua e devolução qua-sex, em qualquer dia em que o teste rode', () => {
  const inicio = Date.UTC(2026, 9, 1);
  for (let i = 0; i < 60 * 24; i++) {   // 60 dias, de hora em hora
    const agora = inicio + i * 3_600_000;
    const { retirada, devolucao } = datasDoDiagnostico(agora);
    assert.ok([1, 2, 3].includes(diaDaSemana(retirada.date)), `retirada ${retirada.date} (agora=${new Date(agora).toISOString()})`);
    assert.ok([3, 4, 5].includes(diaDaSemana(devolucao.date)), `devolução ${devolucao.date}`);
    assert.ok(new Date(`${retirada.date}T10:00:00-03:00`).getTime() - agora >= 24 * 3_600_000, 'a API não devolve nada com menos de 24 h');
  }
});

test('diagnóstico: terça 27/10/2026 21h44 (Salvador) não cai no domingo', () => {
  const agora = Date.parse('2026-10-27T21:44:00-03:00');
  const { retirada, devolucao } = datasDoDiagnostico(agora);
  assert.deepEqual([retirada.date, devolucao.date], ['2026-11-02', '2026-11-04']);
});
