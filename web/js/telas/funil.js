// Funil de vendas em colunas. O assistente move os clientes sozinho; a equipe arrasta ou usa o menu do card.
import { api } from '../api.js';
import { html, render, $, $$, icone, iniciais, avisar, abrirModal, comBotao, quando } from '../util.js';
import { abrirFicha } from './clientes.js';

const COLUNAS = [['novo', 'Novo contato'], ['cotacao', 'Em cotação'], ['reserva', 'Reserva criada'], ['retirada', 'Retirada'], ['concluido', 'Concluído'], ['perdido', 'Perdido']];
const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export async function montar(alvo, ctx) {
  let ops = [];
  render(alvo, html`
    <div class="cabecalho-pagina"><div class="titulos"><h1>Funil de vendas</h1><p>Cada cliente da conversa até a devolução do carro. Concluídos e perdidos mostram os últimos 30 dias.</p></div></div>
    <div class="kanban" id="kanban"><div class="painel"><div class="painel-corpo"><div class="esqueleto"></div></div></div></div>`);
  const k = $('#kanban', alvo);

  function desenhar() {
    render(k, html`${COLUNAS.map(([etapa, nome]) => {
      const cards = ops.filter((o) => o.etapa === etapa);
      const total = cards.reduce((s, o) => s + (o.valor || 0), 0);
      return html`<section class="coluna" data-etapa="${etapa}" aria-label="${nome}">
        <header><h2>${nome}</h2><span class="sub num">${cards.length}${total ? ` · ${reais(total)}` : ''}</span></header>
        <div class="coluna-cards">${cards.length ? cards.map((o) => html`<article class="card-funil" draggable="true" data-id="${o.id}" tabindex="0">
          <div class="card-topo"><span class="avatar">${o.contato.nome ? iniciais(o.contato.nome) : '#'}</span><strong>${o.contato.nome || '+' + o.contato.telefone}</strong></div>
          ${o.valor ? html`<span class="num valor-card">${reais(o.valor)}</span>` : ''}
          ${o.motivoPerda ? html`<span class="sub">${o.motivoPerda}</span>` : ''}
          <div class="card-rodape"><span class="sub">${quando(o.atualizadaEm)}</span>
            <select data-mover="${o.id}" aria-label="Mover ${o.contato.nome || 'cliente'} para">${COLUNAS.map(([e, n]) => html`<option value="${e}" ${e === o.etapa ? 'selected' : ''}>${n}</option>`)}</select></div>
        </article>`) : html`<p class="coluna-vazia">Nenhum cliente</p>`}</div></section>`;
    })}`);
    $$('.card-funil', k).forEach((c) => {
      c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', c.dataset.id); c.classList.add('arrastando'); });
      c.addEventListener('dragend', () => c.classList.remove('arrastando'));
      c.addEventListener('click', (e) => { if (e.target.closest('select')) return; const o = ops.find((x) => x.id === c.dataset.id); abrirFicha(o.contato.id, ctx, carregar); });
      c.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.target.closest('select')) c.click(); });
    });
    $$('.coluna', k).forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('alvo'); });
      col.addEventListener('dragleave', () => col.classList.remove('alvo'));
      col.addEventListener('drop', (e) => { e.preventDefault(); col.classList.remove('alvo'); mover(e.dataTransfer.getData('text/plain'), col.dataset.etapa); });
    });
    $$('[data-mover]', k).forEach((s) => s.addEventListener('change', () => mover(s.dataset.mover, s.value)));
  }

  async function mover(id, etapa) {
    const o = ops.find((x) => x.id === id);
    if (!o || o.etapa === etapa) return;
    let motivoPerda;
    if (etapa === 'perdido') {
      motivoPerda = await pedirMotivo();
      if (!motivoPerda) return desenhar();
    }
    const anterior = o.etapa;
    o.etapa = etapa; desenhar();
    try { await api.moverOportunidade(id, { etapa, motivoPerda }); o.motivoPerda = motivoPerda || null; desenhar(); }
    catch (err) { o.etapa = anterior; desenhar(); avisar(err.campos ? Object.values(err.campos)[0] : err.message, 'erro'); }
  }

  function pedirMotivo() {
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

  async function carregar() {
    try { ops = await api.funil(); desenhar(); } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      render(k, html`<div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div></div>`);
    }
  }
  carregar();
}
