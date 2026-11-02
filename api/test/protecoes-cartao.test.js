// v14.1: o cartão "Cotação da Lia" mostra as proteções que o portal devolveu para cada grupo (nada fixo no código).
import './ambiente.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { protecoesResumo } from '../src/servicos/locarx/api-locarx.js';

test('protecoesResumo guarda código, nome, valor por diária, base e caução da API', () => {
  const r = protecoesResumo([
    { id: 1, codigo: 'PROTECAO_X', nome: 'Proteção X', diaria: 10, base: true, padrao: true, caucao: 800 },
    { id: 3, codigo: 'TERCEIROS', nome: 'Terceiros', diaria: 13, base: false, padrao: false, caucao: null },
  ]);
  assert.deepEqual(r, [
    { codigo: 'PROTECAO_X', nome: 'Proteção X', diaria: 10, base: true, padrao: true, caucao: 800 },
    { codigo: 'TERCEIROS', nome: 'Terceiros', diaria: 13, base: false, padrao: false, caucao: null },
  ]);
});

test('protecoesResumo ignora itens sem código e lista vazia', () => {
  assert.deepEqual(protecoesResumo([{ nome: 'sem código' }, null]), []);
  assert.deepEqual(protecoesResumo(undefined), []);
});
