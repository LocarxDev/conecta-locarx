// Reservas da loja: feitas pelo assistente (e futuramente pela equipe), com a situação do portal LocarX.
import { api } from '../api.js';
import { html, render, $, $$, icone, avisar, comBotao, buscavel } from '../util.js';

const reais = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const SITUACAO = { confirmada: 'ok', 'em andamento': 'marca', concluida: 'neutro', cancelada: 'erro' };

export async function montar(alvo, ctx) {
  let periodo = 'proximas', busca = '', lista = [], espera = null, variasFiliais = false, filial = '', escopo = 'minhas', destino = '';
  api.filiais().then((f) => {
    variasFiliais = f.length > 1;
    if (!variasFiliais) return;
    const sel = document.createElement('select'); sel.id = 'filial-res'; sel.className = 'select-filial'; sel.setAttribute('aria-label', 'Filial');
    render(sel, html`<option value="">Todas as filiais</option>${f.map((x) => html`<option value="${x.branchId}">${x.nome}</option>`)}`);
    $('.painel-cab .abas', alvo).after(sel);
    sel.addEventListener('change', () => { filial = sel.value; carregar(); });
    buscavel(sel);
    if (lista.length) desenhar();
  }).catch(() => {});
  render(alvo, html`
    <div class="cabecalho-pagina"><div class="titulos"><h1>Reservas</h1><p>Reservas feitas pelo WhatsApp da loja e enviadas ao portal LocarX.</p></div></div>
    <div id="cobrancas-pix" hidden></div>
    <section class="painel">
      <div class="painel-cab">
        <label class="busca"><span class="sr-only">Buscar</span>${icone('busca')}<input id="busca-res" type="search" placeholder="Código, nome ou telefone"></label>
        <div class="abas" id="abas-escopo" hidden>${[['minhas', 'Desta loja'], ['central', 'Vindas da Central']].map(([v, t]) => html`<button data-e="${v}" class="${v === escopo ? 'ativa' : ''}">${t}</button>`)}</div>
        <div class="abas" id="abas-periodo">${[['proximas', 'Próximas'], ['passadas', 'Anteriores'], ['todas', 'Todas']].map(([v, t]) => html`<button data-p="${v}" class="${v === periodo ? 'ativa' : ''}">${t}</button>`)}</div>
      </div>
      <div id="lista-res"><div class="painel-corpo"><div class="esqueleto"></div></div></div>
    </section>`);
  const area = $('#lista-res', alvo);

  function desenhar() {
    if (!lista.length) return render(area, html`<div class="estado">${icone('reservas')}<h3>Nenhuma reserva</h3><p>${periodo === 'proximas' ? 'As reservas feitas pelo assistente no WhatsApp aparecem aqui.' : 'Nenhuma reserva neste filtro.'}</p></div>`);
    render(area, html`<div class="tabela-caixa"><table class="tabela">
      <thead><tr><th>Reserva</th><th>Cliente</th><th class="col-opcional">Retirada</th><th class="col-opcional">Devolução</th><th class="col-opcional">Valor</th><th>Situação</th><th><span class="sr-only">Ações</span></th></tr></thead>
      <tbody>${lista.map((r) => html`<tr>
        <td><strong class="num">${r.codigo || '—'}</strong><div class="sub">${r.grupo || ''}${r.filial && variasFiliais ? ` · 📍 ${r.filial}` : ''}${r.origem === 'assistente' ? ' · pelo assistente' : ''}${r.destino ? ` · retira em ${r.destino}` : ''}${r.pagamento === 'pix' ? ' · Pix' : ''}</div></td>
        <td>${escopo === 'central' ? html`${r.clienteNome || '—'}<div class="sub">reserva da ${r.central || 'Central'}</div>` : r.contato ? html`${r.contato.nome || '+' + r.contato.telefone}${r.conversaId ? html`<div class="sub"><a href="#/conversas/${r.conversaId}">abrir conversa</a></div>` : ''}` : '—'}</td>
        <td class="col-opcional num">${dataHora(r.retirada)}</td><td class="col-opcional num">${dataHora(r.devolucao)}</td>
        <td class="col-opcional num">${reais(r.valor)}</td>
        <td><span class="selo ${SITUACAO[r.status] || 'neutro'}">${r.status}</span></td>
        <td>${escopo === 'central' ? '' : html`<button class="btn btn-texto" data-atualizar="${r.id}" title="Consultar a situação no portal LocarX">Atualizar</button>`}</td>
      </tr>`)}</tbody></table></div>`);
    $$('[data-atualizar]', area).forEach((b) => b.addEventListener('click', () => comBotao(b, async () => {
      try { const nova = await api.atualizarReserva(b.dataset.atualizar); lista = lista.map((r) => (r.id === nova.id ? { ...r, ...nova } : r)); desenhar(); avisar('Situação atualizada pelo portal.'); } catch (err) { avisar(err.message, 'erro'); }
    })));
  }

  async function carregar() {
    try { lista = await api.reservas({ periodo, busca: busca || undefined, filial: filial || undefined, escopo: escopo === 'central' ? 'central' : undefined, destino: destino || undefined }); desenhar(); } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      render(area, html`<div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div>`);
    }
  }
  $$('#abas-periodo [data-p]', alvo).forEach((b) => b.addEventListener('click', () => { periodo = b.dataset.p; $$('#abas-periodo [data-p]', alvo).forEach((x) => x.classList.toggle('ativa', x === b)); carregar(); }));
  $('#busca-res', alvo).addEventListener('input', (e) => { busca = e.target.value.trim(); clearTimeout(espera); espera = setTimeout(carregar, 350); });
  // Central de Reservas: filtro por loja de destino (a loja onde o cliente vai retirar)
  api.centralInfo().then((i) => {
    if (!i.central) return;
    const sel = document.createElement('select'); sel.id = 'destino-res'; sel.className = 'select-filial'; sel.setAttribute('aria-label', 'Loja de retirada');
    render(sel, html`<option value="">Todas as lojas de retirada</option><option value="fora">Filiais fora do Conecta</option>${i.destinos.map((d) => html`<option value="${d.id}">${d.cidade}/${d.uf} — ${d.nome}</option>`)}`);
    $('#abas-periodo', alvo).before(sel);
    buscavel(sel);
    sel.addEventListener('change', () => { destino = sel.value; carregar(); });
  }).catch(() => {});
  // lojas que recebem reservas da Central de Reservas ganham a aba "Vindas da Central"
  $$('#abas-escopo [data-e]', alvo).forEach((b) => b.addEventListener('click', () => { escopo = b.dataset.e; $$('#abas-escopo [data-e]', alvo).forEach((x) => x.classList.toggle('ativa', x === b)); carregar(); }));
  api.reservas({ escopo: 'central', periodo: 'todas' }).then((l) => { if (l.length) $('#abas-escopo', alvo).hidden = false; }).catch(() => {});
  carregar();

  // ---------- cobranças Pix (pagamento pelo WhatsApp) ----------
  const areaPix = $('#cobrancas-pix', alvo);
  const SELO_PIX = { pendente: 'alerta', paga: 'ok', expirada: 'neutro', cancelada: 'neutro', estornada: 'erro', falhou: 'erro' };
  let timerPix = null;
  let infoPix = null;   // { varredura: { ativa, intervaloSegundos, ultimaEm, erro }, versao }
  const textoVarredura = () => {
    const v = infoPix?.varredura;
    if (!v) return 'verificação automática: sem informação (API antiga?)';
    if (!v.ativa) return 'verificação automática DESLIGADA';
    const ha = v.ultimaEm ? Math.round((Date.now() - new Date(v.ultimaEm)) / 1000) : null;
    return `verificação automática a cada ${v.intervaloSegundos} s${ha != null ? ` · última há ${ha} s` : ' · ainda não rodou'}${v.erro ? ` · erro: ${v.erro}` : ''}${infoPix.versao ? ` · API ${infoPix.versao}` : ''}`;
  };
  async function carregarPix() {
    try { infoPix = await api.pagamentos(); } catch { infoPix = null; }
    let lista;
    if (ctx.usuario.loja?.modulos?.pix === false) { areaPix.hidden = true; return; }
    try { lista = await api.cobrancas({}); } catch (err) { if (err.status === 404 || err.status === 403) return; areaPix.hidden = true; return; }
    if (!lista.length) { areaPix.hidden = true; return; }
    areaPix.hidden = false;
    render(areaPix, html`<section class="painel">
      <div class="painel-cab"><h2>Pagamentos via Pix</h2><span class="sub">${lista.filter((c) => c.status === 'pendente').length} pendente(s) · ${textoVarredura()}</span></div>
      <div class="tabela-caixa"><table class="tabela">
        <thead><tr><th>Quando</th><th>Cliente</th><th class="col-opcional">Reserva</th><th>Valor</th><th>Situação</th><th><span class="sr-only">Ações</span></th></tr></thead>
        <tbody>${lista.slice(0, 30).map((c) => html`<tr>
          <td class="num nowrap">${dataHora(c.criadaEm)}<div class="sub">${c.origem === 'equipe' ? 'pela equipe' : 'pelo assistente'}${c.devMode ? ' · teste' : ''}</div></td>
          <td>${c.cliente?.nome || '—'}${c.conversaId ? html`<div class="sub"><a href="#/conversas/${c.conversaId}">abrir conversa</a></div>` : ''}</td>
          <td class="col-opcional"><div class="sub">${c.grupo || ''}${c.periodo ? html`<br>${c.periodo.retirada.date.split('-').reverse().slice(0, 2).join('/')} ${c.periodo.retirada.time} → ${c.periodo.devolucao.date.split('-').reverse().slice(0, 2).join('/')} ${c.periodo.devolucao.time}` : ''}</div></td>
          <td class="num"><strong>${reais(c.valor)}</strong>${c.codigo ? html`<div class="sub num">${c.codigo}</div>` : ''}</td>
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
