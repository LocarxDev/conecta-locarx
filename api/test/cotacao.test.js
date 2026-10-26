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
  assert.equal(corpo.customer.cnh, undefined);               // CNH vazia não vai
  assert.equal(corpo.customer.address, undefined);           // endereço vazio não vai
  assert.equal(corpo.customer.phone, '(71) 99999-0000');     // telefone no formato do portal
  assert.equal(corpo.pickUpDate, '2026-11-15'); assert.equal(corpo.dropOffTime, '10:00');
  assert.equal(r.codigo, 'SSA123'); assert.equal(r.id, 987); assert.equal(r.valor, 330);
});

test('ErroLocarx: códigos documentados viram motivo claro e dica para o assistente', async () => {
  const { ErroLocarx, telefoneBr } = await import('../src/servicos/locarx/api-locarx.js');
  const e1 = new ErroLocarx('API LocarX GET /availabilities/external respondeu 400', 400, { code: 'OUTSIDE_BUSINESS_HOURS', message: 'The branch is closed at the requested pickup time. Business hours on terça: 08:00-18:00.', statusCode: 400 });
  assert.equal(e1.codigo, 'OUTSIDE_BUSINESS_HOURS');
  assert.match(e1.motivo, /fora do horário de atendimento/); assert.match(e1.motivo, /08:00-18:00/);
  assert.match(e1.dicaAssistente, /outro horário/);
  const e2 = new ErroLocarx('x', 400, { code: 'NOT_AVAILABILITY_STCOK', message: 'There is not enough stock', statusCode: 400, days: ['2026-10-28', '2026-10-29'] });
  assert.match(e2.motivo, /Dias sem carro: 2026-10-28, 2026-10-29/);
  const e3 = new ErroLocarx('x', 403, { message: 'Forbidden resource', error: 'Forbidden', statusCode: 403 });
  assert.equal(e3.codigo, 'FORBIDDEN'); assert.match(e3.motivo, /Token/);
  const e4 = new ErroLocarx('x', 400, { statusCode: 400, message: ['customer.phone must be a valid Brazilian phone', 'customer.cpf must be a valid CPF'], error: 'Bad Request' });
  assert.equal(e4.codigo, null); assert.match(e4.motivo, /phone.*; .*cpf/);
  // telefone no formato do portal
  assert.equal(telefoneBr('5571999990000'), '(71) 99999-0000');
  assert.equal(telefoneBr('557133334444'), '(71) 3333-4444');
  assert.equal(telefoneBr('(71) 99999-0000'), '(71) 99999-0000');
  assert.equal(telefoneBr('557181002541'), '(71) 98100-2541');   // WhatsApp sem o nono dígito → insere o 9
  assert.equal(telefoneBr('557133334444'), '(71) 3333-4444');    // fixo continua com 8 dígitos
});

test('locality e catálogo: horários legíveis, filial por id e grupos do catálogo', async (t) => {
  const locarx = await import('../src/servicos/locarx/api-locarx.js');
  const fetchOriginal = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes('/locality')) return Response.json([{ branchId: 2, branchCode: 'SSA', name: 'Salvador - Aeroporto', displayName: 'Salvador - Aeroporto – BA', typeLabel: 'Aeroporto', type: 'AIRPORT', city: 'Salvador', cityCode: 'SSA1', state: 'BA', iataCode: 'SSA1', address: 'Tv. Santos Dumont, 431',
      businessHours: [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, open: true, openingHour: '08:00', closingHour: '18:00' })).concat([{ dayOfWeek: 6, open: true, openingHour: '08:00', closingHour: '13:00' }, { dayOfWeek: 7, open: false, openingHour: '08:00', closingHour: '08:01' }]),
      specialAttentionHours: [{ dayOfWeek: 1, rangeFrom: '18:01', rangeTo: '23:59', amount: 40 }] }]);
    return Response.json([{ fleetId: 2, name: 'B - COMPACTO COM AR', sippCode: 'ECMM', doors: 4, passengers: 5, baggages: 2, transmitionType: 'MANUAL', vehicleModels: [{ brand: 'RENAULT', model: 'Kwid ou Similar', category: 'COMPACT', type: 'DOOR_4_5' }], characteristics: ['Alarme'] }, { fleetId: 99, name: 'Z - DESATIVADO', vehicleModels: [] }]);
  };
  t.after(() => { globalThis.fetch = fetchOriginal; });
  const f = await locarx.dadosDaFilial(2);
  assert.match(urls[0], /\/locality\?branchId=2$/);
  assert.equal(f.horariosTexto, 'seg a sex 08:00–18:00 · sáb 08:00–13:00 · dom fechado');
  assert.equal(f.especiaisTexto, 'segunda 18:01–23:59 (+R$ 40,00)');
  assert.equal(await locarx.dadosDaFilial(77), null);
  const cat = await locarx.catalogoFrotas();
  assert.equal(cat.length, 1);                      // DESATIVADO fica de fora
  assert.equal(cat[0].cambio, 'MANUAL'); assert.equal(cat[0].exemplos, 'RENAULT Kwid ou Similar'); assert.equal(cat[0].malas, 2);
  const antes = urls.length; await locarx.catalogoFrotas(); assert.equal(urls.length, antes);   // cache
});

test('criarReserva: se o portal recusar só o telefone nacional, tenta uma vez no formato +55', async (t) => {
  const locarx = await import('../src/servicos/locarx/api-locarx.js');
  const fetchOriginal = globalThis.fetch;
  const corpos = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/availabilities/external')) return Response.json([{ branch: { fleets: [{ fleetId: 5, name: 'A', price: { priceFleetId: 50, summary: { totalWithTax: 1 } }, availableProtections: [{ id: 1, code: 'PROTECAO_X', baseProtection: true }] }] } }]);
    const c = JSON.parse(init.body); corpos.push(c);
    if (corpos.length === 1) return new Response(JSON.stringify({ message: ['customer.phone must be a valid phone number'], error: 'Bad Request', statusCode: 400 }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    return Response.json({ id: 1, reservationCode: 'SSA1', value: 1 });
  };
  t.after(() => { globalThis.fetch = fetchOriginal; });
  const r = await locarx.criarReserva({ branchId: 2, fleetId: 5, retirada: { date: '2026-11-15', time: '10:00' }, devolucao: { date: '2026-11-18', time: '10:00' }, protecoes: ['PROTECAO_X'], cliente: { nome: 'Silas Teste', cpf: '52998224725', telefone: '557181002541' } });
  assert.equal(corpos[0].customer.phone, '(71) 98100-2541');
  assert.equal(corpos[1].customer.phone, '+5571981002541');
  assert.equal(r.codigo, 'SSA1');
});

test('politicasDoPortal: políticas, km, proteções e serviços viram itens de conhecimento', async (t) => {
  const locarx = await import('../src/servicos/locarx/api-locarx.js');
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => Response.json([
    { branch: { fleets: [{ fleetId: 2, name: 'B - COMPACTO', price: { priceFleetId: 1, summary: { totalWithTax: 100 } }, availableProtections: [{ id: 1, code: 'PROTECAO_X', name: 'Proteção X', baseProtection: true, price: 10, description: 'Cobertura básica' }, { id: 3, code: 'TERCEIROS', name: 'Terceiros', price: 13 }] }] } },
    { additionalServices: [{ additionalServiceId: 4, name: 'Cadeirinha', price: 24.9, maxQuantity: 3 }], protections: [], policies: [{ category: 'Cancelamento', policy: 'Permitido antes da retirada.' }, { category: 'Pagamento', policy: 'Na loja.' }], mileageInfo: 'Franquia de km: livre' },
  ]);
  t.after(() => { globalThis.fetch = fetchOriginal; });
  const itens = await locarx.politicasDoPortal(2);
  assert.deepEqual(itens.map((i) => i.titulo), ['Política LocarX — Cancelamento', 'Política LocarX — Pagamento', 'Quilometragem (franquia de km)', 'Proteções disponíveis e caução', 'Serviços adicionais (cadeirinha, condutor adicional…)']);
  assert.match(itens[3].conteudo, /Proteção X \(básica\) — R\$\s?10,00 por diária\. Cobertura básica/);
  assert.match(itens[4].conteudo, /Cadeirinha — R\$\s?24,90 por diária \(até 3 por reserva\)/);
});

test('acharGrupo: aceita fleetId numérico, letra ou nome (a IA costuma mandar a letra)', async () => {
  const { acharGrupo } = await import('../src/servicos/locarx/api-locarx.js');
  const grupos = [{ fleetId: 3, grupo: 'C - COMPACTO ESPECIAL', exemplos: 'FIAT Argo, HB20' }, { fleetId: 2, grupo: 'B - COMPACTO COM AR', exemplos: 'FIAT Mobi' }, { fleetId: 16, grupo: 'M - MINIVAN 7 LUGARES', exemplos: 'Spin' }];
  assert.equal(acharGrupo(grupos, 2).fleetId, 2);
  assert.equal(acharGrupo(grupos, '3').fleetId, 3);
  assert.equal(acharGrupo(grupos, 'C').fleetId, 3);
  assert.equal(acharGrupo(grupos, 'b').fleetId, 2);
  assert.equal(acharGrupo(grupos, 'Compacto especial').fleetId, 3);
  assert.equal(acharGrupo(grupos, 'minivan').fleetId, 16);
  assert.equal(acharGrupo(grupos, 'argo').fleetId, 3);
  assert.equal(acharGrupo(grupos, 'Z'), null);
});
