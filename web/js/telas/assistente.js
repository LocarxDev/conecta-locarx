// Assistente virtual da loja (dono): ligar, IA, personalidade, horário, comportamento e teste.
import { api } from '../api.js';
import { html, render, $, $$, icone, avisar, comBotao, marcarErros, confirmar } from '../util.js';

const DIAS = [['seg', 'Segunda'], ['ter', 'Terça'], ['qua', 'Quarta'], ['qui', 'Quinta'], ['sex', 'Sexta'], ['sab', 'Sábado'], ['dom', 'Domingo']];
const MODELOS = {
  anthropic: [['claude-haiku-5-5', 'Claude Haiku 5.5 (rápido e econômico)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (mais caprichado)']],
  openai: [['gpt-4o-mini', 'GPT-4o mini (econômico)'], ['gpt-4o', 'GPT-4o']],
};

export async function montar(alvo, ctx) {
  render(alvo, html`<div class="cabecalho-pagina"><div class="titulos"><h1>Assistente virtual</h1><p>Carregando…</p></div></div>`);
  let a;
  try { a = await api.assistente(); } catch (err) {
    if (err.status === 401) return ctx.sessaoExpirou();
    return render(alvo, html`<div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div></div>`);
  }
  const semHorario = !a.horario || !Object.keys(a.horario).length;

  render(alvo, html`
    <div class="cabecalho-pagina">
      <div class="titulos"><h1>Assistente virtual</h1><p>Quem atende os clientes da loja no WhatsApp quando a equipe não está na conversa.</p></div>
      <span class="selo ${a.ativo ? 'ok' : 'neutro'}" id="selo-ativo">${a.ativo ? 'Ligado' : 'Desligado'}</span>
    </div>
    ${a.iaSimulada ? html`<div class="faixa-exemplo">${icone('info')}<span>Servidor em modo de teste: a IA é simulada.</span></div>` : ''}
    ${!a.apiLocarx ? html`<div class="alerta-caixa info">${icone('info')}<span>A ligação com o portal LocarX ainda não foi configurada no servidor. Por enquanto o assistente tira dúvidas, mas não consulta carros nem faz reservas.</span></div>` : ''}

    <div class="perfil-grade">
      <section class="painel">
        <div class="painel-cab"><h2>Inteligência artificial</h2>${a.temChave ? html`<span class="selo ok">Chave cadastrada</span>` : html`<span class="selo alerta">Sem chave</span>`}</div>
        <form class="form painel-corpo" id="form-chave" novalidate>
          <div class="form-linha">
            <div class="campo"><label for="ia-provedor">Empresa</label><select id="ia-provedor" name="provedor">
              <option value="anthropic" ${a.provedor === 'anthropic' ? 'selected' : ''}>Anthropic (Claude)</option>
              <option value="openai" ${a.provedor === 'openai' ? 'selected' : ''}>OpenAI (ChatGPT)</option></select></div>
            <div class="campo"><label for="ia-modelo">Modelo</label><input id="ia-modelo" name="modelo" list="lista-modelos" value="${a.modelo}" autocomplete="off"><datalist id="lista-modelos"></datalist></div>
          </div>
          <div class="campo"><label for="ia-chave">Chave da API</label>
            <input id="ia-chave" name="chave" type="password" autocomplete="off" placeholder="${a.temChave ? `Cadastrada, termina em …${a.chaveFinal}. Deixe em branco para manter.` : 'Cole a chave aqui'}">
            <p class="ajuda">A chave é testada antes de salvar e fica guardada criptografada. Ninguém consegue vê-la depois.</p></div>
          <div class="filtros"><button class="btn btn-primario" type="submit">Testar e salvar</button>
            ${a.temChave ? html`<button class="btn btn-texto" type="button" id="remover-chave">Remover chave</button>` : ''}</div>
          <details>
            <summary class="sub">Áudios dos clientes ${a.temChaveAudio ? '(transcrição ligada)' : ''}</summary>
            <div class="form">
              <p class="sub">Para o assistente entender áudios, é preciso uma chave da OpenAI. ${a.provedor === 'openai' ? 'Como a loja já usa a OpenAI, a mesma chave é usada.' : 'Cadastre aqui uma chave OpenAI só para transcrever áudios.'}</p>
              <div class="campo"><label for="ia-chave-audio">Chave OpenAI para áudios</label><input id="ia-chave-audio" type="password" autocomplete="off" placeholder="${a.temChaveAudio ? 'Cadastrada' : 'Opcional'}"></div>
              <div><button class="btn btn-contorno" type="button" id="salvar-chave-audio">Salvar chave de áudio</button></div>
            </div>
          </details>
        </form>
      </section>

      <section class="painel">
        <div class="painel-cab"><h2>Testar o assistente</h2><span class="sub">Nada é enviado ao cliente</span></div>
        <div class="teste-chat" id="teste-chat">
          <div class="mensagens" id="teste-mensagens"><div class="evento-chat">Escreva como se fosse um cliente. Reservas aqui são só simulação.</div></div>
          <form class="compositor" id="form-teste"><div class="linha-comp">
            <label class="sr-only" for="teste-texto">Mensagem de teste</label>
            <textarea id="teste-texto" rows="1" placeholder="Ex.: Quanto é a caução?"></textarea>
            <button class="btn btn-primario" type="submit">Enviar</button></div>
            <div class="opcoes-comp"><button class="btn btn-texto" type="button" id="limpar-teste">Recomeçar conversa</button></div>
          </form>
        </div>
      </section>
    </div>

    <form class="form" id="form-assistente" novalidate>
      <section class="painel">
        <div class="painel-cab"><h2>Como o assistente se apresenta</h2></div>
        <div class="painel-corpo form">
          <label class="checkbox"><input type="checkbox" name="ativo" ${a.ativo ? 'checked' : ''}> <strong>Assistente ligado</strong> (atende as conversas novas no WhatsApp)</label>
          <div class="form-linha">
            <div class="campo"><label for="as-nome">Nome do assistente</label><input id="as-nome" name="nome" value="${a.nome}" maxlength="60"></div>
            <div class="campo"><label for="as-boas">Saudação do primeiro contato</label><input id="as-boas" name="boasVindas" value="${a.boasVindas}" maxlength="1000" placeholder="Ex.: Olá! Sou a Lia, assistente da LocarX Salvador Aeroporto."></div>
          </div>
          <div class="campo"><label for="as-instr">Orientações desta loja</label>
            <textarea id="as-instr" name="instrucoes" rows="7" maxlength="8000" placeholder="Ex.: Sempre ofereça a proteção Super X. Clientes de empresa: peça o CNPJ e chame um atendente.">${a.instrucoes}</textarea>
            <p class="ajuda">Jeito de falar e regras de atendimento da loja. Regras como caução, documentos e endereço ficam melhor na Base de conhecimento.</p></div>
        </div>
      </section>

      <div class="perfil-grade">
        <section class="painel">
          <div class="painel-cab"><h2>Horário do assistente</h2></div>
          <div class="painel-corpo form">
            <label class="checkbox"><input type="checkbox" id="sempre" ${semHorario ? 'checked' : ''}> Atender 24 horas, todos os dias</label>
            <div class="horario-grade" id="horario-grade" ${semHorario ? 'hidden' : ''}>
              ${DIAS.map(([d, nome]) => { const f = a.horario?.[d]; return html`<div class="horario-linha">
                <label class="checkbox"><input type="checkbox" data-dia="${d}" ${f ? 'checked' : ''}> ${nome}</label>
                <input type="time" data-abre="${d}" value="${f?.[0] || '08:00'}" aria-label="${nome}: início">
                <span class="sub">às</span>
                <input type="time" data-fecha="${d}" value="${f?.[1] || '18:00'}" aria-label="${nome}: fim"></div>`; })}
            </div>
            <div class="campo"><label for="as-fora">Fora do horário</label><select id="as-fora" name="foraHorario">
              <option value="assistente" ${a.foraHorario === 'assistente' ? 'selected' : ''}>O assistente atende normalmente</option>
              <option value="mensagem" ${a.foraHorario === 'mensagem' ? 'selected' : ''}>Mandar mensagem de ausência e deixar para a equipe</option></select></div>
            <div class="campo"><label for="as-ausencia">Mensagem de ausência</label><textarea id="as-ausencia" name="msgAusencia" rows="3" maxlength="1000" placeholder="Ex.: Nosso atendimento é das 8h às 18h. Assim que abrirmos, respondemos você.">${a.msgAusencia}</textarea></div>
          </div>
        </section>

        <section class="painel">
          <div class="painel-cab"><h2>Quando chamar a equipe</h2></div>
          <div class="painel-corpo form">
            <div class="campo"><label for="as-palavras">Palavras que chamam um atendente na hora</label><input id="as-palavras" name="palavrasAtendente" value="${(a.palavrasAtendente || []).join(', ')}">
              <p class="ajuda">Separe por vírgula. Se o cliente escrever uma delas, a conversa vai direto para a equipe.</p></div>
            <div class="campo"><label for="as-repasse">Mensagem ao chamar a equipe</label><input id="as-repasse" name="msgRepasse" value="${a.msgRepasse}" maxlength="1000" placeholder="Ex.: Vou chamar um atendente da loja, é só aguardar um instante."></div>
            <div class="form-linha">
              <div class="campo"><label for="as-retorno">Assistente volta depois de (horas sem resposta da equipe)</label><input id="as-retorno" name="retornoHoras" type="number" min="0" max="72" value="${a.retornoHoras}"><p class="ajuda">0 = nunca volta sozinho.</p></div>
              <div class="campo"><label for="as-limite">Limite de respostas por dia</label><input id="as-limite" name="limiteDiario" type="number" min="0" max="100000" value="${a.limiteDiario}"><p class="ajuda">Protege contra gasto excessivo de IA.</p></div>
            </div>
            <div class="form-linha">
              <div class="campo"><label for="as-sil-ini">Mensagens automáticas: silêncio a partir de</label><select id="as-sil-ini" name="silencioInicio">${[...Array(24).keys()].map((h) => html`<option value="${h}" ${h === a.silencioInicio ? 'selected' : ''}>${String(h).padStart(2, '0')}h</option>`)}</select></div>
              <div class="campo"><label for="as-sil-fim">até</label><select id="as-sil-fim" name="silencioFim">${[...Array(24).keys()].map((h) => html`<option value="${h}" ${h === a.silencioFim ? 'selected' : ''}>${String(h).padStart(2, '0')}h</option>`)}</select></div>
            </div>
          </div>
        </section>
      </div>
      <div class="barra-salvar"><button class="btn btn-primario" type="submit">Salvar configurações</button></div>
    </form>`);

  // ---------- IA ----------
  const fChave = $('#form-chave', alvo);
  const preencherModelos = () => render($('#lista-modelos', alvo), html`${MODELOS[fChave.elements.provedor.value].map(([v, t]) => html`<option value="${v}">${t}</option>`)}`);
  preencherModelos();
  fChave.elements.provedor.addEventListener('change', () => { preencherModelos(); fChave.elements.modelo.value = MODELOS[fChave.elements.provedor.value][0][0]; });
  fChave.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = { provedor: fChave.elements.provedor.value, modelo: fChave.elements.modelo.value.trim(), chave: fChave.elements.chave.value.trim() || undefined };
    if (!marcarErros(fChave, d.modelo ? {} : { modelo: 'Informe o modelo.' })) return;
    await comBotao($('[type=submit]', fChave), async () => {
      try { await api.salvarChaveIa(d); avisar(d.chave ? 'Chave testada e salva.' : 'Modelo atualizado.'); ctx.navegar('assistente'); }
      catch (err) { if (err.campos) marcarErros(fChave, err.campos); else avisar(err.message, 'erro'); }
    });
  });
  $('#remover-chave', alvo)?.addEventListener('click', async () => {
    if (!(await confirmar({ titulo: 'Remover chave da IA', texto: 'O assistente será desligado até você cadastrar uma chave nova.', botao: 'Remover', perigo: true }))) return;
    try { await api.removerChaveIa(); avisar('Chave removida. Assistente desligado.'); ctx.navegar('assistente'); } catch (err) { avisar(err.message, 'erro'); }
  });
  $('#salvar-chave-audio', alvo).addEventListener('click', async (e) => {
    const chave = $('#ia-chave-audio', alvo).value.trim();
    await comBotao(e.currentTarget, async () => {
      try { await api.salvarChaveIa({ provedor: 'openai', modelo: 'whisper-1', chave: chave || undefined, tipo: 'audio' }); avisar(chave ? 'Chave de áudio salva.' : 'Chave de áudio removida.'); ctx.navegar('assistente'); }
      catch (err) { avisar(err.campos ? Object.values(err.campos)[0] : err.message, 'erro'); }
    });
  });

  // ---------- configurações ----------
  const f = $('#form-assistente', alvo);
  $('#sempre', alvo).addEventListener('change', (e) => { $('#horario-grade', alvo).hidden = e.target.checked; });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const horario = {};
    if (!$('#sempre', alvo).checked) {
      for (const [d] of DIAS) {
        const ligado = $(`[data-dia="${d}"]`, f).checked;
        const ini = $(`[data-abre="${d}"]`, f).value, fim = $(`[data-fecha="${d}"]`, f).value;
        if (ligado && (!ini || !fim || ini >= fim)) return avisar('Confira os horários: o fim precisa ser depois do início.', 'erro');
        horario[d] = ligado ? [ini, fim] : null;
      }
    }
    const d = {
      ativo: f.elements.ativo.checked, nome: f.elements.nome.value.trim(), instrucoes: f.elements.instrucoes.value, boasVindas: f.elements.boasVindas.value,
      msgAusencia: f.elements.msgAusencia.value, msgRepasse: f.elements.msgRepasse.value, horario, foraHorario: f.elements.foraHorario.value,
      palavrasAtendente: f.elements.palavrasAtendente.value.split(',').map((p) => p.trim()).filter((p) => p.length >= 2),
      retornoHoras: Number(f.elements.retornoHoras.value || 0), limiteDiario: Number(f.elements.limiteDiario.value || 0),
      silencioInicio: Number(f.elements.silencioInicio.value), silencioFim: Number(f.elements.silencioFim.value),
    };
    if (!marcarErros(f, d.nome.length >= 2 ? {} : { nome: 'Informe o nome do assistente.' })) return;
    await comBotao($('.barra-salvar [type=submit]', f), async () => {
      try {
        const r = await api.salvarAssistente(d);
        const selo = $('#selo-ativo', alvo); selo.className = 'selo ' + (r.ativo ? 'ok' : 'neutro'); selo.textContent = r.ativo ? 'Ligado' : 'Desligado';
        avisar('Configurações salvas.');
      } catch (err) { if (err.campos) { marcarErros(f, err.campos); if (err.campos.ativo) avisar(err.campos.ativo, 'erro'); } else avisar(err.message, 'erro'); }
    });
  });

  // ---------- teste ----------
  let historico = [];
  const area = $('#teste-mensagens', alvo), fTeste = $('#form-teste', alvo), campo = $('#teste-texto', alvo);
  const balao = (papel, texto, extra) => {
    area.insertAdjacentHTML('beforeend', String(html`<div class="balao ${papel === 'cliente' ? 'entrada' : 'saida'}"><span>${texto}</span>${extra ? html`<span class="rodape-balao">${extra}</span>` : ''}</div>`));
    area.scrollTop = area.scrollHeight;
  };
  campo.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fTeste.requestSubmit(); } });
  $('#limpar-teste', alvo).addEventListener('click', () => { historico = []; render(area, html`<div class="evento-chat">Conversa recomeçada.</div>`); campo.focus(); });
  fTeste.addEventListener('submit', async (e) => {
    e.preventDefault();
    const texto = campo.value.trim();
    if (!texto) return;
    historico.push({ papel: 'cliente', texto });
    balao('cliente', texto);
    campo.value = '';
    await comBotao($('[type=submit]', fTeste), async () => {
      try {
        const r = await api.testarAssistente(historico.slice(-20));
        const extra = [r.ferramentas?.length ? `consultou: ${r.ferramentas.join(', ')}` : '', r.chamouAtendente ? 'chamaria a equipe' : ''].filter(Boolean).join(' · ');
        if (r.resposta) { historico.push({ papel: 'assistente', texto: r.resposta }); balao('assistente', r.resposta, extra); }
        else balao('assistente', '(sem resposta)', extra);
      } catch (err) { avisar(err.message, 'erro'); historico.pop(); }
    });
    campo.focus();
  });
}
