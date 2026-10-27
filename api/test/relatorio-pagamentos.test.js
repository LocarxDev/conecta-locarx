// Relatório de pagamentos online (repasse): totais, CSV seguro e proteção das rotas.
import './ambiente.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { criarApp } from '../src/app.js';
import { _relatorio as rel } from '../src/rotas/pagamentos.js';

let servidor, base;
before(() => { servidor = criarApp().listen(0); base = `http://127.0.0.1:${servidor.address().port}`; });
after(() => servidor.close());

const linha = (extra) => rel.itemRelatorio({ id: 'c1', loja_id: 'l1', loja_nome: 'Salvador', valor: '350.00', taxa: '0.80', status: 'paga', origem: 'assistente', paga_em: '2026-10-26T15:00:00Z', dev_mode: true, externo_id: 'pix_char_1', reserva_codigo: 'ABC123', retirada: '2026-11-01T11:00:00Z', devolucao: '2026-11-03T11:00:00Z', grupo: 'B', cliente_nome: '=Fulano', usuario_nome: null, ...extra });

test('totais somam só as pagas e separam estornos', () => {
  const itens = [linha(), linha({ id: 'c2', valor: '100.00', taxa: null, usuario_nome: 'Ana', origem: 'equipe' }), linha({ id: 'c3', status: 'estornada', valor: '50.00' })];
  const t = rel.totais(itens);
  assert.deepEqual(t, { quantidade: 2, bruto: 450, taxas: 0.8, liquido: 449.2, estornadas: 1, valorEstornado: 50, aRepassar: 449.2, naContaDaLoja: 0 });
  const t2 = rel.totais([linha({ conta: 'loja' })]);
  assert.equal(t2.aRepassar, 0); assert.equal(t2.naContaDaLoja, 349.2);
  assert.equal(itens[0].por, 'Assistente');
  assert.equal(itens[1].por, 'Ana');
  assert.equal(itens[0].liquido, 349.2);
});

test('csv tem BOM, separador ; vírgula decimal, linha de total e neutraliza fórmulas', () => {
  const csv = rel.csvRelatorio([linha()], { comLoja: true });
  assert.ok(csv.startsWith('﻿"Loja";"Pago em"'));
  assert.ok(csv.includes('"350,00";"0,80";"349,20"'));
  assert.ok(csv.includes(`"'=Fulano"`), 'nome começando com = vira texto');
  assert.ok(csv.includes('"TOTAL PAGO"'));
  assert.ok(!csv.includes('cpf'));
});

test('período padrão é o mês corrente e rejeita fim antes do início', () => {
  const p = rel.periodoRelatorio({});
  assert.match(p.de, /^\d{4}-\d{2}-01$/);
  assert.ok(p.ate >= p.de);
  assert.throws(() => rel.periodoRelatorio({ de: '2026-10-10', ate: '2026-10-01' }), /período/i);
});

test('relatórios exigem login', async () => {
  for (const c of ['/api/loja/pagamentos/relatorio', '/api/loja/pagamentos/relatorio.csv', '/api/admin/pagamentos/relatorio', '/api/admin/pagamentos/relatorio.csv?loja=x']) {
    assert.equal((await fetch(base + c)).status, 401, c);
  }
});
