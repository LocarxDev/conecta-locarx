// Lojas da rede (administração e matriz): lista, cadastro e detalhe com a equipe da loja.
import { api } from '../api.js';
import { html, render, $, $$, icone, data, avisar, abrirModal, confirmar, dadosDoForm, marcarErros, comBotao } from '../util.js';
import { painelEquipe } from './equipe.js';

const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

const seloWhats = (s) => (s === 'conectado' ? html`<span class="selo ok">Conectado</span>` : html`<span class="selo neutro">Não conectado</span>`);
const seloAtiva = (a) => (a ? html`<span class="selo ok">Ativa</span>` : html`<span class="selo neutro">Desativada</span>`);
const filial = (f) => html`<span class="filial-chip"><code>${f.branchCode}</code><span class="sub">filial ${f.branchId} · ${f.tipo}</span></span>`;

function formLoja(loja = {}) {
  const f = loja.filial || {};
  return html`<form class="form" id="form-loja" novalidate>
    <div class="campo"><label for="l-nome">Nome da loja</label><input id="l-nome" name="nome" value="${loja.nome || ''}" placeholder="Ex.: LocarX Salvador Aeroporto" required></div>
    <div class="form-linha">
      <div class="campo"><label for="l-cidade">Cidade</label><input id="l-cidade" name="cidade" value="${loja.cidade || ''}" required></div>
      <div class="campo"><label for="l-uf">Estado</label><select id="l-uf" name="uf" required>
        <option value="">Escolha</option>${UFS.map((uf) => html`<option ${uf === loja.uf ? 'selected' : ''}>${uf}</option>`)}
      </select></div>
    </div>
    <div class="form-linha">
      <div class="campo"><label for="l-branch">Filial no portal (branchId)</label><input id="l-branch" name="branchId" inputmode="numeric" value="${f.branchId ?? ''}" placeholder="Ex.: 5" required></div>
      <div class="campo"><label for="l-code">Código da filial</label><input id="l-code" name="branchCode" value="${f.branchCode || ''}" placeholder="Ex.: SSA1" required></div>
    </div>
    <div class="campo"><label for="l-tipo">Tipo de loja</label><select id="l-tipo" name="tipo">
      <option ${f.tipo !== 'Aeroporto' ? 'selected' : ''}>Cidade</option><option ${f.tipo === 'Aeroporto' ? 'selected' : ''}>Aeroporto</option>
    </select><p class="ajuda">A filial liga a loja ao portal LocarX: o assistente só consulta e reserva carros dela.</p></div>
  </form>`;
}

function abrirFormLoja(loja, aoSalvar) {
  const modal = abrirModal({
    titulo: loja ? 'Editar loja' : 'Cadastrar loja',
    corpo: formLoja(loja || {}),
    rodape: html`<button class="btn btn-contorno" data-fechar>Cancelar</button><button class="btn btn-primario" type="submit" form="form-loja">${loja ? 'Salvar' : 'Cadastrar loja'}</button>`,
  });
  const form = $('#form-loja', modal.el);
  form.elements.branchCode.addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = dadosDoForm(form);
    const erros = {};
    if (!d.nome.trim()) erros.nome = 'Informe o nome da loja.';
    if (!d.cidade.trim()) erros.cidade = 'Informe a cidade.';
    if (!d.uf) erros.uf = 'Escolha o estado.';
    if (!/^\d+$/.test(d.branchId)) erros.branchId = 'Use só números, ex.: 5.';
    if (!/^[A-Z0-9]{2,6}$/.test(d.branchCode)) erros.branchCode = 'Use de 2 a 6 letras ou números.';
    if (!marcarErros(form, erros)) return;
    await comBotao($('[type=submit]', modal.el), async () => {
      try {
        const salva = await api.salvarLoja({ ...d, id: loja?.id });
        modal.fechar();
        avisar(loja ? 'Loja atualizada.' : 'Loja cadastrada. Agora convide o dono da loja.');
        aoSalvar(salva);
      } catch (err) {
        if (err.campos) marcarErros(form, err.campos); else avisar(err.message, 'erro');
      }
    });
  });
}

// ---------- lista ----------
export async function lista(alvo, ctx) {
  const ehAdmin = ctx.usuario.perfil === 'admin';
  let lojas = [];
  let busca = '';

  render(alvo, html`
    <div class="cabecalho-pagina">
      <div class="titulos"><h1>Lojas</h1><p>Lojas da rede com acesso ao Conecta. Cada uma tem equipe, WhatsApp e assistente próprios.</p></div>
      ${ehAdmin ? html`<button class="btn btn-primario" id="nova-loja">${icone('mais')}Cadastrar loja</button>` : ''}
    </div>
    <section class="painel">
      <div class="painel-cab">
        <label class="busca"><span class="sr-only">Buscar loja</span>${icone('busca')}<input id="busca-loja" type="search" placeholder="Buscar por nome, cidade ou filial"></label>
        <span class="sub num" id="contagem"></span>
      </div>
      <div id="tabela-lojas"><div class="painel-corpo"><div class="esqueleto"></div></div></div>
    </section>`);

  const area = $('#tabela-lojas', alvo);
  const desenhar = () => {
    const t = busca.trim().toLowerCase();
    const vis = lojas.filter((l) => !t || [l.nome, l.cidade, l.uf, l.filial.branchCode].join(' ').toLowerCase().includes(t));
    $('#contagem', alvo).textContent = `${vis.length} de ${lojas.length} lojas`;
    if (!lojas.length) {
      render(area, html`<div class="estado">${icone('lojas')}<h3>Nenhuma loja cadastrada</h3><p>Cadastre a primeira loja para liberar o acesso do franqueado.</p></div>`);
      return;
    }
    if (!vis.length) { render(area, html`<div class="estado">${icone('busca')}<h3>Nada encontrado</h3><p>Nenhuma loja corresponde a essa busca.</p></div>`); return; }
    render(area, html`<div class="tabela-caixa"><table class="tabela">
      <thead><tr><th>Loja</th><th class="col-opcional">Filial no portal</th><th class="col-opcional">Dono</th><th class="col-opcional">WhatsApp</th><th>Situação</th></tr></thead>
      <tbody>${vis.map((l) => html`<tr class="clicavel" data-id="${l.id}" tabindex="0">
        <td><strong>${l.nome}</strong><div class="sub">${l.cidade} · ${l.uf} · ${l.usuarios} ${l.usuarios === 1 ? 'pessoa' : 'pessoas'}</div></td>
        <td class="col-opcional">${filial(l.filial)}</td>
        <td class="col-opcional">${l.dono || html`<span class="sub">Sem dono convidado</span>`}</td>
        <td class="col-opcional">${seloWhats(l.whatsapp)}</td>
        <td>${seloAtiva(l.ativa)}</td>
      </tr>`)}</tbody></table></div>`);
    $$('tr.clicavel', area).forEach((tr) => {
      const ir = () => ctx.navegar(`lojas/${tr.dataset.id}`);
      tr.addEventListener('click', ir);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') ir(); });
    });
  };

  $('#busca-loja', alvo).addEventListener('input', (e) => { busca = e.target.value; desenhar(); });
  const novo = () => abrirFormLoja(null, (l) => ctx.navegar(`lojas/${l.id}`));
  $('#nova-loja', alvo)?.addEventListener('click', novo);

  try {
    lojas = await api.listarLojas();
    desenhar();
    if (ehAdmin && ctx.query.get('nova') === '1') {
      history.replaceState(null, '', '#/lojas');
      novo();
    }
  } catch (err) {
    if (err.status === 401) return ctx.sessaoExpirou();
    render(area, html`<div class="estado">${icone('alerta')}<h3>Não foi possível carregar as lojas</h3><p>${err.message}</p></div>`);
  }
}

// ---------- detalhe ----------
export async function detalhe(alvo, ctx) {
  const ehAdmin = ctx.usuario.perfil === 'admin';
  const [lojaId] = ctx.params;
  render(alvo, html`<div class="migalha"><a href="#/lojas">Lojas</a>${icone('seta')}<span>Carregando…</span></div><div class="painel"><div class="painel-corpo"><div class="esqueleto"></div></div></div>`);

  let loja;
  try {
    loja = await api.obterLoja(lojaId);
  } catch (err) {
    if (err.status === 401) return ctx.sessaoExpirou();
    render(alvo, html`<div class="migalha"><a href="#/lojas">Lojas</a></div><div class="painel"><div class="estado">${icone('alerta')}<h3>${err.status === 404 ? 'Loja não encontrada' : 'Não foi possível abrir a loja'}</h3><p>${err.message}</p><a class="btn btn-contorno" href="#/lojas">Voltar para as lojas</a></div></div>`);
    return;
  }

  const temDono = loja.usuarios.some((u) => u.perfil === 'dono');
  render(alvo, html`
    <div class="migalha"><a href="#/lojas">Lojas</a>${icone('seta')}<span>${loja.nome}</span></div>
    <div class="cabecalho-pagina">
      <div class="titulos"><h1>${loja.nome}</h1><p>${loja.cidade} · ${loja.uf} · cadastrada em ${data(loja.criadaEm)}</p></div>
      ${ehAdmin ? html`<div class="filtros">
        <button class="btn btn-contorno" id="editar-loja">${icone('editar')}Editar</button>
        <button class="btn ${loja.ativa ? 'btn-perigo' : 'btn-primario'}" id="situacao-loja">${loja.ativa ? 'Desativar loja' : 'Reativar loja'}</button>
      </div>` : ''}
    </div>
    ${!temDono && ehAdmin ? html`<div class="alerta-caixa info">${icone('info')}<span>Esta loja ainda não tem dono com acesso. Convide o franqueado em “Convidar” na equipe abaixo, escolhendo a função Dono da loja.</span></div>` : ''}
    <section class="painel">
      <div class="painel-cab"><h2>Dados da loja</h2>${seloAtiva(loja.ativa)}</div>
      <div class="painel-corpo"><dl class="dados-grade">
        <div class="dado"><dt>Filial no portal LocarX</dt><dd>${filial(loja.filial)}</dd></div>
        <div class="dado"><dt>WhatsApp da loja</dt><dd>${seloWhats(loja.whatsapp)}</dd></div>
        <div class="dado"><dt>Assistente virtual</dt><dd><span class="selo neutro">Desligado</span></dd></div>
        <div class="dado"><dt>Pessoas com acesso</dt><dd class="num">${loja.usuarios.filter((u) => u.status === 'ativo').length} ativas</dd></div>
      </dl></div>
    </section>
    <div id="equipe-loja"></div>`);

  painelEquipe($('#equipe-loja', alvo), { ctx, lojaId, podeGerir: ehAdmin, podeConvidarDono: ehAdmin, titulo: 'Equipe da loja' });

  $('#editar-loja', alvo)?.addEventListener('click', () => abrirFormLoja(loja, () => ctx.navegar(`lojas/${lojaId}`)));
  $('#situacao-loja', alvo)?.addEventListener('click', async () => {
    if (loja.ativa && !(await confirmar({ titulo: 'Desativar loja', texto: `A equipe da ${loja.nome} perde o acesso ao Conecta e o assistente para de atender. Os dados ficam guardados e a loja pode ser reativada.`, botao: 'Desativar loja', perigo: true }))) return;
    try {
      await api.alterarSituacaoLoja(lojaId, !loja.ativa);
      avisar(loja.ativa ? 'Loja desativada.' : 'Loja reativada.');
      ctx.navegar(`lojas/${lojaId}`);
    } catch (err) { avisar(err.message, 'erro'); }
  });
}
