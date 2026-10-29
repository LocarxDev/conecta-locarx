// Central de Reservas (sem banco): escolha da filial pela cidade, ferramenta buscar_filiais e prompt da Central.
import './ambiente.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filialDaCentral } from '../src/servicos/locarx/filiais.js';
import { ferramentasDaLoja } from '../src/servicos/locarx/ferramentas.js';
import { montarSistema } from '../src/servicos/ia/assistente.js';
import { ehIdDeFilial } from '../src/servicos/site/chat.js';

const rede = [
  { id: null, branch_id: 10, nome: 'LocarX Salvador', cidade: 'Salvador', uf: 'BA', tipo: 'Cidade', principal: true, ativa: true },
  { id: null, branch_id: 11, nome: 'LocarX Salvador Aeroporto', cidade: 'Salvador', uf: 'BA', tipo: 'Aeroporto', principal: false, ativa: true },
  { id: null, branch_id: 20, nome: 'LocarX Recife', cidade: 'Recife', uf: 'PE', tipo: 'Cidade', principal: false, ativa: true },
  { id: null, branch_id: 30, nome: 'LocarX São Luís', cidade: 'São Luís', uf: 'MA', tipo: 'Cidade', principal: false, ativa: true },
];

test('filialDaCentral: cidade com uma filial, com acento e sem acento', () => {
  assert.equal(filialDaCentral(rede, 'Recife').branchId, 20);
  assert.equal(filialDaCentral(rede, 'sao luis').branchId, 30);
  assert.equal(filialDaCentral(rede, 'RECIFE').nome, 'LocarX Recife');
});

test('filialDaCentral: aceita branchId e nome exato; cidade com cidade+aeroporto pede para escolher', () => {
  assert.equal(filialDaCentral(rede, '11').nome, 'LocarX Salvador Aeroporto');
  assert.equal(filialDaCentral(rede, 'locarx salvador aeroporto').branchId, 11);
  assert.throws(() => filialDaCentral(rede, 'Salvador'), (e) => e.status === 422 && /2 filiais/.test(e.message) && /Aeroporto/.test(e.message));
});

test('filialDaCentral: cidade desconhecida manda usar buscar_filiais', () => {
  assert.throws(() => filialDaCentral(rede, 'Atlantis'), (e) => e.status === 422 && /buscar_filiais/.test(e.message));
});

const filiaisIa = rede.map((f) => ({ id: f.id, branchId: f.branch_id, nome: f.nome, cidade: f.cidade, uf: f.uf, tipo: f.tipo, principal: f.principal, ativa: true, portal: { tipo: f.tipo, endereco: `Rua ${f.cidade}, 1`, horarios: 'Seg a Sex 08:00–18:00' } }));
const ctxBase = { lojaId: 'l1', branchId: 10, filiais: filiaisIa, locarxDisponivel: true, simulacao: true, campos: [], etiquetas: [] };

test('buscar_filiais só existe na Central e acha por cidade, aeroporto e sem acento', async () => {
  assert.ok(!ferramentasDaLoja(ctxBase).some((f) => f.nome === 'buscar_filiais'));
  const t = ferramentasDaLoja({ ...ctxBase, central: true }).find((f) => f.nome === 'buscar_filiais');
  assert.ok(t);
  const salvador = await t.executar({ busca: 'salvador' });
  assert.equal(salvador.encontradas, 2);
  const aero = await t.executar({ busca: 'aeroporto de salvador' });
  assert.ok(aero.filiais.some((f) => /Aeroporto/.test(f.filial)));
  assert.equal((await t.executar({ busca: 'são luís' })).encontradas, 1);
  assert.match(await t.executar({ busca: 'Atlantis' }), /Nenhuma filial encontrada/);
  const cidades = await t.executar({});
  assert.equal(cidades.total_de_filiais, 4);
  assert.ok(cidades.cidades.includes('Recife/PE'));
});

test('Central: consultar sem filial escolhida pede a cidade e não assume a filial própria', async () => {
  const ferr = ferramentasDaLoja({ ...ctxBase, central: true, locarxDisponivel: true });
  const consulta = ferr.find((f) => f.nome === 'consultar_disponibilidade');
  const r = await consulta.executar({ data_retirada: '2030-01-10 10:00', data_devolucao: '2030-01-12 10:00' });
  assert.match(String(r), /cidade|buscar_filiais/);
});

test('prompt da Central pergunta a cidade, usa buscar_filiais e sugere a loja mais próxima', () => {
  const loja = { nome: 'Central de Reservas', cidade: 'Salvador', uf: 'BA', central: true };
  const a = { nome: 'Lia', instrucoes: '', boas_vindas: '' };
  const comum = { loja, a, rede: {}, contato: { nome: 'Ana' }, historicoReservas: [], crm: null, filiais: filiaisIa };
  const p = montarSistema(comum);
  assert.match(p, /Central de Reservas da LocarX/);
  assert.match(p, /Passo 0 — Onde retirar/);
  assert.match(p, /buscar_filiais/);
  assert.match(p, /mais próxim/i);
  const loj = montarSistema({ ...comum, loja: { ...loja, central: false } });
  assert.doesNotMatch(loj, /Passo 0 — Onde retirar/);
  assert.doesNotMatch(loj, /Central de Reservas da LocarX/);
});

test('id de filial do chat do site só aceita o formato b + número', () => {
  assert.ok(ehIdDeFilial('b123'));
  for (const ruim of ['123', 'b', 'b12a', 'B12', "b1' OR 1=1", '', null, 'b1234567890']) assert.ok(!ehIdDeFilial(ruim), String(ruim));
});
