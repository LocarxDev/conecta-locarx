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

test('prompt: estado da reserva em andamento entra em toda rodada (opções com fleet_id, cotação e condutor)', async () => {
  const { textoReservaEmAndamento } = await import('../src/servicos/ia/assistente.js');
  const cv = {
    opcoes: { periodo: { data_retirada: '2026-10-30', hora_retirada: '11:00', data_devolucao: '2026-11-05', hora_devolucao: '11:00' }, grupos: [{ letra: 'B', fleet_id: 2, grupo: 'B - COMPACTO COM AR', total: 726 }, { letra: 'C', fleet_id: 3, grupo: 'C - COMPACTO ESPECIAL', total: 858 }] },
    cotacao: { fleetId: 3, grupo: 'C - COMPACTO ESPECIAL', retirada: { date: '2026-10-30', time: '11:00' }, devolucao: { date: '2026-11-05', time: '11:00' }, nomesProtecoes: ['Proteção X'], total: 858 },
    resumo_enviado_em: '2026-10-26T20:35:00Z',
    condutor: { nome: 'Silas Moreira dos Santos', cpf_final: '18', email: 'casilas9@hotmail.com' },
  };
  const t = textoReservaEmAndamento(cv);
  assert.match(t, /C = 3 \(C - COMPACTO ESPECIAL\)/);
  assert.match(t, /fleet_id 3/); assert.match(t, /R\$ 858,00/);
  assert.match(t, /RESUMO já foi enviado/);
  assert.match(t, /Silas Moreira dos Santos, CPF final 18/); assert.match(t, /NÃO peça de novo/);
  assert.equal(textoReservaEmAndamento(null), '');
  const p = montarSistema({ ...base, conversa: cv });
  assert.match(p, /RESERVA EM ANDAMENTO/);
});

test('cancelamento é sempre com atendente: a ferramenta não é oferecida e o prompt manda chamar', async () => {
  const { ferramentasDaLoja, ASSISTENTE_CANCELA } = await import('../src/servicos/locarx/ferramentas.js');
  assert.equal(ASSISTENTE_CANCELA, false);
  const nomes = ferramentasDaLoja({ lojaId: 'l', branchId: 1, locarxDisponivel: true, simulacao: true }).map((f) => f.nome);
  assert.ok(!nomes.includes('cancelar_reserva'));
  assert.ok(nomes.includes('consultar_reserva') && nomes.includes('criar_reserva'));
  assert.match(montarSistema(base), /CANCELAMENTO ou alteração de reserva já criada: você não cancela/);
});

test('prompt: com Pix, nenhuma regra fixa diz que o pagamento é só na loja', () => {
  const sem = montarSistema(base);
  const com = montarSistema({ ...base, pix: true });
  assert.ok(sem.includes('O pagamento é feito na loja, na retirada.') && !sem.includes('Passo 4b'));
  assert.ok(!com.includes('O pagamento é feito na loja, na retirada.'));
  assert.ok(com.includes('Passo 4b') && com.includes('Passo 7b') && com.includes('via Pile'.replace('Pile', 'Pix')));
});

test('prompt: com mais de uma filial, o roteiro começa pela escolha da filial', () => {
  const uma = montarSistema({ ...base, filiais: [{ id: 'a', nome: 'Aeroporto', principal: true }] });
  const duas = montarSistema({ ...base, filiais: [{ id: 'a', nome: 'Aeroporto', principal: true }, { id: 'b', nome: 'Centro' }] });
  assert.ok(!uma.includes('Passo 0'));
  assert.ok(duas.includes('Passo 0 — Filial') && duas.includes('Aeroporto, Centro'));
});

test('prompt: filiais com dados do portal entram no texto (endereço e horário)', () => {
  const f = [{ id: 'a', nome: 'Aeroporto', principal: true, portal: { nome: 'LocarX Salvador Aeroporto', endereco: 'Av. Santos Dumont, 100', horarios: 'Seg a Sex 08:00–18:00\nSáb 08:00–12:00' } }, { id: 'b', nome: 'Centro', portal: null }];
  const p = montarSistema({ ...base, filiais: f });
  assert.ok(p.includes('FILIAIS DESTA LOJA') && p.includes('Av. Santos Dumont, 100') && p.includes('Seg a Sex 08:00–18:00; Sáb'));
  assert.ok(p.includes('e suas 2 filiais'));
});

test('prompt: proteção X ou Super X é obrigatória, seguro do cartão não substitui e nunca diz "sem proteção"', () => {
  const p = montarSistema(base);
  assert.match(p, /Proteção X ou a Super X \(uma das duas, sempre\)/);
  assert.match(p, /Não existe reserva "sem proteção"/);
  assert.match(p, /seguro do cartão não substitui/);
  assert.match(p, /Nunca escreva "sem proteção"/);
  assert.match(p, /Terceiros, Vidros e Vidros e Pneus são opcionais/);
});
