import './ambiente.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversarComIa } from '../src/servicos/ia/provedores.js';
import { paraWhatsApp } from '../src/servicos/ia/assistente.js';

// simula a API da OpenAI: cada chamada devolve a próxima resposta da lista
function openaiFalsa(respostas) {
  const chamadas = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    chamadas.push(JSON.parse(init.body));
    const r = respostas.shift();
    return Response.json({ choices: [{ message: r.message, finish_reason: r.finish || (r.message.tool_calls ? 'tool_calls' : 'stop') }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  };
  return { chamadas, restaurar: () => { globalThis.fetch = original; } };
}
const ferramenta = (nome, executar) => ({ nome, descricao: nome, parametros: { type: 'object', properties: {} }, executar });

test('promessa sem ação: a IA diz "um momento" sem usar ferramenta → o sistema cobra e ela executa', async (t) => {
  const f = openaiFalsa([
    { message: { role: 'assistant', content: 'Obrigado! Agora vou criar a reserva. Um momento, por favor.' } },
    { message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'criar_reserva', arguments: '{"cpf":"123","nome":"x"}' } }] } },
    { message: { role: 'assistant', content: 'Reserva criada! Código SSA1.' } },
  ]);
  t.after(f.restaurar);
  let chamou = false;
  const r = await conversarComIa({ provedor: 'openai', chave: 'k', modelo: 'm', sistema: 's', historico: [{ papel: 'cliente', texto: 'confirmo' }], ferramentas: [ferramenta('criar_reserva', async () => { chamou = true; return { reserva_criada: true }; })] });
  assert.equal(chamou, true);
  assert.equal(r.texto, 'Reserva criada! Código SSA1.');
  assert.deepEqual(r.eventos.map((e) => e.tipo), ['nudge', 'ferramenta']);
  assert.deepEqual(r.eventos[1].args, {});                       // cpf e nome não ficam no evento
  assert.match(f.chamadas[1].messages.at(-1).content, /não usou nenhuma ferramenta/);
});

test('promessa sem ação só é cobrada uma vez; se insistir, volta o texto e o motor sinaliza', async (t) => {
  const f = openaiFalsa([
    { message: { role: 'assistant', content: 'Vou verificar, um instante.' } },
    { message: { role: 'assistant', content: 'Só um momento.' } },
  ]);
  t.after(f.restaurar);
  const r = await conversarComIa({ provedor: 'openai', chave: 'k', modelo: 'm', sistema: 's', historico: [{ papel: 'cliente', texto: 'oi' }], ferramentas: [ferramenta('x', async () => 'ok')] });
  assert.equal(r.texto, 'Só um momento.');
  assert.equal(r.eventos.filter((e) => e.tipo === 'nudge').length, 1);
  assert.equal(f.chamadas.length, 2);
});

test('erro em ferramenta vira evento com mensagem e status, e a IA recebe o erro para explicar', async (t) => {
  const f = openaiFalsa([
    { message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'calcular_preco', arguments: '{"fleet_id":5}' } }] } },
    { message: { role: 'assistant', content: 'Não consegui calcular agora.' } },
  ]);
  t.after(f.restaurar);
  const r = await conversarComIa({ provedor: 'openai', chave: 'k', modelo: 'm', sistema: 's', historico: [{ papel: 'cliente', texto: 'B' }], ferramentas: [ferramenta('calcular_preco', async () => { const e = new Error('API LocarX POST /prices/calculate respondeu 400'); e.status = 400; e.resposta = { message: 'priceFleetId inválido' }; throw e; })] });
  const ev = r.eventos[0];
  assert.equal(ev.ok, false); assert.equal(ev.status, 400); assert.match(ev.erro, /respondeu 400/); assert.match(ev.respostaApi, /priceFleetId/);
  assert.deepEqual(ev.args, { fleet_id: 5 });
  assert.match(f.chamadas[1].messages.at(-1).content, /Erro ao executar calcular_preco/);
});

test('resposta normal sem promessa não é cobrada', async (t) => {
  const f = openaiFalsa([{ message: { role: 'assistant', content: 'Para quando você precisa do carro?' } }]);
  t.after(f.restaurar);
  const r = await conversarComIa({ provedor: 'openai', chave: 'k', modelo: 'm', sistema: 's', historico: [{ papel: 'cliente', texto: 'oi' }], ferramentas: [ferramenta('x', async () => 'ok')] });
  assert.equal(r.eventos.length, 0); assert.equal(f.chamadas.length, 1);
});

test('paraWhatsApp: Markdown vira formatação do WhatsApp', () => {
  assert.equal(paraWhatsApp('1. **B – Compacto com ar**\nR$ 100 · **Total R$ 726,00**'), '1. *B – Compacto com ar*\nR$ 100 · *Total R$ 726,00*');
  assert.equal(paraWhatsApp('### Resumo\n- item um\n- item dois\n\n\n\nfim'), '*Resumo*\n• item um\n• item dois\n\nfim');
  assert.equal(paraWhatsApp('já em *negrito* fica igual'), 'já em *negrito* fica igual');
});
