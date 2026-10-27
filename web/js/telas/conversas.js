// Caixa de conversas do WhatsApp da loja.
// A lista se atualiza sozinha a cada poucos segundos (o "vigia" roda enquanto alguém da loja está logado).
import { api } from '../api.js';
import { html, render, $, $$, icone, iniciais, avisar, abrirModal, comBotao, chipEtiqueta, preferencia, telefoneBr } from '../util.js';
import { abrirCotacao } from './cotacao.js';
import { montarPainelCliente } from './painel-cliente.js';

// ---------------------------------------------------------------------
// Vigia: busca só o que mudou e avisa as telas, o contador do menu e o navegador
// ---------------------------------------------------------------------
const store = { mapa: new Map(), cursor: null, ouvintes: new Set(), timer: null, ativa: null, carregado: false, ctx: null };
const TITULO = 'Conecta LocarX';

export function iniciarVigia(ctx) {
  store.ctx = ctx;
  if (store.timer || !['dono', 'atendente'].includes(ctx.usuario.perfil)) return;
  const ciclo = async () => {
    await sincronizar();
    store.timer = setTimeout(ciclo, document.hidden ? 8000 : 3000);
  };
  store.timer = setTimeout(ciclo, 0);
}

export function pararVigia() {
  clearTimeout(store.timer);
  Object.assign(store, { timer: null, mapa: new Map(), cursor: null, carregado: false, ativa: null });
  document.title = TITULO;
}

async function sincronizar() {
  try {
    const r = await api.listarConversas({ desde: store.cursor || undefined });
    const novidades = [], paraMim = [];
    const eu = store.ctx?.usuario?.id;
    for (const c of r.conversas) {
      const antes = store.mapa.get(c.id);
      if (store.carregado && c.naoLidas > (antes?.naoLidas || 0)) novidades.push(c);
      // roleta: conversa que acabou de ser entregue para mim
      if (store.carregado && eu && c.estado === 'humano' && c.atendente?.id === eu && antes?.atendente?.id !== eu && c.atribuidaEm && Date.now() - new Date(c.atribuidaEm) < 120_000) paraMim.push(c);
      store.mapa.set(c.id, c);
    }
    store.cursor = r.cursor;
    store.carregado = true;
    atualizarContadores();
    novidades.forEach(notificar);
    paraMim.forEach((c) => {
      avisar(`Nova conversa para você: ${nomeDe(c)}`);
      notificar({ ...c, previa: 'A roleta entregou esta conversa para você' });
    });
    store.ouvintes.forEach((f) => f(r.conversas));
  } catch (err) {
    if (err.status === 401) { pararVigia(); store.ctx?.sessaoExpirou(); }
  }
}

export function atualizarContadores() {
  const n = [...store.mapa.values()].filter((c) => c.naoLidas > 0 && c.estado !== 'encerrada').length;
  const el = document.getElementById('contador-conversas');
  if (el) { el.hidden = !n; el.textContent = n > 99 ? '99+' : String(n); }
  document.title = n ? `(${n}) ${TITULO}` : TITULO;
}

function notificar(c) {
  if (!document.hidden && store.ativa === c.id) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(nomeDe(c), { body: c.previa || 'Nova mensagem', tag: 'conversa-' + c.id, icon: '/assets/icone-192.png' });
    n.onclick = () => { window.focus(); location.hash = '#/conversas/' + c.id; n.close(); };
  } catch { /* alguns navegadores só permitem avisos por service worker */ }
}

// ---------------------------------------------------------------------
// formatos
// ---------------------------------------------------------------------
const telefoneBonito = (t) => telefoneBr(t) || '+' + t;
const nomeDe = (c) => c.contato.nome || telefoneBonito(c.contato.telefone);
const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
function quandoCurto(iso) {
  const d = new Date(iso), hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return hora(iso);
  const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === ontem.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function rotuloDia(iso) {
  const d = new Date(iso), hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return 'Hoje';
  const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === ontem.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}
const ESTADO = {
  aguardando: html`<span class="selo alerta">Aguardando atendente</span>`,
  humano: html`<span class="selo ok">Em atendimento</span>`,
  assistente: html`<span class="selo neutro">Com o assistente</span>`,
  encerrada: html`<span class="selo neutro">Encerrada</span>`,
};
const FILTROS = [
  ['abertas', 'Abertas', (c) => c.estado !== 'encerrada'],
  ['aguardando', 'Aguardando', (c) => c.estado === 'aguardando'],
  ['minhas', 'Minhas', (c, eu) => c.estado === 'humano' && c.atendente?.id === eu.id],
  ['assistente', 'Assistente', (c) => c.estado === 'assistente'],
  ['encerradas', 'Encerradas', (c) => c.estado === 'encerrada'],
];
const TIPOS_ARQUIVO = 'image/jpeg,image/png,image/webp,application/pdf,.docx,.xlsx';
const MIME_EXT = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

// ---------------------------------------------------------------------
// tela
// ---------------------------------------------------------------------
export async function montar(alvo, ctx) {
  const eu = ctx.usuario;
  let filtro = 'abertas';
  let busca = '';
  let aberta = null;           // conversa aberta
  let mensagens = [];
  let cursorMsgs = null;
  let timerMsgs = null;
  let respostasRapidas = null;
  let anexo = null;            // { nome, mimetype, base64 }
  let modoNota = false;
  let canalOk = true;

  render(alvo, html`
    <div class="caixa" id="caixa">
      <section class="caixa-lista" aria-label="Lista de conversas">
        <div class="caixa-lista-cab">
          <div class="linha"><h2>Conversas</h2>
            ${'Notification' in window && Notification.permission === 'default' ? html`<button class="btn btn-texto" id="ativar-avisos" title="Receber aviso quando chegar mensagem">${icone('alerta')}Ativar avisos</button>` : ''}
          </div>
          <label class="busca"><span class="sr-only">Buscar por nome ou telefone</span>${icone('busca')}<input id="busca-conversa" type="search" placeholder="Buscar por nome ou telefone" autocomplete="off"></label>
          <div class="filtro-chips" id="filtros" role="tablist" aria-label="Filtrar conversas"></div>
        </div>
        <div class="lista-conversas" id="lista-conversas"><div class="painel-corpo"><div class="esqueleto"></div></div></div>
      </section>
      <section class="chat" id="chat" aria-label="Conversa"></section>
      <aside class="lateral" id="lateral" aria-label="Dados do cliente" hidden></aside>
    </div>`);

  const caixa = $('#caixa', alvo), listaEl = $('#lista-conversas', alvo), chatEl = $('#chat', alvo), lateralEl = $('#lateral', alvo);
  const telaLarga = () => matchMedia('(min-width: 1280px)').matches;
  let lateralAberta = telaLarga() && preferencia.ler('painel-cliente') !== 'fechado';
  let painel = null;

  // ---------- painel do cliente (funil, etiquetas, informações) ----------
  function desenharLateral() {
    painel?.destruir(); painel = null;
    const mostrar = !!aberta && lateralAberta;
    lateralEl.hidden = !mostrar;
    caixa.classList.toggle('com-lateral', mostrar);
    $('[data-lateral]', chatEl)?.setAttribute('aria-pressed', String(mostrar));
    if (!mostrar) return render(lateralEl, '');
    render(lateralEl, html`<div class="lateral-cab"><strong>Dados do cliente</strong>
      <span><a class="btn btn-texto" href="#/clientes/${aberta.contato.id}">Ficha</a>
      <button class="btn btn-texto btn-icone" data-fechar-lateral aria-label="Fechar dados do cliente">${icone('fechar')}</button></span></div>
      <div class="lateral-corpo" id="lateral-corpo"></div>`);
    painel = montarPainelCliente($('#lateral-corpo', lateralEl), aberta.contato.id, { comLinkFicha: false });
    $('[data-fechar-lateral]', lateralEl).addEventListener('click', () => alternarLateral(false));
  }
  function alternarLateral(abrirPainel = !lateralAberta) {
    lateralAberta = abrirPainel;
    if (telaLarga()) preferencia.gravar('painel-cliente', abrirPainel ? 'aberto' : 'fechado');
    desenharLateral();
    if (abrirPainel) $('#lateral-corpo', lateralEl)?.focus?.();
  }

  $('#ativar-avisos', alvo)?.addEventListener('click', async (e) => {
    const r = await Notification.requestPermission().catch(() => 'denied');
    e.currentTarget.remove();
    avisar(r === 'granted' ? 'Avisos ativados. Você será avisado quando chegar mensagem.' : 'Os avisos foram bloqueados no navegador.', r === 'granted' ? 'ok' : 'erro');
  });
  $('#busca-conversa', alvo).addEventListener('input', (e) => { busca = e.target.value.trim().toLowerCase(); desenharLista(); });

  // ---------- lista ----------
  function visiveis() {
    const regra = FILTROS.find((f) => f[0] === filtro)[2];
    const dig = busca.replace(/\D/g, '');
    return [...store.mapa.values()]
      .filter((c) => regra(c, eu))
      .filter((c) => !busca || (c.contato.nome || '').toLowerCase().includes(busca) || (dig && c.contato.telefone.includes(dig)))
      .sort((a, b) => b.ultimaMensagemEm.localeCompare(a.ultimaMensagemEm));
  }

  function desenharFiltros() {
    const todas = [...store.mapa.values()];
    render($('#filtros', alvo), html`${FILTROS.map(([id, rotulo, regra]) => {
      const n = id === 'encerradas' ? 0 : todas.filter((c) => regra(c, eu)).length;
      return html`<button role="tab" data-filtro="${id}" class="${filtro === id ? 'ativo' : ''}" aria-selected="${filtro === id}">${rotulo}${n ? html` <span class="n">${n}</span>` : ''}</button>`;
    })}`);
    $$('[data-filtro]', alvo).forEach((b) => b.addEventListener('click', () => { filtro = b.dataset.filtro; desenharFiltros(); desenharLista(); }));
  }

  function desenharLista() {
    if (!store.carregado) return;
    const lista = visiveis();
    if (!lista.length) {
      render(listaEl, html`<div class="estado">${icone('conversas')}<h3>${store.mapa.size ? 'Nada por aqui' : 'Nenhuma conversa ainda'}</h3>
        <p>${store.mapa.size ? 'Nenhuma conversa neste filtro ou busca.' : 'Quando um cliente mandar mensagem para o WhatsApp da loja, a conversa aparece aqui.'}</p></div>`);
      return;
    }
    render(listaEl, html`${lista.map((c) => html`
      <a class="item-conversa${c.naoLidas ? ' nao-lida' : ''}${aberta?.id === c.id ? ' ativa' : ''}" href="#/conversas/${c.id}" data-id="${c.id}">
        <span class="avatar">${c.contato.nome ? iniciais(c.contato.nome) : '#'}</span>
        <span class="meio"><span class="nome">${nomeDe(c)}</span><span class="previa">${c.previa || ''}</span>
          ${c.etiquetas?.length ? html`<span class="etiquetas-conversa">${c.etiquetas.slice(0, 3).map((e) => chipEtiqueta(e))}${c.etiquetas.length > 3 ? html`<span class="sub">+${c.etiquetas.length - 3}</span>` : ''}</span>` : ''}</span>
        <span class="lado"><span class="hora">${quandoCurto(c.ultimaMensagemEm)}</span>
          ${c.naoLidas ? html`<span class="bolinha">${c.naoLidas > 99 ? '99+' : c.naoLidas}</span>` : html`<span class="marca-estado ${c.estado}" title="${c.estado}"></span>`}</span>
      </a>`)}`);
  }

  const aoMudarLista = (mudadas) => {
    desenharFiltros(); desenharLista();
    if (aberta) {
      const nova = store.mapa.get(aberta.id);
      if (nova && mudadas?.some((m) => m.id === aberta.id)) {
        const mudouEstado = nova.estado !== aberta.estado || nova.atendente?.id !== aberta.atendente?.id;
        aberta = nova;
        if (mudouEstado) desenharCabecalho();
        if (nova.naoLidas && !document.hidden) marcarLida();
        painel?.recarregar();
      }
    }
  };
  store.ouvintes.add(aoMudarLista);
  if (store.carregado) aoMudarLista([]);
  else desenharFiltros();

  // ---------- conversa aberta ----------
  function chatVazio() {
    caixa.classList.remove('com-conversa');
    painel?.destruir(); painel = null; lateralEl.hidden = true; caixa.classList.remove('com-lateral');
    render(chatEl, html`<div class="chat-vazio">${icone('conversas')}<h3>Escolha uma conversa</h3><p>As mensagens do WhatsApp da loja aparecem aqui.</p></div>`);
  }

  function desenharCabecalho() {
    const cab = $('#chat-cab', chatEl);
    if (!cab || !aberta) return;
    const c = aberta, minha = c.estado === 'humano' && c.atendente?.id === eu.id;
    render(cab, html`
      <a class="btn btn-texto btn-icone voltar" href="#/conversas" aria-label="Voltar para a lista">${icone('voltar')}</a>
      <span class="avatar">${c.contato.nome ? iniciais(c.contato.nome) : '#'}</span>
      <div class="quem"><strong>${nomeDe(c)}</strong><span>${telefoneBonito(c.contato.telefone)}${c.atendente ? ` · com ${c.atendente.nome}` : ''}${c.transferida ? (c.transferida.atendimento.id === ctx.usuario.loja?.id ? ` · 📍 veio de ${c.transferida.origem.nome}` : ` · 📍 atendida por ${c.transferida.atendimento.nome}`) : ''}</span></div>
      <div class="acoes-chat">
        ${ESTADO[c.estado]}
        <button class="btn btn-contorno" data-lateral aria-pressed="${lateralAberta}" title="Funil, etiquetas e informações do cliente">${icone('painel')}<span class="rotulo-lateral">Dados do cliente</span></button>
        ${c.estado !== 'encerrada' && ctx.usuario.loja?.modulos?.cotacao !== false ? html`<button class="btn btn-contorno" data-cotacao title="Consultar valores da tabela vigente e enviar ao cliente, sem sair da conversa">${icone('busca')}<span class="rotulo-lateral">Cotação</span></button>` : ''}
        ${!minha && c.estado !== 'encerrada' ? html`<button class="btn btn-primario" data-acao="assumir">Assumir</button>` : ''}
        ${c.estado === 'humano' ? html`<button class="btn btn-contorno" data-acao="devolver" title="O assistente virtual entra na etapa 3">Devolver ao assistente</button>` : ''}
        ${c.estado !== 'encerrada' && (eu.perfil === 'dono' || minha) ? html`<button class="btn btn-contorno" data-acao="transferir">Transferir</button>` : ''}
        ${c.estado !== 'encerrada' ? html`<button class="btn btn-contorno" data-acao="encerrar">Encerrar</button>` : ''}
      </div>`);
    $$('[data-acao]', cab).forEach((b) => b.addEventListener('click', () => acao(b.dataset.acao, b)));
    $('[data-lateral]', cab).addEventListener('click', () => alternarLateral());
    $('[data-cotacao]', cab)?.addEventListener('click', () => {
      if (!canalOk) return avisar('O WhatsApp da loja está desconectado.', 'erro');
      abrirCotacao({
        ctx, conversa: c,
        // "Enviar ao cliente": o texto vai para o campo de mensagem, como o assistente faria — o atendente revisa e manda
        aoUsarTexto: (texto) => {
          const campo = $('#texto-msg', chatEl); if (!campo) return;
          if ($('#modo-nota', chatEl)?.checked) $('#modo-nota', chatEl).click();
          campo.value = (campo.value.trim() ? campo.value.trimEnd() + '\n\n' : '') + texto;
          campo.dispatchEvent(new Event('input'));
          campo.focus(); campo.setSelectionRange(campo.value.length, campo.value.length);
          avisar('Texto colocado na mensagem. Revise e clique em Enviar.');
        },
        // reserva criada pela equipe: o evento aparece no histórico e a conversa passa a ser deste atendente
        aoReservar: async () => {
          await buscarNovas();
          if (aberta?.estado !== 'humano' || aberta.atendente?.id !== eu.id) {
            try { aberta = await api.acaoConversa(aberta.id, 'assumir'); store.mapa.set(aberta.id, aberta); desenharCabecalho(); desenharLista(); } catch { /* segue */ }
          }
        },
      });
    });
  }

  async function acao(nome, botao) {
    if (nome === 'transferir') return transferir();
    await comBotao(botao, async () => {
      try {
        aberta = await api.acaoConversa(aberta.id, nome);
        store.mapa.set(aberta.id, aberta);
        desenharCabecalho(); desenharFiltros(); desenharLista();
        await buscarNovas();
        if (nome === 'encerrar') avisar('Conversa encerrada. Se o cliente escrever de novo, ela reabre sozinha.');
      } catch (err) { avisar(err.message, 'erro'); }
    });
  }

  async function transferir() {
    let equipe = [], lojas = [];
    try { [equipe, lojas] = await Promise.all([api.equipeAtiva(), api.lojasDestino().catch(() => [])]); } catch (err) { return avisar(err.message, 'erro'); }
    const origem = aberta.transferida?.origem;
    const m = abrirModal({
      titulo: 'Transferir conversa',
      corpo: html`<form class="form" id="form-transferir">
        ${eu.perfil === 'dono' ? html`<div class="campo"><label for="t-pessoa">Passar para alguém desta loja</label>
          <select id="t-pessoa" name="atendenteId"><option value="">— escolher —</option>${equipe.map((p) => html`<option value="${p.id}">${p.nome}${p.id === eu.id ? ' (você)' : ''}</option>`)}</select></div>` : html`<input type="hidden" name="atendenteId" value="">`}
        ${lojas.length ? html`<div class="campo"><label for="t-loja">Ou para outra loja</label>
          <select id="t-loja" name="lojaId"><option value="">— escolher —</option>${origem ? html`<option value="${origem.id}">↩ Devolver para ${origem.nome} (origem)</option>` : ''}${lojas.filter((l) => l.id !== origem?.id).map((l) => html`<option value="${l.id}">${l.nome} · ${l.cidade}/${l.uf}</option>`)}</select>
          <p class="ajuda">A conversa continua neste mesmo WhatsApp; a equipe da outra loja passa a ver e responder por ele. Vai para a fila de lá.</p></div>
        <div class="campo"><label for="t-nota">Recado para quem vai atender (opcional)</label><input id="t-nota" name="nota" maxlength="300" placeholder="Ex.: cliente quer retirar em Feira de Santana dia 12"></div>` : ''}
      </form>`,
      rodape: html`<button class="btn btn-contorno" data-fechar>Cancelar</button><button class="btn btn-primario" type="submit" form="form-transferir">Transferir</button>`,
    });
    $('#form-transferir', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target; const atendenteId = f.elements.atendenteId.value; const lojaId = f.elements.lojaId?.value;
      if (!atendenteId && !lojaId) return avisar('Escolha uma pessoa ou uma loja.', 'erro');
      await comBotao($('[type=submit]', m.el), async () => {
        try {
          if (lojaId) {
            const r = await api.transferirConversa(aberta.id, { lojaId, nota: f.elements.nota?.value || undefined });
            m.fechar(); store.mapa.delete(aberta.id); aberta = null; desenharLista(); ctx.navegar('conversas'); avisar(`Conversa transferida para ${r.para.nome}.`);
            return;
          }
          aberta = await api.acaoConversa(aberta.id, 'transferir', { atendenteId });
          store.mapa.set(aberta.id, aberta); m.fechar(); desenharCabecalho(); desenharLista(); await buscarNovas(); avisar('Conversa transferida.');
        } catch (err) { avisar(err.message, 'erro'); }
      });
    });
  }

  function htmlMensagem(m) {
    if (m.tipo === 'evento') return html`<div class="evento-chat" data-mid="${m.id}">${m.texto} · ${hora(m.criadaEm)}</div>`;
    const classe = m.tipo === 'nota' ? 'nota' : m.direcao === 'entrada' ? 'entrada' : 'saida';
    const url = m.temArquivo ? api.urlArquivo(aberta.id, m.id) : null;
    let corpo = '';
    if (m.tipo === 'imagem' || m.tipo === 'figurinha') corpo = url ? html`<a href="${url}" target="_blank" rel="noopener"><img class="foto" src="${url}" alt="Foto enviada na conversa" loading="lazy"></a>` : html`<span class="sub">Foto</span>`;
    else if (m.tipo === 'audio') corpo = url ? html`<audio controls preload="none" src="${url}"></audio>` : html`<span class="sub">Áudio</span>`;
    else if (m.tipo === 'video') corpo = html`<a class="anexo" href="${url || '#'}" target="_blank" rel="noopener">${icone('reservas')}Vídeo · abrir</a>`;
    else if (m.tipo === 'documento') corpo = html`<a class="anexo" href="${url || '#'}" target="_blank" rel="noopener">${icone('copiar')}${m.midia?.nome || 'Documento'} · baixar</a>`;
    else if (m.tipo === 'localizacao' && m.midia?.lat != null) corpo = html`<a class="anexo" href="https://www.google.com/maps?q=${m.midia.lat},${m.midia.lng}" target="_blank" rel="noopener noreferrer">${icone('lojas')}Localização · abrir no mapa</a>`;
    else if (m.tipo === 'outro') corpo = html`<span class="sub">Mensagem de um tipo que o Conecta ainda não mostra. Veja no celular da loja.</span>`;
    return html`<div class="balao ${classe}${m.status === 'erro' ? ' erro-envio' : ''}" data-mid="${m.id}">
      ${m.tipo === 'nota' ? html`<span class="autor-balao">Nota interna · ${m.autorNome || 'equipe'}</span>` : m.direcao === 'saida' && m.autorNome ? html`<span class="autor-balao">${m.autorNome}</span>` : ''}
      ${corpo}${m.texto && m.tipo !== 'evento' ? html`<span>${m.texto}</span>` : ''}
      <span class="rodape-balao">${m.status === 'erro' ? html`<span class="falhou">Não enviada</span>` : ''}${hora(m.criadaEm)}</span>
    </div>`;
  }

  function anexarMensagens(novas, rolar) {
    const area = $('#mensagens', chatEl);
    if (!area) return;
    const perto = rolar || area.scrollHeight - area.scrollTop - area.clientHeight < 120;
    let ultimoDia = mensagens.length ? new Date(mensagens[mensagens.length - 1].criadaEm).toDateString() : null;
    let pedaco = '';
    for (const m of novas) {
      if (mensagens.some((x) => x.id === m.id)) continue;
      const dia = new Date(m.criadaEm).toDateString();
      if (dia !== ultimoDia) { pedaco += String(html`<div class="dia">${rotuloDia(m.criadaEm)}</div>`); ultimoDia = dia; }
      pedaco += String(htmlMensagem(m));
      mensagens.push(m);
      if (m.cursor && (!cursorMsgs || m.cursor > cursorMsgs)) cursorMsgs = m.cursor;
    }
    if (pedaco) area.insertAdjacentHTML('beforeend', pedaco);
    if (perto) area.scrollTop = area.scrollHeight;
  }

  async function buscarNovas() {
    if (!aberta) return;
    const id = aberta.id;
    try {
      const r = await api.mensagens(id, { depois: cursorMsgs || undefined });
      if (aberta?.id !== id) return;
      anexarMensagens(r.mensagens);
    } catch (err) { if (err.status === 401) ctx.sessaoExpirou(); }
  }

  function vigiarMensagens() {
    clearTimeout(timerMsgs);
    const ciclo = async () => { await buscarNovas(); timerMsgs = setTimeout(ciclo, document.hidden ? 8000 : 3000); };
    timerMsgs = setTimeout(ciclo, 3000);
  }

  async function marcarLida() {
    if (!aberta?.naoLidas) return;
    aberta.naoLidas = 0;
    store.mapa.set(aberta.id, aberta);
    atualizarContadores(); desenharLista();
    api.marcarLida(aberta.id).catch(() => {});
  }

  async function abrir(id) {
    clearTimeout(timerMsgs);
    mensagens = []; cursorMsgs = null; anexo = null; modoNota = false;
    store.ativa = id;
    caixa.classList.add('com-conversa');
    render(chatEl, html`<div class="chat-cab" id="chat-cab"><div class="esqueleto"></div></div><div class="mensagens" id="mensagens"></div>`);
    try {
      const r = await api.mensagens(id);
      if (store.ativa !== id) return;
      aberta = r.conversa;
      store.mapa.set(aberta.id, { ...store.mapa.get(aberta.id), ...aberta });
      render(chatEl, html`
        <div class="chat-cab" id="chat-cab"></div>
        ${canalOk ? '' : html`<div class="aviso-desconectado">${icone('alerta')}<span>O WhatsApp da loja está desconectado. Dá para ler, mas não para responder.${eu.perfil === 'dono' ? html` <a href="#/whatsapp">Conectar</a>` : ''}</span></div>`}
        <div class="mensagens" id="mensagens" role="log" aria-live="polite"></div>
        ${compositor()}`);
      desenharCabecalho();
      if (!telaLarga()) lateralAberta = false;
      desenharLateral();
      anexarMensagens(r.mensagens, true);
      ligarCompositor();
      desenharLista();
      marcarLida();
      vigiarMensagens();
    } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      render(chatEl, html`<div class="chat-vazio">${icone('alerta')}<h3>Não foi possível abrir</h3><p>${err.message}</p><a class="btn btn-contorno" href="#/conversas">Voltar</a></div>`);
    }
  }

  // ---------- compositor ----------
  function compositor() {
    return html`<form class="compositor" id="compositor" novalidate>
      <div id="anexo-area"></div>
      <div class="linha-comp">
        <button type="button" class="btn btn-texto btn-icone" id="anexar" aria-label="Anexar foto ou documento" title="Anexar foto ou documento (até 8 MB)">${icone('mais')}</button>
        <input type="file" id="arquivo" accept="${TIPOS_ARQUIVO}" hidden>
        <label class="sr-only" for="texto-msg">Mensagem</label>
        <textarea id="texto-msg" rows="1" maxlength="4000" placeholder="Escreva a mensagem"></textarea>
        <button class="btn btn-primario" type="submit" id="enviar">Enviar</button>
      </div>
      <div class="opcoes-comp">
        <label class="checkbox"><input type="checkbox" id="modo-nota"> Nota interna (só a equipe vê)</label>
        <span class="sub">Digite / para respostas rápidas</span>
      </div>
    </form>`;
  }

  function ligarCompositor() {
    const form = $('#compositor', chatEl), campo = $('#texto-msg', form), arquivo = $('#arquivo', form);
    const ajustarAltura = () => { campo.style.height = 'auto'; campo.style.height = Math.min(campo.scrollHeight, 160) + 'px'; };

    $('#modo-nota', form).addEventListener('change', (e) => {
      modoNota = e.target.checked;
      form.classList.toggle('modo-nota', modoNota);
      campo.placeholder = modoNota ? 'Nota para a equipe (o cliente não vê)' : 'Escreva a mensagem';
      $('#anexar', form).disabled = modoNota;
      if (modoNota) { anexo = null; desenharAnexo(); }
      campo.focus();
    });

    $('#anexar', form).addEventListener('click', () => arquivo.click());
    arquivo.addEventListener('change', () => {
      const f = arquivo.files[0];
      arquivo.value = '';
      if (!f) return;
      if (f.size > 8 * 1024 * 1024) return avisar('Arquivo maior que 8 MB. Envie um arquivo menor.', 'erro');
      const ext = f.name.split('.').pop().toLowerCase();
      const mimetype = f.type || MIME_EXT[ext] || '';
      if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(mimetype) && !Object.values(MIME_EXT).includes(mimetype)) return avisar('Tipo de arquivo não permitido. Envie foto, PDF, Word ou Excel.', 'erro');
      const leitor = new FileReader();
      leitor.onload = () => { anexo = { nome: f.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120), mimetype, base64: String(leitor.result).split(',')[1] }; desenharAnexo(); campo.focus(); };
      leitor.onerror = () => avisar('Não foi possível ler o arquivo.', 'erro');
      leitor.readAsDataURL(f);
    });

    function desenharAnexo() {
      const area = $('#anexo-area', form);
      if (!anexo) return render(area, '');
      render(area, html`<span class="anexo-escolhido">${icone('copiar')}<span>${anexo.nome}</span><button type="button" class="btn btn-texto btn-icone" id="tirar-anexo" aria-label="Remover anexo">${icone('fechar')}</button></span>`);
      $('#tirar-anexo', area).addEventListener('click', () => { anexo = null; desenharAnexo(); });
      campo.placeholder = 'Legenda (opcional)';
    }

    // respostas rápidas com "/"
    let sugestoes = [], marcada = 0;
    async function mostrarSugestoes() {
      const v = campo.value;
      const caixaSug = $('.sugestoes', form);
      if (!v.startsWith('/') || v.includes(' ') || v.includes('\n') || modoNota) { caixaSug?.remove(); sugestoes = []; return; }
      if (!respostasRapidas) { try { respostasRapidas = await api.respostas(); } catch { respostasRapidas = []; } }
      const termo = v.slice(1).toLowerCase();
      sugestoes = respostasRapidas.filter((r) => r.atalho.includes(termo)).slice(0, 8);
      marcada = 0;
      let el = caixaSug;
      if (!sugestoes.length) { el?.remove(); return; }
      if (!el) { el = document.createElement('div'); el.className = 'sugestoes'; el.setAttribute('role', 'listbox'); form.prepend(el); }
      render(el, html`${sugestoes.map((r, i) => html`<button type="button" role="option" class="${i === marcada ? 'marcada' : ''}" data-i="${i}"><code>/${r.atalho}</code><span>${r.texto}</span></button>`)}`);
      $$('button', el).forEach((b) => b.addEventListener('mousedown', (e) => { e.preventDefault(); usar(Number(b.dataset.i)); }));
    }
    function usar(i) {
      const r = sugestoes[i]; if (!r) return;
      campo.value = r.texto; $('.sugestoes', form)?.remove(); sugestoes = []; ajustarAltura(); campo.focus();
    }

    campo.addEventListener('input', () => { ajustarAltura(); mostrarSugestoes(); });
    campo.addEventListener('keydown', (e) => {
      if (sugestoes.length && ['ArrowDown', 'ArrowUp', 'Tab', 'Escape'].includes(e.key) || (sugestoes.length && e.key === 'Enter')) {
        e.preventDefault();
        if (e.key === 'Escape') { $('.sugestoes', form)?.remove(); sugestoes = []; return; }
        if (e.key === 'Enter' || e.key === 'Tab') return usar(marcada);
        marcada = (marcada + (e.key === 'ArrowDown' ? 1 : -1) + sugestoes.length) % sugestoes.length;
        $$('.sugestoes button', form).forEach((b, i) => b.classList.toggle('marcada', i === marcada));
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) { e.preventDefault(); form.requestSubmit(); }
    });

    let enviando = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (enviando || !aberta) return;
      const texto = campo.value.trim();
      if (!texto && !anexo) return campo.focus();
      if (!modoNota && !canalOk) return avisar('O WhatsApp da loja está desconectado.', 'erro');
      enviando = true;
      await comBotao($('#enviar', form), async () => {
        try {
          let m;
          if (modoNota) m = await api.nota(aberta.id, texto);
          else if (anexo) m = await api.enviarMidia(aberta.id, { mimetype: anexo.mimetype, base64: anexo.base64, nomeArquivo: anexo.nome, legenda: texto || undefined });
          else m = await api.enviarTexto(aberta.id, texto);
          campo.value = ''; anexo = null; desenharAnexo(); ajustarAltura();
          campo.placeholder = modoNota ? 'Nota para a equipe (o cliente não vê)' : 'Escreva a mensagem';
          await buscarNovas();
          anexarMensagens([m], true);
          if (!modoNota && (aberta.estado !== 'humano' || aberta.atendente?.id !== eu.id)) {
            aberta = { ...aberta, estado: 'humano', atendente: { id: eu.id, nome: eu.nome } };
            store.mapa.set(aberta.id, aberta); desenharCabecalho(); desenharLista();
          }
        } catch (err) { avisar(err.message, 'erro'); await buscarNovas(); }
      });
      enviando = false;
      campo.focus();
    });
    campo.focus({ preventScroll: true });
  }

  // ---------- início ----------
  try { canalOk = (await api.canal()).status === 'conectado'; } catch { canalOk = true; }
  if (!store.timer) iniciarVigia(ctx);
  const [idInicial] = ctx.params;
  if (idInicial) abrir(idInicial); else chatVazio();

  return {
    atualizar: ({ params }) => {
      const [id] = params;
      if (!id) { clearTimeout(timerMsgs); aberta = null; store.ativa = null; chatVazio(); desenharLista(); return; }
      if (id !== aberta?.id) abrir(id);
    },
    limpar: () => { clearTimeout(timerMsgs); store.ouvintes.delete(aoMudarLista); store.ativa = null; painel?.destruir(); },
  };
}
