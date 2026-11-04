// v14.6 — validação de CNPJ dos dados cadastrais da loja
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cnpjValido, cnpjFormatado, soDigitos } from '../src/servicos/cnpj.js';

test('cnpjValido aceita CNPJs com dígitos verificadores corretos, com ou sem pontuação', () => {
  assert.equal(cnpjValido('11.222.333/0001-81'), true);
  assert.equal(cnpjValido('11222333000181'), true);
  assert.equal(cnpjValido('45.723.174/0001-10'), true);   // Google Brasil
  assert.equal(cnpjValido(' 06.990.590/0001-23 '), true); // Google Brasil (outra inscrição)
});

test('cnpjValido recusa dígito errado, tamanho errado e sequências repetidas', () => {
  assert.equal(cnpjValido('11.222.333/0001-82'), false);
  assert.equal(cnpjValido('1122233300018'), false);
  assert.equal(cnpjValido('00000000000000'), false);
  assert.equal(cnpjValido('11111111111111'), false);
  assert.equal(cnpjValido(''), false);
  assert.equal(cnpjValido(null), false);
});

test('cnpjFormatado e soDigitos', () => {
  assert.equal(soDigitos('11.222.333/0001-81'), '11222333000181');
  assert.equal(cnpjFormatado('11222333000181'), '11.222.333/0001-81');
  assert.equal(cnpjFormatado('123'), '123');
});
