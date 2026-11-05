// Funil de vendas em colunas. Cada loja tem os próprios funis (o dono personaliza em "Funis, etiquetas e campos").
// O assistente e as automações movem os clientes no funil principal; a equipe arrasta ou usa o menu do card.
// v14.9: período (este mês, mês anterior, 30 dias, intervalo) para fechados/perdidos; números no topo com comparação; cards parados.
import { api } from '../api.js';
import { html, render, $, $$, icone, iniciais, avisar, quando, chipEtiqueta, preferencia } from '../util.js';
import { abrirFicha } from './clientes.js';
import { pedirMotivo } from './painel-cliente.js';

const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const PERIODOS = [['mes', 'Este mês'], ['mes-anterior', 'Mês anterior'], ['30d', 'Últimos 30 dias'], ['intervalo', 'Outro período…']];
const diaIso = (d) => d.toISOString().slice(0, 10);

export async function montar(alvo, ctx) {
  let funis = [], quadros = new Map(), resumos = new Map(), modo = 'todos';   // modo: id de um funil ou 'todos'
  let periodo = preferencia.ler('funil-periodo') || 'mes', de = '', ate = '', soParados = false, diasParado = 3;
  if (!PERIODOS.some(([k]) => k === periodo)) periodo = 'mes';
  if (periodo === 'intervalo') { const hoje = new Date(); ate = diaIso(hoje); de = diaIso(new Date(hoje.getTime() - 29 * 86400000)); }
  const dono = ctx.usuario.perfil === 'dono';
  render(alvo, html`
    <div class="cabecalho-pagina">
      <div class="titulos"><h1>Funil de vendas</h1><p>Cada cliente da conversa até a devolução do carro. Quem está em andamento aparece sempre; concluídos e perdidos, só no período escolhido. Arraste o cliente, ou use o menu do card, para mudar de etapa ou de funil.</p></div>
      <div class="filtros filtros-funil">
        <label class="campo-periodo"><span class="sr-only">Período</span><select id="periodo-funil">${PERIODOS.map(([k, n]) => html`<option value="${k}" ${k === periodo ? 'selected' : ''}>${n}</option>`)}</select></label>
        <span id="intervalo-funil" class="intervalo-funil campo-inline" ${periodo !== 'intervalo' ? 'hidden' : ''}>
          <input type="date" id="de-funil" value="${de}" aria-label="De"> <span class="sub">a</span> <input type="date" id="ate-funil" value="${ate}" aria-label="Até">
          <button class="btn btn-contorno" id="aplicar-funil" type="button">Aplicar</button>
        </span>
        <button class="btn btn-contorno" id="so-parados" type="button" aria-pressed="false">${icone('alerta')}Parados</button>
        ${dono ? html`<a class="btn btn-contorno" href="#/personalizar">${icone('ajustes')}Personalizar funis</a>` : ''}
      </div>
    </div>
    <div class="abas abas-funis" id="abas-funis" role="tablist" aria-label="Funis" hidden></div>
    <div id="resumo-funil"></div>
    <div id="quadros"><div class="painel"><div class="painel-corpo"><div class="esqueleto"></div></div></div></div>`);
  const area = $('#quadros', alvo), abas = $('#abas-funis', alvo), areaResumo = $('#resumo-funil', alvo);

  const todasOps = () => [...quadros.values()].flat();
  const funilDaEtapa = (etapaId) => funis.find((f) => f.etapas.some((e) => e.id === etapaId));
  const visiveis = () => (modo === 'todos' ? funis : funis.filter((f) => f.id === modo));
  const paramsPeriodo = () => (periodo === 'intervalo' ? { periodo, de, ate } : { periodo });

  // ---- período e filtro "parados" ----
  const selPeriodo = $('#periodo-funil', alvo), caixaIntervalo = $('#intervalo-funil', alvo), btnParados = $('#so-parados', alvo);
  selPeriodo.addEventListener('change', () => {
    periodo = selPeriodo.value; preferencia.gravar('funil-periodo', periodo);
    caixaIntervalo.hidden = periodo !== 'intervalo';
    if (periodo === 'intervalo') { if (!de || !ate) { const hoje = new Date(); ate = diaIso(hoje); de = diaIso(new Date(hoje.getTime() - 29 * 86400000)); $('#de-funil', alvo).value = de; $('#ate-funil', alvo).value = ate; } }
    else carregar();
  });
  $('#aplicar-funil', alvo).addEventListener('click', () => {
    de = $('#de-funil', alvo).value; ate = $('#ate-funil', alvo).value;
    if (!de || !ate) return avisar('Informe as duas datas.', 'erro');
    if (ate < de) return avisar('O fim do período precisa ser depois do início.', 'erro');
    carregar();
  });
  btnParados.addEventListener('click', () => { soParados = !soParados; btnParados.setAttribute('aria-pressed', String(soParados)); btnParados.classList.toggle('btn-primario', soParados); btnParados.classList.toggle('btn-contorno', !soParados); desenhar(); });

  function desenharAbas() {
    abas.hidden = funis.length < 2;
    render(abas, html`${[['todos', 'Todos os funis'], ...funis.map((f) => [f.id, f.nome])].map(([v, t]) =>
      html`<button role="tab" data-funil="${v}" class="${v === modo ? 'ativa' : ''}" aria-selected="${v === modo}">${t}</button>`)}`);
    $$('[data-funil]', abas).forEach((b) => b.addEventListener('click', () => {
      modo = b.dataset.funil; preferencia.gravar('funil', modo); desenharAbas(); carregar();
    }));
  }

  // ---- números no topo (soma dos funis visíveis) ----
  function desenharResumo() {
    const lista = visiveis().map((f) => resumos.get(f.id)).filter(Boolean);
    if (!lista.length) return render(areaResumo, '');
    const soma = (sel) => lista.reduce((s, r) => s + (sel(r) || 0), 0);
    const atual = { novos: soma((r) => r.atual.novos), ganhos: soma((r) => r.atual.ganhos), valorGanho: soma((r) => r.atual.valorGanho), perdidos: soma((r) => r.atual.perdidos) };
    const ant = { novos: soma((r) => r.anterior.novos), ganhos: soma((r) => r.anterior.ganhos), valorGanho: soma((r) => r.anterior.valorGanho), perdidos: soma((r) => r.anterior.perdidos) };
    const conv = (x) => (x.ganhos + x.perdidos ? Math.round((x.ganhos / (x.ganhos + x.perdidos)) * 100) : null);
    const fechados = lista.filter((r) => r.atual.diasAteFechar != null);
    const dias = fechados.length ? Math.round(fechados.reduce((s, r) => s + r.atual.diasAteFechar * r.atual.ganhos, 0) / Math.max(1, fechados.reduce((s, r) => s + r.atual.ganhos, 0)) * 10) / 10 : null;
    const abertos = soma((r) => r.abertos), valorAberto = soma((r) => r.valorAberto), parados = soma((r) => r.parados);
    const motivos = new Map();
    lista.forEach((r) => r.motivos.forEach((m) => motivos.set(m.motivo, (motivos.get(m.motivo) || 0) + m.qtd)));
    const topMotivos = [...motivos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const nomeAnt = periodo === 'mes' ? 'mês anterior' : periodo === 'mes-anterior' ? 'mês antes' : 'período anterior';
    const comp = (a, b, fmt = (v) => v) => html`<span class="detalhe">${nomeAnt}: ${fmt(b)}${a > b ? ' ↑' : a < b ? ' ↓' : ''}</span>`;
    const pct = (v) => (v == null ? '—' : `${v}%`);
    render(areaResumo, html`<div class="resumo resumo-6 resumo-funil">
      <div class="resumo-item"><span class="rotulo">Novos clientes</span><span class="valor">${atual.novos}</span>${comp(atual.novos, ant.novos)}</div>
      <div class="resumo-item"><span class="rotulo">Fechados</span><span class="valor ok">${atual.ganhos}</span><span class="detalhe">${atual.valorGanho ? reais(atual.valorGanho) + ' · ' : ''}${nomeAnt}: ${ant.ganhos}${atual.ganhos > ant.ganhos ? ' ↑' : atual.ganhos < ant.ganhos ? ' ↓' : ''}</span></div>
      <div class="resumo-item"><span class="rotulo">Conversão</span><span class="valor ${conv(atual) != null && conv(atual) >= 50 ? 'ok' : ''}">${pct(conv(atual))}</span><span class="detalhe">dos que decidiram · ${nomeAnt}: ${pct(conv(ant))}</span></div>
      <div class="resumo-item"><span class="rotulo">Perdidos</span><span class="valor ${atual.perdidos ? 'erro' : ''}">${atual.perdidos}</span><span class="detalhe">${topMotivos.length ? topMotivos.map(([m, q]) => `${m} (${q})`).join(' · ') : `${nomeAnt}: ${ant.perdidos}`}</span></div>
      <div class="resumo-item"><span class="rotulo">Tempo até fechar</span><span class="valor">${dias != null ? `${dias} d` : '—'}</span><span class="detalhe">média, da entrada ao fechamento</span></div>
      <button type="button" class="resumo-item resumo-botao ${parados ? 'atencao' : ''}" id="kpi-parados" title="Mostrar só os parados"><span class="rotulo">Em andamento</span><span class="valor">${abertos}</span><span class="detalhe">${valorAberto ? reais(valorAberto) + ' · ' : ''}${parados ? html`<strong>${parados} parado${parados === 1 ? '' : 's'}</strong> há ${diasParado}+ dias` : 'nenhum parado'}</span></button>
    </div>`);
    $('#kpi-parados', areaResumo)?.addEventListener('click', () => btnParados.click());
  }

  // opções do menu do card: etapas do funil dele e, em grupos, as dos outros funis
  function opcoesMover(o, funil) {
    const outras = funis.filter((f) => f.id !== funil.id);
    return html`${funil.etapas.map((e) => html`<option value="${e.id}" ${e.id === o.etapaId ? 'selected' : ''}>${e.nome}</option>`)}
      ${outras.map((f) => html`<optgroup label="Mover para o funil ${f.nome}">${f.etapas.map((e) => html`<option value="${e.id}">${e.nome}</option>`)}</optgroup>`)}`;
  }

  function cardHtml(o, funil) {
    return html`<article class="card-funil ${o.diasParado ? 'parado' : ''}" draggable="true" data-id="${o.id}" tabindex="0">
      <div class="card-topo"><span class="avatar">${o.contato.nome ? iniciais(o.contato.nome) : '#'}</span><strong>${o.contato.nome || '+' + o.contato.telefone}</strong></div>
      ${o.contato.etiquetas?.length ? html`<div class="card-etiquetas">${o.contato.etiquetas.slice(0, 3).map((e) => chipEtiqueta(e))}</div>` : ''}
      ${o.valor ? html`<span class="num valor-card">${reais(o.valor)}</span>` : ''}
      ${o.motivoPerda ? html`<span class="sub">${o.motivoPerda}</span>` : ''}
      ${o.diasParado ? html`<div class="card-parado"><span class="selo alerta">${icone('alerta')}Parado há ${o.diasParado} dia${o.diasParado === 1 ? '' : 's'}</span>${o.conversaId ? html`<a class="btn btn-texto btn-mini" href="#/conversas/${o.conversaId}" title="Abrir a conversa e mandar uma mensagem (use / para as respostas rápidas)">${icone('conversas')}Mandar mensagem</a>` : ''}</div>` : ''}
      <div class="card-rodape"><span class="sub">${quando(o.movimentoEm || o.atualizadaEm)}</span>
        <select data-mover="${o.id}" aria-label="Mover ${o.contato.nome || 'cliente'} para">${opcoesMover(o, funil)}</select></div>
    </article>`;
  }

  function desenhar() {
    const lista = visiveis();
    desenharResumo();
    render(area, html`${lista.map((funil) => {
      const ops = (quadros.get(funil.id) || []).filter((o) => !soParados || o.diasParado);
      return html`<section class="quadro-funil" data-quadro="${funil.id}" aria-label="Funil ${funil.nome}">
        ${modo === 'todos' && funis.length > 1 ? html`<h2 class="titulo-funil">${funil.nome}${funil.principal ? html` <span class="selo neutro">principal</span>` : ''} <span class="sub num">${ops.filter((o) => !o.resultado).length} em andamento</span></h2>` : ''}
        <div class="kanban">${funil.etapas.map((etapa) => {
          const cards = ops.filter((o) => o.etapaId === etapa.id);
          const total = cards.reduce((s, o) => s + (o.valor || 0), 0);
          return html`<section class="coluna" data-etapa="${etapa.id}" aria-label="${etapa.nome}">
            <header data-cor="${etapa.cor}"><h2><span class="ponto-cor"></span>${etapa.nome}</h2><span class="sub num">${cards.length}${total ? ` · ${reais(total)}` : ''}</span></header>
            <div class="coluna-cards">${cards.length ? cards.map((o) => cardHtml(o, funil)) : html`<p class="coluna-vazia">${soParados ? 'Nenhum parado' : 'Nenhum cliente'}</p>`}</div></section>`;
        })}</div></section>`;
    })}`);
    $$('.card-funil', area).forEach((c) => {
      c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', c.dataset.id); c.classList.add('arrastando'); });
      c.addEventListener('dragend', () => c.classList.remove('arrastando'));
      c.addEventListener('click', (e) => { if (e.target.closest('select, a')) return; const o = todasOps().find((x) => x.id === c.dataset.id); abrirFicha(o.contato.id, ctx, () => carregar()); });
      c.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.target.closest('select, a')) c.click(); });
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
      if (mudaDeFunil || r.resultado || o.resultado) { if (mudaDeFunil) avisar(`Cliente movido para o funil ${funilDestino.nome}.`); await carregar(); return; }   // fechou/reabriu: recarrega os números
      Object.assign(o, { etapaId, motivoPerda: r.motivoPerda, resultado: r.resultado, diasParado: 0, movimentoEm: r.atualizadaEm }); desenhar();
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
      const buscar = visiveis(), pp = paramsPeriodo();
      const dados = await Promise.all(buscar.map(async (f) => {
        const [q, r] = await Promise.all([api.funil(f.id, pp), api.funilResumo(f.id, pp)]);
        diasParado = q.diasParado || diasParado;
        return [f.id, q.oportunidades, r];
      }));
      quadros = new Map(dados.map(([id, ops]) => [id, ops]));
      resumos = new Map(dados.map(([id, , r]) => [id, r]));
      desenhar();
    } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      if (err.status === 422) return avisar(err.campos ? Object.values(err.campos)[0] : err.message, 'erro');
      render(area, html`<div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div></div>`);
    }
  }
  carregar();
}
