// v14.10 — plano e valores editáveis: a personalização sobrepõe o padrão do código e volta ao padrão quando apagada
import './ambiente.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANOS, aplicarConfigPlano, padraoDoPlano, planosPublicos, valorDoPlano, modulosComPlano, configDeLinha, NOTAS } from '../src/servicos/assinatura/planos.js';

test('padrão do código: R$ 220 / R$ 2.000, 2 acessos, extra R$ 29,90', () => {
  assert.equal(PLANOS.basico.mensal, 22000); assert.equal(PLANOS.basico.anual, 200000);
  assert.equal(PLANOS.basico.acessosInclusos, 2); assert.equal(PLANOS.basico.acessoExtraMensal, 2990);
  assert.equal(planosPublicos()[0].notas.length, NOTAS.length);
});

test('personalizar muda preço, textos e acessos; módulos e naoInclui continuam os do código', () => {
  aplicarConfigPlano('basico', configDeLinha({ nome: 'Conecta Pro', rotulo: 'Plano único', descricao: 'Novo', mensal: 25000, anual: 240000, acessos_inclusos: 3, acesso_extra_mensal: 3490, inclui: ['Tudo'], notas: ['Nota 1'] }));
  assert.equal(valorDoPlano('basico', 'mensal'), 25000); assert.equal(valorDoPlano('basico', 'anual'), 240000);
  assert.equal(PLANOS.basico.nome, 'Conecta Pro'); assert.equal(PLANOS.basico.acessosInclusos, 3); assert.equal(PLANOS.basico.acessoExtraMensal, 3490);
  assert.deepEqual(PLANOS.basico.inclui, ['Tudo']); assert.deepEqual(planosPublicos()[0].notas, ['Nota 1']);
  assert.equal(PLANOS.basico.modulos.assistente, true);
  assert.deepEqual(modulosComPlano({ pix: true }, 'basico').funil, true);
});

test('voltar ao padrão restaura tudo; chave desconhecida é ignorada', () => {
  aplicarConfigPlano('basico', {});
  assert.equal(PLANOS.basico.mensal, 22000); assert.equal(PLANOS.basico.nome, padraoDoPlano('basico').nome);
  assert.deepEqual(PLANOS.basico.inclui, padraoDoPlano('basico').inclui);
  aplicarConfigPlano('inexistente', { mensal: 1 });
  assert.equal(PLANOS.inexistente, undefined);
});
