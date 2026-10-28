import './ambiente.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { limparCamposVazios, preencherModelo } from '../src/servicos/crm/modelos.js';
import { zFunil, etapaPublica } from '../src/servicos/crm/funis.js';

test('mensagem de etapa: campos sem valor somem e o texto fica arrumado', () => {
  const t = preencherModelo('Olá, {nome}! Sua reserva {codigo} na {loja} foi concluída.', { nome: 'Ana', loja: 'LocarX Salvador', codigo: null });
  assert.equal(limparCamposVazios(t), 'Olá, Ana! Sua reserva na LocarX Salvador foi concluída.');
  assert.equal(limparCamposVazios('Sua reserva {codigo}, obrigado!'), 'Sua reserva, obrigado!');
});

test('funil aceita um modelo de mensagem por etapa (e só o formato certo)', () => {
  const base = (modeloChave) => ({ nome: 'Pós-venda', etapas: [
    { nome: 'Novo', tipo: 'aberta' }, { nome: 'Pesquisa', tipo: 'aberta', modeloChave },
    { nome: 'Fechado', tipo: 'ganho' }, { nome: 'Perdido', tipo: 'perdido' }] });
  assert.ok(zFunil.safeParse(base('pesquisa_satisfacao')).success);
  assert.ok(zFunil.safeParse(base(null)).success);
  assert.ok(!zFunil.safeParse(base('Pesquisa; DROP')).success);
  assert.equal(etapaPublica({ id: 'x', nome: 'A', cor: '#000000', tipo: 'aberta', modelo_chave: 'pesquisa_satisfacao', ordem: 1 }).modeloChave, 'pesquisa_satisfacao');
  assert.equal(etapaPublica({ id: 'x', nome: 'A', cor: '#000000', tipo: 'aberta', ordem: 1 }).modeloChave, null);
});
