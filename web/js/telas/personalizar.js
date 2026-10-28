// Personalização do CRM.
// - Dono (#/personalizar): funis da loja, etiquetas e campos da loja (os da rede aparecem só para consulta).
// - Administração e matriz (#/padroes): funil padrão, etiquetas e campos que valem para toda a rede.
import { api } from '../api.js';
import { html, render, $, $$, icone, avisar, abrirModal, confirmar, comBotao, marcarErros, chipEtiqueta, seletorCor, CORES, preferencia } from '../util.js';

const TIPO_ETAPA = { aberta: 'Em andamento', ganho: 'Venda concluída', perdido: 'Perdido' };
const EVENTOS = [['', 'Só a equipe move'], ['cotacao', 'Automático: cotou preço'], ['reserva', 'Automático: reserva criada'], ['retirada', 'Automático: carro retirado']];
const TIPOS_CAMPO = { texto: 'Texto', numero: 'Número', data: 'Data', lista: 'Lista de opções', simnao: 'Sim ou não' };
const NOVO_FUNIL = [
  { nome: 'Novo contato', cor: '#64748b', tipo: 'aberta', evento: null },
  { nome: 'Em negociação', cor: '#2563eb', tipo: 'aberta', evento: null },
  { nome: 'Fechado', cor: '#16a34a', tipo: 'ganho', evento: null },
  { nome: 'Perdido', cor: '#dc2626', tipo: 'perdido', evento: null },
];

export async function montar(alvo, ctx) {
  const rede = ['admin', 'matriz'].includes(ctx.usuario.perfil);
  const escopo = rede ? 'rede' : 'loja';
  let aba = preferencia.ler('aba-personalizar') || 'funis';
  render(alvo, html`
    <div class="cabecalho-pagina">
      <div class="titulos"><h1>${rede ? 'Padrões do CRM' : 'Funis, etiquetas e campos'}</h1>
        <p>${rede ? 'O que vale para todas as lojas da rede. Cada dono pode criar os próprios funis, etiquetas e campos a partir daqui.'
                  : 'Monte o funil de vendas da loja, as etiquetas dos clientes e as informações que o assistente anota na conversa.'}</p></div>
    </div>
    <div class="abas abas-pagina" role="tablist" aria-label="O que personalizar">
      ${[['funis', rede ? 'Funil padrão' : 'Funis'], ['etiquetas', 'Etiquetas'], ['campos', 'Informações do cliente']].map(([v, t]) =>
        html`<button role="tab" data-aba="${v}" class="${aba === v ? 'ativa' : ''}" aria-selected="${aba === v}">${t}</button>`)}
    </div>
    <div id="aba-conteudo"></div>`);
  const area = $('#aba-conteudo', alvo);

  function trocar(nova) {
    aba = nova; preferencia.gravar('aba-personalizar', nova);
    $$('[data-aba]', alvo).forEach((b) => { b.classList.toggle('ativa', b.dataset.aba === nova); b.setAttribute('aria-selected', String(b.dataset.aba === nova)); });
    ({ funis: rede ? funilPadrao : funisDaLoja, etiquetas, campos })[nova](area, { escopo, ctx });
  }
  $$('[data-aba]', alvo).forEach((b) => b.addEventListener('click', () => trocar(b.dataset.aba)));
  trocar(['funis', 'etiquetas', 'campos'].includes(aba) ? aba : 'funis');
}

const carregando = (area) => render(area, html`<section class="painel"><div class="painel-corpo"><div class="esqueleto"></div></div></section>`);
const falhou = (area, err, ctx) => { if (err.status === 401) return ctx.sessaoExpirou(); render(area, html`<section class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div></section>`); };
const trilhaEtapas = (f) => html`<div class="trilha-etapas">${f.etapas.map((e) => html`<span class="etapa-chip" data-cor="${e.cor}"><span class="ponto-cor"></span>${e.nome}${e.evento ? html`<span class="pc-robo" title="${EVENTOS.find((x) => x[0] === e.evento)[1]}">${icone('robo')}</span>` : ''}${e.modeloChave ? html`<span class="pc-robo" title="Envia uma mensagem pelo WhatsApp quando o cliente entra aqui">${icone('conversas')}</span>` : ''}</span>`)}</div>`;

// =====================================================================
// FUNIS
// =====================================================================
async function funisDaLoja(area, { ctx }) {
  carregando(area);
  let funis, regras;
  try { [funis, regras] = await Promise.all([api.funis(), api.regrasFunil()]); } catch (err) { return falhou(area, err, ctx); }
  render(area, html`
    <div class="alerta-caixa info">${icone('info')}<span>O <strong>funil principal</strong> é o que o assistente usa: ele coloca cada conversa nova na primeira etapa e move o cliente sozinho nas etapas marcadas com ${icone('robo')}. Os outros funis a equipe usa como quiser (ex.: mensalistas, empresas).</span></div>
    <div class="lista-funis">${funis.map((f) => html`
      <section class="painel">
        <div class="painel-cab"><div><h2>${f.nome} ${f.principal ? html`<span class="selo marca sem-ponto">Principal</span>` : ''}</h2>
          <span class="sub">${f.abertas} cliente(s) em andamento${!f.personalizado && f.principal ? ' · segue o padrão da rede' : ''}</span></div>
          <div class="filtros"><button class="btn btn-contorno" data-editar="${f.id}">${icone('editar')}Editar</button>
            ${f.principal ? '' : html`<button class="btn btn-texto" data-arquivar="${f.id}">Arquivar</button>`}</div></div>
        <div class="painel-corpo">${trilhaEtapas(f)}</div>
      </section>`)}</div>
    <button class="btn btn-primario" id="novo-funil">${icone('mais')}Novo funil</button>
    <section class="painel" id="regras-funil"><div class="painel-cab"><div><h2>Regras automáticas</h2><span class="sub">Quando o Conecta marca o cliente como perdido ou concluído sem ninguém mexer (funil principal).</span></div></div>
      <form class="form painel-corpo" id="form-regras" novalidate>
        <div class="campo campo-curto"><label for="rg-horas">Marcar como <strong>perdido</strong> quando o cliente ficar sem responder por</label>
          <select id="rg-horas" name="perdidoSemRespostaHoras">${[[0, 'Nunca (só manualmente)'], [24, '24 horas'], [48, '48 horas'], [72, '3 dias'], [168, '7 dias']].map(([v, t]) => html`<option value="${v}" ${Number(regras.perdidoSemRespostaHoras) === v ? 'selected' : ''}>${t}</option>`)}</select>
          <p class="ajuda">Conta a partir da última mensagem do cliente, só quando a última palavra foi nossa (assistente ou equipe) e ainda não há reserva.</p></div>
        <label class="opcao-caixa"><input type="checkbox" name="perdidoPeloAssistente" ${regras.perdidoPeloAssistente ? 'checked' : ''}><span><strong>Assistente marca perdido</strong> quando o cliente diz que não vai alugar (fechou com outra, achou caro, mudou de planos) — com o motivo.</span></label>
        <label class="opcao-caixa"><input type="checkbox" name="concluidoAoPagar" ${regras.concluidoAoPagar ? 'checked' : ''}><span><strong>Concluído ao pagar</strong>: Pix confirmado pelo WhatsApp fecha a oportunidade como ganha.</span></label>
        <label class="opcao-caixa"><input type="checkbox" name="concluidoNaRetirada" ${regras.concluidoNaRetirada ? 'checked' : ''}><span><strong>Concluído na retirada</strong>: passou a data de retirada e a reserva não foi cancelada → ganha.</span></label>
        <div><button class="btn btn-primario" type="submit">Salvar regras</button></div>
      </form></section>`);
  $('#form-regras', area).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const d = { perdidoSemRespostaHoras: Number(f.elements.perdidoSemRespostaHoras.value), perdidoPeloAssistente: f.elements.perdidoPeloAssistente.checked, concluidoAoPagar: f.elements.concluidoAoPagar.checked, concluidoNaRetirada: f.elements.concluidoNaRetirada.checked };
    await comBotao($('[type=submit]', f), async () => { try { await api.salvarRegrasFunil(d); avisar('Regras salvas.'); } catch (err) { avisar(err.message, 'erro'); } });
  });
  $$('[data-editar]', area).forEach((b) => b.addEventListener('click', () => editarFunil({ funil: funis.find((f) => f.id === b.dataset.editar), escopo: 'loja' }, () => funisDaLoja(area, { ctx }))));
  $$('[data-arquivar]', area).forEach((b) => b.addEventListener('click', async () => {
    const f = funis.find((x) => x.id === b.dataset.arquivar);
    if (!(await confirmar({ titulo: `Arquivar o funil ${f.nome}?`, texto: 'Ele some do quadro. O histórico dos clientes continua guardado.', botao: 'Arquivar', perigo: true }))) return;
    try { await api.arquivarFunil(f.id); avisar('Funil arquivado.'); funisDaLoja(area, { ctx }); } catch (err) { avisar(err.message, 'erro'); }
  }));
  $('#novo-funil', area).addEventListener('click', () => editarFunil({ funil: { nome: '', etapas: NOVO_FUNIL.map((e) => ({ ...e })) }, escopo: 'loja', novo: true }, () => funisDaLoja(area, { ctx })));
}

async function funilPadrao(area, { ctx }) {
  carregando(area);
  let r;
  try { r = await api.funilPadrao(); } catch (err) { return falhou(area, err, ctx); }
  const f = r.funil;
  render(area, html`
    <div class="alerta-caixa info">${icone('info')}<span>Toda loja nova começa com uma cópia deste funil. Lojas que ainda não personalizaram acompanham as mudanças que você fizer aqui
      (hoje: <strong class="num">${r.lojas.acompanham}</strong> acompanham, <strong class="num">${r.lojas.personalizaram}</strong> personalizaram).</span></div>
    <section class="painel">
      <div class="painel-cab"><div><h2>${f.nome}</h2><span class="sub">Etapas marcadas com ${icone('robo')} o assistente e as automações movem sozinhos.</span></div>
        <button class="btn btn-contorno" id="editar-padrao">${icone('editar')}Editar</button></div>
      <div class="painel-corpo">${trilhaEtapas(f)}</div>
    </section>`);
  $('#editar-padrao', area).addEventListener('click', () => editarFunil({ funil: f, escopo: 'rede' }, () => funilPadrao(area, { ctx })));
}

async function editarFunil({ funil, escopo, novo = false }, aoSalvar) {
  // modelos de mensagem da loja: a etapa pode enviar um deles quando o cliente chega nela (ex.: pesquisa de satisfação)
  let modelos = [];
  if (escopo === 'loja') { try { modelos = (await api.modelos()).filter((x) => x.ativo); } catch { modelos = []; } }
  let etapas = funil.etapas.map((e) => ({ id: novo ? undefined : e.id, nome: e.nome, cor: e.cor, tipo: e.tipo, evento: e.evento || null, modeloChave: e.modeloChave || null, abertas: e.abertas || 0 }));
  const m = abrirModal({
    titulo: novo ? 'Novo funil' : `Editar funil · ${funil.nome}`,
    corpo: html`<form class="form" id="form-funil" novalidate>
      <div class="campo"><label for="fu-nome">Nome do funil</label><input id="fu-nome" name="nome" maxlength="60" value="${funil.nome}" placeholder="Ex.: Mensalistas"></div>
      ${escopo === 'loja' && !funil.principal ? html`<label class="checkbox"><input type="checkbox" name="principal"> Funil principal (o que o assistente usa)</label>` : ''}
      <div class="campo"><span class="rotulo-campo">Etapas, na ordem</span>
        <ol class="etapas-ed" id="etapas-ed"></ol>
        <button type="button" class="btn btn-texto" id="mais-etapa">${icone('mais')}Adicionar etapa</button>
        <p class="ajuda">As etapas de venda concluída e de perdido não podem ser removidas, só renomeadas. Clientes de uma etapa removida vão para a primeira etapa em andamento.${escopo === 'loja' ? ' A mensagem de uma etapa vai uma vez para cada cliente que entrar nela depois de você ligar, respeitando o horário de silêncio e quem pediu para não receber. Os textos ficam em Modelos de mensagem.' : ''}</p>
      </div></form>`,
    rodape: html`<button class="btn btn-contorno" data-fechar>Cancelar</button><button class="btn btn-primario" type="submit" form="form-funil">Salvar funil</button>`,
  });
  m.el.querySelector('.modal').classList.add('modal-largo');
  const lista = $('#etapas-ed', m.el), form = $('#form-funil', m.el);

  const ler = () => $$('.etapa-ed', lista).forEach((li) => {
    const e = etapas[Number(li.dataset.i)];
    e.nome = $('[data-c=nome]', li).value;
    e.cor = $('[data-c=cor]', li).value;
    const ev = $('[data-c=evento]', li); if (ev) e.evento = ev.value || null;
    const mm = $('[data-c=mensagem]', li); if (mm) e.modeloChave = mm.value || null;
  });
  function desenhar(foco) {
    render(lista, html`${etapas.map((e, i) => html`<li class="etapa-ed" data-i="${i}">
      <span class="ponto-cor grande" data-cor="${e.cor}"></span>
      <label class="sr-only" for="et-cor-${i}">Cor</label>
      <select id="et-cor-${i}" data-c="cor" class="sel-cor">${CORES.map(([c, n]) => html`<option value="${c}" ${c === e.cor ? 'selected' : ''}>${n}</option>`)}</select>
      <label class="sr-only" for="et-nome-${i}">Nome da etapa ${i + 1}</label>
      <input id="et-nome-${i}" data-c="nome" value="${e.nome}" maxlength="40" placeholder="Nome da etapa">
      ${e.tipo === 'aberta'
        ? html`<label class="sr-only" for="et-ev-${i}">Quem move para cá</label><select id="et-ev-${i}" data-c="evento">${EVENTOS.map(([v, t]) => html`<option value="${v}" ${(e.evento || '') === v ? 'selected' : ''}>${t}</option>`)}</select>`
        : html`<span class="selo ${e.tipo === 'ganho' ? 'ok' : 'erro'}">${TIPO_ETAPA[e.tipo]}</span>`}
      <span class="acoes-etapa">
        <button type="button" class="btn btn-texto btn-icone" data-mover="-1" aria-label="Subir ${e.nome}" ${i === 0 ? 'disabled' : ''}>${icone('subir')}</button>
        <button type="button" class="btn btn-texto btn-icone" data-mover="1" aria-label="Descer ${e.nome}" ${i === etapas.length - 1 ? 'disabled' : ''}>${icone('descer')}</button>
        ${e.tipo === 'aberta' ? html`<button type="button" class="btn btn-texto btn-icone" data-remover aria-label="Remover ${e.nome}">${icone('lixo')}</button>` : html`<span class="btn-icone"></span>`}
      </span>
      ${escopo === 'loja' && modelos.length ? html`<div class="etapa-msg"><label for="et-msg-${i}">${icone('conversas')}Ao entrar nesta etapa, enviar pelo WhatsApp:</label>
        <select id="et-msg-${i}" data-c="mensagem"><option value="">Nenhuma mensagem</option>${modelos.map((x) => html`<option value="${x.chave}" ${e.modeloChave === x.chave ? 'selected' : ''}>${x.nome}</option>`)}</select></div>` : ''}
      </li>`)}`);
    $$('[data-c=cor]', lista).forEach((s) => s.addEventListener('change', () => { const p = s.parentElement.querySelector('.ponto-cor'); p.dataset.cor = s.value; p.style.setProperty('--cor', s.value); }));
    $$('[data-mover]', lista).forEach((b) => b.addEventListener('click', () => {
      ler(); const i = Number(b.closest('li').dataset.i), j = i + Number(b.dataset.mover);
      [etapas[i], etapas[j]] = [etapas[j], etapas[i]]; desenhar(`[data-i="${j}"] [data-mover="${b.dataset.mover}"]`);
    }));
    $$('[data-remover]', lista).forEach((b) => b.addEventListener('click', async () => {
      ler(); const i = Number(b.closest('li').dataset.i), e = etapas[i];
      if (etapas.filter((x) => x.tipo === 'aberta').length <= 1) return avisar('O funil precisa de pelo menos uma etapa em andamento.', 'erro');
      if (e.abertas && !(await confirmar({ titulo: `Remover a etapa ${e.nome}?`, texto: `${e.abertas} cliente(s) estão nela e vão para a primeira etapa em andamento ao salvar.`, botao: 'Remover', perigo: true }))) return;
      etapas.splice(i, 1); desenhar();
    }));
    if (foco) $(foco, lista)?.focus();
  }
  desenhar();
  $('#mais-etapa', m.el).addEventListener('click', () => {
    ler();
    if (etapas.length >= 15) return avisar('No máximo 15 etapas.', 'erro');
    const pos = etapas.findIndex((e) => e.tipo !== 'aberta');
    etapas.splice(pos < 0 ? etapas.length : pos, 0, { nome: '', cor: '#0891b2', tipo: 'aberta', evento: null });
    desenhar(`[data-i="${pos < 0 ? etapas.length - 1 : pos}"] [data-c=nome]`);
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault(); ler();
    const nome = form.elements.nome.value.trim();
    if (!marcarErros(form, nome.length < 2 ? { nome: 'Dê um nome ao funil.' } : {})) return;
    const vazia = etapas.findIndex((e) => e.nome.trim().length < 2);
    if (vazia >= 0) { avisar('Toda etapa precisa de nome (2 letras ou mais).', 'erro'); return $(`[data-i="${vazia}"] [data-c=nome]`, lista).focus(); }
    const nomes = etapas.map((e) => e.nome.trim().toLowerCase());
    if (new Set(nomes).size !== nomes.length) return avisar('Há duas etapas com o mesmo nome.', 'erro');
    const eventos = etapas.filter((e) => e.evento).map((e) => e.evento);
    if (new Set(eventos).size !== eventos.length) return avisar('Cada movimento automático só pode levar para uma etapa.', 'erro');
    const corpo = { nome, etapas: etapas.map((e) => ({ id: e.id, nome: e.nome.trim(), cor: e.cor, tipo: e.tipo, evento: e.evento, ...(escopo === 'loja' ? { modeloChave: e.modeloChave } : {}) })) };
    if (form.elements.principal?.checked) corpo.principal = true;
    await comBotao($('[type=submit]', m.el), async () => {
      try {
        if (escopo === 'rede') {
          const r = await api.salvarFunilPadrao(corpo);
          avisar(r.lojasAtualizadas ? `Funil padrão salvo e levado a ${r.lojasAtualizadas} loja(s).` : 'Funil padrão salvo.');
        } else if (novo) { await api.criarFunil(corpo); avisar('Funil criado.'); }
        else { await api.salvarFunil(funil.id, corpo); avisar('Funil salvo.'); }
        m.fechar(); aoSalvar();
      } catch (err) { avisar(err.campos ? Object.values(err.campos)[0] : err.message, 'erro'); }
    });
  });
}

// =====================================================================
// ETIQUETAS
// =====================================================================
async function etiquetas(area, { escopo, ctx }) {
  carregando(area);
  let lista;
  try { lista = await api.etiquetas(escopo); } catch (err) { return falhou(area, err, ctx); }
  const minhas = (e) => (escopo === 'rede' ? true : !e.daRede);
  render(area, html`
    <div class="alerta-caixa info">${icone('info')}<span>Etiquetas com instrução o assistente aplica sozinho durante a conversa (${icone('robo')}). A equipe pode colocar e tirar etiquetas no painel ao lado da conversa.
      ${escopo === 'loja' ? ' As etiquetas da rede são definidas pela LocarX.' : ' Estas valem para todas as lojas.'}</span></div>
    <section class="painel">
      <div class="painel-cab"><h2>Etiquetas</h2><button class="btn btn-primario" id="nova-etiqueta">${icone('mais')}Nova etiqueta</button></div>
      ${lista.length ? html`<div class="tabela-caixa"><table class="tabela">
        <thead><tr><th>Etiqueta</th><th class="col-opcional">O assistente aplica quando</th>${escopo === 'loja' ? html`<th class="col-opcional">Clientes</th>` : ''}<th><span class="sr-only">Ações</span></th></tr></thead>
        <tbody>${lista.map((e) => html`<tr>
          <td>${chipEtiqueta(e)} ${escopo === 'loja' && e.daRede ? html`<span class="sub">da rede</span>` : ''}</td>
          <td class="col-opcional">${e.descricaoBot ? html`<span class="com-robo">${icone('robo')}${e.descricaoBot}</span>` : html`<span class="sub">Só a equipe aplica</span>`}</td>
          ${escopo === 'loja' ? html`<td class="col-opcional num">${e.uso || 0}</td>` : ''}
          <td class="acoes-linha">${minhas(e) ? html`<button class="btn btn-texto btn-icone" data-editar="${e.id}" aria-label="Editar ${e.nome}">${icone('editar')}</button>
            <button class="btn btn-texto btn-icone" data-excluir="${e.id}" aria-label="Excluir ${e.nome}">${icone('lixo')}</button>` : ''}</td></tr>`)}</tbody></table></div>`
      : html`<div class="estado">${icone('etiqueta')}<h3>Nenhuma etiqueta</h3><p>Crie etiquetas para separar os clientes (ex.: Empresa, Mensal, Urgente).</p></div>`}
    </section>`);
  const recarregar = () => etiquetas(area, { escopo, ctx });
  $('#nova-etiqueta', area).addEventListener('click', () => editarEtiqueta({}, escopo, recarregar));
  $$('[data-editar]', area).forEach((b) => b.addEventListener('click', () => editarEtiqueta(lista.find((e) => e.id === b.dataset.editar), escopo, recarregar)));
  $$('[data-excluir]', area).forEach((b) => b.addEventListener('click', async () => {
    const e = lista.find((x) => x.id === b.dataset.excluir);
    const texto = escopo === 'rede' ? 'Ela sai de todos os clientes de todas as lojas.' : `Ela sai de ${e.uso || 0} cliente(s).`;
    if (!(await confirmar({ titulo: `Excluir a etiqueta ${e.nome}?`, texto, botao: 'Excluir', perigo: true }))) return;
    try { await api.excluirEtiqueta(escopo, e.id); avisar('Etiqueta excluída.'); recarregar(); } catch (err) { avisar(err.message, 'erro'); }
  }));
}

function editarEtiqueta(e, escopo, aoSalvar) {
  const m = abrirModal({
    titulo: e.id ? `Editar etiqueta · ${e.nome}` : 'Nova etiqueta',
    corpo: html`<form class="form" id="form-etiqueta" novalidate>
      <div class="campo"><label for="et-nome">Nome</label><input id="et-nome" name="nome" maxlength="30" value="${e.nome || ''}" placeholder="Ex.: Empresa"></div>
      <div class="campo"><span class="rotulo-campo">Cor</span>${seletorCor('cor', e.cor || CORES[1][0])}</div>
      <div class="campo"><label for="et-bot">Quando o assistente deve aplicar (opcional)</label>
        <textarea id="et-bot" name="descricaoBot" rows="2" maxlength="300" placeholder="Ex.: O cliente aluga em nome de uma empresa ou pede nota para CNPJ.">${e.descricaoBot || ''}</textarea>
        <p class="ajuda">Deixe em branco para só a equipe aplicar.</p></div></form>`,
    rodape: html`<button class="btn btn-contorno" data-fechar>Cancelar</button><button class="btn btn-primario" type="submit" form="form-etiqueta">Salvar</button>`,
  });
  const f = $('#form-etiqueta', m.el);
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const nome = f.elements.nome.value.trim();
    if (!marcarErros(f, nome.length < 2 ? { nome: 'Dê um nome à etiqueta.' } : {})) return;
    await comBotao($('[type=submit]', m.el), async () => {
      try { await api.salvarEtiqueta(escopo, { id: e.id, nome, cor: f.elements.cor.value, descricaoBot: f.elements.descricaoBot.value.trim() || null }); m.fechar(); avisar('Etiqueta salva.'); aoSalvar(); }
      catch (err) { if (err.campos) marcarErros(f, err.campos); else avisar(err.message, 'erro'); }
    });
  });
}

// =====================================================================
// CAMPOS (informações do cliente)
// =====================================================================
async function campos(area, { escopo, ctx }) {
  carregando(area);
  let lista;
  try { lista = await api.campos(escopo); } catch (err) { return falhou(area, err, ctx); }
  const meus = lista.filter((c) => (escopo === 'rede' ? true : !c.daRede));
  const linha = (c, i, grupo) => html`<tr class="${c.ativo ? '' : 'inativo'}">
    <td><strong>${c.nome}</strong>${c.ativo ? '' : html` <span class="selo neutro">Desligado</span>`}<br><span class="sub">${TIPOS_CAMPO[c.tipo]}${c.tipo === 'lista' ? ': ' + c.opcoes.join(', ') : ''}</span></td>
    <td class="col-opcional">${c.instrucaoBot ? html`<span class="com-robo">${icone('robo')}${c.instrucaoBot}</span>` : html`<span class="sub">Só a equipe preenche</span>`}</td>
    <td class="acoes-linha">${grupo ? html`
      <button class="btn btn-texto btn-icone" data-ordem="${c.id}" data-dir="-1" aria-label="Subir ${c.nome}" ${i === 0 ? 'disabled' : ''}>${icone('subir')}</button>
      <button class="btn btn-texto btn-icone" data-ordem="${c.id}" data-dir="1" aria-label="Descer ${c.nome}" ${i === grupo.length - 1 ? 'disabled' : ''}>${icone('descer')}</button>
      <button class="btn btn-texto btn-icone" data-editar="${c.id}" aria-label="Editar ${c.nome}">${icone('editar')}</button>
      <button class="btn btn-texto btn-icone" data-excluir="${c.id}" aria-label="Excluir ${c.nome}">${icone('lixo')}</button>` : ''}</td></tr>`;
  render(area, html`
    <div class="alerta-caixa info">${icone('info')}<span>São as informações que aparecem no painel ao lado da conversa (ex.: período, carro desejado). Com instrução, o assistente anota sozinho quando o cliente conta na conversa (${icone('robo')}).</span></div>
    <section class="painel">
      <div class="painel-cab"><h2>${escopo === 'rede' ? 'Campos da rede' : 'Campos da loja'}</h2><button class="btn btn-primario" id="novo-campo">${icone('mais')}Novo campo</button></div>
      ${meus.length ? html`<div class="tabela-caixa"><table class="tabela"><thead><tr><th>Campo</th><th class="col-opcional">O assistente anota</th><th><span class="sr-only">Ações</span></th></tr></thead>
        <tbody>${meus.map((c, i) => linha(c, i, meus))}</tbody></table></div>`
      : html`<div class="estado">${icone('editar')}<h3>Nenhum campo ${escopo === 'rede' ? 'da rede' : 'da loja'}</h3><p>${escopo === 'loja' ? 'Os campos da rede já valem para a loja. Crie aqui só o que for específico da loja.' : 'Crie as informações que toda loja deve anotar.'}</p></div>`}
    </section>
    ${escopo === 'loja' && lista.some((c) => c.daRede) ? html`<section class="painel">
      <div class="painel-cab"><div><h2>Campos da rede</h2><span class="sub">Definidos pela LocarX para todas as lojas.</span></div></div>
      <div class="tabela-caixa"><table class="tabela"><tbody>${lista.filter((c) => c.daRede).map((c, i) => linha(c, i, null))}</tbody></table></div></section>` : ''}`);
  const recarregar = () => campos(area, { escopo, ctx });
  $('#novo-campo', area).addEventListener('click', () => editarCampo({}, escopo, recarregar));
  $$('[data-editar]', area).forEach((b) => b.addEventListener('click', () => editarCampo(lista.find((c) => c.id === b.dataset.editar), escopo, recarregar)));
  $$('[data-excluir]', area).forEach((b) => b.addEventListener('click', async () => {
    const c = lista.find((x) => x.id === b.dataset.excluir);
    if (!(await confirmar({ titulo: `Excluir o campo ${c.nome}?`, texto: 'O que já foi anotado neste campo é apagado de todos os clientes. Para só esconder, edite e desligue o campo.', botao: 'Excluir', perigo: true }))) return;
    try { await api.excluirCampo(escopo, c.id); avisar('Campo excluído.'); recarregar(); } catch (err) { avisar(err.message, 'erro'); }
  }));
  $$('[data-ordem]', area).forEach((b) => b.addEventListener('click', async () => {
    const ids = meus.map((c) => c.id), i = ids.indexOf(b.dataset.ordem), j = i + Number(b.dataset.dir);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await api.ordenarCampos(escopo, ids); recarregar(); } catch (err) { avisar(err.message, 'erro'); }
  }));
}

function editarCampo(c, escopo, aoSalvar) {
  const m = abrirModal({
    titulo: c.id ? `Editar campo · ${c.nome}` : 'Novo campo',
    corpo: html`<form class="form" id="form-campo" novalidate>
      <div class="campo"><label for="cp-nome">Nome</label><input id="cp-nome" name="nome" maxlength="60" value="${c.nome || ''}" placeholder="Ex.: Forma de pagamento"></div>
      <div class="campo"><label for="cp-tipo">Tipo</label><select id="cp-tipo" name="tipo" ${c.id ? 'disabled' : ''}>${Object.entries(TIPOS_CAMPO).map(([v, t]) => html`<option value="${v}" ${v === (c.tipo || 'texto') ? 'selected' : ''}>${t}</option>`)}</select>
        ${c.id ? html`<p class="ajuda">O tipo não muda depois de criado.</p>` : ''}</div>
      <div class="campo" id="cp-opcoes-caixa" ${c.tipo === 'lista' ? '' : 'hidden'}><label for="cp-opcoes">Opções (uma por linha)</label><textarea id="cp-opcoes" name="opcoes" rows="4">${(c.opcoes || []).join('\n')}</textarea></div>
      <div class="campo"><label for="cp-bot">Instrução para o assistente (opcional)</label>
        <textarea id="cp-bot" name="instrucaoBot" rows="2" maxlength="300" placeholder="Ex.: Como o cliente pretende pagar, se ele disser.">${c.instrucaoBot || ''}</textarea>
        <p class="ajuda">Com instrução, o assistente anota sozinho quando o cliente contar. Em branco, só a equipe preenche.</p></div>
      ${c.id ? html`<label class="checkbox"><input type="checkbox" name="ativo" ${c.ativo ? 'checked' : ''}> Campo ligado (aparece no painel do cliente)</label>` : ''}</form>`,
    rodape: html`<button class="btn btn-contorno" data-fechar>Cancelar</button><button class="btn btn-primario" type="submit" form="form-campo">Salvar</button>`,
  });
  const f = $('#form-campo', m.el);
  f.elements.tipo.addEventListener('change', () => { $('#cp-opcoes-caixa', m.el).hidden = f.elements.tipo.value !== 'lista'; });
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const tipo = c.tipo || f.elements.tipo.value;
    const opcoes = [...new Set(f.elements.opcoes.value.split('\n').map((x) => x.trim()).filter(Boolean))];
    const erros = {};
    if (f.elements.nome.value.trim().length < 2) erros.nome = 'Dê um nome ao campo.';
    if (tipo === 'lista' && opcoes.length < 2) erros.opcoes = 'Escreva pelo menos 2 opções, uma por linha.';
    if (!marcarErros(f, erros)) return;
    await comBotao($('[type=submit]', m.el), async () => {
      try {
        await api.salvarCampo(escopo, { id: c.id, nome: f.elements.nome.value.trim(), tipo, opcoes: tipo === 'lista' ? opcoes : [], instrucaoBot: f.elements.instrucaoBot.value.trim() || null, ativo: c.id ? f.elements.ativo.checked : true });
        m.fechar(); avisar('Campo salvo.'); aoSalvar();
      } catch (err) { if (err.campos) marcarErros(f, err.campos); else avisar(err.message, 'erro'); }
    });
  });
}
