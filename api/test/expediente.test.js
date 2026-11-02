// v14 Parte A — horário de atendimento com dias fechados/feriados e a Lia sem atendente disponível
import './ambiente.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dentroDoHorario, proximaAbertura, faixaDoDia, textoProximoAtendimento, venceRetorno } from '../src/servicos/crm/expediente.js';
import { montarSistema } from '../src/servicos/ia/assistente.js';
import { ferramentasDaLoja } from '../src/servicos/locarx/ferramentas.js';

// Salvador = UTC-3. 2026-11-02 é segunda (Finados).
const em = (iso) => Date.parse(iso);
const SEG_0930 = em('2026-11-02T12:30:00Z');   // seg 02/11 09:30
const SEG_2100 = em('2026-11-03T00:00:00Z');   // seg 02/11 21:00
const SAB_1300 = em('2026-10-31T16:00:00Z');   // sáb 31/10 13:00
const DOM_1000 = em('2026-11-01T13:00:00Z');   // dom 01/11 10:00
const HORARIO = { seg: ['08:00', '18:00'], ter: ['08:00', '18:00'], qua: ['08:00', '18:00'], qui: ['08:00', '18:00'], sex: ['08:00', '18:00'], sab: ['08:00', '12:00'], dom: null };
const FINADOS = [{ de: '2026-11-02', ate: '2026-11-02', motivo: 'Finados', abre: null, fecha: null }];
const ESPECIAL = [{ de: '2026-11-02', ate: '2026-11-02', motivo: 'Finados', abre: '09:00', fecha: '12:00' }];

test('expediente: dia da semana normal e domingo fechado', () => {
  assert.equal(dentroDoHorario(HORARIO, [], SEG_0930), true);
  assert.equal(dentroDoHorario(HORARIO, [], SEG_2100), false);
  assert.equal(dentroDoHorario(HORARIO, [], DOM_1000), false);
  assert.equal(dentroDoHorario(HORARIO, [], SAB_1300), false);   // sábado fecha ao meio-dia
});

test('expediente: feriado sem horário fecha a loja mesmo em dia útil; com horário especial vale o especial', () => {
  assert.equal(dentroDoHorario(HORARIO, FINADOS, SEG_0930), false);
  assert.equal(dentroDoHorario(HORARIO, ESPECIAL, SEG_0930), true);
  assert.equal(dentroDoHorario(HORARIO, ESPECIAL, em('2026-11-02T16:00:00Z')), false);   // 13:00, depois do especial
  assert.deepEqual(faixaDoDia(HORARIO, ESPECIAL, '2026-11-02', 'seg'), ['09:00', '12:00']);
  assert.equal(faixaDoDia(HORARIO, FINADOS, '2026-11-02', 'seg'), null);
});

test('expediente: período fechado de vários dias (emenda) e horário vazio = sempre aberto', () => {
  const emenda = [{ de: '2026-10-31', ate: '2026-11-02', motivo: 'Feriado prolongado' }];
  assert.equal(dentroDoHorario(HORARIO, emenda, SAB_1300), false);
  assert.equal(dentroDoHorario(HORARIO, emenda, em('2026-10-31T13:00:00Z')), false);   // sáb 10:00, estaria aberto sem a emenda
  assert.equal(dentroDoHorario(HORARIO, emenda, em('2026-11-03T12:00:00Z')), true);    // ter 09:00 reabre
  assert.equal(dentroDoHorario({}, [], DOM_1000), true);
  assert.equal(dentroDoHorario(null, FINADOS, SEG_0930), false);   // sempre aberto, mas é feriado
  assert.equal(dentroDoHorario({}, FINADOS, em('2026-11-03T03:00:00Z')), true);   // ter 00:00
});

test('expediente: próxima abertura pula feriado, domingo e virada de semana', () => {
  // sábado 13:00 (já fechou), domingo fechado, segunda é Finados → terça 03/11 às 08:00
  const p = proximaAbertura(HORARIO, FINADOS, SAB_1300);
  assert.equal(p.data, '2026-11-03'); assert.equal(p.hora, '08:00'); assert.equal(p.texto, 'terça, 03/11, às 08:00');
  assert.equal(p.em.toISOString(), '2026-11-03T11:00:00.000Z');
  // véspera à noite → amanhã
  const q = proximaAbertura(HORARIO, [], em('2026-11-03T23:00:00Z'));   // ter 20:00
  assert.equal(q.texto, 'amanhã (quarta, 04/11), às 08:00');
  // de madrugada no mesmo dia → hoje
  assert.equal(proximaAbertura(HORARIO, [], em('2026-11-03T09:00:00Z')).texto, 'hoje, às 08:00');
  // feriado com horário especial abre às 09:00 do próprio dia
  assert.equal(proximaAbertura(HORARIO, ESPECIAL, em('2026-11-02T10:00:00Z')).texto, 'hoje, às 09:00');
  // aberto agora → "agora"
  assert.equal(proximaAbertura(HORARIO, [], SEG_0930).abertoAgora, true);
  // tudo fechado por 20 dias → null
  assert.equal(proximaAbertura(HORARIO, [{ de: '2026-11-01', ate: '2026-11-25' }], DOM_1000), null);
  // horário vazio + feriado: reabre à meia-noite do dia seguinte, sem hora no texto
  assert.equal(proximaAbertura({}, FINADOS, SEG_0930).texto, 'amanhã (terça, 03/11)');
});

test('expediente: textos e prazo da tarefa de retorno', () => {
  const sit = { abertoAgora: false, proximaAbertura: proximaAbertura(HORARIO, FINADOS, SAB_1300) };
  assert.equal(textoProximoAtendimento(sit), 'terça, 03/11, às 08:00');
  assert.equal(venceRetorno(sit).toISOString(), '2026-11-03T12:00:00.000Z');   // abertura + 1 h
  assert.equal(textoProximoAtendimento({ abertoAgora: true }), 'hoje mesmo, assim que um atendente ficar livre');
  assert.equal(venceRetorno({ abertoAgora: true, proximaAbertura: null }, SEG_0930).toISOString(), new Date(SEG_0930 + 3_600_000).toISOString());
});

test('chamar_atendente: sem equipe disponível registra o pedido e manda a Lia continuar; com equipe, repassa', async () => {
  let pendente = null, chamou = null;
  const base = { lojaId: 'l', branchId: 1, locarxDisponivel: true, simulacao: false, aoChamarAtendente: async (a) => { chamou = a; }, aoPendenteEquipe: async (a) => { pendente = a; } };
  const sem = ferramentasDaLoja({ ...base, equipeDisponivel: async () => ({ equipeDisponivel: false, continuarSemEquipe: true, abertoAgora: false, proximaAbertura: { texto: 'terça, 03/11, às 08:00' } }) }).find((f) => f.nome === 'chamar_atendente');
  const r = await sem.executar({ motivo: 'cliente quer mudar a data' });
  assert.match(r, /Nenhum atendente disponível agora\. Próximo atendimento da equipe: terça, 03\/11, às 08:00/);
  assert.match(r, /CONTINUE atendendo/);
  assert.equal(pendente.motivo, 'cliente quer mudar a data'); assert.equal(chamou, null);

  pendente = null;
  const com = ferramentasDaLoja({ ...base, equipeDisponivel: async () => ({ equipeDisponivel: true, continuarSemEquipe: true }) }).find((f) => f.nome === 'chamar_atendente');
  assert.match(await com.executar({ motivo: 'reclamação' }), /Atendente avisado/);
  assert.equal(chamou.motivo, 'reclamação'); assert.equal(pendente, null);

  // opção desligada: comportamento antigo mesmo sem ninguém
  chamou = null;
  const desl = ferramentasDaLoja({ ...base, equipeDisponivel: async () => ({ equipeDisponivel: false, continuarSemEquipe: false }) }).find((f) => f.nome === 'chamar_atendente');
  assert.match(await desl.executar({ motivo: 'x' }), /Atendente avisado/);
  assert.equal(chamou.motivo, 'x'); assert.equal(pendente, null);
});

test('prompt: linha EQUIPE DA LOJA só quando ninguém está disponível e a Lia deve continuar', () => {
  const base = { loja: { nome: 'Loja', cidade: 'Salvador', uf: 'BA', central: false }, a: { nome: 'Lia', instrucoes: '', boas_vindas: '' }, rede: {}, contato: { nome: 'Ana' }, historicoReservas: [], crm: null };
  const sem = montarSistema({ ...base, equipe: { equipeDisponivel: false, continuarSemEquipe: true, abertoAgora: false, proximaAbertura: { texto: 'terça, 03/11, às 08:00' } } });
  assert.match(sem, /EQUIPE DA LOJA: ninguém disponível agora; próximo atendimento: terça, 03\/11, às 08:00\./);
  assert.doesNotMatch(montarSistema({ ...base, equipe: { equipeDisponivel: true, continuarSemEquipe: true } }), /EQUIPE DA LOJA/);
  assert.doesNotMatch(montarSistema({ ...base, equipe: { equipeDisponivel: false, continuarSemEquipe: false } }), /EQUIPE DA LOJA/);
  assert.doesNotMatch(montarSistema(base), /EQUIPE DA LOJA/);
});
