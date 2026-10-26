import './ambiente.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarSistema } from '../src/servicos/ia/assistente.js';

const base = { loja: { nome: 'LocarX Salvador', cidade: 'Salvador', uf: 'BA' }, a: { nome: 'Lívia', instrucoes: '', boas_vindas: '' }, rede: {}, contato: { nome: 'Ana' }, historicoReservas: [], crm: null };

test('prompt: roteiro de reserva completo, na ordem', () => {
  const p = montarSistema(base);
  const passos = ['Passo 1 — Período', 'Passo 2 — Opções', 'Passo 3 — Escolha', 'Passo 4 — Proteção', 'Passo 5 — Dados do condutor', 'Passo 6 — Resumo', 'Passo 7 — Confirmação', 'Passo 8 — Fechamento'];
  let pos = -1;
  for (const s of passos) { const i = p.indexOf(s); assert.ok(i > pos, `faltou ou está fora de ordem: ${s}`); pos = i; }
});

test('prompt: coleta nome, CPF e e-mail em uma mensagem; CNH opcional; telefone do WhatsApp', () => {
  const p = montarSistema(base);
  assert.match(p, /Peça em UMA mensagem: nome completo, CPF e e-mail/);
  assert.match(p, /CNH é opcional/);
  assert.match(p, /telefone usado será o deste WhatsApp/);
});

test('prompt: resumo obrigatório, confirmação explícita e chamar_atendente ao final', () => {
  const p = montarSistema(base);
  assert.match(p, /Posso confirmar a reserva\?/);
  assert.match(p, /cliente_confirmou = true/);
  assert.match(p, /Não chame criar_reserva de novo nesta mesma resposta/);
  assert.match(p, /chamar_atendente com motivo "reserva criada"/);
});

test('prompt: regras de disponibilidade e 24 h continuam, e o assistente não manda o cliente para o site', () => {
  const p = montarSistema(base);
  assert.match(p, /NÃO procure outras datas/);
  assert.match(p, /24 horas de agora/);
  assert.match(p, /Nunca mande o cliente para o site/);
  assert.match(p, /texto_para_cliente EXATAMENTE como veio/);
});

test('prompt: cliente recorrente e nome aparecem', () => {
  const p = montarSistema({ ...base, historicoReservas: [{ grupo: 'B - COMPACTO', retirada: '2026-09-01T10:00:00Z' }] });
  assert.match(p, /Cliente recorrente: já alugou 1x/);
  assert.match(p, /CLIENTE: Ana\./);
});
