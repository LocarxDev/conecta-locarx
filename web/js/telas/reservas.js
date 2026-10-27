// Reservas da loja: feitas pelo assistente (e futuramente pela equipe), com a situação do portal LocarX.
import { api } from '../api.js';
import { html, render, $, $$, icone, avisar, comBotao } from '../util.js';

const reais = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const SITUACAO = { confirmada: 'ok', 'em andamento': 'marca', concluida: 'neutro', cancelada: 'erro' };

export async function montar(alvo, ctx) {
  let periodo = 'proximas', busca = '', lista = [], espera = null;
  render(alvo, html`
    <div class="cabecalho-pagina"><div class="titulos"><h1>Reservas</h1><p>Reservas feitas pelo WhatsApp da loja e enviadas ao portal LocarX.</p></div></div>
    <div id="cobrancas-pix" hidden></div>
    <section class="painel">
      <div class="painel-cab">
        <label class="busca"><span class="sr-only">Buscar</span>${icone('busca')}<input id="busca-res" type="search" placeholder="Código, nome ou telefone"></label>
        <div class="abas">${[['proximas', 'Próximas'], ['passadas', 'Anteriores'], ['todas', 'Todas']].map(([v, t]) => html`<button data-p="${v}" class="${v === periodo ? 'ativa' : ''}">${t}</button>`)}</div>
      </div>
      <div id="lista-res"><div class="painel-corpo"><div class="esqueleto"></div></div></div>
    </section>`);
  const area = $('#lista-res', alvo);

  function desenhar() {
    if (!lista.length) return render(area, html`<div class="estado">${icone('reservas')}<h3>Nenhuma reserva</h3><p>${periodo === 'proximas' ? 'As reservas feitas pelo assistente no WhatsApp aparecem aqui.' : 'Nenhuma reserva neste filtro.'}</p></div>`);
    render(area, html`<div class="tabela-caixa"><table class="tabela">
      <thead><tr><th>Reserva</th><th>Cliente</th><th class="col-opcional">Retirada</th><th class="col-opcional">Devolução</th><th class="col-opcional">Valor</th><th>Situação</th><th><span class="sr-only">Ações</span></th></tr></thead>
      <tbody>${lista.map((r) => html`<tr>
        <td><strong class="num">${r.codigo || '—'}</strong><div class="sub">${r.grupo || ''}${r.origem === 'assistente' ? ' · pelo assistente' : ''}</div></td>
        <td>${r.contato ? html`${r.contato.nome || '+' + r.contato.telefone}${r.conversaId ? html`<div class="sub"><a href="#/conversas/${r.conversaId}">abrir conversa</a></div>` : ''}` : '—'}</td>
        <td class="col-opcional num">${dataHora(r.retirada)}</td><td class="col-opcional num">${dataHora(r.devolucao)}</td>
        <td class="col-opcional num">${reais(r.valor)}</td>
        <td><span class="selo ${SITUACAO[r.status] || 'neutro'}">${r.status}</span></td>
        <td><button class="btn btn-texto" data-atualizar="${r.id}" title="Consultar a situação no portal LocarX">Atualizar</button></td>
      </tr>`)}</tbody></table></div>`);
    $$('[data-atualizar]', area).forEach((b) => b.addEventListener('click', () => comBotao(b, async () => {
      try { const nova = await api.atualizarReserva(b.dataset.atualizar); lista = lista.map((r) => (r.id === nova.id ? { ...r, ...nova } : r)); desenhar(); avisar('Situação atualizada pelo portal.'); } catch (err) { avisar(err.message, 'erro'); }
    })));
  }

  async function carregar() {
    try { lista = await api.reservas({ periodo, busca: busca || undefined }); desenhar(); } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      render(area, html`<div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div>`);
    }
  }
  $$('[data-p]', alvo).forEach((b) => b.addEventListener('click', () => { periodo = b.dataset.p; $$('[data-p]', alvo).forEach((x) => x.classList.toggle('ativa', x === b)); carregar(); }));
  $('#busca-res', alvo).addEventListener('input', (e) => { busca = e.target.value.trim(); clearTimeout(espera); espera = setTimeout(carregar, 350); });
  carregar();

  // ---------- cobranças Pix (pagamento pelo WhatsApp) ----------
  const areaPix = $('#cobrancas-pix', alvo);
  const SELO_PIX = { pendente: 'alerta', paga: 'ok', expirada: 'neutro', cancelada: 'neutro', estornada: 'erro', falhou: 'erro' };
  let timerPix = null;
  async function carregarPix() {
    let lista;
    try { lista = await api.cobrancas({}); } catch (err) { if (err.status === 404) return; areaPix.hidden = true; return; }
    if (!lista.length) { areaPix.hidden = true; return; }
    areaPix.hidden = false;
    render(areaPix, html`<section class="painel">
      <div class="painel-cab"><h2>Pagamentos via Pix</h2><span class="sub">${lista.filter((c) => c.status === 'pendente').length} pendente(s) · atualiza sozinho</span></div>
      <div class="tabela-caixa"><table class="tabela">
        <thead><tr><th>Quando</th><th>Cliente</th><th class="col-opcional">Reserva</th><th>Valor</th><th>Situação</th><th><span class="sr-only">Ações</span></th></tr></thead>
        <tbody>${lista.slice(0, 30).map((c) => html`<tr>
          <td class="num nowrap">${dataHora(c.criadaEm)}<div class="sub">${c.origem === 'equipe' ? 'pela equipe' : 'pelo assistente'}${c.devMode ? ' · teste' : ''}</div></td>
          <td>${c.cliente?.nome || '—'}${c.conversaId ? html`<div class="sub"><a href="#/conversas/${c.conversaId}">abrir conversa</a></div>` : ''}</td>
          <td class="col-opcional"><div class="sub">${c.grupo || ''}${c.periodo ? html`<br>${c.periodo.retirada.date.split('-').reverse().slice(0, 2).join('/')} ${c.periodo.retirada.time} → ${c.periodo.devolucao.date.split('-').reverse().slice(0, 2).join('/')} ${c.periodo.devolucao.time}` : ''}</div></td>
          <td class="num"><strong>${reais(c.valor)}</strong></td>
          <td><span class="selo ${SELO_PIX[c.status] || 'neutro'}">${c.status}</span><div class="sub">${c.status === 'pendente' ? 'vence ' + dataHora(c.expiraEm) : c.status === 'paga' ? 'pago ' + dataHora(c.pagaEm) : ''}${c.erro ? html`<div class="erro-texto">${c.erro}</div>` : ''}</div></td>
          <td><div class="acoes-linha">
            ${c.status === 'pendente' ? html`<button class="btn btn-texto" data-verificar="${c.id}" title="Consulta o AbacatePay agora">Verificar</button>` : ''}
            ${c.status === 'pendente' && c.devMode ? html`<button class="btn btn-texto" data-simular="${c.id}" title="Só em ambiente de teste: marca como pago no AbacatePay">Simular pagamento</button>` : ''}
            ${c.comprovanteUrl ? html`<a class="btn btn-texto" href="${c.comprovanteUrl}" target="_blank" rel="noopener">Comprovante</a>` : ''}
          </div></td>
        </tr>`)}</tbody></table></div></section>`);
    $$('[data-verificar]', areaPix).forEach((b) => b.addEventListener('click', () => comBotao(b, async () => {
      try { const r = await api.verificarCobranca(b.dataset.verificar); avisar(r.status === 'paga' ? 'Pagamento confirmado! Reserva criada.' : `Situação: ${r.status}.`); carregarPix(); carregar(); } catch (err) { avisar(err.message, 'erro'); }
    })));
    $$('[data-simular]', areaPix).forEach((b) => b.addEventListener('click', () => comBotao(b, async () => {
      try { const r = await api.simularCobranca(b.dataset.simular); avisar(r.status === 'paga' ? 'Pagamento simulado e reserva criada.' : 'Simulação enviada; aguardando confirmação.'); setTimeout(() => { carregarPix(); carregar(); }, 1500); } catch (err) { avisar(err.message, 'erro'); }
    })));
  }
  carregarPix();
  timerPix = setInterval(() => { if (!document.hidden) carregarPix(); }, 15_000);
  return () => { clearTimeout(espera); clearInterval(timerPix); };
}
