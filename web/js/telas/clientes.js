// Clientes da loja: lista, ficha, etiquetas, mensagem ativa e exportação.
import { api } from '../api.js';
import { html, render, $, $$, icone, iniciais, avisar, abrirModal, comBotao, marcarErros, dadosDoForm, quando, data, chipEtiqueta, telefoneBr } from '../util.js';
import { montarPainelCliente } from './painel-cliente.js';

const reais = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const telefone = (t) => telefoneBr(t) || '+' + t;
const seloEtapa = (e) => html`<span class="etapa-chip" data-cor="${e.cor}" title="${e.funil}"><span class="ponto-cor"></span>${e.nome}</span>`;

export async function montar(alvo, ctx) {
  let pagina = 1, busca = '', etiqueta = '', espera = null;
  const dono = ctx.usuario.perfil === 'dono';
  render(alvo, html`
    <div class="cabecalho-pagina">
      <div class="titulos"><h1>Clientes</h1><p>Todo cliente que falou com a loja pelo WhatsApp, com histórico de conversas e reservas.</p></div>
      <div class="filtros">${dono ? html`<a class="btn btn-contorno" id="exportar" href="${api.urlExportarContatos()}" download>Exportar planilha</a>` : ''}
        <button class="btn btn-primario" id="novo-cliente">${icone('mais')}Novo cliente</button></div>
    </div>
    <section class="painel">
      <div class="painel-cab">
        <label class="busca"><span class="sr-only">Buscar</span>${icone('busca')}<input id="busca-cli" type="search" placeholder="Nome, telefone ou e-mail"></label>
        <select id="filtro-etiqueta" class="campo-inline" aria-label="Filtrar por etiqueta"><option value="">Todas as etiquetas</option></select>
      </div>
      <div id="lista-cli"><div class="painel-corpo"><div class="esqueleto"></div></div></div>
    </section>`);
  const area = $('#lista-cli', alvo);

  async function carregar() {
    try {
      const r = await api.contatos({ busca: busca || undefined, etiqueta: etiqueta || undefined, pagina: String(pagina) });
      const sel = $('#filtro-etiqueta', alvo);
      if (sel.options.length <= 1) render(sel, html`<option value="">Todas as etiquetas</option>${r.etiquetas.map((e) => html`<option value="${e.id}" ${e.id === etiqueta ? 'selected' : ''}>${e.nome}</option>`)}`);
      if (!r.contatos.length) return render(area, html`<div class="estado">${icone('clientes')}<h3>${busca || etiqueta ? 'Nada encontrado' : 'Nenhum cliente ainda'}</h3><p>${busca || etiqueta ? 'Nenhum cliente corresponde à busca.' : 'Os clientes entram aqui sozinhos quando mandam mensagem para o WhatsApp da loja.'}</p></div>`);
      const paginas = Math.ceil(r.total / 50);
      render(area, html`<div class="tabela-caixa"><table class="tabela">
        <thead><tr><th>Cliente</th><th class="col-opcional">Etiquetas</th><th class="col-opcional">Funil</th><th class="col-opcional">Reservas</th><th>Último contato</th></tr></thead>
        <tbody>${r.contatos.map((k) => html`<tr class="clicavel" data-id="${k.id}" tabindex="0">
          <td><div class="pessoa"><span class="avatar">${k.nome ? iniciais(k.nome) : '#'}</span><div><strong>${k.nome || telefone(k.telefone)}</strong><span>${telefone(k.telefone)}${k.optout ? ' · não quer mensagens' : ''}</span></div></div></td>
          <td class="col-opcional">${k.etiquetas.map((e) => chipEtiqueta(e))}</td>
          <td class="col-opcional">${k.etapa ? seloEtapa(k.etapa) : ''}</td>
          <td class="col-opcional num">${k.reservas || 0}</td>
          <td class="sub">${quando(k.ultimaConversa || k.criadoEm)}</td></tr>`)}</tbody></table></div>
        ${paginas > 1 ? html`<div class="paginacao"><button class="btn btn-texto" data-pag="-1" ${pagina <= 1 ? 'disabled' : ''}>${icone('voltar')}Anterior</button><span class="sub num">Página ${pagina} de ${paginas} · ${r.total} clientes</span><button class="btn btn-texto" data-pag="1" ${pagina >= paginas ? 'disabled' : ''}>Próxima${icone('seta')}</button></div>` : ''}`);
      $$('tr.clicavel', area).forEach((tr) => { const ir = () => abrirFicha(tr.dataset.id, ctx, carregar); tr.addEventListener('click', ir); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') ir(); }); });
      $$('[data-pag]', area).forEach((b) => b.addEventListener('click', () => { pagina += Number(b.dataset.pag); carregar(); }));
    } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      render(area, html`<div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div>`);
    }
  }
  $('#busca-cli', alvo).addEventListener('input', (e) => { busca = e.target.value.trim(); pagina = 1; clearTimeout(espera); espera = setTimeout(carregar, 350); });
  $('#filtro-etiqueta', alvo).addEventListener('change', (e) => { etiqueta = e.target.value; pagina = 1; carregar(); });
  $('#novo-cliente', alvo).addEventListener('click', () => novoCliente(ctx, carregar));
  await carregar();
  if (ctx.params[0]) abrirFicha(ctx.params[0], ctx, carregar);
  return { atualizar: ({ params }) => { if (params[0]) abrirFicha(params[0], ctx, carregar); }, limpar: () => clearTimeout(espera) };
}

function novoCliente(ctx, aoSalvar) {
  const m = abrirModal({
    titulo: 'Novo cliente',
    corpo: html`<form class="form" id="form-novo" novalidate>
      <div class="campo"><label for="n-nome">Nome</label><input id="n-nome" name="nome" maxlength="120"></div>
      <div class="campo"><label for="n-tel">WhatsApp com DDD</label><input id="n-tel" name="telefone" inputmode="tel" placeholder="(71) 99999-0000"></div></form>`,
    rodape: html`<button class="btn btn-contorno" data-fechar>Cancelar</button><button class="btn btn-primario" type="submit" form="form-novo">Cadastrar</button>`,
  });
  const f = $('#form-novo', m.el);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = dadosDoForm(f);
    const erros = {};
    if (d.nome.trim().length < 2) erros.nome = 'Informe o nome.';
    if (!/^\d{10,13}$/.test(d.telefone.replace(/\D/g, ''))) erros.telefone = 'Informe o telefone com DDD.';
    if (!marcarErros(f, erros)) return;
    await comBotao($('[type=submit]', m.el), async () => {
      try { const k = await api.novoContato(d); m.fechar(); avisar('Cliente cadastrado.'); aoSalvar(); abrirFicha(k.id, ctx, aoSalvar); }
      catch (err) { if (err.campos) marcarErros(f, err.campos); else avisar(err.message, 'erro'); }
    });
  });
}

export async function abrirFicha(id, ctx, aoMudar) {
  let k;
  try { k = await api.contato(id); } catch (err) { return avisar(err.message, 'erro'); }
  const janela = k.janelaAbertaAte && new Date(k.janelaAbertaAte) > new Date();
  const m = abrirModal({
    titulo: k.nome || telefone(k.telefone),
    corpo: html`
      <div class="filtros"><span class="sub num">${telefone(k.telefone)}</span>${k.conversaId ? html`<a class="btn btn-texto" href="#/conversas/${k.conversaId}">${icone('conversas')}Abrir conversa</a>` : ''}
        <button class="btn btn-contorno" id="f-mensagem">${icone('whatsapp')}Enviar mensagem</button></div>
      <form class="form" id="form-ficha" novalidate>
        <div class="form-linha">
          <div class="campo"><label for="f-nome">Nome</label><input id="f-nome" name="nome" value="${k.nome || ''}" maxlength="120"></div>
          <div class="campo"><label for="f-email">E-mail</label><input id="f-email" name="email" type="email" value="${k.email || ''}"></div>
        </div>
        <div class="campo"><label for="f-cpf">CPF</label><input id="f-cpf" name="cpf" inputmode="numeric" placeholder="${k.cpf || 'Não informado'}" autocomplete="off"><p class="ajuda">Guardado criptografado. Mostramos só o final.</p></div>
        <div class="campo"><label for="f-obs">Observações</label><textarea id="f-obs" name="observacoes" rows="3" maxlength="4000">${k.observacoes}</textarea></div>
        <label class="checkbox"><input type="checkbox" name="optout" ${k.optout ? 'checked' : ''}> Não enviar mensagens automáticas para este cliente</label>
      </form>
      <div class="ficha-painel" id="ficha-painel"></div>
      <div class="ficha-blocos">
        <div><h3>Reservas</h3>${k.reservas.length ? html`<ul class="lista-ficha">${k.reservas.map((r) => html`<li><strong class="num">${r.codigo}</strong> · ${r.grupo || ''} · ${data(r.retirada)} · ${reais(r.valor)} <span class="sub">${r.status}</span></li>`)}</ul>` : html`<p class="sub">Nenhuma reserva.</p>`}</div>
        <div><h3>Histórico no funil</h3>${k.oportunidades.length ? html`<ul class="lista-ficha">${k.oportunidades.map((o) => html`<li><span class="etapa-chip" data-cor="${o.etapa.cor}"><span class="ponto-cor"></span>${o.etapa.nome}</span> <span class="sub">${o.funil}</span>${o.valor ? ` · ${reais(o.valor)}` : ''}${o.motivoPerda ? ` · ${o.motivoPerda}` : ''} <span class="sub">${data(o.criadaEm)}</span></li>`)}</ul>` : html`<p class="sub">Fora do funil.</p>`}</div>
        <div><h3>Tarefas</h3>${k.tarefas.length ? html`<ul class="lista-ficha">${k.tarefas.map((t) => html`<li class="${t.feitaEm ? 'feita' : ''}">${t.titulo} <span class="sub">${t.feitaEm ? 'feita' : 'vence ' + quando(t.venceEm)}</span></li>`)}</ul>` : html`<p class="sub">Nenhuma tarefa.</p>`}
          <button class="btn btn-texto" id="f-tarefa">${icone('mais')}Nova tarefa</button></div>
      </div>`,
    rodape: html`<button class="btn btn-contorno" data-fechar>Fechar</button><button class="btn btn-primario" type="submit" form="form-ficha">Salvar</button>`,
  });
  m.el.querySelector('.modal').classList.add('modal-largo');
  const painel = montarPainelCliente($('#ficha-painel', m.el), id, { comLinkFicha: false, aoMudar: () => aoMudar?.() });
  new MutationObserver((_, obs) => { if (!m.el.isConnected) { obs.disconnect(); painel.destruir(); } }).observe(document.body, { childList: true });
  const f = $('#form-ficha', m.el);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = dadosDoForm(f);
    const corpo = { nome: d.nome.trim() || undefined, email: d.email.trim(), observacoes: d.observacoes, optout: !!d.optout };
    if (d.cpf.trim()) corpo.cpf = d.cpf;
    await comBotao($('[type=submit]', m.el), async () => {
      try { await api.salvarContato(id, corpo); avisar('Cliente salvo.'); m.fechar(); aoMudar?.(); }
      catch (err) { if (err.campos) marcarErros(f, err.campos); else avisar(err.message, 'erro'); }
    });
  });
  $('#f-mensagem', m.el).addEventListener('click', () => { m.fechar(); mensagemAtiva(k, janela, ctx); });
  $('#f-tarefa', m.el).addEventListener('click', () => { m.fechar(); novaTarefa({ contatoId: k.id, nome: k.nome }, () => abrirFicha(id, ctx, aoMudar)); });
}

export async function novaTarefa({ contatoId, nome } = {}, aoSalvar) {
  const amanha = new Date(Date.now() + 86_400_000); amanha.setHours(9, 0, 0, 0);
  const local = new Date(amanha.getTime() - amanha.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const m = abrirModal({
    titulo: nome ? `Nova tarefa · ${nome}` : 'Nova tarefa',
    corpo: html`<form class="form" id="form-tarefa" novalidate>
      <div class="campo"><label for="t-titulo">O que fazer</label><input id="t-titulo" name="titulo" maxlength="200" placeholder="Ex.: Ligar para confirmar a retirada"></div>
      <div class="campo"><label for="t-vence">Para quando</label><input id="t-vence" name="venceEm" type="datetime-local" value="${local}"></div></form>`,
    rodape: html`<button class="btn btn-contorno" data-fechar>Cancelar</button><button class="btn btn-primario" type="submit" form="form-tarefa">Criar tarefa</button>`,
  });
  const f = $('#form-tarefa', m.el);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = dadosDoForm(f);
    if (!marcarErros(f, d.titulo.trim().length >= 2 ? (d.venceEm ? {} : { venceEm: 'Escolha a data.' }) : { titulo: 'Descreva a tarefa.' })) return;
    await comBotao($('[type=submit]', m.el), async () => {
      try { await api.novaTarefa({ titulo: d.titulo.trim(), venceEm: new Date(d.venceEm).toISOString(), contatoId: contatoId || null }); m.fechar(); avisar('Tarefa criada.'); aoSalvar?.(); }
      catch (err) { avisar(err.message, 'erro'); }
    });
  });
}

export async function mensagemAtiva(k, janela, ctx) {
  let modelos = [];
  try { modelos = (await api.modelos()).filter((x) => x.ativo); } catch { /* segue sem modelos */ }
  const m = abrirModal({
    titulo: `Mensagem para ${k.nome || telefone(k.telefone)}`,
    corpo: html`
      ${janela ? html`<div class="alerta-caixa ok">${icone('info')}<span>O cliente falou com a loja nas últimas 24 horas: dá para escrever livremente.</span></div>`
               : html`<div class="alerta-caixa info">${icone('info')}<span>Passaram mais de 24 horas desde a última mensagem do cliente. Pela regra do WhatsApp, use um modelo.</span></div>`}
      ${k.optout && !janela ? html`<div class="alerta-caixa erro">${icone('alerta')}<span>Este cliente pediu para não receber mensagens.</span></div>` : ''}
      <form class="form" id="form-msg" novalidate>
        <div class="campo"><label for="msg-modelo">Modelo</label><select id="msg-modelo" name="modelo">${janela ? html`<option value="">Mensagem livre</option>` : ''}${modelos.map((x) => html`<option value="${x.chave}">${x.nome}</option>`)}</select></div>
        <div id="msg-campos" class="form"></div>
        <div class="campo"><label for="msg-texto">Mensagem</label><textarea id="msg-texto" name="texto" rows="5" maxlength="1000"></textarea></div>
      </form>`,
    rodape: html`<button class="btn btn-contorno" data-fechar>Cancelar</button><button class="btn btn-primario" type="submit" form="form-msg">Enviar</button>`,
  });
  const f = $('#form-msg', m.el), sel = f.elements.modelo, texto = f.elements.texto, campos = $('#msg-campos', m.el);
  const atualizar = () => {
    const md = modelos.find((x) => x.chave === sel.value);
    texto.readOnly = !!md;
    if (!md) { render(campos, ''); if (texto.dataset.modelo) { texto.value = ''; delete texto.dataset.modelo; } return; }
    texto.dataset.modelo = '1';
    const vars = [...new Set((md.texto.match(/\{([a-z_]+)\}/g) || []).map((v) => v.slice(1, -1)))].filter((v) => !['nome', 'loja'].includes(v));
    render(campos, html`${vars.map((v) => html`<div class="campo"><label for="var-${v}">${v.replace(/_/g, ' ')}</label><input id="var-${v}" data-var="${v}" maxlength="200"></div>`)}`);
    const previa = () => { let t = md.texto.replace('{nome}', (k.nome || '').split(' ')[0] || 'cliente').replace(/\{loja\}/g, 'a loja'); $$('[data-var]', campos).forEach((i) => { if (i.value) t = t.replaceAll(`{${i.dataset.var}}`, i.value); }); texto.value = t; };
    $$('[data-var]', campos).forEach((i) => i.addEventListener('input', previa));
    previa();
  };
  sel.addEventListener('change', atualizar); atualizar();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const md = sel.value;
    const variaveis = Object.fromEntries($$('[data-var]', campos).map((i) => [i.dataset.var, i.value.trim()]));
    if (!md && !texto.value.trim()) return avisar('Escreva a mensagem.', 'erro');
    await comBotao($('[type=submit]', m.el), async () => {
      try { const r = await api.mensagemAtiva(k.id, md ? { modelo: md, variaveis } : { texto: texto.value.trim() }); m.fechar(); avisar('Mensagem enviada.'); ctx.navegar(`conversas/${r.conversaId}`); }
      catch (err) { avisar(err.campos ? Object.values(err.campos)[0] : err.message, 'erro'); }
    });
  });
}
