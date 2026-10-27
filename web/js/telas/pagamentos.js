// Pagamentos online (Pix pelo WhatsApp): conciliação do repasse franqueador → loja.
// Loja (dono): os próprios pagamentos no período, com totais e CSV para pedir o repasse.
// Rede (administração e matriz): por loja, com totais e CSV. Só números e códigos de reserva — sem CPF.
import { api } from '../api.js';
import { html, render, $, $$, icone } from '../util.js';

const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const dataCurta = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '');
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const SELO = { paga: 'ok', estornada: 'erro' };

function periodoPadrao() { const h = new Date(); return { de: iso(new Date(h.getFullYear(), h.getMonth(), 1)), ate: iso(h) }; }
function mesPassado() { const h = new Date(); return { de: iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), ate: iso(new Date(h.getFullYear(), h.getMonth(), 0)) }; }

function filtros(p) {
  return html`<form class="filtros" id="filtro-periodo" novalidate>
    <div class="campo campo-data"><label for="p-de">De</label><input id="p-de" name="de" type="date" value="${p.de}"></div>
    <div class="campo campo-data"><label for="p-ate">Até</label><input id="p-ate" name="ate" type="date" value="${p.ate}"></div>
    <button class="btn btn-contorno" type="submit">Aplicar</button>
    <button class="btn btn-texto" type="button" data-atalho="mes">Este mês</button>
    <button class="btn btn-texto" type="button" data-atalho="anterior">Mês passado</button>
  </form>`;
}

function resumo(t, { rotuloLiquido }) {
  return html`<div class="resumo">
    <div class="resumo-item"><span class="rotulo">Pagamentos recebidos</span><span class="valor">${t.quantidade}</span><span class="detalhe">${t.estornadas ? `${t.estornadas} estornado(s) · ${reais(t.valorEstornado)}` : 'nenhum estorno'}</span></div>
    <div class="resumo-item"><span class="rotulo">Valor bruto</span><span class="valor">${reais(t.bruto)}</span><span class="detalhe">pago pelos clientes</span></div>
    <div class="resumo-item"><span class="rotulo">Taxas do provedor</span><span class="valor">${reais(t.taxas)}</span><span class="detalhe">AbacatePay</span></div>
    <div class="resumo-item"><span class="rotulo">${rotuloLiquido}</span><span class="valor">${reais(t.liquido)}</span><span class="detalhe">bruto − taxas</span></div>
  </div>`;
}

function tabela(itens, { comLoja }) {
  if (!itens.length) return html`<div class="estado">${icone('reservas')}<h3>Nenhum pagamento no período</h3><p>Os pagamentos via Pix confirmados aparecem aqui.</p></div>`;
  return html`<div class="tabela-caixa"><table class="tabela">
    <thead><tr><th>Pago em</th>${comLoja ? html`<th>Loja</th>` : ''}<th>Reserva</th><th class="col-opcional">Cliente</th><th>Valor</th><th class="col-opcional">Taxa</th><th>Líquido</th><th>Situação</th></tr></thead>
    <tbody>${itens.map((i) => html`<tr>
      <td class="num nowrap">${dataHora(i.pagaEm)}${i.devMode ? html`<div class="sub">teste</div>` : ''}</td>
      ${comLoja ? html`<td><strong>${i.loja.nome}</strong></td>` : ''}
      <td>${i.reserva ? html`<strong class="num">${i.reserva.codigo}</strong><div class="sub">${i.reserva.grupo || ''}${i.reserva.retirada ? ` · ${dataCurta(i.reserva.retirada)} → ${dataCurta(i.reserva.devolucao)}` : ''}</div>` : html`<span class="sub">sem reserva (ver ocorrências)</span>`}</td>
      <td class="col-opcional">${i.cliente || '—'}<div class="sub">${i.por || i.origem}</div></td>
      <td class="num">${reais(i.valor)}</td>
      <td class="col-opcional num">${i.taxa != null ? reais(i.taxa) : '—'}</td>
      <td class="num"><strong>${reais(i.liquido)}</strong></td>
      <td><span class="selo ${SELO[i.status] || 'neutro'}">${i.status}</span>${i.comprovanteUrl ? html`<div class="sub"><a href="${i.comprovanteUrl}" target="_blank" rel="noopener">comprovante</a></div>` : ''}</td>
    </tr>`)}</tbody></table></div>`;
}

function ligarFiltros(alvo, p, aoMudar) {
  const f = $('#filtro-periodo', alvo);
  f.addEventListener('submit', (e) => { e.preventDefault(); aoMudar({ de: f.elements.de.value || p.de, ate: f.elements.ate.value || p.ate }); });
  $$('[data-atalho]', f).forEach((b) => b.addEventListener('click', () => aoMudar(b.dataset.atalho === 'mes' ? periodoPadrao() : mesPassado())));
}

export async function loja(alvo, ctx) {
  let p = periodoPadrao();
  async function carregar() {
    render(alvo, html`<div class="cabecalho-pagina"><div class="titulos"><h1>Pagamentos online</h1><p>Carregando…</p></div></div>`);
    let r;
    try { r = await api.relatorioPagamentos(p); } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      return render(alvo, html`<div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div></div>`);
    }
    render(alvo, html`
      <div class="cabecalho-pagina">
        <div class="titulos"><h1>Pagamentos online</h1><p>Pix recebidos pelo WhatsApp da ${ctx.usuario.loja?.nome || 'loja'} na conta da rede. Use este relatório para solicitar o repasse ao franqueador.</p></div>
        <a class="btn btn-contorno" href="${api.urlRelatorioPagamentosCsv(p)}" download>${icone('copiar')}Exportar CSV</a>
      </div>
      <section class="painel"><div class="painel-corpo">${filtros(p)}</div></section>
      ${resumo(r.totais, { rotuloLiquido: 'A receber da rede' })}
      <section class="painel"><div class="painel-cab"><h2>Pagamentos de ${p.de.split('-').reverse().join('/')} a ${p.ate.split('-').reverse().join('/')}</h2></div>${tabela(r.itens, { comLoja: false })}</section>`);
    ligarFiltros(alvo, p, (novo) => { p = novo; carregar(); });
  }
  await carregar();
}

export async function rede(alvo, ctx) {
  let p = periodoPadrao();
  async function carregar() {
    render(alvo, html`<div class="cabecalho-pagina"><div class="titulos"><h1>Repasses Pix</h1><p>Carregando…</p></div></div>`);
    let r;
    try { r = await api.relatorioPagamentosRede(p); } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      return render(alvo, html`<div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div></div>`);
    }
    render(alvo, html`
      <div class="cabecalho-pagina">
        <div class="titulos"><h1>Repasses Pix</h1><p>Pagamentos recebidos na conta da rede pelo WhatsApp das lojas. O líquido é o que cada loja tem a receber no período.</p></div>
        <a class="btn btn-contorno" href="${api.urlRelatorioPagamentosRedeCsv(p)}" download>${icone('copiar')}Exportar CSV</a>
      </div>
      <section class="painel"><div class="painel-corpo">${filtros(p)}</div></section>
      ${resumo(r.totais, { rotuloLiquido: 'A repassar às lojas' })}
      <section class="painel"><div class="painel-cab"><h2>Por loja</h2></div>
        ${r.lojas.length ? html`<div class="tabela-caixa"><table class="tabela"><thead><tr><th>Loja</th><th>Pagamentos</th><th>Bruto</th><th class="col-opcional">Taxas</th><th>A repassar</th><th class="col-opcional">Estornos</th></tr></thead>
          <tbody>${r.lojas.map((l) => html`<tr><td><strong>${l.loja.nome}</strong></td><td class="num">${l.quantidade}</td><td class="num">${reais(l.bruto)}</td><td class="col-opcional num">${reais(l.taxas)}</td><td class="num"><strong>${reais(l.liquido)}</strong></td><td class="col-opcional num">${l.estornadas ? `${l.estornadas} · ${reais(l.valorEstornado)}` : '—'}</td></tr>`)}</tbody></table></div>` : html`<div class="estado"><p>Nenhum pagamento no período.</p></div>`}</section>
      <section class="painel"><div class="painel-cab"><h2>Todos os pagamentos</h2></div>${tabela(r.itens, { comLoja: true })}</section>`);
    ligarFiltros(alvo, p, (novo) => { p = novo; carregar(); });
  }
  await carregar();
}
