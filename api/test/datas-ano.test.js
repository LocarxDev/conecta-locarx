import './ambiente.js';
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { validarPeriodo, dataExiste } from '../src/servicos/locarx/cotacao.js';
import { agoraBahia, montarSistema } from '../src/servicos/ia/assistente.js';

const HOJE = Date.parse('2026-10-28T17:10:00Z'); // quarta, 28/10/2026 14:10 em Salvador
const periodo = (r, d) => ({ data_retirada: r, hora_retirada: '10:00', data_devolucao: d, hora_devolucao: '10:00' });

test('datas: retirar 31/12 e devolver 02/01 vira a virada do ano', () => {
  mock.timers.enable({ apis: ['Date'], now: HOJE });
  try {
    const p = validarPeriodo(periodo('2026-12-31', '2027-01-02'));
    assert.ok(p.fim > p.ini);
  } finally { mock.timers.reset(); }
});

test('datas: ano passado dá erro que ensina o ano certo (não manda para atendente)', () => {
  mock.timers.enable({ apis: ['Date'], now: HOJE });
  try {
    assert.throws(() => validarPeriodo(periodo('2025-12-31', '2026-01-02')), /ano atual é 2026.*31\/12\/2026/);
  } finally { mock.timers.reset(); }
});

test('datas: dia que não existe (31/11, 30/02) é recusado, sem virar 01/12', () => {
  assert.equal(dataExiste('2026-11-31'), false);
  assert.equal(dataExiste('2026-02-30'), false);
  assert.equal(dataExiste('2028-02-29'), true);
  assert.equal(dataExiste('2026-12-31'), true);
  mock.timers.enable({ apis: ['Date'], now: HOJE });
  try {
    assert.throws(() => validarPeriodo(periodo('2026-11-31', '2026-12-02')), /não existe no calendário. Não consulte nem chame atendente/);
  } finally { mock.timers.reset(); }
});

test('prompt: diz o ano de hoje e como completar dia/mês sem ano', () => {
  const a = agoraBahia(HOJE);
  assert.equal(a.ano, 2026); assert.equal(a.dataBr, '28/10/2026'); assert.equal(a.porExtenso, 'quarta-feira'); assert.equal(a.diasParaFimDoAno, 64);
  const t = montarSistema({ loja: { nome: 'LocarX Salvador', cidade: 'Salvador', uf: 'BA' }, a: { nome: 'Lia', instrucoes: '', boas_vindas: '' }, rede: {}, contato: { nome: 'Ana' }, historicoReservas: [], crm: null });
  assert.match(t, /HOJE É .*\(ano \d{4}\)/);
  assert.match(t, /14\. DATAS E ANO/);
  assert.match(t, /Nunca use um ano anterior/);
});
