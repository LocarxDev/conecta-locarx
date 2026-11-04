// Assistente virtual da loja (dono): ligar, IA, personalidade, horário, comportamento e teste.
import { api } from '../api.js';
import { html, render, $, $$, icone, avisar, comBotao, marcarErros, confirmar, preferencia } from '../util.js';

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
  // v14.7: a loja é entregue pronta. O gestor liga/desliga a Lia e cuida do horário, dias fechados e "continuar sem equipe";
  // nome, textos, orientações, palavras, retorno, silêncio, IA e limite são da administração (que abre esta tela por Lojas → loja).
  const admin = ctx.usuario.perfil === 'admin';
  const ABAS = [['apresenta', 'Como a Lia se apresenta'], ['horario', 'Horário e equipe'], ...(admin ? [['ia', 'Inteligência artificial']] : []), ['teste', 'Testar assistente']];
  let aba = preferencia.ler('aba-assistente');
  if (!ABAS.some(([v]) => v === aba)) aba = 'apresenta';
  const horaOpcoes = (sel) => [...Array(24).keys()].map((h) => html`<option value="${h}" ${h === sel ? 'selected' : ''}>${String(h).padStart(2, '0')}h</option>`);

  render(alvo, html`
    <div class="cabecalho-pagina">
      <div class="titulos"><h1>Assistente virtual</h1><p>Quem atende os clientes da loja no WhatsApp quando a equipe não está na conversa.</p></div>
      <span class="selo ${a.ativo ? 'ok' : 'neutro'}" id="selo-ativo">${a.ativo ? 'Ligado' : 'Desligado'}</span>
    </div>
    ${a.iaSimulada ? html`<div class="faixa-exemplo">${icone('info')}<span>Servidor em modo de teste: a IA é simulada.</span></div>` : ''}
    ${!a.apiLocarx ? html`<div class="alerta-caixa info">${icone('info')}<span>A ligação com o portal LocarX ainda não foi configurada no servidor. Por enquanto o assistente tira dúvidas, mas não consulta carros nem faz reservas.</span></div>` : ''}

    <div class="abas abas-pagina abas-assistente" role="tablist" aria-label="Configurações do assistente">
      ${ABAS.map(([v, t]) => html`<button type="button" role="tab" data-aba="${v}" class="${aba === v ? 'ativa' : ''}" aria-selected="${aba === v}">${t}</button>`)}
    </div>

    <form class="form" id="form-assistente" novalidate>
      <!-- 1. Como a Lia se apresenta -->
      <section class="painel" data-painel="apresenta">
        <div class="painel-cab"><h2>Como a Lia se apresenta</h2></div>
        <div class="painel-corpo form">
          ${admin ? '' : html`<div class="alerta-caixa info">${icone('info')}<span>Nome, saudação e orientações da Lia são configurados pela administração da rede, que entrega a loja pronta. Aqui você liga ou desliga a assistente; o horário e os dias fechados ficam na aba "Horário e equipe".</span></div>`}
          <label class="checkbox opcao-destaque"><input type="checkbox" name="ativo" ${a.ativo ? 'checked' : ''}>
            <span><strong>Assistente ligado</strong><br><span class="sub">Atende as conversas novas no WhatsApp, no Instagram e no chat do site.</span></span></label>
          <div class="campo campo-curto"><label for="as-nome">Nome do assistente</label><input id="as-nome" name="nome" value="${a.nome}" maxlength="60"></div>
          <div class="campo"><label for="as-boas">Saudação do primeiro contato</label>
            <textarea id="as-boas" name="boasVindas" rows="2" maxlength="1000" data-cresce placeholder="Ex.: Olá! Sou a Lia, assistente da LocarX Salvador Aeroporto.">${a.boasVindas}</textarea></div>
          <div class="campo"><label for="as-instr">Orientações desta loja <span class="sub contador" data-contador-de="as-instr"></span></label>
            <textarea id="as-instr" name="instrucoes" rows="10" maxlength="8000" class="texto-longo" data-cresce placeholder="Ex.: Sempre ofereça a proteção Super X. Clientes de empresa: peça o CNPJ e chame um atendente.">${a.instrucoes}</textarea>
            <p class="ajuda">Jeito de falar e regras de atendimento da loja. Regras como caução, documentos e endereço ficam melhor na Base de conhecimento.</p></div>
        </div>
      </section>

      <!-- 2. Horário e equipe -->
      <div class="pilha-aba" data-painel="horario">
        <div class="caixa-expediente" id="caixa-expediente" hidden></div>
        <div class="perfil-grade">
          <section class="painel">
            <div class="painel-cab"><h2>Horário da equipe</h2></div>
            <div class="painel-corpo form">
              <p class="sub">A Lia usa este horário para saber se tem gente da loja para assumir uma conversa.</p>
              <label class="checkbox"><input type="checkbox" id="sempre" ${semHorario ? 'checked' : ''}> Atender 24 horas, todos os dias</label>
              <div class="horario-grade" id="horario-grade" ${semHorario ? 'hidden' : ''}>
                ${DIAS.map(([d, nome]) => { const fx = a.horario?.[d]; return html`<div class="horario-linha">
                  <label class="checkbox"><input type="checkbox" data-dia="${d}" ${fx ? 'checked' : ''}> ${nome}</label>
                  <input type="time" data-abre="${d}" value="${fx?.[0] || '08:00'}" aria-label="${nome}: início">
                  <span class="sub">às</span>
                  <input type="time" data-fecha="${d}" value="${fx?.[1] || '18:00'}" aria-label="${nome}: fim"></div>`; })}
              </div>
              <label class="checkbox opcao-destaque"><input type="checkbox" name="continuarSemEquipe" ${a.continuarSemEquipe !== false ? 'checked' : ''}>
                <span><strong>Sem atendente, a Lia continua atendendo</strong><br>
                <span class="sub">Avisa quando a equipe volta, tira dúvidas, cota e reserva, e marca a conversa como "Pendente para a equipe". Desligado: a conversa só fica na fila.</span></span></label>
              <div class="campo"><label for="as-fora">Fora do horário</label><select id="as-fora" name="foraHorario">
                <option value="assistente" ${a.foraHorario === 'assistente' ? 'selected' : ''}>O assistente atende normalmente</option>
                <option value="mensagem" ${a.foraHorario === 'mensagem' ? 'selected' : ''}>Mandar mensagem de ausência e deixar para a equipe</option></select></div>
              <div class="campo"><label for="as-ausencia">Mensagem de ausência</label><textarea id="as-ausencia" name="msgAusencia" rows="3" maxlength="1000" placeholder="Ex.: Nosso atendimento é das 8h às 18h. Assim que abrirmos, respondemos você.">${a.msgAusencia}</textarea></div>
            </div>
          </section>

          <section class="painel">
            <div class="painel-cab"><h2>Dias fechados e feriados</h2></div>
            <div class="painel-corpo form">
              <p class="sub">Nesses dias a equipe não atende, mesmo que caia num dia útil: feriado, emenda ou dia com horário especial.</p>
              <ul class="dias-fechados" id="dias-fechados"></ul>
              <div class="form-linha">
                <div class="campo"><label for="df-de">De</label><input id="df-de" type="date"></div>
                <div class="campo"><label for="df-ate">Até</label><input id="df-ate" type="date"></div>
              </div>
              <div class="campo"><label for="df-motivo">Motivo</label><input id="df-motivo" maxlength="80" placeholder="Ex.: feriado de Finados"></div>
              <label class="checkbox"><input type="checkbox" id="df-especial"> Horário especial nesse dia (em vez de fechado)</label>
              <div class="form-linha" id="df-horas" hidden>
                <div class="campo"><label for="df-abre">Abre às</label><input id="df-abre" type="time" value="08:00"></div>
                <div class="campo"><label for="df-fecha">Fecha às</label><input id="df-fecha" type="time" value="12:00"></div>
              </div>
              <div><button class="btn btn-contorno" type="button" id="df-adicionar">${icone('mais')}Adicionar dia fechado</button></div>
            </div>
          </section>
        </div>

        <section class="painel">
          <div class="painel-cab"><h2>Quando chamar a equipe</h2>${admin ? '' : html`<span class="sub">Configurado pela administração da rede</span>`}</div>
          <div class="painel-corpo form">
            <div class="form-linha">
              <div class="campo"><label for="as-palavras">Palavras que chamam um atendente</label><input id="as-palavras" name="palavrasAtendente" value="${(a.palavrasAtendente || []).join(', ')}">
                <p class="ajuda">Separe por vírgula. Se o cliente escrever uma delas, a conversa vai direto para a equipe.</p></div>
              <div class="campo"><label for="as-repasse">Mensagem ao chamar a equipe</label><input id="as-repasse" name="msgRepasse" value="${a.msgRepasse}" maxlength="1000" placeholder="Ex.: Vou chamar um atendente da loja, é só aguardar um instante.">
                <p class="ajuda">O que a Lia escreve ao passar a conversa.</p></div>
            </div>
            <div class="form-linha campos-tres">
              <div class="campo"><label for="as-retorno">Lia volta depois de</label>
                <div class="campo-com-unidade"><input id="as-retorno" name="retornoHoras" type="number" min="0" max="72" value="${a.retornoHoras}"><span class="sub">horas</span></div>
                <p class="ajuda">Sem resposta da equipe. 0 = nunca volta sozinha.</p></div>
              <div class="campo"><label for="as-sil-ini">Silêncio das automáticas: de</label><select id="as-sil-ini" name="silencioInicio">${horaOpcoes(a.silencioInicio)}</select>
                <p class="ajuda">Mensagens automáticas não saem nesse intervalo.</p></div>
              <div class="campo"><label for="as-sil-fim">até</label><select id="as-sil-fim" name="silencioFim">${horaOpcoes(a.silencioFim)}</select></div>
            </div>
          </div>
        </section>
      </div>
    </form>

    <!-- 3. Inteligência artificial -->
    <div class="pilha-aba" data-painel="ia">
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
          <div class="filtros"><button class="btn btn-primario" type="submit">Testar e salvar chave</button>
            ${a.temChave ? html`<button class="btn btn-texto" type="button" id="remover-chave">Remover chave</button>` : ''}</div>
        </form>
      </section>
      <div class="perfil-grade">
        <section class="painel">
          <div class="painel-cab"><h2>Áudios dos clientes</h2>${a.temChaveAudio ? html`<span class="selo ok">Transcrição ligada</span>` : ''}</div>
          <div class="painel-corpo form">
            <p class="sub">Para a Lia entender áudios, é preciso uma chave da OpenAI. ${a.provedor === 'openai' ? 'Como a loja já usa a OpenAI, a mesma chave é usada.' : 'Cadastre aqui uma chave OpenAI só para transcrever áudios.'}</p>
            <div class="campo"><label for="ia-chave-audio">Chave OpenAI para áudios</label><input id="ia-chave-audio" type="password" autocomplete="off" placeholder="${a.temChaveAudio ? 'Cadastrada' : 'Opcional'}"></div>
            <div><button class="btn btn-contorno" type="button" id="salvar-chave-audio">Salvar chave de áudio</button></div>
          </div>
        </section>
        <section class="painel">
          <div class="painel-cab"><h2>Limite de uso</h2></div>
          <div class="painel-corpo form">
            <div class="campo campo-curto"><label for="as-limite">Respostas por dia</label><input id="as-limite" name="limiteDiario" type="number" min="0" max="100000" value="${a.limiteDiario}" form="form-assistente">
              <p class="ajuda">Protege contra gasto excessivo de IA. Gravado em "Salvar configurações".</p></div>
          </div>
        </section>
      </div>
    </div>

    <!-- 4. Testar -->
    <section class="painel" data-painel="teste">
      <div class="painel-cab"><h2>Testar o assistente</h2><span class="sub">Nada é enviado ao cliente. Usa as configurações já salvas.</span></div>
      <div class="teste-chat teste-chat-largo" id="teste-chat">
        <div class="mensagens" id="teste-mensagens"><div class="evento-chat">Escreva como se fosse um cliente. Reservas aqui são só simulação.</div></div>
        <form class="compositor" id="form-teste"><div class="linha-comp">
          <label class="sr-only" for="teste-texto">Mensagem de teste</label>
          <textarea id="teste-texto" rows="1" placeholder="Ex.: Quanto é a caução?"></textarea>
          <button class="btn btn-primario" type="submit">Enviar</button></div>
          <div class="opcoes-comp"><button class="btn btn-texto" type="button" id="limpar-teste">Recomeçar conversa</button></div>
        </form>
      </div>
    </section>

    <div class="barra-salvar barra-salvar-fixa" id="barra-salvar">
      <span class="sub estado-salvar" id="estado-salvar">Tudo salvo.</span>
      <button class="btn btn-primario" type="submit" form="form-assistente">Salvar configurações</button>
    </div>`);

  // ---------- abas ----------
  const barra = $('#barra-salvar', alvo);
  function trocarAba(nova) {
    aba = nova; preferencia.gravar('aba-assistente', nova);
    $$('[data-aba]', alvo).forEach((b) => { b.classList.toggle('ativa', b.dataset.aba === nova); b.setAttribute('aria-selected', String(b.dataset.aba === nova)); });
    $$('[data-painel]', alvo).forEach((p) => { p.hidden = p.dataset.painel !== nova; });
    barra.hidden = nova === 'teste';
    $('#form-assistente', alvo).hidden = !['apresenta', 'horario'].includes(nova);
    if (nova === 'apresenta') $$('[data-cresce]', alvo).forEach((t) => t._ajustar?.());
  }
  $$('[data-aba]', alvo).forEach((b) => b.addEventListener('click', () => trocarAba(b.dataset.aba)));
  trocarAba(aba);
  if (!admin) {
    // campos da administração ficam visíveis, mas travados (o valor continua indo no formulário; a API também ignora mudanças do gestor)
    const f0 = $('#form-assistente', alvo);
    for (const n of ['nome', 'boasVindas', 'instrucoes', 'foraHorario', 'msgAusencia', 'palavrasAtendente', 'msgRepasse', 'retornoHoras', 'silencioInicio', 'silencioFim', 'limiteDiario']) { const el = f0.elements[n]; if (el) { el.disabled = true; el.title = 'Configurado pela administração da rede.'; } }
  }

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
  const estadoSalvar = $('#estado-salvar', alvo);
  const sujo = (v) => { barra.classList.toggle('pendente', v); estadoSalvar.textContent = v ? 'Alterações não salvas' : 'Tudo salvo.'; };
  // campos da configuração (inclui o limite diário, que fica na aba de IA mas pertence a este formulário)
  const ehDaConfig = (el) => el && (el.form === f || el.id === 'sempre' || el.dataset?.dia || el.dataset?.abre || el.dataset?.fecha);
  alvo.addEventListener('input', (e) => { if (ehDaConfig(e.target)) sujo(true); });
  alvo.addEventListener('change', (e) => { if (ehDaConfig(e.target)) sujo(true); });
  const avisoSair = (e) => { if (barra.classList.contains('pendente') && document.body.contains(barra)) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', avisoSair);
  // campos de texto crescem com o conteúdo; o de orientações mostra quantos caracteres ainda cabem
  $$('[data-cresce]', f).forEach((t) => {
    const ajustar = () => { if (!t.offsetParent) return; t.style.height = 'auto'; t.style.height = Math.max(t.scrollHeight + 2, t.classList.contains('texto-longo') ? 240 : 0) + 'px'; };
    t._ajustar = ajustar; t.addEventListener('input', ajustar); ajustar();
  });
  $$('[data-contador-de]', f).forEach((c) => {
    const t = $('#' + c.dataset.contadorDe, f);
    const mostrar = () => { c.textContent = `${t.value.length.toLocaleString('pt-BR')} / ${Number(t.maxLength).toLocaleString('pt-BR')}`; c.classList.toggle('alerta', t.value.length > t.maxLength * 0.9); };
    t.addEventListener('input', mostrar); mostrar();
  });
  $('#sempre', alvo).addEventListener('change', (e) => { $('#horario-grade', alvo).hidden = e.target.checked; });

  // ---------- dias fechados e feriados ----------
  let diasFechados = (a.diasFechados || []).map((x) => ({ ...x }));
  const dataBr = (d) => { const [y, m, dd] = d.split('-'); return `${dd}/${m}`; };
  const diaSemana = (d) => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(`${d}T12:00:00`).getDay()];
  const listaDf = $('#dias-fechados', alvo);
  function desenharDias() {
    if (!diasFechados.length) return render(listaDf, html`<li class="sub vazio">Nenhum dia fechado cadastrado.</li>`);
    render(listaDf, html`${diasFechados.map((x, i) => html`<li>
      <div><strong>${diaSemana(x.de)}, ${dataBr(x.de)}${x.ate && x.ate !== x.de ? html` a ${diaSemana(x.ate)}, ${dataBr(x.ate)}` : ''}</strong>
        <span class="sub">${x.motivo || 'sem motivo'} · ${x.abre && x.fecha ? `horário especial ${x.abre}–${x.fecha}` : 'fechado'}</span></div>
      <button type="button" class="btn btn-texto btn-icone" data-remover-dia="${i}" aria-label="Remover">${icone('fechar')}</button></li>`)}`);
    $$('[data-remover-dia]', listaDf).forEach((b) => b.addEventListener('click', () => { diasFechados.splice(Number(b.dataset.removerDia), 1); desenharDias(); sujo(true); }));
  }
  desenharDias();
  $('#df-especial', alvo).addEventListener('change', (e) => { $('#df-horas', alvo).hidden = !e.target.checked; });
  $('#df-de', alvo).addEventListener('change', (e) => { const ate = $('#df-ate', alvo); if (!ate.value || ate.value < e.target.value) ate.value = e.target.value; });
  $('#df-adicionar', alvo).addEventListener('click', () => {
    const de = $('#df-de', alvo).value, ate = $('#df-ate', alvo).value || de, motivo = $('#df-motivo', alvo).value.trim();
    const especial = $('#df-especial', alvo).checked, abre = $('#df-abre', alvo).value, fecha = $('#df-fecha', alvo).value;
    if (!de) return avisar('Informe a data inicial.', 'erro');
    if (ate < de) return avisar('A data final precisa ser igual ou depois da inicial.', 'erro');
    if (especial && (!abre || !fecha || abre >= fecha)) return avisar('No horário especial, o fechar precisa ser depois do abrir.', 'erro');
    if (diasFechados.length >= 60) return avisar('No máximo 60 períodos fechados.', 'erro');
    diasFechados.push({ de, ate, motivo, abre: especial ? abre : null, fecha: especial ? fecha : null });
    diasFechados.sort((x, y) => x.de.localeCompare(y.de));
    ['#df-de', '#df-ate', '#df-motivo'].forEach((id) => { $(id, alvo).value = ''; });
    desenharDias(); sujo(true);
    avisar('Dia adicionado. Clique em "Salvar configurações" para gravar.');
  });

  // ---------- como a Lia vai responder agora ----------
  async function mostrarExpediente() {
    const caixa = $('#caixa-expediente', alvo);
    try {
      const e = await api.expediente();
      const quando = e.proximaAbertura?.texto || 'sem abertura prevista nos próximos 14 dias';
      const continua = e.continuarSemEquipe;
      let titulo, frase;
      if (e.equipeDisponivel) { titulo = `Equipe disponível agora (${e.pessoasDisponiveis} pessoa${e.pessoasDisponiveis > 1 ? 's' : ''} "Disponível").`; frase = 'Se o cliente pedir uma pessoa, a conversa vai para a equipe pela roleta.'; }
      else if (e.abertoAgora) { titulo = 'Loja no horário, mas ninguém marcado como "Disponível".'; frase = continua ? '"Nossa equipe vai falar com você hoje mesmo, assim que um atendente ficar livre. Enquanto isso, posso te ajudar por aqui."' : 'Pedidos de atendente ficam na fila esperando alguém.'; }
      else { titulo = html`Equipe fora do horário. Próxima abertura: <strong>${quando}</strong>.`; frase = continua ? `"Nossa equipe não está atendendo agora; um atendente vai falar com você a partir de ${quando}. Enquanto isso, posso te ajudar por aqui."` : 'Pedidos de atendente ficam na fila esperando a equipe.'; }
      caixa.hidden = false;
      render(caixa, html`<span class="rotulo">Como a Lia vai responder agora</span><p>${titulo}</p><p class="sub">${frase}</p>`);
    } catch { caixa.hidden = true; }
  }
  mostrarExpediente();
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
      diasFechados, continuarSemEquipe: f.elements.continuarSemEquipe.checked,
    };
    if (!marcarErros(f, d.nome.length >= 2 ? {} : { nome: 'Informe o nome do assistente.' })) return;
    await comBotao($('#barra-salvar [type=submit]', alvo), async () => {
      try {
        const r = await api.salvarAssistente(d);
        const selo = $('#selo-ativo', alvo); selo.className = 'selo ' + (r.ativo ? 'ok' : 'neutro'); selo.textContent = r.ativo ? 'Ligado' : 'Desligado';
        sujo(false);
        avisar('Configurações salvas.');
        mostrarExpediente();
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
