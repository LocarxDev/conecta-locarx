// v14.8.7 — Assinaturas (administração): visão geral das lojas pagantes, receita do mês, previsão, faturas em aberto, lista por loja e CSV.
import { api } from '../api.js';
import { html, render, $, $$, icone, data } from '../util.js';

const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dia = (v) => (v ? data(typeof v === 'string' && v.length === 10 ? v + 'T12:00:00' : v) : '—');
const ST = { ativa: ['Ativa', 'ok'], atrasada: ['Atrasada', 'erro'], suspensa: ['Suspensa', 'erro'], pendente: ['Aguardando pagamento', 'alerta'], isenta: ['Isenta', 'ok'], cancelada: ['Cancelada', ''], sem: ['Sem assinatura', ''] };
const ORDEM = ['atrasada', 'suspensa', 'pendente', 'ativa', 'isenta', 'sem', 'cancelada'];

export async function montar(alvo, ctx) {
  render(alvo, html`<div class="cabecalho-pagina"><div class="titulos"><h1>Assinaturas</h1><p>Carregando…</p></div></div><div class="painel"><div class="painel-corpo"><div class="esqueleto"></div></div></div>`);
  let v;
  try { v = await api.assinaturasAdmin(); } catch (err) {
    if (err.status === 401) return ctx.sessaoExpirou();
    return render(alvo, html`<div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div></div>`);
  }
  let filtro = 'todas', busca = '';
  const r = v.resumo, c = r.contagem;
  const mesNome = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  function desenhar() {
    const lista = v.lojas
      .filter((l) => filtro === 'todas' ? true : filtro === 'atencao' ? ['atrasada', 'suspensa', 'pendente'].includes(l.status) : l.status === filtro)
      .filter((l) => !busca || `${l.loja} ${l.cidade} ${l.cnpj || ''}`.toLowerCase().includes(busca))
      .sort((a, b) => ORDEM.indexOf(a.status) - ORDEM.indexOf(b.status) || a.loja.localeCompare(b.loja));
    render(alvo, html`
      <div class="cabecalho-pagina">
        <div class="titulos"><h1>Assinaturas</h1><p>Quem paga o Conecta, quem está atrasado e quanto entrou em ${mesNome}. Isenção, confirmação manual e cancelamento ficam no detalhe de cada loja.</p></div>
        <a class="btn btn-contorno" href="${api.urlAssinaturasCsv()}" download>${icone('copiar')}Exportar CSV</a>
      </div>
      <div class="resumo resumo-6">
        <div class="resumo-item"><span class="rotulo">Lojas pagantes</span><span class="valor">${r.pagantes}</span><span class="detalhe">de ${r.lojas} lojas · ${c.isenta} isenta${c.isenta === 1 ? '' : 's'} · ${c.sem} sem assinatura</span></div>
        <div class="resumo-item"><span class="rotulo">Ativas</span><span class="valor ok">${c.ativa}</span><span class="detalhe">em dia</span></div>
        <div class="resumo-item"><span class="rotulo">Atrasadas / suspensas</span><span class="valor ${c.atrasada + c.suspensa ? 'erro' : ''}">${c.atrasada + c.suspensa}</span><span class="detalhe">${c.atrasada} atrasada${c.atrasada === 1 ? '' : 's'} · ${c.suspensa} suspensa${c.suspensa === 1 ? '' : 's'}</span></div>
        <div class="resumo-item"><span class="rotulo">Aguardando pagamento</span><span class="valor">${c.pendente}</span><span class="detalhe">assinaram e ainda não pagaram</span></div>
        <div class="resumo-item"><span class="rotulo">Recebido no mês</span><span class="valor num">${reais(r.receitaMes)}</span><span class="detalhe">${r.faturasMes} fatura${r.faturasMes === 1 ? '' : 's'} · mês anterior ${reais(r.receitaMesAnterior)}</span></div>
        <div class="resumo-item"><span class="rotulo">Previsão mensal</span><span class="valor num">${reais(r.previsaoMensal)}</span><span class="detalhe">${r.faturasAbertas ? `${reais(r.emAberto)} em aberto (${r.faturasAbertas})` : 'nenhuma fatura em aberto'}</span></div>
      </div>
      <section class="painel">
        <div class="painel-cab">
          <div class="filtros">${[['todas', 'Todas'], ['atencao', 'Precisam de atenção'], ['ativa', 'Ativas'], ['isenta', 'Isentas'], ['sem', 'Sem assinatura'], ['cancelada', 'Canceladas']].map(([k, n]) => html`<button class="btn ${filtro === k ? 'btn-primario' : 'btn-texto'}" data-filtro="${k}">${n}</button>`)}</div>
          <label class="busca"><span class="sr-only">Buscar</span>${icone('busca')}<input type="search" id="busca-ass" placeholder="Loja, cidade ou CNPJ" value="${busca}"></label>
        </div>
        <div class="tabela-caixa"><table class="tabela">
          <thead><tr><th>Loja</th><th>Situação</th><th>Plano</th><th>Pagamento</th><th class="num">Valor</th><th>Desde</th><th>Próxima cobrança</th><th>Em aberto</th><th>Último pagamento</th></tr></thead>
          <tbody>${lista.length ? lista.map((l) => html`<tr class="${['atrasada', 'suspensa'].includes(l.status) ? 'linha-alerta' : ''}">
            <td><a href="#/lojas/${l.lojaId}"><strong>${l.loja}</strong></a><div class="sub">${l.cidade}/${l.uf}${l.cnpj ? ` · ${l.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}` : ' · sem CNPJ'}${l.lojaAtiva ? '' : ' · loja desativada'}</div></td>
            <td><span class="selo ${ST[l.status]?.[1] || ''}">${ST[l.status]?.[0] || l.status}</span>${l.observacao ? html`<div class="sub">${l.observacao}</div>` : ''}</td>
            <td>${l.planoNome || '—'}${l.ciclo ? html`<div class="sub">${l.ciclo}</div>` : ''}</td>
            <td>${l.formaNome || '—'}${l.cartaoFinal ? html`<div class="sub">final ${l.cartaoFinal}</div>` : ''}</td>
            <td class="num">${l.valor != null ? (l.valor ? reais(l.valor) : 'cortesia') : '—'}</td>
            <td>${dia(l.inicioEm)}</td>
            <td>${dia(l.proximaCobranca)}</td>
            <td>${l.faturasAbertas ? html`<span class="selo ${l.status === 'ativa' || l.status === 'pendente' ? 'alerta' : 'erro'}">${l.faturasAbertas} · vence ${dia(l.venceAberta)}</span>` : '—'}</td>
            <td>${dia(l.ultimoPagamento)}</td>
          </tr>`) : html`<tr><td colspan="9"><div class="estado">${icone('info')}<p>Nenhuma loja neste filtro.</p></div></td></tr>`}</tbody>
        </table></div>
      </section>`);
    $$('[data-filtro]', alvo).forEach((b) => b.addEventListener('click', () => { filtro = b.dataset.filtro; desenhar(); }));
    const i = $('#busca-ass', alvo); let t;
    i.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { busca = i.value.trim().toLowerCase(); const pos = i.selectionStart; desenhar(); const n = $('#busca-ass', alvo); n.focus(); n.setSelectionRange(pos, pos); }, 250); });
  }
  desenhar();
}
