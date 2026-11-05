// v14.9 — período do funil de vendas (este mês, mês anterior, 30 dias, intervalo) em dias civis de Brasília
import './ambiente.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodoFunil } from '../src/rotas/crm.js';

const agora = new Date('2026-11-04T23:30:00-03:00');   // 4 de novembro, 23h30 em Brasília (já é dia 5 em UTC)

test('padrão = este mês, do dia 1 00:00 (Brasília) ao dia 1 do mês seguinte', () => {
  const p = periodoFunil({}, agora);
  assert.equal(p.inicio.toISOString(), '2026-11-01T03:00:00.000Z');
  assert.equal(p.fim.toISOString(), '2026-12-01T03:00:00.000Z');
  assert.equal(p.nome, 'este mês');
  assert.equal(p.anterior.inicio.toISOString(), '2026-10-02T03:00:00.000Z');   // mesmo tamanho (30 dias) para comparar
  assert.equal(p.anterior.fim.toISOString(), p.inicio.toISOString());
});

test('mês anterior e últimos 30 dias', () => {
  const m = periodoFunil({ periodo: 'mes-anterior' }, agora);
  assert.equal(m.inicio.toISOString(), '2026-10-01T03:00:00.000Z');
  assert.equal(m.fim.toISOString(), '2026-11-01T03:00:00.000Z');
  const t = periodoFunil({ periodo: '30d' }, agora);
  assert.equal(t.fim.toISOString(), '2026-11-05T03:00:00.000Z');   // fim = amanhã 00:00 (inclui hoje inteiro)
  assert.equal(t.inicio.toISOString(), '2026-10-06T03:00:00.000Z');
});

test('intervalo inclui o dia final inteiro e valida a ordem e o tamanho', () => {
  const p = periodoFunil({ periodo: 'intervalo', de: '2026-10-10', ate: '2026-10-12' }, agora);
  assert.equal(p.inicio.toISOString(), '2026-10-10T03:00:00.000Z');
  assert.equal(p.fim.toISOString(), '2026-10-13T03:00:00.000Z');
  assert.throws(() => periodoFunil({ periodo: 'intervalo', de: '2026-10-12', ate: '2026-10-10' }, agora), /depois do início/);
  assert.throws(() => periodoFunil({ periodo: 'intervalo', de: '2025-01-01', ate: '2026-10-10' }, agora), /400 dias/);
  // intervalo sem datas cai no padrão
  assert.equal(periodoFunil({ periodo: 'intervalo' }, agora).nome, 'este mês');
});

test('virada de ano: janeiro → mês anterior é dezembro', () => {
  const p = periodoFunil({ periodo: 'mes-anterior' }, new Date('2027-01-15T12:00:00-03:00'));
  assert.equal(p.inicio.toISOString(), '2026-12-01T03:00:00.000Z');
  assert.equal(p.fim.toISOString(), '2027-01-01T03:00:00.000Z');
});
