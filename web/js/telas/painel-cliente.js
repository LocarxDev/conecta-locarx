// Painel do cliente: funil, etiquetas e informações anotadas (campos personalizados).
// Aparece ao lado da conversa e dentro da ficha do cliente. Cada mudança salva sozinha.
import { api } from '../api.js';
import { html, render, $, $$, icone, avisar, abrirModal, chipEtiqueta, CORES, data } from '../util.js';

const reais = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

// pergunta o motivo quando o cliente vai para uma etapa de "perdido"
export function pedirMotivo() {
  return new Promise((resolver) => {
    let ok = false;
    const m = abrirModal({
      titulo: 'Por que o cliente não fechou?',
      corpo: html`<form class="form" id="form-perda"><div class="campo"><label for="p-motivo">Motivo</label>
        <select id="p-motivo"><option>Preço acima do esperado</option><option>Sem carro disponível</option><option>Cliente desistiu da viagem</option><option>Fechou com outra locadora</option><option>Não respondeu mais</option><option>Não atende aos requisitos (idade, CNH, cartão)</option><option value="outro">Outro</option></select></div>
        <div class="campo" id="campo-outro" hidden><label for="p-outro">Qual?</label><input id="p-outro" maxlength="200"></div></form>`,
      rodape: html`<button class="btn btn-contorno" data-fechar>Cancelar</button><button class="btn btn-primario" type="submit" form="form-perda">Marcar como perdido</button>`,
    });
    $('#p-motivo', m.el).addEventListener('change', (e) => { $('#campo-outro', m.el).hidden = e.target.value !== 'outro'; });
    $('#form-perda', m.el).addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('#p-motivo', m.el).value === 'outro' ? $('#p-outro', m.el).value.trim() : $('#p-motivo', m.el).value;
      if (v.length < 2) return avisar('Informe o motivo.', 'erro');
      ok = true; m.fechar(); resolver(v);
    });
    new MutationObserver((_, obs) => { if (!m.el.isConnected) { obs.disconnect(); if (!ok) resolver(null); } }).observe(document.body, { childList: true });
  });
}

function entradaDoCampo(c) {
  const id = `pc-${c.id}`;
  const v = c.valor ?? '';
  switch (c.tipo) {
    case 'lista':
      return html`<select id="${id}" data-campo="${c.id}"><option value="">—</option>${c.opcoes.map((o) => html`<option ${o === v ? 'selected' : ''}>${o}</option>`)}${v && !c.opcoes.includes(v) ? html`<option selected>${v}</option>` : ''}</select>`;
    case 'simnao':
      return html`<select id="${id}" data-campo="${c.id}"><option value="">—</option><option value="sim" ${v === 'sim' ? 'selected' : ''}>Sim</option><option value="não" ${v === 'não' ? 'selected' : ''}>Não</option></select>`;
    case 'data':
      return html`<input id="${id}" data-campo="${c.id}" type="date" value="${v}">`;
    case 'numero':
      return html`<input id="${id}" data-campo="${c.id}" inputmode="decimal" value="${v}" maxlength="20">`;
    default:
      return html`<input id="${id}" data-campo="${c.id}" value="${v}" maxlength="500">`;
  }
}

/**
 * @param {HTMLElement} el onde desenhar
 * @param {string} contatoId
 * @param {{ comLinkFicha?: boolean, aoMudar?: () => void }} opcoes
 */
export function montarPainelCliente(el, contatoId, { comLinkFicha = true, aoMudar } = {}) {
  let d = null;
  let editandoEtiquetas = false;
  let vivo = true;

  async function carregar() {
    try {
      d = await api.painelCliente(contatoId);
      if (vivo) desenhar();
    } catch (err) {
      if (vivo) render(el, html`<div class="pc"><p class="sub">${err.message}</p></div>`);
    }
  }

  function desenhar() {
    const livres = d.funis.filter((f) => !d.oportunidades.some((o) => o.funilId === f.id)); // funis em que o cliente ainda não está
    const aplicadas = d.aplicadas.map((a) => ({ ...d.etiquetas.find((e) => e.id === a.id), peloAssistente: a.peloAssistente })).filter((e) => e.id);
    render(el, html`<div class="pc" data-salva-sozinho>
      ${comLinkFicha ? html`<div class="pc-cab"><h3>Dados do cliente</h3><a class="btn btn-texto" href="#/clientes/${d.contato.id}">Ficha completa</a></div>` : ''}

      <section class="pc-bloco" aria-label="Funil">
        <h4>${icone('funil')}Funil</h4>
        ${d.oportunidades.map((o) => {
          const f = d.funis.find((x) => x.id === o.funilId);
          if (!f) return '';
          const atual = f.etapas.find((e) => e.id === o.etapaId);
          return html`<div class="pc-funil">
            ${d.funis.length > 1 ? html`<span class="sub">${f.nome}</span>` : ''}
            <label class="sr-only" for="pc-op-${o.id}">Etapa no funil ${f.nome}</label>
            <div class="pc-etapa" data-cor="${atual?.cor || '#64748b'}"><select id="pc-op-${o.id}" data-op="${o.id}">${f.etapas.map((e) => html`<option value="${e.id}" ${e.id === o.etapaId ? 'selected' : ''}>${e.nome}</option>`)}
              ${livres.map((outro) => html`<optgroup label="Mover para o funil ${outro.nome}">${outro.etapas.map((e) => html`<option value="${e.id}">${e.nome}</option>`)}</optgroup>`)}</select></div>
          </div>`;
        })}
        ${livres.map((f) => html`<button class="btn btn-texto" data-entrar-funil="${f.id}">${icone('mais')}Colocar no funil ${f.nome}</button>`)}
      </section>

      <section class="pc-bloco" aria-label="Etiquetas">
        <h4>${icone('etiqueta')}Etiquetas <button class="btn btn-texto pc-mini" data-editar-etiquetas aria-expanded="${editandoEtiquetas}">${editandoEtiquetas ? 'Pronto' : 'Alterar'}</button></h4>
        ${editandoEtiquetas ? html`
          <div class="pc-escolher" role="group" aria-label="Escolha as etiquetas">
            ${d.etiquetas.length ? d.etiquetas.map((e) => {
              const marcada = aplicadas.some((a) => a.id === e.id);
              return html`<button type="button" class="etiqueta cor alternar${marcada ? ' marcada' : ''}" data-cor="${e.cor}" data-etiqueta="${e.id}" aria-pressed="${marcada}">${marcada ? icone('ok') : ''}${e.nome}</button>`;
            }) : html`<p class="sub">Nenhuma etiqueta cadastrada.</p>`}
          </div>
          <form class="pc-nova-etiqueta" id="pc-nova-etiqueta" novalidate><label class="sr-only" for="pc-nova-nome">Nova etiqueta</label>
            <input id="pc-nova-nome" maxlength="30" placeholder="Nova etiqueta"><button class="btn btn-contorno" type="submit">Criar</button></form>`
        : html`<div class="pc-etiquetas">${aplicadas.length ? aplicadas.map((e) => chipEtiqueta(e, e.peloAssistente ? html`<span class="pc-robo" title="Aplicada pelo assistente">${icone('robo')}</span>` : '')) : html`<span class="sub">Nenhuma etiqueta</span>`}</div>`}
      </section>

      <section class="pc-bloco" aria-label="Informações do cliente">
        <h4>${icone('editar')}Informações</h4>
        ${d.campos.length ? html`<form class="pc-campos" id="pc-campos" novalidate>${d.campos.map((c) => html`
          <div class="campo pc-campo">
            <label for="pc-${c.id}">${c.nome}${c.peloAssistente && c.valor ? html`<span class="pc-robo" title="Anotado pelo assistente">${icone('robo')}</span>` : ''}</label>
            ${entradaDoCampo(c)}
          </div>`)}</form>` : html`<p class="sub">Nenhum campo cadastrado.</p>`}
      </section>

      ${d.reservas.length ? html`<section class="pc-bloco" aria-label="Reservas"><h4>${icone('reservas')}Reservas</h4>
        <ul class="lista-ficha">${d.reservas.map((r) => html`<li><strong class="num">${r.codigo || '—'}</strong> · ${data(r.retirada)} · ${reais(r.valor)} <span class="sub">${r.status}</span></li>`)}</ul></section>` : ''}
    </div>`);
    ligar();
  }

  function ligar() {
    // funil
    $$('[data-op]', el).forEach((s) => s.addEventListener('change', async () => {
      const o = d.oportunidades.find((x) => x.id === s.dataset.op);
      const etapa = d.funis.flatMap((x) => x.etapas).find((e) => e.id === s.value);
      let motivoPerda;
      if (etapa.tipo === 'perdido') {
        motivoPerda = await pedirMotivo();
        if (!motivoPerda) { s.value = o.etapaId; return; }
      }
      try {
        await api.moverOportunidade(o.id, { etapaId: etapa.id, motivoPerda });
        if (etapa.tipo !== 'aberta') avisar(etapa.tipo === 'ganho' ? `Venda concluída: cliente em "${etapa.nome}".` : 'Cliente marcado como perdido.');
        await carregar(); aoMudar?.();
      } catch (err) { s.value = o.etapaId; avisar(err.message, 'erro'); }
    }));
    $$('[data-entrar-funil]', el).forEach((entrar) => entrar.addEventListener('click', async () => {
      entrar.disabled = true;
      try { await api.novaOportunidade({ contatoId, funilId: entrar.dataset.entrarFunil }); await carregar(); aoMudar?.(); }
      catch (err) { avisar(err.message, 'erro'); entrar.disabled = false; }
    }));

    // etiquetas
    $('[data-editar-etiquetas]', el).addEventListener('click', () => { editandoEtiquetas = !editandoEtiquetas; desenhar(); if (editandoEtiquetas) $('.pc-escolher button', el)?.focus(); });
    $$('[data-etiqueta]', el).forEach((b) => b.addEventListener('click', async () => {
      const atuais = d.aplicadas.map((a) => a.id);
      const nova = atuais.includes(b.dataset.etiqueta) ? atuais.filter((x) => x !== b.dataset.etiqueta) : [...atuais, b.dataset.etiqueta];
      b.disabled = true;
      try { const r = await api.salvarEtiquetasCliente(contatoId, nova); Object.assign(d, r); desenhar(); $(`[data-etiqueta="${b.dataset.etiqueta}"]`, el)?.focus(); aoMudar?.(); }
      catch (err) { avisar(err.message, 'erro'); b.disabled = false; }
    }));
    $('#pc-nova-etiqueta', el)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const entrada = $('#pc-nova-nome', el), nome = entrada.value.trim();
      if (nome.length < 2) return avisar('Escreva o nome da etiqueta (2 letras ou mais).', 'erro');
      try {
        const cor = CORES[Math.floor(Math.random() * CORES.length)][0];
        const nova = await api.salvarEtiqueta('loja', { nome, cor });
        const r = await api.salvarEtiquetasCliente(contatoId, [...d.aplicadas.map((a) => a.id), nova.id]);
        Object.assign(d, r); desenhar(); avisar('Etiqueta criada e aplicada.'); aoMudar?.();
      } catch (err) { avisar(err.campos ? Object.values(err.campos)[0] : err.message, 'erro'); }
    });

    // campos: salva ao sair do campo / escolher
    $$('[data-campo]', el).forEach((entrada) => {
      const salvar = async () => {
        const c = d.campos.find((x) => x.id === entrada.dataset.campo);
        const valor = entrada.value.trim();
        if ((c.valor ?? '') === valor) return;
        const caixa = entrada.closest('.campo');
        caixa.classList.remove('invalido'); $('.erro-campo', caixa)?.remove();
        try {
          const r = await api.salvarCamposCliente(contatoId, { [c.id]: valor || null });
          const novo = r.campos.find((x) => x.id === c.id);
          Object.assign(c, novo);
          if (entrada.tagName === 'INPUT' && entrada.value !== (novo.valor ?? '')) entrada.value = novo.valor ?? '';
          $('.pc-robo', caixa)?.remove();
          caixa.classList.add('salvo'); setTimeout(() => caixa.classList.remove('salvo'), 1400);
        } catch (err) {
          caixa.classList.add('invalido');
          const p = document.createElement('p'); p.className = 'erro-campo'; p.textContent = err.campos ? Object.values(err.campos)[0] : err.message; caixa.appendChild(p);
        }
      };
      entrada.addEventListener('change', salvar);
      if (entrada.tagName === 'INPUT') entrada.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); entrada.blur(); } });
    });
  }

  render(el, html`<div class="pc"><div class="esqueleto"></div></div>`);
  carregar();
  return {
    // recarrega quando o assistente anota algo (sem atrapalhar quem está digitando)
    recarregar: () => { if (!el.contains(document.activeElement) || document.activeElement === el) carregar(); },
    destruir: () => { vivo = false; },
  };
}
