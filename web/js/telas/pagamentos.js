// Pagamentos online (Pix pelo WhatsApp): conciliação do repasse franqueador → loja.
// Loja (dono): os próprios pagamentos no período, com totais e CSV para pedir o repasse.
// Rede (administração e matriz): por loja, com totais e CSV. Só números e códigos de reserva — sem CPF.
import { api } from '../api.js';
import { html, render, $, $$, icone, avisar, comBotao, marcarErros, paginar, ligarPaginacao, buscavel } from '../util.js';

const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const dataCurta = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '');
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const SELO = { paga: 'ok', estornada: 'erro' };

function periodoPadrao() { const h = new Date(); return { de: iso(new Date(h.getFullYear(), h.getMonth(), 1)), ate: iso(h) }; }
function mesPassado() { const h = new Date(); return { de: iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), ate: iso(new Date(h.getFullYear(), h.getMonth(), 0)) }; }

function filtros(p, filiais = []) {
  return html`<form class="filtros" id="filtro-periodo" novalidate>
    ${filiais.length > 1 ? html`<div class="campo campo-data"><label for="p-filial">Filial</label><select id="p-filial" name="filial"><option value="">Todas</option>${filiais.map((f) => html`<option value="${f.branchId}" ${String(p.filial || '') === String(f.branchId) ? 'selected' : ''}>${f.nome}</option>`)}</select></div>` : ''}
    <div class="campo campo-data"><label for="p-de">De</label><input id="p-de" name="de" type="date" value="${p.de}"></div>
    <div class="campo campo-data"><label for="p-ate">Até</label><input id="p-ate" name="ate" type="date" value="${p.ate}"></div>
    <button class="btn btn-contorno" type="submit">Aplicar</button>
    <button class="btn btn-texto" type="button" data-atalho="mes">Este mês</button>
    <button class="btn btn-texto" type="button" data-atalho="15">Últimos 15 dias</button>
    <button class="btn btn-texto" type="button" data-atalho="7">Últimos 7 dias</button>
    <button class="btn btn-texto" type="button" data-atalho="anterior">Mês passado</button>
  </form>`;
}

function resumo(t, { rotuloLiquido, repasse = false }) {
  if (repasse) {
    return html`<div class="resumo">
      <div class="resumo-item"><span class="rotulo">Pagamentos recebidos</span><span class="valor">${t.quantidade}</span><span class="detalhe">${t.estornadas ? `${t.estornadas} estornado(s) · ${reais(t.valorEstornado)}` : 'nenhum estorno'}</span></div>
      <div class="resumo-item"><span class="rotulo">Valor bruto</span><span class="valor">${reais(t.bruto)}</span><span class="detalhe">pago pelos clientes</span></div>
      <div class="resumo-item"><span class="rotulo">Taxas do provedor</span><span class="valor">${reais(t.taxas)}</span><span class="detalhe">AbacatePay</span></div>
      <div class="resumo-item"><span class="rotulo">${rotuloLiquido}</span><span class="valor">${reais(t.aRepassar)}</span><span class="detalhe">${t.naContaDaLoja ? `+ ${reais(t.naContaDaLoja)} já na conta das lojas` : 'conta da rede, bruto − taxas'}</span></div>
    </div>`;
  }
  return html`<div class="resumo">
    <div class="resumo-item"><span class="rotulo">Pagamentos recebidos</span><span class="valor">${t.quantidade}</span><span class="detalhe">${t.estornadas ? `${t.estornadas} estornado(s) · ${reais(t.valorEstornado)}` : 'nenhum estorno'}</span></div>
    <div class="resumo-item"><span class="rotulo">Valor bruto</span><span class="valor">${reais(t.bruto)}</span><span class="detalhe">pago pelos clientes</span></div>
    <div class="resumo-item"><span class="rotulo">Taxas do provedor</span><span class="valor">${reais(t.taxas)}</span><span class="detalhe">AbacatePay</span></div>
    <div class="resumo-item"><span class="rotulo">${rotuloLiquido}</span><span class="valor">${reais(t.liquido)}</span><span class="detalhe">bruto − taxas</span></div>
  </div>`;
}

function tabelaFiliais(filiais, { rotulo = 'Líquido' } = {}) {
  if (!filiais || filiais.length < 2) return '';
  return html`<section class="painel"><div class="painel-cab"><h2>Por filial</h2></div><div class="tabela-caixa"><table class="tabela"><thead><tr><th>Filial</th><th>Pagamentos</th><th>Bruto</th><th class="col-opcional">Taxas</th><th>${rotulo}</th></tr></thead>
    <tbody>${filiais.map((f) => html`<tr><td><strong>${f.filial.nome}</strong></td><td class="num">${f.quantidade}</td><td class="num">${reais(f.bruto)}</td><td class="col-opcional num">${reais(f.taxas)}</td><td class="num"><strong>${reais(f.liquido)}</strong></td></tr>`)}</tbody></table></div></section>`;
}

function tabela(itens, { comLoja }) {
  if (!itens.length) return html`<div class="estado">${icone('reservas')}<h3>Nenhum pagamento no período</h3><p>Os pagamentos via Pix confirmados aparecem aqui.</p></div>`;
  return html`<div class="tabela-caixa"><table class="tabela">
    <thead><tr><th>Pago em</th>${comLoja ? html`<th>Loja</th>` : ''}<th>Reserva</th><th class="col-opcional">Cliente</th><th>Valor</th><th class="col-opcional">Taxa</th><th>Líquido</th><th>Situação</th></tr></thead>
    <tbody>${itens.map((i) => html`<tr>
      <td class="num nowrap">${dataHora(i.pagaEm)}${i.devMode ? html`<div class="sub">teste</div>` : ''}</td>
      ${comLoja ? html`<td><strong>${i.loja.nome}</strong></td>` : ''}
      <td>${i.reserva ? html`<strong class="num">${i.reserva.codigo}</strong><div class="sub">${i.reserva.grupo || ''}${i.reserva.filial ? ` · 📍 ${i.reserva.filial}` : ''}${i.reserva.retirada ? ` · ${dataCurta(i.reserva.retirada)} → ${dataCurta(i.reserva.devolucao)}` : ''}</div>` : html`<span class="sub">sem reserva (ver ocorrências)</span>`}</td>
      <td class="col-opcional">${i.cliente || '—'}<div class="sub">${i.por || i.origem}</div></td>
      <td class="num">${reais(i.valor)}${i.codigo ? html`<div class="sub num">${i.codigo}</div>` : ''}</td>
      <td class="col-opcional num">${i.taxa != null ? reais(i.taxa) : '—'}</td>
      <td class="num"><strong>${reais(i.liquido)}</strong></td>
      <td><span class="selo ${SELO[i.status] || 'neutro'}">${i.status}</span>${i.comprovanteUrl ? html`<div class="sub"><a href="${i.comprovanteUrl}" target="_blank" rel="noopener">comprovante</a></div>` : ''}</td>
    </tr>`)}</tbody></table></div>`;
}

function ligarFiltros(alvo, p, aoMudar) {
  const f = $('#filtro-periodo', alvo);
  if (f.elements.filial) buscavel(f.elements.filial);
  const filialSel = () => (f.elements.filial ? f.elements.filial.value || undefined : p.filial);
  f.addEventListener('submit', (e) => { e.preventDefault(); aoMudar({ de: f.elements.de.value || p.de, ate: f.elements.ate.value || p.ate, filial: filialSel() }); });
  f.elements.filial?.addEventListener('change', () => aoMudar({ ...p, filial: filialSel() }));
  const ultimos = (n) => { const h = new Date(); return { de: iso(new Date(h.getFullYear(), h.getMonth(), h.getDate() - (n - 1))), ate: iso(h) }; };
  $$('[data-atalho]', f).forEach((b) => b.addEventListener('click', () => aoMudar({ ...(b.dataset.atalho === 'mes' ? periodoPadrao() : b.dataset.atalho === 'anterior' ? mesPassado() : ultimos(Number(b.dataset.atalho))), filial: filialSel() })));
}

// Painel "Recebimento": conta da rede (repasse) ou conta própria da loja (chave do AbacatePay cadastrada aqui, só pelo dono)
function painelRecebimento(cfg) {
  if (!cfg) return '';
  if (!cfg.proprio) {
    return html`<section class="painel"><div class="painel-cab"><div><h2>Recebimento</h2><span class="sub">Os Pix do WhatsApp caem na conta da rede LocarX; a loja recebe o repasse com base neste relatório.</span></div><span class="selo neutro">Conta da rede</span></div>
      <div class="painel-corpo"><p class="sub">Para receber direto na sua conta AbacatePay, peça à administração da rede para liberar a "conta própria" para a sua loja.</p></div></section>`;
  }
  return html`<section class="painel" id="recebimento"><div class="painel-cab"><div><h2>Recebimento</h2><span class="sub">Os Pix do WhatsApp caem na conta AbacatePay da própria loja — sem repasse.</span></div><span class="selo marca sem-ponto">Conta própria</span></div>
    <div class="painel-corpo">
      ${cfg.chaveFinal ? html`<div class="lista-simples">
          <div><span>Chave do AbacatePay cadastrada <strong class="num">…${cfg.chaveFinal}</strong>${cfg.devMode === true ? html` <span class="selo alerta">sandbox</span>` : cfg.devMode === false ? html` <span class="selo ok">produção</span>` : ''}</span><button type="button" class="btn btn-texto" data-remover-chave>Remover</button></div>
        </div><p class="ajuda">Para trocar, cole a chave nova abaixo.</p>` : html`<div class="alerta-caixa info">${icone('info')}<span>A administração liberou a conta própria, mas o Pix só fica disponível depois de cadastrar a chave da sua conta AbacatePay.</span></div>`}
      <form class="form" id="form-chave" novalidate>
        <div class="campo"><label for="ch-abacate">Chave de API do AbacatePay</label><input id="ch-abacate" name="chave" type="password" autocomplete="off" placeholder="abc_dev_… ou abc_prod_…" required>
          <p class="ajuda">No painel do AbacatePay: Integrações → Chaves de API. A chave fica cifrada no servidor e nunca volta ao navegador. Cadastre também o webhook da rede na sua conta (a administração passa a URL).</p></div>
        <div><button class="btn btn-primario" type="submit">Testar e salvar</button></div>
      </form></div></section>`;
}

export async function loja(alvo, ctx) {
  let p = periodoPadrao();
  async function carregar() {
    render(alvo, html`<div class="cabecalho-pagina"><div class="titulos"><h1>Pagamentos online</h1><p>Carregando…</p></div></div>`);
    let r, cfg = null, filiais = [];
    try { [r, cfg, filiais] = await Promise.all([api.relatorioPagamentos(p), api.pagamentos().catch(() => null), api.filiais().catch(() => [])]); } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      return render(alvo, html`<div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div></div>`);
    }
    render(alvo, html`
      <div class="cabecalho-pagina">
        <div class="titulos"><h1>Pagamentos online</h1><p>Pix recebidos pelo WhatsApp da ${ctx.usuario.loja?.nome || 'loja'} na conta da rede. Use este relatório para solicitar o repasse ao franqueador.</p></div>
        <a class="btn btn-contorno" href="${api.urlRelatorioPagamentosCsv(p)}" download>${icone('copiar')}Exportar CSV</a>
      </div>
      ${painelRecebimento(cfg)}
      <section class="painel"><div class="painel-corpo">${filtros(p, filiais)}</div></section>
      ${resumo(r.totais, { rotuloLiquido: cfg?.proprio ? 'Recebido na sua conta' : 'A receber da rede' })}
      ${!p.filial ? tabelaFiliais(r.filiais, { rotulo: cfg?.proprio ? 'Recebido' : 'A receber' }) : ''}
      <section class="painel"><div class="painel-cab"><h2>Pagamentos de ${p.de.split('-').reverse().join('/')} a ${p.ate.split('-').reverse().join('/')}</h2></div>${tabela(r.itens, { comLoja: false })}</section>`);
    ligarFiltros(alvo, p, (novo) => { p = novo; carregar(); });
    $('#form-chave', alvo)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target; const chave = f.elements.chave.value.trim();
      if (!marcarErros(f, chave.length >= 20 ? {} : { chave: 'Cole a chave completa.' })) return;
      await comBotao($('[type=submit]', f), async () => {
        try { const r2 = await api.salvarChaveAbacatePay(chave); avisar(r2.devMode === true ? 'Chave salva (sandbox): os Pix desta loja serão de teste.' : 'Chave salva. Os Pix desta loja agora caem na sua conta.'); carregar(); }
        catch (err) { if (err.campos) marcarErros(f, err.campos); avisar(err.message, 'erro'); }
      });
    });
    $('[data-remover-chave]', alvo)?.addEventListener('click', async () => {
      try { await api.removerChaveAbacatePay(); avisar('Chave removida. O Pix fica indisponível até cadastrar outra.'); carregar(); } catch (err) { avisar(err.message, 'erro'); }
    });
  }
  await carregar();
}

export async function rede(alvo, ctx) {
  let p = periodoPadrao(), lojas = [], pagItens = 1, pagLojas = 1, buscaLoja = '';
  try { lojas = await api.listarLojas(); } catch { lojas = []; }
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
      <section class="painel"><div class="painel-corpo"><div class="filtros"><div class="campo campo-data"><label for="p-loja">Loja</label><select id="p-loja"><option value="">Todas as lojas</option>${lojas.map((l) => html`<option value="${l.id}" ${p.loja === l.id ? 'selected' : ''}>${l.nome}</option>`)}</select></div>${filtros(p)}</div></div></section>
      ${resumo(r.totais, { rotuloLiquido: 'A repassar às lojas', repasse: true })}
      <section class="painel"><div class="painel-cab"><h2>Por loja</h2>${r.lojas.length > 10 ? html`<label class="busca"><span class="sr-only">Buscar loja</span>${icone('busca')}<input id="busca-loja-pag" type="search" placeholder="Buscar loja" value="${buscaLoja}"></label>` : ''}</div>
        <div id="por-loja"></div></section>
      <section class="painel"><div class="painel-cab"><h2>Todos os pagamentos</h2></div><div id="todos-pag"></div></section>`);
    const desenharLojas = () => {
      const q = buscaLoja.trim().toLowerCase();
      const lista = q ? r.lojas.filter((l) => l.loja.nome.toLowerCase().includes(q)) : r.lojas;
      const pg = paginar(lista, pagLojas, 15, { rotulo: 'lojas' }); pagLojas = pg.pagina;
      render($('#por-loja', alvo), pg.fatia.length ? html`<div class="tabela-caixa"><table class="tabela"><thead><tr><th>Loja</th><th>Conta</th><th>Pagamentos</th><th>Bruto</th><th class="col-opcional">Taxas</th><th>A repassar</th><th class="col-opcional">Estornos</th></tr></thead>
          <tbody>${pg.fatia.map((l) => html`<tr><td><strong>${l.loja.nome}</strong></td><td>${l.conta === 'loja' ? html`<span class="selo marca sem-ponto">própria</span>` : l.conta === 'mista' ? html`<span class="selo alerta">mista</span>` : html`<span class="selo neutro">rede</span>`}</td><td class="num">${l.quantidade}</td><td class="num">${reais(l.bruto)}</td><td class="col-opcional num">${reais(l.taxas)}</td><td class="num"><strong>${l.aRepassar ? reais(l.aRepassar) : '—'}</strong>${l.naContaDaLoja ? html`<div class="sub">${reais(l.naContaDaLoja)} na conta da loja</div>` : ''}${l.filiais?.length > 1 ? html`<div class="sub">${l.filiais.map((f) => `${f.filial.nome}: ${reais(f.liquido)}`).join(' · ')}</div>` : ''}</td><td class="col-opcional num">${l.estornadas ? `${l.estornadas} · ${reais(l.valorEstornado)}` : '—'}</td></tr>`)}</tbody></table></div>${pg.controles}` : html`<div class="estado"><p>Nenhum pagamento no período.</p></div>`);
      ligarPaginacao($('#por-loja', alvo), (d) => { pagLojas += d; desenharLojas(); });
    };
    const desenharItens = () => {
      const pg = paginar(r.itens, pagItens, 25, { rotulo: 'pagamentos' }); pagItens = pg.pagina;
      render($('#todos-pag', alvo), html`${tabela(pg.fatia, { comLoja: true })}${pg.controles}`);
      ligarPaginacao($('#todos-pag', alvo), (d) => { pagItens += d; desenharItens(); });
    };
    desenharLojas(); desenharItens();
    $('#busca-loja-pag', alvo)?.addEventListener('input', (e) => { buscaLoja = e.target.value; pagLojas = 1; desenharLojas(); });
    $('#p-loja', alvo).addEventListener('change', (e) => { p = { ...p, loja: e.target.value || undefined }; pagItens = 1; carregar(); });
    ligarFiltros(alvo, p, (novo) => { p = { ...novo, loja: p.loja }; pagItens = 1; carregar(); });
  }
  await carregar();
}
