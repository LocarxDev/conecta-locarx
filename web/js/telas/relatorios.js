// Relatórios: da loja (dono) e da rede (administração e matriz). Só números, sem conteúdo de conversas.
import { api } from '../api.js';
import { html, render, $, $$, icone, seguro } from '../util.js';

const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const minutos = (m) => (m == null ? '—' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);

function seletorPeriodo(dias) {
  return html`<div class="abas" role="tablist" aria-label="Período">${[[7, '7 dias'], [30, '30 dias'], [90, '90 dias']].map(([d, t]) => html`<button role="tab" data-dias="${d}" class="${d === dias ? 'ativa' : ''}" aria-selected="${d === dias}">${t}</button>`)}</div>`;
}

// gráfico de barras simples (uma série, um eixo), com dica ao passar o mouse
function barrasPorDia(serie, chave, rotulo) {
  const max = Math.max(1, ...serie.map((d) => d[chave]));
  const passo = serie.length > 31 ? 7 : serie.length > 10 ? 5 : 1;
  return seguro(`<div class="grafico" role="img" aria-label="${rotulo} por dia">
    <div class="grafico-eixo"><span>${max}</span><span>${Math.round(max / 2)}</span><span>0</span></div>
    <div class="grafico-barras">${serie.map((d, i) => {
      const dia = new Date(d.dia + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      return `<div class="coluna-grafico" tabindex="0" aria-label="${dia}: ${d[chave]} ${rotulo.toLowerCase()}">
        <span class="barra" style-h="${Math.round((d[chave] / max) * 100)}"></span>
        <span class="dica">${dia} · ${d[chave]}</span>
        <span class="rotulo-x">${i % passo === 0 ? dia : ''}</span></div>`;
    }).join('')}</div></div>`);
}
// altura das barras via CSSOM (a CSP não permite estilo escrito no HTML)
function aplicarAlturas(raiz) { $$('[style-h]', raiz).forEach((b) => { b.style.height = b.getAttribute('style-h') + '%'; b.removeAttribute('style-h'); }); }

function funil(etapas) {
  const max = Math.max(1, etapas[0][1]);
  return seguro(`<div class="funil-relatorio">${etapas.map(([nome, n], i) => `<div class="etapa-funil">
    <span class="etapa-nome">${nome}</span>
    <span class="etapa-trilho"><span class="etapa-barra" style-h-w="${Math.max(2, Math.round((n / max) * 100))}"></span></span>
    <span class="etapa-num num">${n}${i ? ` <small>${pct(n, etapas[i - 1][1])}% da etapa anterior</small>` : ''}</span></div>`).join('')}</div>`);
}
function aplicarLarguras(raiz) { $$('[style-h-w]', raiz).forEach((b) => { b.style.width = b.getAttribute('style-h-w') + '%'; b.removeAttribute('style-h-w'); }); }

// ---------------- loja ----------------
export async function loja(alvo, ctx) {
  let dias = 30;
  async function carregar() {
    render(alvo, html`<div class="cabecalho-pagina"><div class="titulos"><h1>Relatórios</h1><p>Carregando…</p></div>${seletorPeriodo(dias)}</div>`);
    let r;
    try { r = await api.relatorioLoja(dias); } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      return render(alvo, html`<div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div></div>`);
    }
    render(alvo, html`
      <div class="cabecalho-pagina"><div class="titulos"><h1>Relatórios</h1><p>Atendimento da ${ctx.usuario.loja?.nome || 'loja'} nos últimos ${dias} dias.</p></div>${seletorPeriodo(dias)}</div>
      <div class="resumo">
        <div class="resumo-item"><span class="rotulo">Conversas com clientes</span><span class="valor">${r.conversas}</span><span class="detalhe">${pct(r.soAssistente, r.conversas)}% resolvidas só pelo assistente</span></div>
        <div class="resumo-item"><span class="rotulo">Reservas</span><span class="valor">${r.reservas}</span><span class="detalhe">${r.reservasAssistente} feitas pelo assistente</span></div>
        <div class="resumo-item"><span class="rotulo">Valor reservado</span><span class="valor">${reais(r.valor)}</span><span class="detalhe">${reais(r.valorAssistente)} pelo assistente</span></div>
        <div class="resumo-item"><span class="rotulo">Tempo de resposta da equipe</span><span class="valor">${minutos(r.respostaMedianaMin)}</span><span class="detalhe">mediana da 1ª resposta</span></div>
      </div>
      <div class="duas-colunas">
        <section class="painel"><div class="painel-cab"><h2>Conversas por dia</h2></div><div class="painel-corpo">${barrasPorDia(r.porDia, 'conversas', 'Conversas')}</div></section>
        <section class="painel"><div class="painel-cab"><h2>Do contato à reserva</h2></div><div class="painel-corpo">
          ${funil([['Clientes novos', r.clientesNovos], ['Pediram cotação', r.cotacoes], ['Reservaram', r.reservas]])}</div></section>
      </div>
      <div class="duas-colunas">
        <section class="painel"><div class="painel-cab"><h2>Reservas por dia</h2></div><div class="painel-corpo">${barrasPorDia(r.porDia, 'reservas', 'Reservas')}</div></section>
        <section class="painel"><div class="painel-cab"><h2>Por que não fecharam</h2></div>
          ${r.perdas.length ? html`<div class="lista-simples">${r.perdas.map((p) => html`<div><span>${p.motivo || 'Sem motivo'}</span><strong class="num">${p.n}</strong></div>`)}</div>` : html`<div class="estado"><p>Nenhuma perda registrada no período.</p></div>`}</section>
      </div>
      <div class="duas-colunas">
        <section class="painel"><div class="painel-cab"><h2>Equipe</h2></div>
          ${r.equipe.length ? html`<div class="tabela-caixa"><table class="tabela"><thead><tr><th>Pessoa</th><th>Conversas atendidas</th><th>Mensagens</th></tr></thead>
            <tbody>${r.equipe.map((e) => html`<tr><td>${e.nome}</td><td class="num">${e.conversas}</td><td class="num">${e.mensagens}</td></tr>`)}</tbody></table></div>` : html`<div class="estado"><p>Ninguém da equipe respondeu clientes no período.</p></div>`}</section>
        <section class="painel"><div class="painel-cab"><h2>Assistente virtual</h2></div>
          <div class="lista-simples">
            <div><span>Respostas do assistente</span><strong class="num">${r.respostasIa}</strong></div>
            <div><span>Conversas que passaram pela equipe</span><strong class="num">${r.comEquipe}</strong></div>
            <div><span>Perguntas sem resposta</span><a class="btn btn-texto" href="#/base">${r.semResposta.length} · ensinar ${icone('seta')}</a></div>
          </div></section>
      </div>
      <details class="painel tabela-dados"><summary class="painel-cab"><h2>Ver os números em tabela</h2></summary>
        <div class="tabela-caixa"><table class="tabela"><thead><tr><th>Dia</th><th>Conversas</th><th>Reservas</th></tr></thead>
          <tbody>${r.porDia.map((d) => html`<tr><td class="num">${new Date(d.dia + 'T12:00:00').toLocaleDateString('pt-BR')}</td><td class="num">${d.conversas}</td><td class="num">${d.reservas}</td></tr>`)}</tbody></table></div></details>`);
    aplicarAlturas(alvo); aplicarLarguras(alvo);
    $$('[data-dias]', alvo).forEach((b) => b.addEventListener('click', () => { dias = Number(b.dataset.dias); carregar(); }));
  }
  carregar();
}

// ---------------- rede ----------------
export async function rede(alvo, ctx) {
  let dias = 30, ordem = 'reservas';
  async function carregar() {
    render(alvo, html`<div class="cabecalho-pagina"><div class="titulos"><h1>Relatórios da rede</h1><p>Carregando…</p></div>${seletorPeriodo(dias)}</div>`);
    let r;
    try { r = await api.relatorioRede(dias); } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      return render(alvo, html`<div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div></div>`);
    }
    const desenhar = () => {
      const lojas = [...r.lojas].sort((a, b) => (b[ordem] ?? -1) - (a[ordem] ?? -1));
      render($('#ranking', alvo), html`<table class="tabela"><thead><tr><th>#</th><th>Loja</th>
        ${[['conversas', 'Conversas'], ['reservas', 'Reservas'], ['valor', 'Valor'], ['conversao', 'Conversão']].map(([k, t]) => html`<th><button class="ordenar ${ordem === k ? 'ativa' : ''}" data-ordem="${k}">${t}</button></th>`)}
        <th class="col-opcional">WhatsApp</th><th class="col-opcional">Assistente</th><th class="col-opcional">Resposta da equipe</th></tr></thead>
        <tbody>${lojas.map((l, i) => html`<tr><td class="num sub">${i + 1}</td><td><strong>${l.nome}</strong><div class="sub">${l.cidade}/${l.uf}${l.ativa ? '' : ' · desativada'}</div></td>
          <td class="num">${l.conversas}</td><td class="num">${l.reservas}</td><td class="num">${reais(l.valor)}</td><td class="num">${l.conversao}%</td>
          <td class="col-opcional">${l.whatsapp === 'conectado' ? html`<span class="selo ok">Conectado</span>` : html`<span class="selo neutro">Desconectado</span>`}</td>
          <td class="col-opcional">${l.assistente ? html`<span class="selo ok">Ligado</span>` : html`<span class="selo neutro">Desligado</span>`}</td>
          <td class="col-opcional num">${minutos(l.respostaMedianaMin)}</td></tr>`)}</tbody></table>`);
      $$('[data-ordem]', alvo).forEach((b) => b.addEventListener('click', () => { ordem = b.dataset.ordem; desenhar(); }));
    };
    render(alvo, html`
      <div class="cabecalho-pagina"><div class="titulos"><h1>Relatórios da rede</h1><p>Todas as lojas LocarX no Conecta, últimos ${dias} dias. Só números: as conversas ficam com cada loja.</p></div>${seletorPeriodo(dias)}</div>
      <div class="resumo">
        <div class="resumo-item"><span class="rotulo">Conversas</span><span class="valor">${r.total.conversas}</span><span class="detalhe">em ${r.lojas.length} lojas</span></div>
        <div class="resumo-item"><span class="rotulo">Reservas</span><span class="valor">${r.total.reservas}</span><span class="detalhe">${r.total.reservasAssistente} pelo assistente</span></div>
        <div class="resumo-item"><span class="rotulo">Valor reservado</span><span class="valor">${reais(r.total.valor)}</span><span class="detalhe">soma das lojas</span></div>
        <div class="resumo-item"><span class="rotulo">Conversão da rede</span><span class="valor">${pct(r.total.reservas, r.total.conversas)}%</span><span class="detalhe">conversas que viraram reserva</span></div>
      </div>
      <section class="painel"><div class="painel-cab"><h2>Ranking das lojas</h2><span class="sub">Clique no título da coluna para ordenar</span></div><div class="tabela-caixa" id="ranking"></div></section>`);
    desenhar();
    $$('[data-dias]', alvo).forEach((b) => b.addEventListener('click', () => { dias = Number(b.dataset.dias); carregar(); }));
  }
  carregar();
}
