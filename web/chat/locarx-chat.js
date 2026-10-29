/*! Chat do site LocarX — widget (Lia). Sem dependências. Fala com a API do Conecta (/api/site/*).
 *
 * Uso no site (uma linha):
 *   <script src="https://SEU-CONECTA/chat/locarx-chat.js" data-api="https://SEU-CONECTA/api/site" defer></script>
 * Opções (data-*): data-api, data-chave (só no ambiente de teste), data-privacidade (link da política), data-aberto="1".
 * Ou por código: LocarxChat.init({ api, chave, privacidade, abrir }).
 *
 * Segurança: nenhum dado do cliente fica no navegador além do token da conversa (localStorage); o token é aleatório,
 * vale 30 dias e dá acesso só a esta conversa. CPF/e-mail aparecem mascarados quando a conversa é reaberta.
 */
(function () {
  'use strict';
  if (window.LocarxChat) return;

  const SCRIPT = document.currentScript;
  const CFG = { api: '/api/site', chave: null, privacidade: null, abrir: false, css: null };
  const CHAVE_TOKEN = 'locarx_chat_token_v1';
  const CHAVE_ABERTO = 'locarx_chat_aberto_v1';

  // ---------- utilidades ----------
  const guardar = {
    ler(k, sess) { try { return (sess ? sessionStorage : localStorage).getItem(k); } catch { return null; } },
    gravar(k, v, sess) { try { (sess ? sessionStorage : localStorage).setItem(k, v); } catch { /* navegador sem armazenamento */ } },
    apagar(k, sess) { try { (sess ? sessionStorage : localStorage).removeItem(k); } catch { /* idem */ } },
  };
  function h(tag, attrs, ...filhos) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos.flat()) if (f != null && f !== false) el.append(f.nodeType ? f : document.createTextNode(String(f)));
    return el;
  }
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reais = (v) => (v == null ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const pad = (n) => String(n).padStart(2, '0');
  const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dm = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const ICONES = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.6-.8L3 20l1.1-4.6A8.4 8.4 0 1 1 21 11.5z"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    mais: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
    enviar: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6 3.3 10l12.6 2-12.6 2z"/></svg>',
    carro: '<svg viewBox="0 0 64 40" fill="currentColor"><path d="M5 27l4-10c1.5-4 4-6 8-6h20c4 0 6 1.4 9 5l8 3c4 1 5 3 5 7v3h-5a7 7 0 0 0-14 0H26a7 7 0 0 0-14 0H5z" opacity=".9"/><circle cx="19" cy="31" r="5.5" fill="#fff"/><circle cx="19" cy="31" r="2.5"/><circle cx="49" cy="31" r="5.5" fill="#fff"/><circle cx="49" cy="31" r="2.5"/></svg>',
  };
  const icone = (n) => h('span', { html: ICONES[n], 'aria-hidden': 'true', class: 'lc-ico' });

  // texto → HTML seguro (negrito do WhatsApp, links, quebras de linha)
  function formatar(texto) {
    let t = esc(texto);
    t = t.replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
    t = t.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    return t.replace(/\n/g, '<br>');
  }
  const mascaraTelefone = (v) => {
    const d = String(v).replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '').slice(0, 11);
    if (d.length <= 2) return d.length ? `(${d}` : '';
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  };

  // ---------- estado ----------
  const S = {
    token: null, estado: {}, msgs: [], cursor: null, aberto: false, poll: null, turnstile: null,
    aguardando: false, aguardandoAte: 0, assinatura: '', comps: new Map(), carregando: false, avisoErro: null,
  };
  let raiz, el = {};

  // ---------- API ----------
  async function api(metodo, caminho, corpo) {
    const cab = {};
    if (corpo) cab['Content-Type'] = 'application/json';
    if (S.token) cab.Authorization = `Bearer ${S.token}`;
    if (CFG.chave) cab['X-Site-Chave'] = CFG.chave;
    let r;
    try { r = await fetch(CFG.api + caminho, { method: metodo, headers: cab, body: corpo ? JSON.stringify(corpo) : undefined, credentials: 'omit' }); }
    catch { const e = new Error('Sem conexão. Confira sua internet e tente de novo.'); e.rede = true; throw e; }
    let j = null; try { j = await r.json(); } catch { /* sem corpo */ }
    if (!r.ok) { const e = new Error(j?.mensagem || 'Não foi possível concluir. Tente de novo.'); e.status = r.status; e.campos = j?.campos || null; throw e; }
    return j;
  }

  // ---------- sessão e mensagens ----------
  async function abrirSessao(avisoExpirou) {
    S.token = guardar.ler(CHAVE_TOKEN) || null;
    try {
      const r = await api('POST', '/sessao', {});
      if (r.token) { S.token = r.token; guardar.gravar(CHAVE_TOKEN, r.token); }
      S.turnstile = r.turnstile || null;
      S.msgs = []; S.cursor = null; S.comps.clear();
      aplicar(r);
      if (avisoExpirou) mostrarAviso('Sua conversa anterior expirou. Começamos uma nova.');
    } catch (e) {
      if (e.status === 401) { guardar.apagar(CHAVE_TOKEN); S.token = null; return abrirSessao(true); }
      mostrarAviso(e.status === 403 ? 'O chat está em teste e não está liberado para este acesso.' : e.message, true);
    }
  }

  function aplicar(r) {
    if (r.estado) S.estado = r.estado;
    let mudou = false;
    for (const m of r.mensagens || []) {
      if (S.msgs.some((x) => x.id === m.id)) continue;
      S.msgs.push(m); mudou = true;
      if (m.de !== 'cliente') S.aguardando = false;
    }
    if (mudou) S.msgs.sort((a, b) => (a.cursor < b.cursor ? -1 : a.cursor > b.cursor ? 1 : 0));
    if (S.msgs.length) S.cursor = S.msgs[S.msgs.length - 1].cursor;
    if (S.aguardando && Date.now() > S.aguardandoAte) S.aguardando = false;
    desenhar();
  }

  async function buscar() {
    if (!S.token) return;
    try { aplicar(await api('GET', `/mensagens${S.cursor ? `?depois=${encodeURIComponent(S.cursor)}` : ''}`)); S.avisoErro = null; }
    catch (e) {
      if (e.status === 401) { guardar.apagar(CHAVE_TOKEN); S.token = null; await abrirSessao(true); return; }
      if (e.status === 429) return;
    }
  }

  function agendarPoll() {
    clearTimeout(S.poll);
    if (!S.aberto) return;
    const rapido = S.aguardando || S.estado.digitando || S.estado.atendimento?.atendente;
    S.poll = setTimeout(async () => {
      if (document.visibilityState === 'visible') await buscar();
      agendarPoll();
    }, rapido ? 1500 : 4000);
  }

  async function enviar(corpo) {
    if (!S.token) await abrirSessao();
    try {
      S.aguardando = true; S.aguardandoAte = Date.now() + 40_000; desenhar();
      await api('POST', '/mensagem', corpo);
      await buscar();
    } catch (e) {
      S.aguardando = false;
      if (e.status === 428) { await buscar(); S.estado.precisaConfirmar = true; desenhar(); return; }
      if (e.status === 401) { guardar.apagar(CHAVE_TOKEN); await abrirSessao(true); return; }
      mostrarAviso(e.message, true); desenhar();
    }
  }
  const enviarTexto = (texto) => { const t = String(texto || '').trim(); if (t) return enviar({ texto: t }); };

  // ---------- avisos ----------
  let avisoTimer;
  function mostrarAviso(texto, erro) {
    S.avisoErro = { texto, erro: !!erro };
    desenhar();
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(() => { S.avisoErro = null; desenhar(); }, 9000);
  }

  // ---------- componentes ----------
  function compCidades(u) {
    const caixa = h('div', { class: 'lc-comp' });
    const cidades = u.cidades || [];
    const campo = h('input', { class: 'lc-campo', type: 'text', placeholder: 'Digite a cidade…', 'aria-label': 'Cidade de retirada', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list' });
    const lista = h('ul', { class: 'lc-lista', role: 'listbox', hidden: true });
    let ativo = -1, itens = [];
    const escolher = (c) => { campo.value = ''; lista.hidden = true; enviar({ acao: { tipo: 'cidade', cidade: c } }); };
    const atualizar = () => {
      const q = semAcento(campo.value).trim();
      itens = cidades.filter((c) => !q || semAcento(c.cidade).includes(q));
      lista.replaceChildren(...itens.map((c, i) => h('li', { role: 'option', 'aria-selected': String(i === ativo), onmousedown: (ev) => { ev.preventDefault(); escolher(c.cidade); } }, `${c.cidade}/${c.uf}`, c.lojas > 1 ? ` · ${c.lojas} lojas` : '')));
      lista.hidden = !itens.length || (!q && document.activeElement !== campo);
      campo.setAttribute('aria-expanded', String(!lista.hidden));
    };
    campo.addEventListener('input', () => { ativo = -1; atualizar(); });
    campo.addEventListener('focus', atualizar);
    campo.addEventListener('blur', () => setTimeout(() => { lista.hidden = true; }, 120));
    campo.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); ativo = Math.min(itens.length - 1, ativo + 1); atualizar(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); ativo = Math.max(0, ativo - 1); atualizar(); }
      else if (ev.key === 'Enter') { ev.preventDefault(); const c = itens[ativo] || itens[0]; if (c) escolher(c.cidade); else if (campo.value.trim().length > 1) escolher(campo.value.trim()); }
    });
    caixa.append(h('div', { class: 'lc-busca' }, campo, lista));
    if (cidades.length && cidades.length <= 6) caixa.append(h('div', { class: 'lc-chips', style: null }, ...cidades.map((c) => h('button', { class: 'lc-chip', type: 'button', onclick: () => escolher(c.cidade) }, c.cidade))));
    return caixa;
  }

  function compLojas(u) {
    const caixa = h('div', { class: 'lc-comp' });
    let todas = false;
    const desenharLista = () => {
      const lojas = u.lojas || [];
      const mostrar = todas ? lojas : lojas.slice(0, 3);
      caixa.replaceChildren(...[
        ...mostrar.map((l) => h('div', { class: 'lc-cartao' },
          h('div', { class: 'lc-linha' }, h('h4', {}, l.nome, l.tipo === 'Aeroporto' ? h('span', { class: 'lc-selo' }, 'Aeroporto') : null),
            h('button', { class: 'lc-btn pequeno', type: 'button', onclick: () => enviar({ acao: { tipo: 'loja', lojaId: l.id } }) }, 'Escolher')),
          l.endereco ? h('p', {}, l.endereco) : h('p', {}, `${l.cidade}/${l.uf}`),
          l.horario ? h('p', {}, l.horario) : null)),
        !todas && lojas.length > 3 ? h('button', { class: 'lc-mais', type: 'button', onclick: () => { todas = true; desenharLista(); } }, `Ver mais lojas (${lojas.length - 3})`) : null,
      ].filter(Boolean));
    };
    desenharLista();
    return caixa;
  }

  // foto do grupo (servida pelo próprio Conecta); se não carregar, fica o desenho do carro
  function fotoDoCarro(g) {
    const caixa = h('div', { class: 'lc-foto' }, icone('carro'));
    if (g.foto && /^\d+$/.test(String(g.fleetId))) {
      const img = h('img', { src: `${CFG.api}/foto/${g.fleetId}`, alt: `${g.nome || 'Carro'}${g.modelos ? ` (${g.modelos})` : ''}`, decoding: 'async' });
      img.addEventListener('load', () => { caixa.classList.add('tem'); caixa.replaceChildren(img); });
      img.addEventListener('error', () => { /* mantém o desenho */ });
    }
    return caixa;
  }

  function compCarros(u) {
    const caixa = h('div', { class: 'lc-comp' });
    caixa.append(h('p', { class: 'lc-ajuda' }, `Opções para ${u.periodo || 'o período'} — total com a Proteção X e taxas.`));
    for (const g of u.grupos || []) {
      const tags = [g.cambio ? `câmbio ${g.cambio}` : null, g.passageiros ? `${g.passageiros} lugares` : null, g.malas ? `${g.malas} malas` : null, g.portas ? `${g.portas} portas` : null, ...(g.itens || []).slice(0, 2)].filter(Boolean);
      caixa.append(h('div', { class: 'lc-cartao lc-carro' },
        fotoDoCarro(g),
        h('div', { class: 'lc-info' },
          h('h4', {}, `${g.letra} – ${g.nome}`),
          g.modelos ? h('p', {}, g.modelos) : null,
          h('div', { class: 'lc-tags' }, ...tags.map((t) => h('span', {}, t))),
          h('div', { class: 'lc-preco' },
            h('div', {}, h('small', {}, `${reais(g.diaria)} por diária`), h('strong', {}, reais(g.total))),
            h('button', { class: 'lc-btn pequeno', type: 'button', onclick: () => enviar({ acao: { tipo: 'carro', fleetId: g.fleetId } }) }, 'Escolher')))));
    }
    if (u.haMais) caixa.append(h('button', { class: 'lc-mais', type: 'button', onclick: () => enviar({ acao: { tipo: 'mais_opcoes' } }) }, 'Ver mais opções'));
    return caixa;
  }

  function compBotoes(u) {
    return h('div', { class: 'lc-comp lc-chips' }, ...(u.opcoes || []).map((o) => h('button', { class: 'lc-chip', type: 'button', onclick: () => enviarTexto(o) }, o)));
  }

  function compDatas() {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const min = new Date(hoje); min.setDate(min.getDate() + 1);
    let mes = new Date(min.getFullYear(), min.getMonth(), 1);
    let ini = null, fim = null;
    const horas = []; for (let hh = 6; hh <= 22; hh++) for (const mm of ['00', '30']) { if (hh === 22 && mm === '30') continue; horas.push(`${pad(hh)}:${mm}`); }
    const selHoraIni = h('select', { 'aria-label': 'Hora da retirada' }, ...horas.map((x) => h('option', { value: x, selected: x === '10:00' }, x)));
    const selHoraFim = h('select', { 'aria-label': 'Hora da devolução' }, ...horas.map((x) => h('option', { value: x, selected: x === '10:00' }, x)));
    const grade = h('div', { class: 'lc-grade' });
    const tituloMes = h('b', {});
    const btnAnt = h('button', { type: 'button', 'aria-label': 'Mês anterior', onclick: () => { mes = new Date(mes.getFullYear(), mes.getMonth() - 1, 1); montar(); } }, '‹');
    const btnProx = h('button', { type: 'button', 'aria-label': 'Próximo mês', onclick: () => { mes = new Date(mes.getFullYear(), mes.getMonth() + 1, 1); montar(); } }, '›');
    const periodo = h('div', { class: 'lc-periodo' });
    const confirmar = h('button', { class: 'lc-btn largo', type: 'button', disabled: true, onclick: () => {
      enviar({ acao: { tipo: 'datas', retirada: { data: isoLocal(ini), hora: selHoraIni.value }, devolucao: { data: isoLocal(fim), hora: selHoraFim.value } } });
    } }, 'Confirmar datas');
    const escolher = (d) => {
      if (!ini || (ini && fim)) { ini = d; fim = null; }
      else if (d < ini) { ini = d; }
      else fim = d;
      montar();
    };
    const atualizarResumo = () => {
      if (!ini) { periodo.textContent = 'Toque na data de retirada.'; confirmar.disabled = true; return; }
      if (!fim) { periodo.replaceChildren('Retirada ', h('b', {}, `${DIAS[ini.getDay()]}, ${dm(ini)}`), ' — agora toque na data de devolução.'); confirmar.disabled = true; return; }
      const a = new Date(`${isoLocal(ini)}T${selHoraIni.value}:00`), b = new Date(`${isoLocal(fim)}T${selHoraFim.value}:00`);
      if (b <= a) { periodo.textContent = 'A devolução precisa ser depois da retirada. Ajuste o horário.'; confirmar.disabled = true; return; }
      const diarias = Math.max(1, Math.ceil((b - a) / 86_400_000));
      periodo.replaceChildren(h('b', {}, `${DIAS[ini.getDay()]}, ${dm(ini)} às ${selHoraIni.value}`), ' → ', h('b', {}, `${DIAS[fim.getDay()]}, ${dm(fim)} às ${selHoraFim.value}`), ` · ${diarias} ${diarias === 1 ? 'diária' : 'diárias'}`);
      confirmar.disabled = false;
    };
    const montar = () => {
      { const t = mes.toLocaleDateString('pt-BR', { month: 'long' }); tituloMes.textContent = `${t[0].toUpperCase()}${t.slice(1)} de ${mes.getFullYear()}`; }
      btnAnt.disabled = new Date(mes.getFullYear(), mes.getMonth(), 1) <= new Date(min.getFullYear(), min.getMonth(), 1);
      const dias = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate();
      const nos = [...DIAS.map((d) => h('div', { class: 'sem' }, d[0].toUpperCase())), ...Array.from({ length: mes.getDay() }, () => h('div', {}))];
      for (let d = 1; d <= dias; d++) {
        const data = new Date(mes.getFullYear(), mes.getMonth(), d);
        const ponta = (ini && +data === +ini) || (fim && +data === +fim);
        const dentro = ini && fim && data > ini && data < fim;
        nos.push(h('button', { type: 'button', class: `lc-dia${ponta ? ' ponta' : ''}${dentro ? ' no-intervalo' : ''}`, disabled: data < min, 'aria-label': `${d} de ${mes.toLocaleDateString('pt-BR', { month: 'long' })}`, 'aria-pressed': String(!!ponta), onclick: () => escolher(data) }, d));
      }
      grade.replaceChildren(...nos);
      atualizarResumo();
    };
    selHoraIni.addEventListener('change', atualizarResumo); selHoraFim.addEventListener('change', atualizarResumo);
    montar();
    return h('div', { class: 'lc-comp' }, h('div', { class: 'lc-cal' },
      h('div', { class: 'lc-cal-topo' }, btnAnt, tituloMes, btnProx), grade,
      h('div', { class: 'lc-horas' }, h('label', {}, h('span', { class: 'lc-rotulo' }, 'Hora da retirada'), selHoraIni), h('label', {}, h('span', { class: 'lc-rotulo' }, 'Hora da devolução'), selHoraFim)),
      periodo, confirmar));
  }

  // etapa do código (usada no cadastro e na reconfirmação)
  function blocoCodigo(telefoneMascarado, aoConfirmar, aoCorrigir, reenviar) {
    const caixa = h('div', {});
    const campo = h('input', { class: 'lc-campo lc-codigo', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', placeholder: '••••••', 'aria-label': 'Código de 6 dígitos' });
    const erro = h('div', { class: 'lc-erro', role: 'alert' });
    const btn = h('button', { class: 'lc-btn largo', type: 'button', disabled: true }, 'Confirmar');
    const reenvio = h('button', { class: 'lc-btn contorno pequeno', type: 'button', disabled: true }, 'Reenviar código');
    let espera = 45, timer;
    const tick = () => { reenvio.textContent = espera > 0 ? `Reenviar código (${espera}s)` : 'Reenviar código'; reenvio.disabled = espera > 0; if (espera > 0) { espera--; timer = setTimeout(tick, 1000); } };
    const verificar = async () => {
      const codigo = campo.value.replace(/\D/g, '');
      if (codigo.length !== 6) return;
      btn.disabled = true; erro.textContent = '';
      try { await api('POST', '/verificar', { codigo }); clearTimeout(timer); await aoConfirmar(); }
      catch (e) { erro.textContent = e.message; btn.disabled = false; if (e.status === 422) { campo.value = ''; campo.focus(); } }
    };
    campo.addEventListener('input', () => { campo.value = campo.value.replace(/\D/g, '').slice(0, 6); btn.disabled = campo.value.length !== 6; if (campo.value.length === 6) verificar(); });
    btn.addEventListener('click', verificar);
    reenvio.addEventListener('click', async () => {
      reenvio.disabled = true; erro.textContent = '';
      try { await reenviar(); espera = 45; tick(); } catch (e) { erro.textContent = e.message; reenvio.disabled = false; }
    });
    caixa.append(h('p', { style: null }, `Enviamos um código de 6 dígitos para o WhatsApp ${telefoneMascarado}. Digite abaixo:`), campo, erro, btn,
      h('div', { class: 'lc-linha', style: null }, reenvio, aoCorrigir ? h('button', { class: 'lc-resumo', type: 'button', onclick: () => { clearTimeout(timer); aoCorrigir(); } }, 'Corrigir número') : null));
    tick();
    setTimeout(() => campo.focus(), 50);
    return caixa;
  }

  function compCadastro() {
    const caixa = h('div', { class: 'lc-cartao' });
    let desafio = null;
    const formulario = () => {
      const nome = h('input', { class: 'lc-campo', type: 'text', autocomplete: 'name', placeholder: 'Seu nome completo', 'aria-label': 'Nome', maxlength: '120', value: S.estado.nome || '' });
      const tel = h('input', { class: 'lc-campo', type: 'tel', autocomplete: 'tel', inputmode: 'numeric', placeholder: '(71) 99999-9999', 'aria-label': 'WhatsApp com DDD', maxlength: '16' });
      tel.addEventListener('input', () => { tel.value = mascaraTelefone(tel.value); });
      const eNome = h('div', { class: 'lc-erro', role: 'alert' }), eTel = h('div', { class: 'lc-erro', role: 'alert' }), eGeral = h('div', { class: 'lc-erro', role: 'alert' });
      const btn = h('button', { class: 'lc-btn largo', type: 'button' }, 'Receber código no WhatsApp');
      const local = h('div', { class: 'lc-turnstile' });
      btn.addEventListener('click', async () => {
        eNome.textContent = eTel.textContent = eGeral.textContent = '';
        btn.disabled = true;
        try {
          const r = await api('POST', '/cadastro', { nome: nome.value, telefone: tel.value, desafio: desafio || undefined });
          caixa.replaceChildren(h('b', {}, 'Confirme seu WhatsApp'), blocoCodigo(r.telefone, concluido, () => { caixa.replaceChildren(...formulario()); }, () => api('POST', '/cadastro', { reenviar: true, desafio: desafio || undefined })));
        } catch (e) {
          eNome.textContent = e.campos?.nome || ''; eTel.textContent = e.campos?.telefone || ''; if (!e.campos) eGeral.textContent = e.message;
          nome.setAttribute('aria-invalid', String(!!e.campos?.nome)); tel.setAttribute('aria-invalid', String(!!e.campos?.telefone));
          btn.disabled = false;
        }
      });
      if (S.turnstile) carregarTurnstile(local, (t) => { desafio = t; });
      return [h('b', {}, 'Para reservar, confirme seu WhatsApp'),
        h('p', { class: 'lc-ajuda' }, 'Enviamos um código para você. É só para guardar sua reserva e permitir que a equipe continue a conversa — não é um cadastro de conta.'),
        h('label', {}, h('span', { class: 'lc-rotulo' }, 'Nome'), nome), eNome,
        h('label', {}, h('span', { class: 'lc-rotulo' }, 'WhatsApp'), tel), eTel, local, eGeral, h('div', { class: 'lc-ajuda' }, 'Ao continuar, você concorda com o uso dos seus dados para o atendimento.', CFG.privacidade ? [' ', h('a', { href: CFG.privacidade, target: '_blank', rel: 'noopener noreferrer' }, 'Política de privacidade')] : null), btn];
    };
    const concluido = async () => {
      S.estado.verificada = true; S.estado.precisaConfirmar = false;
      caixa.replaceChildren(h('div', { class: 'lc-resumo' }, '✓ ', h('b', {}, 'WhatsApp confirmado')));
      S.aguardando = true; S.aguardandoAte = Date.now() + 40_000;
      await buscar(); desenhar();
    };
    caixa.append(...formulario());
    return caixa;
  }

  function carregarTurnstile(local, aoResolver) {
    const montar = () => { try { window.turnstile.render(local, { sitekey: S.turnstile, callback: aoResolver, 'expired-callback': () => aoResolver(null) }); } catch { /* desafio indisponível */ } };
    if (window.turnstile) return montar();
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true; s.onload = montar;
    document.head.append(s);
  }

  const COMPONENTES = { cidades: compCidades, lojas: compLojas, carros: compCarros, botoes: compBotoes, datas: compDatas, cadastro: compCadastro };

  // resumo de um componente que já foi respondido (ocupa uma linha só)
  function resumoDe(u, ehUltimoDoTipo) {
    if (!ehUltimoDoTipo) return null;
    if (u.tipo === 'lojas' && S.estado.loja) {
      return h('div', { class: 'lc-resumo' }, '✓ ', h('b', {}, S.estado.loja.nome), !S.estado.verificada ? [' · ', h('button', { type: 'button', onclick: () => enviar({ acao: { tipo: 'cidade', cidade: S.estado.loja.cidade } }) }, 'alterar')] : null);
    }
    if (u.tipo === 'cadastro' && S.estado.verificada) return h('div', { class: 'lc-resumo' }, '✓ ', h('b', {}, 'WhatsApp confirmado'));
    return null;
  }

  // ---------- desenho ----------
  function desenhar() {
    if (!el.corpo) return;
    const ultimo = S.msgs.length - 1;
    const assinatura = JSON.stringify([S.msgs.map((m) => m.id), S.estado.verificada, S.estado.loja?.id, S.estado.precisaConfirmar, !!(S.aguardando || S.estado.digitando), S.estado.atendimento, S.avisoErro]);
    atualizarRodape();
    if (assinatura === S.assinatura) return;
    S.assinatura = assinatura;
    const pertoDoFim = el.corpo.scrollHeight - el.corpo.scrollTop - el.corpo.clientHeight < 90;
    const ultimoPorTipo = {};
    S.msgs.forEach((m, i) => (m.ui || []).forEach((u) => { ultimoPorTipo[u.tipo] = `${i}`; }));
    const vivos = new Set();
    const nos = [];
    S.msgs.forEach((m, i) => {
      const quem = m.de === 'cliente' ? 'cliente' : m.de === 'atendente' ? 'atendente' : 'assistente';
      const bloco = h('div', { class: `lc-msg ${quem}` });
      if (quem === 'atendente') bloco.append(h('div', { class: 'lc-quem' }, `${m.nome || 'Atendente'} · equipe LocarX`));
      if (m.texto) {
        const balao = h('div', { class: 'lc-balao', html: formatar(m.texto) });
        const pix = m.texto.match(/00020[\w\-./+ :]{50,}/);
        if (pix && quem !== 'cliente') balao.append(h('button', { class: 'lc-pix', type: 'button', onclick: (ev) => { navigator.clipboard?.writeText(pix[0].replace(/\s/g, '')).then(() => { ev.target.textContent = 'Código copiado ✓'; }); } }, 'Copiar código Pix'));
        bloco.append(balao);
      }
      nos.push(bloco);
      for (const [k, u] of (m.ui || []).entries()) {
        const chave = `${m.id}:${k}`;
        const interativo = i === ultimo && quem !== 'cliente' && !(u.tipo === 'cadastro' && S.estado.verificada);
        let no = null;
        if (interativo && COMPONENTES[u.tipo]) {
          vivos.add(chave);
          if (!S.comps.has(chave)) S.comps.set(chave, COMPONENTES[u.tipo](u));
          no = S.comps.get(chave);
        } else no = resumoDe(u, ultimoPorTipo[u.tipo] === `${i}`);
        if (no) nos.push(h('div', { class: `lc-msg assistente` }, no));
      }
    });
    for (const k of [...S.comps.keys()]) if (!vivos.has(k)) S.comps.delete(k);
    if (S.aguardando || S.estado.digitando) nos.push(h('div', { class: 'lc-digitando', 'aria-label': 'A assistente está escrevendo' }, h('i'), h('i'), h('i')));
    if (S.estado.atendimento?.atendente) nos.push(h('div', { class: 'lc-status' }, `${S.estado.atendimento.atendente}, da equipe LocarX, está na conversa.`));
    else if (S.estado.atendimento?.aguardando) nos.push(h('div', { class: 'lc-status' }, 'Aguardando um atendente da equipe…'));
    if (S.avisoErro) nos.push(h('div', { class: `lc-aviso${S.avisoErro.erro ? ' erro' : ''}`, role: 'status' }, S.avisoErro.texto));
    el.corpo.replaceChildren(...nos);
    if (pertoDoFim || S.msgs.length <= 1) el.corpo.scrollTop = el.corpo.scrollHeight;
    el.vivo.textContent = S.msgs.at(-1)?.de !== 'cliente' ? (S.msgs.at(-1)?.texto || '') : '';
  }

  function atualizarRodape() {
    const precisa = !!S.estado.precisaConfirmar;
    el.form.hidden = precisa;
    el.reconf.hidden = !precisa;
    if (precisa && !el.reconf.dataset.pronto) {
      el.reconf.dataset.pronto = '1';
      const inicio = h('div', {}, h('b', {}, 'Confirme seu número para continuar.'), h('p', { class: 'lc-ajuda' }, `Por segurança, pedimos um código no WhatsApp ${S.estado.telefone || ''} quando a conversa fica parada.`));
      const btn = h('button', { class: 'lc-btn', type: 'button' }, 'Receber código');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const r = await api('POST', '/cadastro', { reenviar: true });
          el.reconf.replaceChildren(blocoCodigo(r.telefone, async () => { S.estado.precisaConfirmar = false; delete el.reconf.dataset.pronto; el.reconf.replaceChildren(); await buscar(); desenhar(); }, null, () => api('POST', '/cadastro', { reenviar: true })));
        } catch (e) { mostrarAviso(e.message, true); btn.disabled = false; }
      });
      inicio.append(btn);
      el.reconf.replaceChildren(inicio);
    }
    if (!precisa && el.reconf.dataset.pronto) { delete el.reconf.dataset.pronto; el.reconf.replaceChildren(); }
  }

  // ---------- janela ----------
  function construir() {
    const host = h('div', { id: 'locarx-chat-host' });
    document.body.append(host);
    const sombra = host.attachShadow({ mode: 'open' });
    const base = CFG.css || new URL('locarx-chat.css', SCRIPT?.src || location.href).href;
    sombra.append(h('link', { rel: 'stylesheet', href: base }));
    el.corpo = h('div', { class: 'lc-corpo', role: 'log', 'aria-live': 'off', tabindex: '0', 'aria-label': 'Mensagens da conversa' });
    el.vivo = h('div', { class: 'lc-vivo', 'aria-live': 'polite' });
    el.campo = h('input', { class: 'lc-campo', type: 'text', placeholder: 'Escreva sua mensagem…', 'aria-label': 'Mensagem', maxlength: '1000', autocomplete: 'off' });
    el.enviar = h('button', { class: 'lc-enviar', type: 'submit', 'aria-label': 'Enviar' }, icone('enviar'));
    el.form = h('form', { class: 'lc-form', onsubmit: (ev) => { ev.preventDefault(); const t = el.campo.value; el.campo.value = ''; enviarTexto(t); } }, el.campo, el.enviar);
    el.reconf = h('div', { class: 'lc-reconfirmar', hidden: true });
    el.menu = h('div', { class: 'lc-menu', role: 'menu' },
      h('button', { type: 'button', role: 'menuitem', onclick: () => { menu(false); enviar({ acao: { tipo: 'atendente' } }); } }, 'Falar com um atendente'),
      h('button', { type: 'button', role: 'menuitem', onclick: () => { menu(false); novaConversa(); } }, 'Nova conversa'),
      CFG.privacidade ? h('button', { type: 'button', role: 'menuitem', onclick: () => { menu(false); window.open(CFG.privacidade, '_blank', 'noopener'); } }, 'Política de privacidade') : null);
    const janela = h('section', { class: 'lc-janela', role: 'dialog', 'aria-label': 'Chat LocarX', 'aria-modal': 'false' },
      h('header', { class: 'lc-topo' }, h('div', { class: 'lc-avatar', 'aria-hidden': 'true' }, 'L'),
        h('div', { class: 'lc-titulo' }, h('b', {}, 'Lia'), h('span', {}, 'Assistente virtual LocarX')),
        h('button', { class: 'lc-icone', type: 'button', 'aria-label': 'Mais opções', 'aria-haspopup': 'menu', onclick: () => menu() }, icone('mais')),
        h('button', { class: 'lc-icone', type: 'button', 'aria-label': 'Fechar o chat', onclick: () => alternar(false) }, icone('x'))),
      el.menu, el.corpo, el.vivo,
      h('footer', { class: 'lc-rodape' }, el.form, el.reconf, h('p', { class: 'lc-privacidade' }, 'Assistente virtual com IA. Pode errar: confirme o valor final antes de pagar.')));
    el.bolha = h('button', { class: 'lc-bolha', type: 'button', 'aria-label': 'Abrir o chat da LocarX', onclick: () => alternar(true) }, icone('chat'), h('span', {}, 'Fale com a Lia'));
    raiz = h('div', { class: 'lc', 'data-aberto': 'false' }, el.bolha, janela);
    sombra.append(raiz);
    el.janela = janela;
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && S.aberto) { if (el.menu.dataset.aberto === 'true') menu(false); else alternar(false); } });
  }

  function menu(abrir) {
    const aberto = abrir ?? el.menu.dataset.aberto !== 'true';
    el.menu.dataset.aberto = String(aberto);
  }

  async function alternar(abrir) {
    S.aberto = abrir;
    raiz.dataset.aberto = String(abrir);
    guardar.gravar(CHAVE_ABERTO, abrir ? '1' : '0', true);
    if (abrir) {
      if (!S.msgs.length) { el.corpo.replaceChildren(h('div', { class: 'lc-status' }, 'Conectando…')); await abrirSessao(); }
      else await buscar();
      agendarPoll();
      // foco no campo de texto só no computador e quando não há componente esperando resposta (no celular abriria o teclado à toa)
      setTimeout(() => { const ultima = S.msgs[S.msgs.length - 1]; if (window.matchMedia?.('(pointer: fine)').matches && !(ultima?.ui?.length && ultima.de !== 'cliente')) el.campo.focus(); }, 80);
    } else { clearTimeout(S.poll); menu(false); el.bolha.focus(); }
  }

  async function novaConversa() {
    try { if (S.token) await api('POST', '/encerrar', {}); } catch { /* já expirada */ }
    guardar.apagar(CHAVE_TOKEN); S.token = null; S.msgs = []; S.cursor = null; S.estado = {}; S.comps.clear(); S.assinatura = ''; S.aguardando = false;
    el.corpo.replaceChildren(h('div', { class: 'lc-status' }, 'Conectando…'));
    await abrirSessao();
  }

  function init(opcoes) {
    if (raiz) return;
    Object.assign(CFG, opcoes || {});
    if (SCRIPT) {
      const d = SCRIPT.dataset;
      if (d.api) CFG.api = d.api; if (d.chave) CFG.chave = d.chave; if (d.privacidade) CFG.privacidade = d.privacidade; if (d.aberto === '1') CFG.abrir = true;
    }
    CFG.api = String(CFG.api).replace(/\/+$/, '');
    if (CFG.privacidade && !/^https:\/\//.test(CFG.privacidade)) CFG.privacidade = null;
    construir();
    if (CFG.abrir || guardar.ler(CHAVE_ABERTO, true) === '1') alternar(true);
  }

  window.LocarxChat = { init, abrir: () => alternar(true), fechar: () => alternar(false) };
  const auto = () => { if (SCRIPT && SCRIPT.dataset.manual !== '1') init(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})();
