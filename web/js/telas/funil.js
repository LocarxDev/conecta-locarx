// Funil de vendas em colunas. Cada loja tem os próprios funis (o dono personaliza em "Funis, etiquetas e campos").
// O assistente e as automações movem os clientes no funil principal; a equipe arrasta ou usa o menu do card.
import { api } from '../api.js';
import { html, render, $, $$, icone, iniciais, avisar, quando, chipEtiqueta, preferencia } from '../util.js';
import { abrirFicha } from './clientes.js';
import { pedirMotivo } from './painel-cliente.js';

const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export async function montar(alvo, ctx) {
  let funis = [], quadros = new Map(), modo = 'todos';   // modo: id de um funil ou 'todos'
  const dono = ctx.usuario.perfil === 'dono';
  render(alvo, html`
    <div class="cabecalho-pagina">
      <div class="titulos"><h1>Funil de vendas</h1><p>Cada cliente da conversa até a devolução do carro. Concluídos e perdidos mostram os últimos 30 dias. Arraste o cliente, ou use o menu do card, para mudar de etapa ou de funil.</p></div>
      <div class="filtros">
        ${dono ? html`<a class="btn btn-contorno" href="#/personalizar">${icone('ajustes')}Personalizar funis</a>` : ''}
      </div>
    </div>
    <div class="abas abas-funis" id="abas-funis" role="tablist" aria-label="Funis" hidden></div>
    <div id="quadros"><div class="painel"><div class="painel-corpo"><div class="esqueleto"></div></div></div></div>`);
  const area = $('#quadros', alvo), abas = $('#abas-funis', alvo);

  const todasOps = () => [...quadros.values()].flat();
  const funilDaEtapa = (etapaId) => funis.find((f) => f.etapas.some((e) => e.id === etapaId));
  const visiveis = () => (modo === 'todos' ? funis : funis.filter((f) => f.id === modo));

  function desenharAbas() {
    abas.hidden = funis.length < 2;
    render(abas, html`${[['todos', 'Todos os funis'], ...funis.map((f) => [f.id, f.nome])].map(([v, t]) =>
      html`<button role="tab" data-funil="${v}" class="${v === modo ? 'ativa' : ''}" aria-selected="${v === modo}">${t}</button>`)}`);
    $$('[data-funil]', abas).forEach((b) => b.addEventListener('click', () => {
      modo = b.dataset.funil; preferencia.gravar('funil', modo); desenharAbas(); carregar();
    }));
  }

  // opções do menu do card: etapas do funil dele e, em grupos, as dos outros funis
  function opcoesMover(o, funil) {
    const outras = funis.filter((f) => f.id !== funil.id);
    return html`${funil.etapas.map((e) => html`<option value="${e.id}" ${e.id === o.etapaId ? 'selected' : ''}>${e.nome}</option>`)}
      ${outras.map((f) => html`<optgroup label="Mover para o funil ${f.nome}">${f.etapas.map((e) => html`<option value="${e.id}">${e.nome}</option>`)}</optgroup>`)}`;
  }

  function cardHtml(o, funil) {
    return html`<article class="card-funil" draggable="true" data-id="${o.id}" tabindex="0">
      <div class="card-topo"><span class="avatar">${o.contato.nome ? iniciais(o.contato.nome) : '#'}</span><strong>${o.contato.nome || '+' + o.contato.telefone}</strong></div>
      ${o.contato.etiquetas?.length ? html`<div class="card-etiquetas">${o.contato.etiquetas.slice(0, 3).map((e) => chipEtiqueta(e))}</div>` : ''}
      ${o.valor ? html`<span class="num valor-card">${reais(o.valor)}</span>` : ''}
      ${o.motivoPerda ? html`<span class="sub">${o.motivoPerda}</span>` : ''}
      <div class="card-rodape"><span class="sub">${quando(o.atualizadaEm)}</span>
        <select data-mover="${o.id}" aria-label="Mover ${o.contato.nome || 'cliente'} para">${opcoesMover(o, funil)}</select></div>
    </article>`;
  }

  function desenhar() {
    const lista = visiveis();
    render(area, html`${lista.map((funil) => {
      const ops = quadros.get(funil.id) || [];
      return html`<section class="quadro-funil" data-quadro="${funil.id}" aria-label="Funil ${funil.nome}">
        ${modo === 'todos' && funis.length > 1 ? html`<h2 class="titulo-funil">${funil.nome}${funil.principal ? html` <span class="selo neutro">principal</span>` : ''} <span class="sub num">${ops.filter((o) => !o.resultado).length} em andamento</span></h2>` : ''}
        <div class="kanban">${funil.etapas.map((etapa) => {
          const cards = ops.filter((o) => o.etapaId === etapa.id);
          const total = cards.reduce((s, o) => s + (o.valor || 0), 0);
          return html`<section class="coluna" data-etapa="${etapa.id}" aria-label="${etapa.nome}">
            <header data-cor="${etapa.cor}"><h2><span class="ponto-cor"></span>${etapa.nome}</h2><span class="sub num">${cards.length}${total ? ` · ${reais(total)}` : ''}</span></header>
            <div class="coluna-cards">${cards.length ? cards.map((o) => cardHtml(o, funil)) : html`<p class="coluna-vazia">Nenhum cliente</p>`}</div></section>`;
        })}</div></section>`;
    })}`);
    $$('.card-funil', area).forEach((c) => {
      c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', c.dataset.id); c.classList.add('arrastando'); });
      c.addEventListener('dragend', () => c.classList.remove('arrastando'));
      c.addEventListener('click', (e) => { if (e.target.closest('select')) return; const o = todasOps().find((x) => x.id === c.dataset.id); abrirFicha(o.contato.id, ctx, () => carregar()); });
      c.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.target.closest('select')) c.click(); });
    });
    $$('.coluna', area).forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('alvo'); });
      col.addEventListener('dragleave', () => col.classList.remove('alvo'));
      col.addEventListener('drop', (e) => { e.preventDefault(); col.classList.remove('alvo'); mover(e.dataTransfer.getData('text/plain'), col.dataset.etapa); });
    });
    $$('[data-mover]', area).forEach((s) => s.addEventListener('change', () => mover(s.dataset.mover, s.value)));
  }

  async function mover(id, etapaId) {
    const o = todasOps().find((x) => x.id === id);
    if (!o || o.etapaId === etapaId) return;
    const funilDestino = funilDaEtapa(etapaId);
    const etapa = funilDestino?.etapas.find((e) => e.id === etapaId);
    if (!etapa) return;
    const mudaDeFunil = funilDestino.id !== o.funilId;
    let motivoPerda;
    if (etapa.tipo === 'perdido') {
      motivoPerda = await pedirMotivo();
      if (!motivoPerda) return desenhar();
    }
    try {
      const r = await api.moverOportunidade(id, { etapaId, motivoPerda });
      if (mudaDeFunil) { avisar(`Cliente movido para o funil ${funilDestino.nome}.`); await carregar(); return; }
      Object.assign(o, { etapaId, motivoPerda: r.motivoPerda, resultado: r.resultado }); desenhar();
    } catch (err) { desenhar(); avisar(err.campos ? Object.values(err.campos)[0] : err.message, 'erro'); }
  }

  async function carregar() {
    try {
      if (!funis.length) {
        funis = await api.funis();
        const lembrado = preferencia.ler('funil');
        modo = funis.length < 2 ? (funis[0]?.id || 'todos') : (lembrado === 'todos' || funis.some((f) => f.id === lembrado) ? lembrado : 'todos');
        desenharAbas();
      }
      const buscar = visiveis();
      const quadrosNovos = await Promise.all(buscar.map(async (f) => [f.id, (await api.funil(f.id)).oportunidades]));
      quadros = new Map(quadrosNovos);
      desenhar();
    } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      render(area, html`<div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div></div>`);
    }
  }
  carregar();
}
