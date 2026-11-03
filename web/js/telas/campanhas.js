// v14.5 — Campanhas: o que cada etiqueta rendeu no período (clientes marcados → cotações → reservas → valor),
// quem aplicou (Lia × equipe), evolução diária e comparação entre campanhas. Loja (dono/atendente) e rede (admin/matriz).
import { api } from '../api.js';
import { html, render, $, $$, icone, seguro, avisar, chipEtiqueta, buscavel } from '../util.js';

const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const pctTxt = (v) => `${String(v).replace('.', ',')}%`;
const iso = (d) => d.toISOString().slice(0, 10);
const dataBr = (s) => new Date(s + 'T12:00:00').toLocaleDateString('pt-BR');
const diasEntre = (de, ate) => Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000) + 1;

// ---------- gráfico de linhas em SVG (sem biblioteca: a CSP só permite script próprio) ----------
function graficoLinhas(series, { de, ate, rotulo = 'clientes' }) {
  const dias = []; for (let t = Date.parse(de + 'T00:00:00Z'); t <= Date.parse(ate + 'T00:00:00Z'); t += 86_400_000) dias.push(new Date(t).toISOString().slice(0, 10));
  if (!series.length) return seguro('<div class="estado"><p>Nenhuma etiqueta aplicada no período.</p></div>');
  const W = 720, H = 220, PL = 36, PR = 12, PT = 14, PB = 34;
  const max = Math.max(1, ...series.flatMap((s) => dias.map((d) => s.porDia[d] || 0)));
  const x = (i) => PL + (dias.length === 1 ? (W - PL - PR) / 2 : (i * (W - PL - PR)) / (dias.length - 1));
  const y = (v) => PT + (H - PT - PB) * (1 - v / max);
  const passo = dias.length > 60 ? 14 : dias.length > 20 ? 7 : dias.length > 10 ? 2 : 1;
  const linhas = series.map((s) => {
    const pts = dias.map((d, i) => `${x(i).toFixed(1)},${y(s.porDia[d] || 0).toFixed(1)}`).join(' ');
    const pontos = dias.map((d, i) => (s.porDia[d] ? `<circle cx="${x(i).toFixed(1)}" cy="${y(s.porDia[d]).toFixed(1)}" r="3" fill="${s.cor}"><title>${s.nome} · ${dataBr(d)}: ${s.porDia[d]} ${rotulo}</title></circle>` : '')).join('');
    return `<polyline points="${pts}" fill="none" stroke="${s.cor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${pontos}`;
  }).join('');
  const grade = [0, 0.5, 1].map((f) => `<line x1="${PL}" x2="${W - PR}" y1="${y(max * f).toFixed(1)}" y2="${y(max * f).toFixed(1)}" stroke="currentColor" stroke-opacity=".12"/><text x="${PL - 6}" y="${(y(max * f) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="currentColor" fill-opacity=".6">${Math.round(max * f)}</text>`).join('');
  const eixoX = dias.map((d, i) => (i % passo === 0 || (i === dias.length - 1 && (dias.length - 1) % passo >= Math.max(1, passo / 2)) ? `<text x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="currentColor" fill-opacity=".6">${d.slice(8, 10)}/${d.slice(5, 7)}</text>` : '')).join('');
  const legenda = series.map((s) => `<span class="leg"><i data-cor="${s.cor}"></i>${s.nome}</span>`).join('');
  return seguro(`<div class="grafico-linhas"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${rotulo} por dia e por etiqueta">${grade}${linhas}${eixoX}</svg><div class="legenda-linhas">${legenda}</div></div>`);
}

function funilCampanha(e) {
  const etapas = [['Clientes marcados', e.clientes], ['Pediram cotação', e.cotacoes], ['Reservaram', e.reservas]];
  const max = Math.max(1, e.clientes);
  return html`<div class="funil-relatorio">${etapas.map(([nome, n], i) => html`<div class="etapa-funil"><span class="etapa-nome">${nome}</span><span class="etapa-trilho"><span class="etapa-barra" data-w="${Math.max(2, Math.round((n / max) * 100))}"></span></span><span class="etapa-num num">${n}${i ? html` <small>${etapas[i - 1][1] ? Math.round((n / etapas[i - 1][1]) * 100) : 0}% da etapa anterior</small>` : ''}</span></div>`)}</div>`;
}
function aplicarLarguras(raiz) { $$('[data-w]', raiz).forEach((b) => { b.style.width = b.dataset.w + '%'; }); }

function seletorPeriodo(de, ate) {
  const hoje = new Date();
  const atalhos = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias']];
  const ativo = (n) => (ate === iso(hoje) && diasEntre(de, ate) === n);
  return html`<div class="filtros periodo-campanhas">
    <div class="abas" role="tablist" aria-label="Período rápido">${atalhos.map(([n, t]) => html`<button role="tab" data-rapido="${n}" class="${ativo(n) ? 'ativa' : ''}" aria-selected="${ativo(n)}">${t}</button>`)}</div>
    <label class="campo-inline"><span class="sub">De</span><input type="date" id="cp-de" value="${de}" max="${iso(hoje)}"></label>
    <label class="campo-inline"><span class="sub">Até</span><input type="date" id="cp-ate" value="${ate}" max="${iso(hoje)}"></label>
    <button class="btn btn-contorno" id="cp-aplicar">Aplicar</button>
  </div>`;
}

function cartoes(t, geral, { rede = false } = {}) {
  return html`<div class="resumo">
    <div class="resumo-item"><span class="rotulo">Clientes marcados</span><span class="valor">${t.clientes}</span><span class="detalhe">${t.pelaLia} pela Lia · ${t.clientes - t.pelaLia} pela equipe</span></div>
    <div class="resumo-item"><span class="rotulo">Pediram cotação</span><span class="valor">${t.cotacoes}</span><span class="detalhe">${t.clientes ? Math.round((t.cotacoes / t.clientes) * 100) : 0}% dos marcados</span></div>
    <div class="resumo-item"><span class="rotulo">Reservaram</span><span class="valor">${t.reservas}</span><span class="detalhe">${t.clientes ? Math.round((t.reservas / t.clientes) * 100) : 0}% dos marcados</span></div>
    <div class="resumo-item"><span class="rotulo">Valor reservado</span><span class="valor">${reais(t.valor)}</span><span class="detalhe">${t.reservas ? 'ticket médio ' + reais(t.valor / t.reservas) : '—'}</span></div>
    ${geral && !rede ? html`<div class="resumo-item"><span class="rotulo">Reservas com etiqueta</span><span class="valor">${geral.reservasComEtiqueta}<small> / ${geral.reservasTotal}</small></span><span class="detalhe">${geral.clientesSemEtiqueta} de ${geral.clientesNovos} clientes novos sem etiqueta</span></div>` : ''}
  </div>`;
}

function tabela(etiquetas, { rede = false } = {}) {
  if (!etiquetas.length) return html`<div class="estado">${icone('etiqueta')}<h3>Nenhuma etiqueta aplicada no período</h3><p>Cadastre etiquetas com a condição para a Lia marcar (ex.: "BLACK X: quando o cliente citar a promoção") em Funis, etiquetas e campos. A equipe também pode marcar pelo painel do cliente.</p></div>`;
  const max = Math.max(1, ...etiquetas.map((e) => e.clientes));
  return html`<div class="tabela-caixa"><table class="tabela tabela-campanhas">
    <thead><tr><th>Etiqueta</th><th>Clientes</th><th class="col-opcional">Lia / equipe</th><th>Cotações</th><th>Reservas</th><th>Conversão</th><th>Valor</th><th class="col-opcional">Perdidos</th>${rede ? html`<th class="col-opcional">Lojas</th>` : ''}</tr></thead>
    <tbody>${etiquetas.map((e) => html`<tr data-etiqueta="${e.id || e.nome}">
      <td><div>${chipEtiqueta({ nome: e.nome, cor: e.cor })}${e.daRede ? html` <span class="sub">rede</span>` : ''}</div><div class="barra-trilho mini"><div class="barra-cheia" data-w="${Math.round((e.clientes / max) * 100)}"></div></div></td>
      <td class="num"><strong>${e.clientes}</strong></td>
      <td class="num col-opcional">${e.pelaLia} / ${e.pelaEquipe}</td>
      <td class="num">${e.cotacoes}<div class="sub">${pctTxt(e.conversaoCotacao)}</div></td>
      <td class="num">${e.reservas}</td>
      <td class="num"><strong>${pctTxt(e.conversaoReserva)}</strong></td>
      <td class="num">${reais(e.valor)}${e.ticket ? html`<div class="sub">ticket ${reais(e.ticket)}</div>` : ''}</td>
      <td class="num col-opcional">${e.perdidos}</td>
      ${rede ? html`<td class="num col-opcional">${e.lojas}</td>` : ''}
    </tr>`)}</tbody></table></div>`;
}

async function tela(alvo, ctx, { rede }) {
  const hoje = new Date();
  let de = iso(new Date(Date.now() - 29 * 86_400_000)), ate = iso(hoje), loja = '', lojas = [], escolhida = null;
  if (rede) { try { const r = await api.listarLojas(); lojas = (Array.isArray(r) ? r : r.lojas || []).filter((l) => l.ativa !== false); } catch { lojas = []; } }

  async function carregar() {
    render(alvo, html`<div class="cabecalho-pagina"><div class="titulos"><h1>Campanhas</h1><p>Carregando…</p></div></div><div class="painel"><div class="painel-corpo"><div class="esqueleto"></div></div></div>`);
    let r;
    try { r = rede ? await api.campanhasRede({ de, ate, loja: loja || undefined }) : await api.campanhasLoja({ de, ate }); } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      return render(alvo, html`<div class="cabecalho-pagina"><div class="titulos"><h1>Campanhas</h1></div></div><div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div></div>`);
    }
    const etiquetas = r.etiquetas;
    if (escolhida && !etiquetas.some((e) => (e.id || e.nome) === escolhida)) escolhida = null;
    const chave = (e) => (rede ? e.nome.toLowerCase() : e.id);
    const top = etiquetas.slice(0, 6);
    const series = top.map((e) => ({ nome: e.nome, cor: e.cor, porDia: Object.fromEntries(r.porDia.filter((d) => (rede ? d.etiqueta === e.nome.toLowerCase() : d.etiquetaId === e.id)).map((d) => [d.dia, d.clientes])) }));
    const seriesRes = top.map((e) => ({ nome: e.nome, cor: e.cor, porDia: Object.fromEntries(r.porDia.filter((d) => (rede ? d.etiqueta === e.nome.toLowerCase() : d.etiquetaId === e.id)).map((d) => [d.dia, d.reservas])) }));
    const sel = etiquetas.find((e) => (e.id || e.nome) === escolhida) || etiquetas[0] || null;
    render(alvo, html`
      <div class="cabecalho-pagina"><div class="titulos"><h1>Campanhas</h1><p>O que cada etiqueta rendeu de ${dataBr(de)} a ${dataBr(ate)}${rede ? (loja ? ` · ${lojas.find((l) => l.id === loja)?.nome || 'loja'}` : ' · toda a rede') : ''}. Uma etiqueta é aplicada pela Lia (pela condição cadastrada) ou pela equipe; aqui ela vira um funil: marcados → cotação → reserva.</p></div>
        <div class="filtros">${rede ? html`<select id="cp-loja" class="select-filial" aria-label="Loja"><option value="">Todas as lojas</option>${lojas.map((l) => html`<option value="${l.id}" ${l.id === loja ? 'selected' : ''}>${l.nome}</option>`)}</select>` : ''}<a class="btn btn-contorno" href="${rede ? api.urlCampanhasRedeCsv({ de, ate }) : api.urlCampanhasLojaCsv({ de, ate })}" download>${icone('copiar')}CSV</a></div></div>
      ${seletorPeriodo(de, ate)}
      ${cartoes(r.totais, r.geral, { rede })}
      <div class="duas-colunas">
        <section class="painel"><div class="painel-cab"><div><h2>Clientes marcados por dia</h2><span class="sub">até 6 etiquetas mais usadas</span></div></div><div class="painel-corpo">${graficoLinhas(series, { de, ate, rotulo: 'clientes' })}</div></section>
        <section class="painel"><div class="painel-cab"><div><h2>Reservas por dia</h2><span class="sub">clientes dessas etiquetas que reservaram</span></div></div><div class="painel-corpo">${graficoLinhas(seriesRes, { de, ate, rotulo: 'reservas' })}</div></section>
      </div>
      <section class="painel"><div class="painel-cab"><div><h2>Comparação entre campanhas</h2><span class="sub">clique numa linha para ver o funil</span></div></div>${tabela(etiquetas, { rede })}</section>
      ${sel ? html`<div class="duas-colunas">
        <section class="painel"><div class="painel-cab"><div><h2>Funil — ${sel.nome}</h2><span class="sub">${sel.pelaLia} marcados pela Lia, ${sel.pelaEquipe} pela equipe${sel.perdidos ? ` · ${sel.perdidos} marcados como perdidos` : ''}</span></div></div><div class="painel-corpo">${funilCampanha(sel)}</div></section>
        ${rede && r.porLoja?.length > 1 ? html`<section class="painel"><div class="painel-cab"><div><h2>${sel.nome} por loja</h2></div></div>
          <div class="tabela-caixa"><table class="tabela"><thead><tr><th>Loja</th><th>Clientes</th><th>Reservas</th><th>Valor</th></tr></thead>
            <tbody>${r.porLoja.map((pl) => { const e = pl.etiquetas.find((x) => chave(x) === chave(sel)); return e ? html`<tr><td>${pl.loja.nome}</td><td class="num">${e.clientes}</td><td class="num">${e.reservas}</td><td class="num">${reais(e.valor)}</td></tr>` : ''; })}</tbody></table></div></section>` : html`<section class="painel"><div class="painel-cab"><div><h2>Como ler</h2></div></div><div class="painel-corpo lista-simples">
            <div><span>Clientes marcados</span><span class="sub">pares cliente + etiqueta aplicados no período</span></div>
            <div><span>Pediram cotação</span><span class="sub">o cliente teve cotação (Lia ou equipe) depois de marcado</span></div>
            <div><span>Reservaram</span><span class="sub">reserva não cancelada criada depois da marcação</span></div>
            <div><span>Valor</span><span class="sub">soma dessas reservas; ticket = valor ÷ reservas</span></div></div></section>`}
      </div>` : ''}`);
    aplicarLarguras(alvo);
    $$('[data-rapido]', alvo).forEach((b) => b.addEventListener('click', () => { ate = iso(new Date()); de = iso(new Date(Date.now() - (Number(b.dataset.rapido) - 1) * 86_400_000)); carregar(); }));
    $('#cp-aplicar', alvo).addEventListener('click', () => {
      const d = $('#cp-de', alvo).value, a = $('#cp-ate', alvo).value;
      if (!d || !a) return avisar('Informe as duas datas.', 'erro');
      if (d > a) return avisar('A data inicial precisa ser antes da final.', 'erro');
      if (diasEntre(d, a) > 370) return avisar('Período de no máximo um ano.', 'erro');
      de = d; ate = a; carregar();
    });
    $$('tr[data-etiqueta]', alvo).forEach((tr) => tr.addEventListener('click', () => { escolhida = tr.dataset.etiqueta; carregar(); }));
    const selLoja = $('#cp-loja', alvo);
    if (selLoja) { buscavel(selLoja); selLoja.addEventListener('change', (e) => { loja = e.target.value; carregar(); }); }
  }
  carregar();
}

export const loja = (alvo, ctx) => tela(alvo, ctx, { rede: false });
export const rede = (alvo, ctx) => tela(alvo, ctx, { rede: true });
