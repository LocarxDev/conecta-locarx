// Lojas da rede (administração e matriz): lista, cadastro e detalhe com a equipe da loja.
import { api } from '../api.js';
import { html, render, $, $$, icone, data, avisar, abrirModal, confirmar, dadosDoForm, marcarErros, comBotao, paginar, ligarPaginacao } from '../util.js';
import { painelEquipe } from './equipe.js';

const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

const seloWhats = (s) => (s === 'conectado' ? html`<span class="selo ok">Conectado</span>` : html`<span class="selo neutro">Não conectado</span>`);
const seloAtiva = (a) => (a ? html`<span class="selo ok">Ativa</span>` : html`<span class="selo neutro">Desativada</span>`);
const filial = (f) => (f.branchId == null ? html`<span class="filial-chip"><code>CENTRAL</code><span class="sub">todas as filiais da rede</span></span>` : html`<span class="filial-chip"><code>${f.branchCode}</code><span class="sub">filial ${f.branchId} · ${f.tipo}</span></span>`);

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
    ${loja.id ? '' : html`<label class="checkbox"><input type="checkbox" name="central" id="l-central"> <strong>Esta é a Central de Reservas</strong> (não tem filial própria: consulta e reserva em todas as filiais da rede)</label>`}
    <div class="filtros" id="bloco-busca"><button type="button" class="btn btn-contorno" id="buscar-filiais">Buscar filiais no portal LocarX</button><span class="sub" id="filiais-info"></span></div>
    <div class="campo" id="campo-filiais" hidden><label for="l-filial">Filial do portal</label><select id="l-filial"></select></div>
    <div class="form-linha" id="bloco-filial">
      <div class="campo"><label for="l-branch">Filial no portal (branchId)</label><input id="l-branch" name="branchId" inputmode="numeric" value="${f.branchId ?? ''}" placeholder="Ex.: 5"${loja.central ? '' : ' required'}></div>
      <div class="campo"><label for="l-code">Código da filial</label><input id="l-code" name="branchCode" value="${f.branchCode || ''}" placeholder="Ex.: SSA1"${loja.central ? '' : ' required'}></div>
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
  // Central de Reservas: sem filial própria, os campos da filial somem
  const alternarCentral = () => {
    const c = !!form.elements.central?.checked;
    ['bloco-busca', 'campo-filiais', 'bloco-filial'].forEach((id) => { const el = $('#' + id, form); if (el) el.hidden = c || (id === 'campo-filiais' && !filiais.length); });
    form.elements.branchId.required = !c; form.elements.branchCode.required = !c;
  };
  form.elements.central?.addEventListener('change', alternarCentral);
  let filiais = [];
  $('#buscar-filiais', form).addEventListener('click', (e) => comBotao(e.currentTarget, async () => {
    try {
      filiais = await api.filiaisLocarx();
      const sel = $('#l-filial', form);
      render(sel, html`<option value="">Escolha a filial</option>${filiais.map((f, i) => html`<option value="${i}">${f.nome} · ${f.cidade}/${f.uf} · ${f.codigo} (${f.branchId})</option>`)}`);
      $('#campo-filiais', form).hidden = false;
      $('#filiais-info', form).textContent = `${filiais.length} filiais encontradas`;
    } catch (err) { avisar(err.message, 'erro'); }
  }));
  $('#l-filial', form).addEventListener('change', (e) => {
    const f = filiais[Number(e.target.value)];
    if (!f) return;
    form.elements.branchId.value = f.branchId; form.elements.branchCode.value = String(f.codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!form.elements.cidade.value) form.elements.cidade.value = f.cidade || '';
    if (f.uf && !form.elements.uf.value) form.elements.uf.value = f.uf;
    form.elements.tipo.value = /aero|airport/i.test(f.tipo || '') ? 'Aeroporto' : 'Cidade';
    if (!form.elements.nome.value) form.elements.nome.value = `LocarX ${f.nome}`;
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = dadosDoForm(form);
    const erros = {};
    if (!d.nome.trim()) erros.nome = 'Informe o nome da loja.';
    if (!d.cidade.trim()) erros.cidade = 'Informe a cidade.';
    if (!d.uf) erros.uf = 'Escolha o estado.';
    const central = !!d.central || !!loja?.central;
    if (!central || d.branchId) { if (!/^\d+$/.test(d.branchId)) erros.branchId = 'Use só números, ex.: 5.'; }
    if (!central || d.branchCode) { if (!/^[A-Z0-9]{2,6}$/.test(d.branchCode)) erros.branchCode = 'Use de 2 a 6 letras ou números.'; }
    if (!marcarErros(form, erros)) return;
    await comBotao($('[type=submit]', modal.el), async () => {
      try {
        const salva = await api.salvarLoja({ ...d, central: d.central ? true : undefined, id: loja?.id });
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
  let busca = '', pagina = 1;

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
    const vis = lojas.filter((l) => !t || [l.nome, l.cidade, l.uf, l.filial.branchCode || 'central'].join(' ').toLowerCase().includes(t));
    $('#contagem', alvo).textContent = `${vis.length} de ${lojas.length} lojas`;
    if (!lojas.length) {
      render(area, html`<div class="estado">${icone('lojas')}<h3>Nenhuma loja cadastrada</h3><p>Cadastre a primeira loja para liberar o acesso do franqueado.</p></div>`);
      return;
    }
    if (!vis.length) { render(area, html`<div class="estado">${icone('busca')}<h3>Nada encontrado</h3><p>Nenhuma loja corresponde a essa busca.</p></div>`); return; }
    const pg = paginar(vis, pagina, 20, { rotulo: 'lojas' }); pagina = pg.pagina;
    render(area, html`<div class="tabela-caixa"><table class="tabela">
      <thead><tr><th>Loja</th><th class="col-opcional">Filial no portal</th><th class="col-opcional">Dono</th><th class="col-opcional">WhatsApp</th><th>Situação</th></tr></thead>
      <tbody>${pg.fatia.map((l) => html`<tr class="clicavel" data-id="${l.id}" tabindex="0">
        <td><strong>${l.nome}</strong><div class="sub">${l.cidade} · ${l.uf} · ${l.usuarios} ${l.usuarios === 1 ? 'pessoa' : 'pessoas'}</div></td>
        <td class="col-opcional">${filial(l.filial)}</td>
        <td class="col-opcional">${l.dono || html`<span class="sub">Sem dono convidado</span>`}</td>
        <td class="col-opcional">${seloWhats(l.whatsapp)}</td>
        <td>${seloAtiva(l.ativa)}</td>
      </tr>`)}</tbody></table></div>${pg.controles}`);
    ligarPaginacao(area, (d) => { pagina += d; desenhar(); });
    $$('tr.clicavel', area).forEach((tr) => {
      const ir = () => ctx.navegar(`lojas/${tr.dataset.id}`);
      tr.addEventListener('click', ir);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') ir(); });
    });
  };

  $('#busca-loja', alvo).addEventListener('input', (e) => { busca = e.target.value; pagina = 1; desenhar(); });
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
        ${loja.filial.branchId == null ? '' : html`<button class="btn btn-contorno" id="testar-api">Testar API LocarX</button>`}
        <button class="btn btn-contorno" id="editar-loja">${icone('editar')}Editar</button>
        <button class="btn ${loja.ativa ? 'btn-perigo' : 'btn-primario'}" id="situacao-loja">${loja.ativa ? 'Desativar loja' : 'Reativar loja'}</button>
        ${!loja.ativa ? html`<button class="btn btn-texto" id="excluir-loja" title="Apaga a loja e tudo o que é dela (para lojas de teste)">Excluir loja</button>` : ''}
      </div>` : ''}
    </div>
    ${loja.filialPortal?.encontrada === false ? html`<div class="alerta-caixa erro">${icone('alerta')}<span><strong>Filial ${loja.filial.branchId} não existe no ambiente atual da API LocarX (${loja.filialPortal.ambiente}).</strong> Os ids mudam entre homologação e produção: edite a loja e escolha a filial de novo em "Buscar filiais no portal". Até lá, cotações e reservas desta loja falham.</span></div>` : ''}
    ${loja.filialPortal?.encontrada === null ? html`<div class="alerta-caixa info">${icone('info')}<span>Não foi possível conferir a filial no portal LocarX agora: ${loja.filialPortal.erro}</span></div>` : ''}
    ${!temDono && ehAdmin ? html`<div class="alerta-caixa info">${icone('info')}<span>Esta loja ainda não tem dono com acesso. Convide o franqueado em “Convidar” na equipe abaixo, escolhendo a função Dono da loja.</span></div>` : ''}
    <section class="painel">
      <div class="painel-cab"><h2>Dados da loja</h2>${seloAtiva(loja.ativa)}</div>
      <div class="painel-corpo"><dl class="dados-grade">
        <div class="dado"><dt>Filial no portal LocarX</dt><dd>${filial(loja.filial)}${loja.filialPortal?.encontrada ? html`<div class="sub">${loja.filialPortal.nome} · ${loja.filialPortal.ambiente}${loja.filialPortal.horarios ? ' · ' + loja.filialPortal.horarios : ''}</div>` : ''}</dd></div>
        <div class="dado"><dt>WhatsApp da loja</dt><dd>${seloWhats(loja.whatsapp)}</dd></div>
        <div class="dado"><dt>Assistente virtual</dt><dd><span class="selo neutro">Desligado</span></dd></div>
        ${ehAdmin ? html`<div class="dado"><dt>Central de Reservas</dt><dd id="central-dd"><span class="sub">Carregando…</span></dd></div>` : ''}
        ${ehAdmin ? html`<div class="dado"><dt>Chat do site</dt><dd id="site-chat-dd"><span class="sub">Carregando…</span></dd></div>` : ''}
        <div class="dado"><dt>Pessoas com acesso</dt><dd class="num">${loja.usuarios.filter((u) => u.status === 'ativo').length} ativas</dd></div>
        <div class="dado"><dt>Recebimento do Pix</dt><dd>${loja.pix?.proprio
          ? html`<span class="selo marca sem-ponto">Conta própria</span> <span class="sub">${loja.pix.temChave ? `chave …${loja.pix.chaveFinal}${loja.pix.devMode === true ? ' · sandbox' : loja.pix.devMode === false ? ' · produção' : ''}` : 'a loja ainda não cadastrou a chave'}</span>`
          : html`<span class="selo neutro">Conta da rede</span> <span class="sub">repasse pelo relatório</span>`}
          ${ehAdmin ? html`<div><button class="btn btn-texto" id="pix-proprio">${loja.pix?.proprio ? 'Voltar para a conta da rede' : 'Liberar conta própria (AbacatePay da loja)'}</button></div>` : ''}</dd></div>
      </dl></div>
    </section>
    <section class="painel" id="modulos-loja">
      <div class="painel-cab"><div><h2>Módulos do plano</h2><span class="sub">O que esta loja pode usar no Conecta. Desligado some do menu da loja e a API bloqueia. A equipe entra de novo ao salvar.</span></div>
        ${ehAdmin ? html`<div class="filtros"><button class="btn btn-texto" data-plano="todos">Marcar tudo</button><button class="btn btn-texto" data-plano="basico">Plano básico</button></div>` : ''}</div>
      <form class="painel-corpo" id="form-modulos" novalidate><div class="lista-modulos" data-lista-modulos><div class="esqueleto"></div></div>
        ${ehAdmin ? html`<div class="acoes-form"><button class="btn btn-primario" type="submit">Salvar módulos</button><span class="sub">${Object.values(loja.modulos || {}).every(Boolean) ? 'Hoje: tudo liberado.' : 'Hoje: plano com restrições.'}</span></div>` : ''}
      </form>
    </section>
    <section class="painel" id="filiais-loja">
      <div class="painel-cab"><div><h2>Filiais da franquia</h2><span class="sub">Várias filiais do portal LocarX no mesmo WhatsApp e na mesma equipe (ex.: Aeroporto e Centro). A principal é a padrão.</span></div>
        ${ehAdmin ? html`<button class="btn btn-contorno" id="nova-filial">${icone('mais')}Adicionar filial</button>` : ''}</div>
      <div class="tabela-caixa"><table class="tabela"><thead><tr><th>Filial</th><th>Nº no portal</th><th>Situação</th><th><span class="sr-only">Ações</span></th></tr></thead>
        <tbody>${(loja.filiais || []).map((f) => html`<tr>
          <td><strong>${f.nome}</strong>${f.principal ? html` <span class="selo marca sem-ponto">Principal</span>` : ''}
            ${f.portal ? html`<div class="sub">${f.portal.nome}${f.portal.tipo ? ` · ${f.portal.tipo}` : ''}${f.portal.endereco ? html`<br>${f.portal.endereco}` : ''}${f.portal.horarios ? html`<br>${f.portal.horarios.split('\n').join(' · ')}` : ''}</div>` : html`<div class="sub erro-texto">não encontrada no portal (ambiente atual)</div>`}</td>
          <td class="num">${f.branchId}</td>
          <td>${f.ativa ? html`<span class="selo ok">Ativa</span>` : html`<span class="selo neutro">Desativada</span>`}</td>
          <td><div class="acoes-linha">${ehAdmin && !f.principal ? html`<button class="btn btn-texto" data-filial-principal="${f.id}">Tornar principal</button><button class="btn btn-texto" data-filial-remover="${f.id}">Remover</button>` : ''}</div></td>
        </tr>`)}</tbody></table></div>
    </section>
    <section class="painel" id="acessos-loja">
      <div class="painel-cab"><div><h2>Donos vinculados de outras lojas</h2><span class="sub">Para quem tem mais de uma loja: escolha a pessoa na lista e ela passa a ver esta loja também (troca no topo da tela).</span></div>
        ${ehAdmin ? html`<button class="btn btn-contorno" id="dar-acesso">${icone('mais')}Vincular dono</button>` : ''}</div>
      <div id="lista-acessos"><div class="painel-corpo"><p class="sub">Carregando…</p></div></div>
    </section>
    <div id="equipe-loja"></div>`);

  // acessos extras (multiloja)
  const listaAcessos = $('#lista-acessos', alvo);
  const carregarAcessos = async () => {
    try {
      const rows = await api.acessosLoja(lojaId);
      render(listaAcessos, rows.length ? html`<div class="tabela-caixa"><table class="tabela"><thead><tr><th>Pessoa</th><th>Nível aqui</th><th class="col-opcional">Loja principal</th><th><span class="sr-only">Ações</span></th></tr></thead>
        <tbody>${rows.map((u) => html`<tr><td><strong>${u.nome}</strong><div class="sub">${u.email}</div></td><td>${u.perfil === 'dono' ? 'Dono da loja' : 'Atendente'}</td><td class="col-opcional">${u.loja_principal || '—'}</td>
          <td><div class="acoes-linha">${ehAdmin ? html`<button class="btn btn-texto" data-tirar-acesso="${u.id}">Tirar acesso</button>` : ''}</div></td></tr>`)}</tbody></table></div>` : html`<div class="painel-corpo"><p class="sub">Ninguém de outra loja tem acesso a esta.</p></div>`);
      $$('[data-tirar-acesso]', listaAcessos).forEach((b) => b.addEventListener('click', async () => {
        if (!(await confirmar({ titulo: 'Tirar acesso', texto: 'A pessoa deixa de ver esta loja (continua na loja principal dela).', botao: 'Tirar acesso', perigo: true }))) return;
        try { await api.tirarAcessoLoja(lojaId, b.dataset.tirarAcesso); carregarAcessos(); } catch (err) { avisar(err.message, 'erro'); }
      }));
    } catch (err) { render(listaAcessos, html`<div class="painel-corpo"><p class="sub">${err.message}</p></div>`); }
  };
  carregarAcessos();
  $('#dar-acesso', alvo)?.addEventListener('click', async () => {
    let cand = [];
    try { cand = await api.candidatosAcessoLoja(lojaId); } catch (err) { avisar(err.message, 'erro'); return; }
    const m = abrirModal({
      titulo: 'Vincular dono a esta loja',
      corpo: cand.length ? html`<form class="form" id="form-acesso" novalidate>
        <div class="campo"><label for="a-email">Quem passa a acessar esta loja</label>
          <select id="a-email" name="email" required>${cand.map((u) => html`<option value="${u.email}">${u.nome} (${u.perfil === 'dono' ? 'dono' : 'atendente'} em ${u.loja_principal || '—'}) · ${u.email}</option>`)}</select>
          <p class="ajuda">Depois de vincular, a pessoa entra com o mesmo login e troca de loja no topo da tela.</p></div>
        <div class="campo"><label for="a-perfil">Nível nesta loja</label><select id="a-perfil" name="perfil"><option value="dono">Dono da loja</option><option value="atendente">Atendente</option></select></div>
      </form>` : html`<p class="sub">Não há ninguém de outras lojas para vincular. Para cadastrar uma pessoa nova, use "Convidar" na equipe da loja.</p>`,
      rodape: cand.length ? html`<button class="btn btn-contorno" data-fechar>Cancelar</button><button class="btn btn-primario" form="form-acesso" type="submit">Vincular</button>` : html`<button class="btn btn-contorno" data-fechar>Fechar</button>`,
    });
    $('#form-acesso', m.el)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target; const d = dadosDoForm(f);
      await comBotao($('[type=submit]', m.el), async () => {
        try { const r = await api.darAcessoLoja(lojaId, d); m.fechar(); avisar(`${r.nome} agora acessa esta loja.`); carregarAcessos(); } catch (err) { if (err.campos) marcarErros(f, err.campos); avisar(err.message, 'erro'); }
      });
    });
  });

  // módulos do plano
  (async () => {
    let catalogo = [];
    try { catalogo = await api.modulosCatalogo(); } catch { catalogo = []; }
    const listaEl = $('[data-lista-modulos]', alvo);
    const atual = loja.modulos || {};
    const BASICO = { clientes: true, automacoes: true, base: true };
    render(listaEl, html`${catalogo.map((m) => html`<label class="modulo-item"><label class="interruptor"><input type="checkbox" name="${m.chave}" ${atual[m.chave] !== false ? 'checked' : ''} ${ehAdmin ? '' : 'disabled'}><span class="sr-only">${m.nome}</span><span class="trilho"></span></label><span><strong>${m.nome}</strong><span class="sub">${m.descricao}</span></span></label>`)}`);
    $$('[data-plano]', alvo).forEach((b) => b.addEventListener('click', () => {
      const todos = b.dataset.plano === 'todos';
      $$('input[type=checkbox]', listaEl).forEach((i) => { i.checked = todos || !!BASICO[i.name]; });
    }));
    $('#form-modulos', alvo).addEventListener('submit', async (e) => {
      e.preventDefault();
      const modulos = Object.fromEntries($$('input[type=checkbox]', listaEl).map((i) => [i.name, i.checked]));
      await comBotao($('[type=submit]', e.target), async () => {
        try { await api.salvarModulosLoja(lojaId, modulos); avisar('Módulos salvos. A equipe da loja entra de novo com o menu atualizado.'); detalhe(alvo, ctx); } catch (err) { avisar(err.message, 'erro'); }
      });
    });
  })();

  $('#excluir-loja', alvo)?.addEventListener('click', () => {
    const m = abrirModal({
      titulo: 'Excluir loja',
      corpo: html`<form class="form" id="form-excluir" novalidate>
        <div class="alerta-caixa erro">${icone('alerta')}<span>Apaga <strong>${loja.nome}</strong> com equipe, conversas, clientes, reservas, cobranças de teste, base e funil. Não tem volta. Lojas com pagamentos Pix reais não podem ser excluídas (fique com ela desativada).</span></div>
        <div class="campo"><label for="ex-nome">Para confirmar, digite o nome da loja</label><input id="ex-nome" name="confirmacao" autocomplete="off" placeholder="${loja.nome}"></div>
      </form>`,
      rodape: html`<button class="btn btn-contorno" data-fechar>Cancelar</button><button class="btn btn-perigo" form="form-excluir" type="submit">Excluir definitivamente</button>`,
    });
    $('#form-excluir', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      await comBotao($('[type=submit]', m.el), async () => {
        try { await api.excluirLoja(lojaId, f.elements.confirmacao.value); m.fechar(); avisar('Loja excluída.'); ctx.navegar('lojas'); } catch (err) { if (err.campos) marcarErros(f, err.campos); avisar(err.message, 'erro'); }
      });
    });
  });

  $('#nova-filial', alvo)?.addEventListener('click', () => {
    const m = abrirModal({
      titulo: 'Adicionar filial',
      corpo: html`<form class="form" id="form-filial" novalidate>
        <div class="campo"><label for="f-portal">Filial no portal LocarX</label>
          <div class="filtros"><select id="f-portal" style="flex:1 1 260px"><option value="">Carregando filiais do portal…</option></select><button type="button" class="btn btn-contorno" id="f-recarregar">Consultar de novo</button></div>
          <p class="ajuda">Lista do ambiente atual da API (homologação ou produção). Escolha e o número é preenchido sozinho.</p></div>
        <div class="campo"><label for="f-nome">Nome curto</label><input id="f-nome" name="nome" placeholder="Ex.: Centro" required><p class="ajuda">É assim que o assistente vai chamar a filial ("retirada no Aeroporto ou no Centro?").</p></div>
        <div class="campo campo-curto"><label for="f-branch">Número da filial no portal (branchId)</label><input id="f-branch" name="branchId" inputmode="numeric" required><p class="ajuda">Preenchido pela lista acima; pode digitar se já souber.</p></div>
      </form>`,
      rodape: html`<button class="btn btn-contorno" data-fechar>Cancelar</button><button class="btn btn-primario" form="form-filial" type="submit">Adicionar</button>`,
    });
    // lista do portal: as já vinculadas a esta loja ficam de fora
    let doPortal = [];
    const usados = new Set((loja.filiais || []).map((x) => Number(x.branchId)));
    const carregarPortal = async () => {
      const sel = $('#f-portal', m.el);
      try {
        doPortal = (await api.filiaisLocarx()).filter((x) => !usados.has(Number(x.branchId)));
        render(sel, html`<option value="">Escolha a filial (${doPortal.length} disponíveis)</option>${doPortal.map((x, i) => html`<option value="${i}">${x.nome} · ${x.cidade}/${x.uf} · ${x.codigo} (${x.branchId})</option>`)}`);
      } catch (err) { render(sel, html`<option value="">Não foi possível consultar o portal: ${err.message}</option>`); }
    };
    carregarPortal();
    $('#f-recarregar', m.el).addEventListener('click', (e) => comBotao(e.currentTarget, carregarPortal));
    $('#f-portal', m.el).addEventListener('change', (e) => {
      const x = doPortal[Number(e.target.value)]; if (!x) return;
      const f = $('#form-filial', m.el);
      f.elements.branchId.value = x.branchId;
      if (!f.elements.nome.value.trim()) f.elements.nome.value = String(x.nome || '').replace(/^locarx\s*/i, '').replace(new RegExp('^' + (loja.cidade || '') + '\\s*', 'i'), '').trim().slice(0, 60) || x.nome;
    });
    $('#form-filial', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target; const d = dadosDoForm(f);
      if (!marcarErros(f, { ...(d.nome?.trim().length >= 2 ? {} : { nome: 'Dê um nome curto.' }), ...(/^\d+$/.test(d.branchId || '') ? {} : { branchId: 'Use só números.' }) })) return;
      await comBotao($('[type=submit]', m.el), async () => {
        try { await api.adicionarFilial(lojaId, d); m.fechar(); avisar('Filial adicionada.'); detalhe(alvo, ctx); } catch (err) { if (err.campos) marcarErros(f, err.campos); avisar(err.message, 'erro'); }
      });
    });
  });
  $$('[data-filial-principal]', alvo).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmar({ titulo: 'Tornar principal', texto: 'A filial principal é a padrão da loja (cotações sem escolha, teste da API, políticas importadas).', botao: 'Tornar principal' }))) return;
    try { await api.editarFilial(lojaId, b.dataset.filialPrincipal, { principal: true }); avisar('Filial principal alterada.'); detalhe(alvo, ctx); } catch (err) { avisar(err.message, 'erro'); }
  }));
  $$('[data-filial-remover]', alvo).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmar({ titulo: 'Remover filial', texto: 'As reservas já feitas continuam registradas. Só deixa de aparecer como opção.', botao: 'Remover', perigo: true }))) return;
    try { await api.removerFilial(lojaId, b.dataset.filialRemover); avisar('Filial removida.'); detalhe(alvo, ctx); } catch (err) { avisar(err.message, 'erro'); }
  }));

  painelEquipe($('#equipe-loja', alvo), { ctx, lojaId, podeGerir: ehAdmin, podeConvidarDono: ehAdmin, titulo: 'Equipe da loja' });

  // chat do site (widget da Lia no site da LocarX): liga/desliga por loja
  const caixaSite = $('#site-chat-dd', alvo);
  if (caixaSite) {
    const desenharSite = async () => {
      try {
        const r = await api.siteChat();
        const eu = r.lojas.find((l) => l.id === lojaId);
        render(caixaSite, html`${eu?.ativo ? html`<span class="selo ok">Ligado</span>` : html`<span class="selo neutro">Desligado</span>`}
          ${!r.ligado ? html` <span class="sub">o servidor ainda não tem o site autorizado (variável SITE_ORIGENS)</span>` : r.protegido ? html` <span class="sub">acesso restrito por chave de teste</span>` : ''}
          ${eu?.ultimos30dias ? html`<div class="sub">Últimos 30 dias: <strong>${eu.ultimos30dias.conversas}</strong> ${eu.ultimos30dias.conversas === 1 ? 'conversa' : 'conversas'} · <strong>${eu.ultimos30dias.confirmaram}</strong> confirmaram o WhatsApp · <strong>${eu.ultimos30dias.reservas}</strong> ${eu.ultimos30dias.reservas === 1 ? 'reserva' : 'reservas'}</div>` : ''}
          <div><button class="btn btn-texto" id="alternar-site-chat">${eu?.ativo ? 'Desligar chat do site' : 'Ligar chat do site'}</button></div>`);
        $('#alternar-site-chat', caixaSite).addEventListener('click', async () => {
          try { await api.siteChatLoja(lojaId, !eu?.ativo); avisar(eu?.ativo ? 'Chat do site desligado para esta loja.' : 'Chat do site ligado para esta loja.'); desenharSite(); } catch (err) { avisar(err.message, 'erro'); }
        });
      } catch (err) { render(caixaSite, html`<span class="sub">${err.message}</span>`); }
    };
    desenharSite();
  }

  // Central de Reservas: esta loja reserva em qualquer filial da rede
  const caixaCentral = $('#central-dd', alvo);
  if (caixaCentral) {
    api.siteChat().then((r) => {
      const eu = r.lojas.find((l) => l.id === lojaId);
      const outra = r.lojas.find((l) => l.central && l.id !== lojaId);
      render(caixaCentral, html`${eu?.central ? html`<span class="selo ok">Ligada</span>` : html`<span class="selo neutro">Desligada</span>`}
        <div class="sub">${eu?.central
          ? 'Esta loja consulta preços e disponibilidade e reserva em qualquer filial LocarX. A loja de retirada recebe um aviso (tarefa no CRM e WhatsApp). O chat do site, se ligado nesta loja, passa a atender o site inteiro.'
          : 'Ligue só na loja que será a Central: o WhatsApp dela passa a perguntar a cidade de retirada e reservar em qualquer filial da rede.'}</div>
        ${!eu?.central && outra ? html`<div class="sub">Atenção: <strong>${outra.nome}</strong> já é Central.</div>` : ''}
        <div><button class="btn btn-texto" id="alternar-central">${eu?.central ? 'Desligar Central de Reservas' : 'Ligar Central de Reservas'}</button></div>`);
      $('#alternar-central', caixaCentral).addEventListener('click', async () => {
        const ligar = !eu?.central;
        if (!(await confirmar({ titulo: ligar ? 'Ligar Central de Reservas' : 'Desligar Central de Reservas', texto: ligar
          ? 'O assistente desta loja passará a atender a rede inteira: pergunta a cidade, mostra qualquer filial e reserva nela. Confira se o WhatsApp e o assistente desta loja são os da Central.'
          : 'A loja volta a atender só as próprias filiais.', botao: ligar ? 'Ligar' : 'Desligar' }))) return;
        try { await api.centralLoja(lojaId, ligar); avisar(ligar ? 'Central de Reservas ligada.' : 'Central de Reservas desligada.'); detalhe(alvo, ctx); } catch (err) { avisar(err.message, 'erro'); }
      });
    }).catch((err) => render(caixaCentral, html`<span class="sub">${err.message}</span>`));
  }

  $('#pix-proprio', alvo)?.addEventListener('click', async () => {
    const ligar = !loja.pix?.proprio;
    const ok = await confirmar({ titulo: ligar ? 'Liberar conta própria' : 'Voltar para a conta da rede', texto: ligar
      ? 'A loja passa a receber os Pix do WhatsApp na própria conta AbacatePay. O dono cadastra a chave da conta em "Pagamentos online"; até lá, o Pix fica indisponível para esta loja. Ela sai do relatório de repasse.'
      : 'Os próximos Pix desta loja voltam a cair na conta da rede (repasse pelo relatório). A chave cadastrada pela loja deixa de ser usada.', botao: ligar ? 'Liberar' : 'Voltar para a rede' });
    if (!ok) return;
    try { await api.pixProprioLoja(lojaId, ligar); avisar(ligar ? 'Conta própria liberada. Avise o dono para cadastrar a chave.' : 'Loja de volta à conta da rede.'); detalhe(alvo, ctx); } catch (err) { avisar(err.message, 'erro'); }
  });

  const NOMES_DIAG = { ambiente: 'Ambiente', locality: 'GET /locality', availabilities: 'GET /availabilities/external', prices_calculate: 'POST /prices/calculate', reservations: 'GET /reservations', reservations_new_TESTE: 'POST /reservations/new (reserva de teste, cancelada em seguida)' };
  async function testarApi(comReserva) {
    const r = await api.testarLocarx(loja.filial.branchId, comReserva);
    let homolog = false;
    try { homolog = !!JSON.parse(r.ambiente?.amostra || '{}').homologacao; } catch { /* sem ambiente */ }
    const m = abrirModal({
      titulo: 'Teste da API LocarX',
      corpo: html`<p class="sub">Filial ${loja.filial.branchId}. Mostra o que o portal respondeu em cada passo, para conferir endereço, token e formato dos campos.</p>
        ${Object.entries(r).map(([nome, x]) => html`<div class="diag"><div class="filtros"><strong>${NOMES_DIAG[nome] || nome}</strong>${x.ok ? html`<span class="selo ok">OK</span>` : html`<span class="selo erro">Erro ${x.status || ''}</span>`}</div>
          <pre class="pre-diag">${x.ok ? x.amostra : `${x.erro}\n${x.resposta || ''}`}</pre></div>`)}`,
      rodape: html`${homolog && !comReserva ? html`<button class="btn btn-contorno" id="reserva-teste" title="Cria uma reserva com cliente fictício na homologação e cancela em seguida">Testar reserva (homologação)</button>` : ''}<button class="btn btn-primario" data-fechar>Fechar</button>`,
    });
    $('#reserva-teste', m.el)?.addEventListener('click', (e) => comBotao(e.currentTarget, async () => {
      try { m.fechar(); await testarApi(true); } catch (err) { avisar(err.message, 'erro'); }
    }));
  }
  $('#testar-api', alvo)?.addEventListener('click', (e) => comBotao(e.currentTarget, async () => { try { await testarApi(false); } catch (err) { avisar(err.message, 'erro'); } }));
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
