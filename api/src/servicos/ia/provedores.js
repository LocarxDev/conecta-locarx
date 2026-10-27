// Conversa com a IA (Anthropic ou OpenAI) com uso de ferramentas.
// Formato interno: historico = [{ papel: 'cliente' | 'assistente', texto }]
// ferramentas = [{ nome, descricao, parametros (JSON Schema), executar(args) → string|objeto }]

const TIMEOUT = 45_000;
const MAX_VOLTAS = 6;

async function post(url, headers, corpo) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(TIMEOUT) });
  const dados = await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error(`IA respondeu ${r.status}: ${dados?.error?.message || dados?.error?.type || 'erro'}`.slice(0, 300));
    e.status = r.status;
    throw e;
  }
  return dados;
}

const paraTexto = (v) => (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 12_000);
const SENSIVEIS = ['cpf', 'cnh', 'email', 'nome', 'telefone', 'informacoes'];
const argsSeguros = (args) => Object.fromEntries(Object.entries(args || {}).filter(([k]) => !SENSIVEIS.includes(k)));

// A IA às vezes diz "vou criar a reserva, um momento" e encerra a resposta sem chamar ferramenta nenhuma.
// Quando isso acontece, damos uma volta a mais pedindo para ela agir de fato.
const PROMESSA = /\b(um momento|um instante|s[oó] um (momento|minuto|instante)|aguarde|vou (criar|fazer|consultar|verificar|calcular|buscar|checar|confirmar|registrar|gerar)|estou (criando|consultando|verificando|calculando|buscando))\b/i;
const NUDGE = '(mensagem automática do sistema, não do cliente) Você disse que ia fazer algo, mas não usou nenhuma ferramenta. Faça agora usando a ferramenta certa e só então responda ao cliente com o resultado. Se não for possível, explique ao cliente e use chamar_atendente.';
const MAX_NUDGES = 1;
// resumo de reserva escrito pela IA sem passar pela ferramenta (o único resumo válido é o que criar_reserva devolve)
const RESUMO_INVENTADO = /posso confirmar a reserva|resumo da (sua )?reserva/i;
const NUDGE_RESUMO = '(mensagem automática do sistema, não do cliente) Você escreveu um resumo de reserva sem chamar criar_reserva. Resumos escritos por você não valem: chame criar_reserva agora com os dados do condutor (e forma_pagamento, se já perguntou) e envie ao cliente exatamente o resumo que a ferramenta devolver, terminando com "Posso confirmar a reserva?".';

// Cada chamada de ferramenta vira um evento no monitor da administração: nome, argumentos sem dados pessoais,
// se deu certo, a mensagem de erro e o tempo gasto. O conteúdo das respostas não é guardado.
async function executar(ferramentas, nome, args, usadas, eventos) {
  const f = ferramentas.find((x) => x.nome === nome);
  usadas.push(nome);
  const ev = { tipo: 'ferramenta', nome, args: argsSeguros(args), em: new Date().toISOString() };
  const inicio = Date.now();
  if (!f) { ev.ok = false; ev.erro = 'Ferramenta inexistente.'; ev.ms = 0; eventos.push(ev); return 'Ferramenta inexistente.'; }
  try {
    const r = await f.executar(args || {});
    const texto = paraTexto(r);
    ev.ok = true; ev.ms = Date.now() - inicio;
    // respostas de "não feito" das ferramentas (ex.: reserva ainda não criada) viram aviso, não erro
    if (typeof r === 'string' && (nome === 'criar_reserva' || /^(RESERVA AINDA NÃO CRIADA|Nenhum carro disponível|Limite de consultas|Ainda não há cotação|Nada encontrado)/.test(r))) ev.aviso = r.split('\n')[0].slice(0, 160);
    // o que a ferramenta de reserva de fato fez (o monitor só registra "reserva criada" quando foi criada mesmo)
    if (r && typeof r === 'object') ev.resultado = r.reserva_criada ? 'reserva_criada' : r.pix_gerado ? 'pix_gerado' : r.pix_ja_gerado ? 'pix_ja_gerado' : undefined;
    eventos.push(ev);
    return texto;
  } catch (e) {
    ev.ok = false; ev.ms = Date.now() - inicio; ev.erro = String(e.message || e).slice(0, 300);
    if (e.status) ev.status = e.status;
    if (e.resposta) ev.respostaApi = JSON.stringify(e.resposta).slice(0, 600);
    eventos.push(ev);
    console.error(`[ferramenta] ${nome} falhou: ${ev.erro}`, JSON.stringify(ev.args).slice(0, 500), ev.respostaApi ? 'resposta da API: ' + ev.respostaApi : '');
    return `Erro ao executar ${nome}: ${ev.erro}`.slice(0, 500);
  }
}

// a IA respondeu só texto: decide se é uma "promessa sem ação" que merece uma volta a mais
function promessaSemAcao(texto, ferramentas, nudges, eventosDaVolta) {
  if (!ferramentas.length || nudges >= MAX_NUDGES || eventosDaVolta !== 0) return null;
  if (ferramentas.some((f) => f.nome === 'criar_reserva') && RESUMO_INVENTADO.test(texto || '')) return NUDGE_RESUMO;
  return PROMESSA.test(texto || '') ? NUDGE : null;
}

async function anthropic({ chave, modelo, sistema, historico, ferramentas, maxTokens }) {
  const msgs = [];
  for (const h of historico) {
    const role = h.papel === 'cliente' ? 'user' : 'assistant';
    if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += '\n' + h.texto;
    else msgs.push({ role, content: h.texto });
  }
  if (!msgs.length || msgs[0].role !== 'user') msgs.unshift({ role: 'user', content: '(início da conversa)' });
  const tools = ferramentas.map((f) => ({ name: f.nome, description: f.descricao, input_schema: f.parametros }));
  const uso = { entrada: 0, saida: 0 }, usadas = [], eventos = [];
  let nudges = 0, voltas = 0;
  for (let volta = 0; volta < MAX_VOLTAS; volta++) {
    voltas++;
    const r = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      { model: modelo, max_tokens: maxTokens, system: sistema, messages: msgs, ...(tools.length ? { tools } : {}) });
    uso.entrada += r.usage?.input_tokens || 0; uso.saida += r.usage?.output_tokens || 0;
    const pedidos = (r.content || []).filter((b) => b.type === 'tool_use');
    const texto = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (r.stop_reason !== 'tool_use' || !pedidos.length) {
      const nudge = promessaSemAcao(texto, ferramentas, nudges, eventos.length);
      if (nudge) {
        nudges++;
        eventos.push({ tipo: 'nudge', em: new Date().toISOString(), texto: texto.slice(0, 160), motivo: nudge === NUDGE_RESUMO ? 'resumo sem ferramenta' : 'promessa sem ação' });
        msgs.push({ role: 'assistant', content: r.content?.length ? r.content : texto || '…' });
        msgs.push({ role: 'user', content: nudge });
        continue;
      }
      return { texto, uso, usadas, eventos, voltas, parada: r.stop_reason };
    }
    msgs.push({ role: 'assistant', content: r.content });
    const resultados = [];
    for (const p of pedidos) resultados.push({ type: 'tool_result', tool_use_id: p.id, content: await executar(ferramentas, p.name, p.input, usadas, eventos) });
    msgs.push({ role: 'user', content: resultados });
  }
  eventos.push({ tipo: 'limite', em: new Date().toISOString(), erro: `Limite de ${MAX_VOLTAS} voltas de ferramentas atingido sem resposta final.` });
  return { texto: '', uso, usadas, eventos, voltas, parada: 'limite' };
}

async function openai({ chave, modelo, sistema, historico, ferramentas, maxTokens }) {
  const msgs = [{ role: 'system', content: sistema }, ...historico.map((h) => ({ role: h.papel === 'cliente' ? 'user' : 'assistant', content: h.texto }))];
  const tools = ferramentas.map((f) => ({ type: 'function', function: { name: f.nome, description: f.descricao, parameters: f.parametros } }));
  const uso = { entrada: 0, saida: 0 }, usadas = [], eventos = [];
  let nudges = 0, voltas = 0;
  for (let volta = 0; volta < MAX_VOLTAS; volta++) {
    voltas++;
    const r = await post('https://api.openai.com/v1/chat/completions', { Authorization: `Bearer ${chave}` },
      { model: modelo, max_completion_tokens: maxTokens, messages: msgs, ...(tools.length ? { tools } : {}) });
    uso.entrada += r.usage?.prompt_tokens || 0; uso.saida += r.usage?.completion_tokens || 0;
    const m = r.choices?.[0]?.message || {};
    const parada = r.choices?.[0]?.finish_reason || null;
    if (!m.tool_calls?.length) {
      const texto = (m.content || '').trim();
      const nudge = promessaSemAcao(texto, ferramentas, nudges, eventos.length);
      if (nudge) {
        nudges++;
        eventos.push({ tipo: 'nudge', em: new Date().toISOString(), texto: texto.slice(0, 160), motivo: nudge === NUDGE_RESUMO ? 'resumo sem ferramenta' : 'promessa sem ação' });
        msgs.push({ role: 'assistant', content: texto || '…' });
        msgs.push({ role: 'user', content: nudge });
        continue;
      }
      if (parada === 'length') eventos.push({ tipo: 'limite', em: new Date().toISOString(), erro: 'A resposta foi cortada pelo limite de tokens (max_completion_tokens).' });
      return { texto, uso, usadas, eventos, voltas, parada };
    }
    msgs.push(m);
    for (const t of m.tool_calls) {
      let args = {};
      try { args = JSON.parse(t.function.arguments || '{}'); } catch { eventos.push({ tipo: 'erro', em: new Date().toISOString(), erro: `Argumentos inválidos para ${t.function.name}.` }); }
      msgs.push({ role: 'tool', tool_call_id: t.id, content: await executar(ferramentas, t.function.name, args, usadas, eventos) });
    }
  }
  eventos.push({ tipo: 'limite', em: new Date().toISOString(), erro: `Limite de ${MAX_VOLTAS} voltas de ferramentas atingido sem resposta final.` });
  return { texto: '', uso, usadas, eventos, voltas, parada: 'limite' };
}

export async function conversarComIa(opcoes) {
  const o = { maxTokens: 700, ferramentas: [], ...opcoes };
  return o.provedor === 'openai' ? openai(o) : anthropic(o);
}

// Teste rápido da chave (usado no botão "Testar chave")
export async function testarChave({ provedor, chave, modelo }) {
  const r = await conversarComIa({ provedor, chave, modelo, sistema: 'Responda apenas: ok', historico: [{ papel: 'cliente', texto: 'teste' }], maxTokens: 10 });
  return !!r;
}

// Transcrição de áudio (OpenAI)
export async function transcreverAudio({ chave, buffer, mimetype }) {
  const form = new FormData();
  const ext = /mpeg|mp3/.test(mimetype) ? 'mp3' : /mp4|m4a|aac/.test(mimetype) ? 'm4a' : 'ogg';
  form.append('file', new Blob([buffer], { type: mimetype.split(';')[0] }), `audio.${ext}`);
  form.append('model', 'whisper-1');
  form.append('language', 'pt');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${chave}` }, body: form, signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`Transcrição falhou (${r.status})`);
  const d = await r.json();
  return String(d.text || '').trim().slice(0, 4000);
}
