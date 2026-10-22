// Tarefas da equipe: retornos combinados e cotações que o sistema identificou como esquecidas.
import { api } from '../api.js';
import { html, render, $, $$, icone, avisar, confirmar } from '../util.js';
import { novaTarefa, abrirFicha } from './clientes.js';

const quandoVence = (iso) => {
  const d = new Date(iso), agora = new Date();
  const txt = d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return { txt, atrasada: d < agora, hoje: d.toDateString() === agora.toDateString() };
};

export async function montar(alvo, ctx) {
  let situacao = 'abertas', minhas = '0', lista = [];
  render(alvo, html`
    <div class="cabecalho-pagina">
      <div class="titulos"><h1>Tarefas</h1><p>Retornos para clientes. Cotações sem resposta há 24 horas viram tarefa sozinhas.</p></div>
      <button class="btn btn-primario" id="nova-tarefa">${icone('mais')}Nova tarefa</button>
    </div>
    <section class="painel">
      <div class="painel-cab">
        <div class="abas">${[['abertas', 'Abertas'], ['feitas', 'Feitas']].map(([v, t]) => html`<button data-s="${v}" class="${v === situacao ? 'ativa' : ''}">${t}</button>`)}</div>
        <label class="checkbox"><input type="checkbox" id="so-minhas"> Só as minhas</label>
      </div>
      <div id="lista-tarefas"><div class="painel-corpo"><div class="esqueleto"></div></div></div>
    </section>`);
  const area = $('#lista-tarefas', alvo);

  function desenhar() {
    if (!lista.length) return render(area, html`<div class="estado">${icone('ok')}<h3>${situacao === 'abertas' ? 'Nenhuma tarefa pendente' : 'Nenhuma tarefa feita nos últimos 30 dias'}</h3><p>${situacao === 'abertas' ? 'Tudo em dia.' : ''}</p></div>`);
    render(area, html`<ul class="lista-tarefas">${lista.map((t) => { const v = quandoVence(t.venceEm); return html`<li class="${t.feitaEm ? 'feita' : ''}">
      <label class="checkbox"><input type="checkbox" data-feita="${t.id}" ${t.feitaEm ? 'checked' : ''}><span class="sr-only">Marcar como feita</span></label>
      <div class="tarefa-meio"><strong>${t.titulo}</strong>
        <span class="sub">${t.automatica ? 'criada pelo sistema · ' : ''}${t.responsavel ? t.responsavel.nome + ' · ' : ''}${t.contatoId ? html`<a href="#" data-cliente="${t.contatoId}">${t.contatoNome || 'ver cliente'}</a>` : ''}</span></div>
      <span class="selo ${t.feitaEm ? 'neutro' : v.atrasada ? 'erro' : v.hoje ? 'alerta' : 'neutro'} num">${t.feitaEm ? 'Feita' : v.atrasada ? 'Atrasada · ' + v.txt : v.txt}</span>
      <button class="btn btn-texto btn-icone" data-excluir="${t.id}" aria-label="Excluir tarefa">${icone('lixo')}</button></li>`; })}</ul>`);
    $$('[data-feita]', area).forEach((c) => c.addEventListener('change', async () => {
      try { await api.marcarTarefa(c.dataset.feita, c.checked); carregar(); } catch (err) { avisar(err.message, 'erro'); c.checked = !c.checked; }
    }));
    $$('[data-excluir]', area).forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmar({ titulo: 'Excluir tarefa', texto: 'Excluir esta tarefa?', botao: 'Excluir', perigo: true }))) return;
      try { await api.excluirTarefa(b.dataset.excluir); carregar(); } catch (err) { avisar(err.message, 'erro'); }
    }));
    $$('[data-cliente]', area).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); abrirFicha(a.dataset.cliente, ctx, carregar); }));
  }

  async function carregar() {
    try { lista = await api.tarefas({ situacao, minhas }); desenhar(); } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      render(area, html`<div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div>`);
    }
  }
  $$('[data-s]', alvo).forEach((b) => b.addEventListener('click', () => { situacao = b.dataset.s; $$('[data-s]', alvo).forEach((x) => x.classList.toggle('ativa', x === b)); carregar(); }));
  $('#so-minhas', alvo).addEventListener('change', (e) => { minhas = e.target.checked ? '1' : '0'; carregar(); });
  $('#nova-tarefa', alvo).addEventListener('click', () => novaTarefa({}, carregar));
  carregar();
}
