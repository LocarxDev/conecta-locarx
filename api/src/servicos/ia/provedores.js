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

async function executar(ferramentas, nome, args, usadas) {
  const f = ferramentas.find((x) => x.nome === nome);
  usadas.push(nome);
  if (!f) return 'Ferramenta inexistente.';
  try { return paraTexto(await f.executar(args || {})); } catch (e) { return `Erro ao executar ${nome}: ${e.message}`.slice(0, 500); }
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
  const uso = { entrada: 0, saida: 0 }, usadas = [];
  for (let volta = 0; volta < MAX_VOLTAS; volta++) {
    const r = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      { model: modelo, max_tokens: maxTokens, system: sistema, messages: msgs, ...(tools.length ? { tools } : {}) });
    uso.entrada += r.usage?.input_tokens || 0; uso.saida += r.usage?.output_tokens || 0;
    const pedidos = (r.content || []).filter((b) => b.type === 'tool_use');
    const texto = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (r.stop_reason !== 'tool_use' || !pedidos.length) return { texto, uso, usadas };
    msgs.push({ role: 'assistant', content: r.content });
    const resultados = [];
    for (const p of pedidos) resultados.push({ type: 'tool_result', tool_use_id: p.id, content: await executar(ferramentas, p.name, p.input, usadas) });
    msgs.push({ role: 'user', content: resultados });
  }
  return { texto: '', uso, usadas };
}

async function openai({ chave, modelo, sistema, historico, ferramentas, maxTokens }) {
  const msgs = [{ role: 'system', content: sistema }, ...historico.map((h) => ({ role: h.papel === 'cliente' ? 'user' : 'assistant', content: h.texto }))];
  const tools = ferramentas.map((f) => ({ type: 'function', function: { name: f.nome, description: f.descricao, parameters: f.parametros } }));
  const uso = { entrada: 0, saida: 0 }, usadas = [];
  for (let volta = 0; volta < MAX_VOLTAS; volta++) {
    const r = await post('https://api.openai.com/v1/chat/completions', { Authorization: `Bearer ${chave}` },
      { model: modelo, max_completion_tokens: maxTokens, messages: msgs, ...(tools.length ? { tools } : {}) });
    uso.entrada += r.usage?.prompt_tokens || 0; uso.saida += r.usage?.completion_tokens || 0;
    const m = r.choices?.[0]?.message || {};
    if (!m.tool_calls?.length) return { texto: (m.content || '').trim(), uso, usadas };
    msgs.push(m);
    for (const t of m.tool_calls) {
      let args = {};
      try { args = JSON.parse(t.function.arguments || '{}'); } catch { /* argumentos inválidos */ }
      msgs.push({ role: 'tool', tool_call_id: t.id, content: await executar(ferramentas, t.function.name, args, usadas) });
    }
  }
  return { texto: '', uso, usadas };
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
