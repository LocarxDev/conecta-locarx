// Funil de vendas em colunas. Cada loja tem os próprios funis (o dono personaliza em "Funis, etiquetas e campos").
// O assistente e as automações movem os clientes no funil principal; a equipe arrasta ou usa o menu do card.
import { api } from '../api.js';
import { html, render, $, $$, icone, iniciais, avisar, quando, chipEtiqueta, preferencia } from '../util.js';
import { abrirFicha } from './clientes.js';
import { pedirMotivo } from './painel-cliente.js';

const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export async function montar(alvo, ctx) {
  let funis = [], funil = null, ops = [];
  const dono = ctx.usuario.perfil === 'dono';
  render(alvo, html`
    <div class="cabecalho-pagina">
      <div class="titulos"><h1>Funil de vendas</h1><p>Cada cliente da conversa até a devolução do carro. Concluídos e perdidos mostram os últimos 30 dias.</p></div>
      <div class="filtros">
        <label class="sr-only" for="escolher-funil">Funil</label>
        <select id="escolher-funil" class="campo-inline" hidden></select>
        ${dono ? html`<a class="btn btn-contorno" href="#/personalizar">${icone('ajustes')}Personalizar funis</a>` : ''}
      </div>
    </div>
    <div class="kanban" id="kanban"><div class="painel"><div class="painel-corpo"><div class="esqueleto"></div></div></div></div>`);
  const k = $('#kanban', alvo), sel = $('#escolher-funil', alvo);

  function desenhar() {
    const etapas = funil.etapas;
    render(k, html`${etapas.map((etapa) => {
      const cards = ops.filter((o) => o.etapaId === etapa.id);
      const total = cards.reduce((s, o) => s + (o.valor || 0), 0);
      return html`<section class="coluna" data-etapa="${etapa.id}" aria-label="${etapa.nome}">
        <header data-cor="${etapa.cor}"><h2><span class="ponto-cor"></span>${etapa.nome}</h2><span class="sub num">${cards.length}${total ? ` · ${reais(total)}` : ''}</span></header>
        <div class="coluna-cards">${cards.length ? cards.map((o) => html`<article class="card-funil" draggable="true" data-id="${o.id}" tabindex="0">
          <div class="card-topo"><span class="avatar">${o.contato.nome ? iniciais(o.contato.nome) : '#'}</span><strong>${o.contato.nome || '+' + o.contato.telefone}</strong></div>
          ${o.contato.etiquetas?.length ? html`<div class="card-etiquetas">${o.contato.etiquetas.slice(0, 3).map((e) => chipEtiqueta(e))}</div>` : ''}
          ${o.valor ? html`<span class="num valor-card">${reais(o.valor)}</span>` : ''}
          ${o.motivoPerda ? html`<span class="sub">${o.motivoPerda}</span>` : ''}
          <div class="card-rodape"><span class="sub">${quando(o.atualizadaEm)}</span>
            <select data-mover="${o.id}" aria-label="Mover ${o.contato.nome || 'cliente'} para">${etapas.map((e) => html`<option value="${e.id}" ${e.id === o.etapaId ? 'selected' : ''}>${e.nome}</option>`)}</select></div>
        </article>`) : html`<p class="coluna-vazia">Nenhum cliente</p>`}</div></section>`;
    })}`);
    $$('.card-funil', k).forEach((c) => {
      c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', c.dataset.id); c.classList.add('arrastando'); });
      c.addEventListener('dragend', () => c.classList.remove('arrastando'));
      c.addEventListener('click', (e) => { if (e.target.closest('select')) return; const o = ops.find((x) => x.id === c.dataset.id); abrirFicha(o.contato.id, ctx, () => carregar()); });
      c.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.target.closest('select')) c.click(); });
    });
    $$('.coluna', k).forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('alvo'); });
      col.addEventListener('dragleave', () => col.classList.remove('alvo'));
      col.addEventListener('drop', (e) => { e.preventDefault(); col.classList.remove('alvo'); mover(e.dataTransfer.getData('text/plain'), col.dataset.etapa); });
    });
    $$('[data-mover]', k).forEach((s) => s.addEventListener('change', () => mover(s.dataset.mover, s.value)));
  }

  async function mover(id, etapaId) {
    const o = ops.find((x) => x.id === id);
    if (!o || o.etapaId === etapaId) return;
    const etapa = funil.etapas.find((e) => e.id === etapaId);
    let motivoPerda;
    if (etapa.tipo === 'perdido') {
      motivoPerda = await pedirMotivo();
      if (!motivoPerda) return desenhar();
    }
    const anterior = o.etapaId;
    o.etapaId = etapaId; desenhar();
    try { const r = await api.moverOportunidade(id, { etapaId, motivoPerda }); Object.assign(o, { motivoPerda: r.motivoPerda, resultado: r.resultado }); desenhar(); }
    catch (err) { o.etapaId = anterior; desenhar(); avisar(err.campos ? Object.values(err.campos)[0] : err.message, 'erro'); }
  }

  async function carregar(funilId) {
    try {
      if (!funis.length) {
        funis = await api.funis();
        const lembrado = preferencia.ler('funil');
        funil = funis.find((f) => f.id === lembrado) || funis.find((f) => f.principal) || funis[0];
        sel.hidden = funis.length < 2;
        render(sel, html`${funis.map((f) => html`<option value="${f.id}" ${f.id === funil.id ? 'selected' : ''}>${f.nome}${f.principal ? ' (principal)' : ''}</option>`)}`);
      }
      if (funilId) funil = funis.find((f) => f.id === funilId) || funil;
      const r = await api.funil(funil.id);
      ops = r.oportunidades;
      desenhar();
    } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      render(k, html`<div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div></div>`);
    }
  }
  sel.addEventListener('change', () => { preferencia.gravar('funil', sel.value); carregar(sel.value); });
  carregar();
}
