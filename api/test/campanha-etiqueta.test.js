// v14.3 — campanha/etiqueta/anúncio não passa a conversa para a equipe: a Lia etiqueta e segue atendendo.
import './ambiente.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ferramentasDaLoja, repasseSoPorCampanha } from '../src/servicos/locarx/ferramentas.js';
import { montarSistema } from '../src/servicos/ia/assistente.js';

const etiquetas = [
  { id: 'e1', nome: 'BLACK X', descricao_bot: 'Quando o cliente falar da BLACK X' },
  { id: 'e2', nome: 'Campinas', descricao_bot: 'Lead do anúncio de Campinas' },
  { id: 'e3', nome: 'VIP', descricao_bot: null },
];

test('motivo só de campanha/etiqueta/anúncio é recusado; motivos da equipe passam', () => {
  const ctx = { etiquetas };
  for (const m of ['BLACK X', 'cliente interessado em locação de carros em Campinas', 'cliente quer saber da promoção 50% OFF', 'lead do anúncio', 'pergunta sobre desconto da campanha', 'Black x'])
    assert.equal(repasseSoPorCampanha(m, ctx), true, m);
  for (const m of ['cliente pediu atendente', 'reclamação sobre a BLACK X', 'reserva criada', 'frota/empresa', 'retirada hoje', 'multa', 'cliente enviou documento/foto', 'cancelamento da reserva da campanha', 'caução do grupo D', ''])
    assert.equal(repasseSoPorCampanha(m, ctx), false, m);
  // etiqueta sem condição para o assistente (VIP) não conta
  assert.equal(repasseSoPorCampanha('cliente VIP', ctx), false);
});

test('chamar_atendente por campanha não repassa e manda continuar; por pedido do cliente repassa', async () => {
  let chamou = null;
  const ctx = { lojaId: 'l', etiquetas, simulacao: true, aoChamarAtendente: async (a) => { chamou = a; } };
  const f = ferramentasDaLoja(ctx).find((x) => x.nome === 'chamar_atendente');
  const r = await f.executar({ motivo: 'BLACK X' });
  assert.equal(chamou, null);
  assert.equal(r.ok, false);
  assert.match(r.instrucao, /NÃO chame atendente/);
  assert.match(r.instrucao, /datas/);
  const r2 = await f.executar({ motivo: 'cliente pediu atendente' });
  assert.deepEqual(chamou, { motivo: 'cliente pediu atendente' });
  assert.match(String(r2), /Atendente avisado/);
});

test('aplicar_etiqueta manda seguir o roteiro', async () => {
  const ctx = { lojaId: 'l', etiquetas, simulacao: true };
  const f = ferramentasDaLoja(ctx).find((x) => x.nome === 'aplicar_etiqueta');
  const r = await f.executar({ etiquetas: ['black x'] });
  assert.match(r, /BLACK X/); assert.match(r, /Não chame atendente/);
  assert.deepEqual(ctx.etiquetasNestaResposta, ['BLACK X']);
});

test('prompt: regra 18 de campanhas e aviso no bloco de etiquetas', () => {
  const s = montarSistema({ loja: { nome: 'LocarX Salvador', cidade: 'Salvador', uf: 'BA' }, a: { nome: 'Lia', instrucoes: '' }, rede: {}, contato: {}, historicoReservas: [],
    crm: { campos: [], etiquetas, aplicadas: [], valores: {} } });
  assert.match(s, /18\. CAMPANHAS E ANÚNCIOS/);
  assert.match(s, /exceto condições de campanha/);
  if (/ETIQUETAS \(/.test(s)) assert.match(s, /NUNCA são motivo para chamar_atendente/);
});
