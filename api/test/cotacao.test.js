import './ambiente.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarPeriodo, normalizarProtecoes, rotuloGrupo, ordenarPorPreco, textoOpcoes, periodoTexto, dataBr, cotarPeriodo } from '../src/servicos/locarx/cotacao.js';

// data/hora em Salvador (UTC-3) daqui a N dias; sem `hora`, usa a hora exata do momento
const em = (dias, hora) => { const d = new Date(Date.now() + dias * 86_400_000 - 3 * 3_600_000); return { data: d.toISOString().slice(0, 10), hora: hora || d.toISOString().slice(11, 16) }; };
const periodo = (ini, fim) => ({ data_retirada: ini.data, hora_retirada: ini.hora, data_devolucao: fim.data, hora_devolucao: fim.hora });

test('validarPeriodo: assistente exige 24 h de antecedência', () => {
  assert.throws(() => validarPeriodo(periodo(em(0.5), em(3))), /menos de 24 horas/);
  const ok = validarPeriodo(periodo(em(2, '10:00'), em(4, '10:00')));
  assert.equal(ok.retirada.time, '10:00');
  assert.ok(ok.fim > ok.ini);
});

test('validarPeriodo: equipe pode consultar com menos de 24 h, mas não no passado', () => {
  assert.doesNotThrow(() => validarPeriodo(periodo(em(0.2), em(2)), { antecedenciaHoras: 0 }));
  assert.throws(() => validarPeriodo(periodo(em(-1), em(2)), { antecedenciaHoras: 0 }), /no futuro/);
});

test('validarPeriodo: formatos, ordem e limite de 90 dias', () => {
  assert.throws(() => validarPeriodo({ data_retirada: '15/11/2026', hora_retirada: '10:00', data_devolucao: '2026-11-18', hora_devolucao: '10:00' }), /AAAA-MM-DD/);
  assert.throws(() => validarPeriodo(periodo(em(3), em(2))), /depois da retirada/);
  assert.throws(() => validarPeriodo(periodo(em(2), em(95))), /90 dias/);
});

test('normalizarProtecoes: sempre uma básica; Super X vence X; vidros não duplicam', () => {
  assert.deepEqual(normalizarProtecoes([]), ['PROTECAO_X']);
  assert.deepEqual(normalizarProtecoes(['protecao super x', 'PROTECAO_X']), ['PROTECAO_SUPER_X']);
  assert.deepEqual(normalizarProtecoes(['VIDROS', 'VIDROS_E_PNEUS', 'TERCEIROS']), ['PROTECAO_X', 'VIDROS_E_PNEUS', 'TERCEIROS']);
  assert.deepEqual(normalizarProtecoes(['INVENTADA']), ['PROTECAO_X']);
});

test('rotuloGrupo: letra do nome do grupo ou número da opção', () => {
  assert.deepEqual(rotuloGrupo({ grupo: 'B - COMPACTO COM AR' }, 1), { letra: 'B', nome: 'Compacto com ar' });
  assert.deepEqual(rotuloGrupo({ grupo: 'SUV Intermediário' }, 2), { letra: '2', nome: 'Suv intermediário' });
});

const grupos = [
  { fleetId: 3, grupo: 'C - SUV', exemplos: 'Renegade', cambio: 'AUTOMATIC', diaria: 200, total: 600, protecoes: [] },
  { fleetId: 1, grupo: 'A - ECONÔMICO', exemplos: 'Mobi, Kwid', cambio: 'MANUAL', diaria: 90, total: 270, protecoes: [] },
  { fleetId: 2, grupo: 'B - COMPACTO', exemplos: 'Argo', cambio: 'MANUAL', diaria: 120, total: null, protecoes: [] },
];

test('ordenarPorPreco: do mais barato ao mais caro, sem total por último', () => {
  assert.deepEqual(ordenarPorPreco(grupos).map((g) => g.fleetId), [1, 3, 2]);
});

test('textoOpcoes: formato fixo da rede para o WhatsApp', () => {
  const t = textoOpcoes(ordenarPorPreco(grupos).slice(0, 2), { periodo: '15/11 10:00 até 18/11 10:00', haMais: true });
  assert.match(t, /^🚗 \*Opções para 15\/11 10:00 até 18\/11 10:00:\*/);
  assert.match(t, /\*A – Econômico\*\nMobi, Kwid · câmbio manual\nR\$\s?90,00 por diária · \*Total R\$\s?270,00\*/);
  assert.match(t, /\*C – Suv\*\nRenegade · câmbio automático/);
  assert.match(t, /responder com a letra \(A ou C\)\./);
  assert.match(t, /mostro outras opções/);
  assert.doesNotMatch(textoOpcoes(grupos.slice(0, 1), { periodo: 'x' }), /outras opções/);
});

test('periodoTexto e dataBr', () => {
  assert.equal(periodoTexto({ data_retirada: '2026-11-15', hora_retirada: '10:00', data_devolucao: '2026-11-18', hora_devolucao: '18:30' }), '15/11 10:00 até 18/11 18:30');
  assert.equal(dataBr({ date: '2026-11-15', time: '10:00' }), '15/11/2026 às 10:00');
});

test('cotarPeriodo: lê o formato real da API LocarX e ordena por preço', async (t) => {
  const respostaApi = [
    { branch: { fleets: [
      { fleetId: 7, name: 'C - SUV', transmissionType: 'AUTOMATIC', vehicleModels: [{ brand: 'Jeep', model: 'Renegade' }], price: { priceFleetId: 70, period: { baseDailyRate: 250, baseDays: 3 }, summary: { totalWithTax: 780 } }, availableProtections: [{ id: 1, code: 'PROTECAO_X', name: 'Proteção X', baseProtection: true }] },
      { fleetId: 5, name: 'A - ECONÔMICO', transmissionType: 'MANUAL', vehicleModels: [{ brand: 'Fiat', model: 'Mobi' }], price: { priceFleetId: 50, period: { baseDailyRate: 100, baseDays: 3 }, summary: { totalWithTax: 330 } }, availableProtections: [{ id: 1, code: 'PROTECAO_X', name: 'Proteção X', baseProtection: true }, { id: 2, code: 'PROTECAO_SUPER_X', name: 'Super X', price: 30 }] },
      { fleetId: 9, name: 'SEM PREÇO', price: {} },
    ] } },
    { additionalServices: [{ additionalServiceId: 3, name: 'Cadeirinha', price: 15, maxQuantity: 2 }], policies: [{ category: 'Combustível', policy: 'Devolver cheio' }], mileageInfo: 'Km livre' },
  ];
  const fetchOriginal = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url) => { chamadas.push(String(url)); return new Response(JSON.stringify(respostaApi), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  t.after(() => { globalThis.fetch = fetchOriginal; });

  const r = await cotarPeriodo({ branchId: 12, periodo: { retirada: { date: '2026-11-15', time: '10:00' }, devolucao: { date: '2026-11-18', time: '10:00' } } });
  assert.match(chamadas[0], /\/availabilities\/external\?branchId=12&dateFrom=2026-11-15T10%3A00%3A00&dateTo=2026-11-18T10%3A00%3A00$/);
  assert.deepEqual(r.grupos.map((g) => g.fleetId), [5, 7]);           // sem priceFleetId fica de fora
  assert.deepEqual(r.grupos[0].rotulo, { letra: 'A', nome: 'Econômico' });
  assert.equal(r.grupos[0].total, 330);
  assert.equal(r.grupos[0].exemplos, 'Fiat Mobi');
  assert.equal(r.grupos[0].protecoes[1].codigo, 'PROTECAO_SUPER_X');
  assert.equal(r.adicionais[0].nome, 'Cadeirinha');
  assert.equal(r.km, 'Km livre');
});

test('criarReserva: corpo no formato real da API (LOCAL_PAYMENT, ids da filial, CNH opcional)', async (t) => {
  const locarx = await import('../src/servicos/locarx/api-locarx.js');
  const fetchOriginal = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, init) => {
    chamadas.push({ url: String(url), corpo: init?.body ? JSON.parse(init.body) : null });
    if (String(url).includes('/availabilities/external')) {
      return Response.json([{ branch: { fleets: [{ fleetId: 5, name: 'A - ECONÔMICO', price: { priceFleetId: 50, summary: { totalWithTax: 330 } }, availableProtections: [{ id: 11, code: 'PROTECAO_X', name: 'Proteção X', baseProtection: true }, { id: 12, code: 'PROTECAO_SUPER_X', name: 'Super X' }] }] } }]);
    }
    return Response.json({ reservation: { id: 987, reservationCode: 'SSA123', status: { reservation: 'CONFIRMED' }, value: 330, fleet: { name: 'A - ECONÔMICO' } } });
  };
  t.after(() => { globalThis.fetch = fetchOriginal; });
  const r = await locarx.criarReserva({ branchId: 12, fleetId: 5, retirada: { date: '2026-11-15', time: '10:00' }, devolucao: { date: '2026-11-18', time: '10:00' }, protecoes: ['PROTECAO_SUPER_X'], cliente: { nome: 'Ana Souza', cpf: '52998224725', cnh: '', email: 'ana@exemplo.com', telefone: '5571999990000' } });
  const corpo = chamadas.at(-1).corpo;
  assert.match(chamadas.at(-1).url, /\/reservations\/new$/);
  assert.equal(corpo.priceFleetId, 50);
  assert.equal(corpo.billingType, 'LOCAL_PAYMENT');
  assert.equal(corpo.pickUpLocationBranchId, 12);
  assert.deepEqual(corpo.protections, [{ fleetProtectionId: 12 }]);
  assert.equal(corpo.customer.cnh, '');
  assert.equal(corpo.pickUpDate, '2026-11-15'); assert.equal(corpo.dropOffTime, '10:00');
  assert.equal(r.codigo, 'SSA123'); assert.equal(r.id, 987); assert.equal(r.valor, 330);
});
