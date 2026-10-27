// Base de conhecimento: o que o assistente pode responder. Usada pela loja (escopo "loja") e pela rede (escopo "rede").
import { api } from '../api.js';
import { html, render, $, $$, icone, avisar, abrirModal, confirmar, dadosDoForm, marcarErros, comBotao, quando } from '../util.js';

const SITUACAO = {
  aprovado: html`<span class="selo ok">Valendo</span>`,
  pendente: html`<span class="selo alerta">Aguardando aprovação</span>`,
  arquivado: html`<span class="selo neutro">Arquivado</span>`,
};

export async function montar(alvo, ctx) {
  const dono = ctx.usuario.perfil === 'dono';
  render(alvo, html`
    <div class="cabecalho-pagina">
      <div class="titulos"><h1>Base de conhecimento</h1><p>${dono ? 'As informações que o assistente usa para responder os clientes da loja. Ele não responde nada que não esteja aqui ou na base da rede.' : 'Sugira informações para o assistente. O dono da loja aprova antes de valer.'}</p></div>
    </div>
    ${dono ? html`<div id="perguntas"></div>` : ''}
    <div id="base-loja"></div>
    <div id="base-rede"></div>`);
  if (dono) painelPerguntas($('#perguntas', alvo), ctx);
  painelBase($('#base-loja', alvo), { ctx, escopo: 'loja', titulo: 'Informações desta loja', podeEditar: true, podeAprovar: dono });
  painelBase($('#base-rede', alvo), { ctx, escopo: 'rede', titulo: 'Informações da rede LocarX (valem para todas as lojas)', podeEditar: false, podeAprovar: false });
}

async function painelPerguntas(alvo, ctx) {
  let lista = [];
  try { lista = await api.perguntasSemResposta(); } catch { return; }
  if (!lista.length) return render(alvo, '');
  render(alvo, html`<section class="painel">
    <div class="painel-cab"><h2>Perguntas que o assistente não soube responder</h2><span class="selo alerta">${lista.length}</span></div>
    <div class="lista-simples">${lista.slice(0, 20).map((p) => html`<div>
      <div><strong>${p.pergunta}</strong><div class="sub">${quando(p.criadaEm)}${p.conversaId ? html` · <a href="#/conversas/${p.conversaId}">ver conversa</a>` : ''}</div></div>
      <div class="acoes-linha"><button class="btn btn-contorno" data-responder="${p.id}">Ensinar resposta</button><button class="btn btn-texto" data-resolver="${p.id}">Dispensar</button></div>
    </div>`)}</div></section>`);
  $$('[data-resolver]', alvo).forEach((b) => b.addEventListener('click', async () => {
    try { await api.resolverPergunta(b.dataset.resolver); painelPerguntas(alvo, ctx); } catch (err) { avisar(err.message, 'erro'); }
  }));
  $$('[data-responder]', alvo).forEach((b) => b.addEventListener('click', () => {
    const p = lista.find((x) => x.id === b.dataset.responder);
    editarItem({ escopo: 'loja', titulo: p.pergunta.slice(0, 200) }, async () => {
      await api.resolverPergunta(p.id).catch(() => {});
      ctx.navegar('base');
    });
  }));
}

export function editarItem(item, aoSalvar) {
  const m = abrirModal({
    titulo: item.id ? 'Editar informação' : 'Nova informação',
    corpo: html`<form class="form" id="form-item" novalidate>
      <div class="campo"><label for="k-titulo">Assunto ou pergunta</label><input id="k-titulo" name="titulo" value="${item.titulo || ''}" maxlength="200" placeholder="Ex.: Qual o valor da caução?"></div>
      <div class="campo"><label for="k-conteudo">Resposta oficial</label><textarea id="k-conteudo" name="conteudo" rows="8" maxlength="6000">${item.conteudo || ''}</textarea>
        <p class="ajuda">Um assunto por item, com a resposta completa. Escreva a pergunta do jeito que o cliente pergunta: ajuda o assistente a encontrar.</p></div>
    </form>`,
    rodape: html`<button class="btn btn-contorno" data-fechar>Cancelar</button><button class="btn btn-primario" type="submit" form="form-item">Salvar</button>`,
  });
  const f = $('#form-item', m.el);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = dadosDoForm(f);
    const erros = {};
    if (d.titulo.trim().length < 2) erros.titulo = 'Informe o assunto.';
    if (d.conteudo.trim().length < 2) erros.conteudo = 'Escreva a resposta.';
    if (!marcarErros(f, erros)) return;
    await comBotao($('[type=submit]', m.el), async () => {
      try { const r = await api.salvarConhecimento({ ...d, id: item.id, escopo: item.escopo }); m.fechar(); avisar(r.status === 'pendente' ? 'Enviado para aprovação.' : 'Informação salva.'); aoSalvar?.(r); }
      catch (err) { if (err.campos) marcarErros(f, err.campos); else avisar(err.message, 'erro'); }
    });
  });
}

function importar(escopo, aoSalvar) {
  const m = abrirModal({
    titulo: 'Importar texto ou documento',
    corpo: html`<div class="form" id="imp-passo1">
      <p class="sub">Cole um texto (regras, perguntas frequentes) ou envie um PDF ou Word. O Conecta divide em itens para você revisar antes de salvar.</p>
      <div class="campo"><label for="imp-texto">Texto</label><textarea id="imp-texto" rows="8" placeholder="Cole aqui"></textarea></div>
      <div class="campo"><label for="imp-arquivo">Ou envie um arquivo (PDF ou .docx, até 10 MB)</label><input id="imp-arquivo" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></div>
    </div><div id="imp-passo2" hidden></div>`,
    rodape: html`<button class="btn btn-contorno" data-fechar>Cancelar</button><button class="btn btn-primario" id="imp-continuar">Dividir em itens</button>`,
  });
  let blocos = [];
  $('#imp-continuar', m.el).addEventListener('click', async (e) => {
    const botao = e.currentTarget;
    if (blocos.length) {
      const marcados = $$('[data-bloco]', m.el).filter((c) => c.checked).map((c) => {
        const i = Number(c.dataset.bloco);
        return { escopo, titulo: $(`[data-titulo="${i}"]`, m.el).value.trim(), conteudo: $(`[data-conteudo="${i}"]`, m.el).value.trim() };
      }).filter((b) => b.titulo.length >= 2 && b.conteudo.length >= 2);
      if (!marcados.length) return avisar('Marque pelo menos um item.', 'erro');
      return comBotao(botao, async () => {
        try { const r = await api.salvarConhecimentoLote(marcados); m.fechar(); avisar(`${r.salvos} itens salvos.`); aoSalvar?.(); } catch (err) { avisar(err.message, 'erro'); }
      });
    }
    const texto = $('#imp-texto', m.el).value;
    const arq = $('#imp-arquivo', m.el).files[0];
    if (!texto.trim() && !arq) return avisar('Cole um texto ou escolha um arquivo.', 'erro');
    let corpo = { texto };
    if (arq) {
      if (arq.size > 10 * 1024 * 1024) return avisar('Arquivo maior que 10 MB.', 'erro');
      const tipo = /\.pdf$/i.test(arq.name) ? 'pdf' : /\.docx$/i.test(arq.name) ? 'docx' : null;
      if (!tipo) return avisar('Envie um PDF ou um Word (.docx).', 'erro');
      const base64 = await new Promise((ok, falha) => { const l = new FileReader(); l.onload = () => ok(String(l.result).split(',')[1]); l.onerror = falha; l.readAsDataURL(arq); });
      corpo = { arquivo: { tipo, base64 } };
    }
    await comBotao(botao, async () => {
      try {
        const r = await api.importarConhecimento(corpo);
        blocos = r.blocos || [];
        if (!blocos.length) return avisar('Não encontrei conteúdo para importar.', 'erro');
        $('#imp-passo1', m.el).hidden = true;
        const p2 = $('#imp-passo2', m.el); p2.hidden = false;
        render(p2, html`<p class="sub">${blocos.length} itens encontrados. Revise, ajuste e desmarque o que não quiser.</p>
          <div class="lista-blocos">${blocos.map((b, i) => html`<div class="bloco-import">
            <label class="checkbox"><input type="checkbox" data-bloco="${i}" checked> Incluir</label>
            <input data-titulo="${i}" value="${b.titulo}" maxlength="200" aria-label="Assunto do item ${i + 1}">
            <textarea data-conteudo="${i}" rows="4" maxlength="6000" aria-label="Conteúdo do item ${i + 1}">${b.conteudo}</textarea></div>`)}</div>`);
        botao.textContent = 'Salvar itens marcados';
      } catch (err) { avisar(err.message, 'erro'); }
    });
  });
}

export function painelBase(alvo, { ctx, escopo, titulo, podeEditar, podeAprovar, importarPortal = false }) {
  let lista = [], filtro = 'todos', busca = '';
  render(alvo, html`<section class="painel">
    <div class="painel-cab"><h2>${titulo}</h2>
      <div class="filtros">
        <label class="busca"><span class="sr-only">Buscar</span>${icone('busca')}<input type="search" data-busca placeholder="Buscar"></label>
        ${podeAprovar ? html`<div class="abas">${[['todos', 'Todas'], ['pendente', 'Para aprovar']].map(([v, t]) => html`<button data-filtro="${v}" class="${v === filtro ? 'ativa' : ''}">${t}</button>`)}</div>` : ''}
        ${importarPortal ? html`<button class="btn btn-contorno" data-importar-portal title="Traz as políticas oficiais do portal LocarX (clientes, cancelamento, pagamento, km, proteções, serviços) como itens pendentes para você aprovar">${icone('reservas')}Importar do portal LocarX</button>` : ''}
        ${escopo === 'loja' && podeEditar ? html`<button class="btn btn-contorno" data-importar-filial title="Traz do portal o endereço, os horários e as políticas da filial como itens pendentes">${icone('reservas')}Importar da filial</button>` : ''}
        ${podeEditar ? html`<button class="btn btn-contorno" data-importar>Importar arquivo</button><button class="btn btn-primario" data-novo>${icone('mais')}Nova informação</button>` : ''}
      </div></div>
    <div data-lista><div class="painel-corpo"><div class="esqueleto"></div></div></div></section>`);
  const area = $('[data-lista]', alvo);

  function desenhar() {
    const t = busca.toLowerCase();
    const vis = lista.filter((k) => filtro === 'todos' || k.status === filtro).filter((k) => !t || k.titulo.toLowerCase().includes(t) || k.conteudo.toLowerCase().includes(t));
    if (!vis.length) {
      render(area, html`<div class="estado">${icone('info')}<h3>${lista.length ? 'Nada encontrado' : 'Nenhuma informação ainda'}</h3><p>${lista.length ? 'Nenhum item corresponde ao filtro.' : escopo === 'loja' ? 'Cadastre caução, documentos, endereço, horário, quilometragem e outras regras da loja.' : 'A matriz cadastra aqui as regras gerais da LocarX.'}</p></div>`);
      return;
    }
    render(area, html`<div class="lista-base">${vis.map((k) => html`<article class="item-base">
      <div class="item-base-cab"><h3>${k.titulo}</h3>${SITUACAO[k.status]}</div>
      <p>${k.conteudo.length > 400 ? k.conteudo.slice(0, 400) + '…' : k.conteudo}</p>
      <div class="item-base-rodape"><span class="sub">${k.autor ? `${k.autor} · ` : ''}${quando(k.atualizadoEm)}</span>
        <span class="acoes-linha">
          ${podeAprovar && k.status === 'pendente' ? html`<button class="btn btn-primario" data-aprovar="${k.id}">Aprovar</button>` : ''}
          ${podeEditar ? html`<button class="btn btn-texto" data-editar="${k.id}">Editar</button>` : ''}
          ${podeAprovar ? html`<button class="btn btn-texto" data-arquivar="${k.id}">Arquivar</button>` : ''}
        </span></div></article>`)}</div>`);
    $$('[data-editar]', area).forEach((b) => b.addEventListener('click', () => editarItem(lista.find((k) => k.id === b.dataset.editar), carregar)));
    $$('[data-aprovar]', area).forEach((b) => b.addEventListener('click', async () => { try { await api.acaoConhecimento(b.dataset.aprovar, 'aprovar'); avisar('Aprovado. Já vale para o assistente.'); carregar(); } catch (err) { avisar(err.message, 'erro'); } }));
    $$('[data-arquivar]', area).forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmar({ titulo: 'Arquivar informação', texto: 'O assistente deixa de usar esta informação.', botao: 'Arquivar', perigo: true }))) return;
      try { await api.acaoConhecimento(b.dataset.arquivar, 'arquivar'); carregar(); } catch (err) { avisar(err.message, 'erro'); }
    }));
  }

  async function carregar() {
    try { lista = await api.conhecimento({ escopo }); desenhar(); } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      render(area, html`<div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div>`);
    }
  }
  $('[data-busca]', alvo).addEventListener('input', (e) => { busca = e.target.value; desenhar(); });
  $$('[data-filtro]', alvo).forEach((b) => b.addEventListener('click', () => { filtro = b.dataset.filtro; $$('[data-filtro]', alvo).forEach((x) => x.classList.toggle('ativa', x === b)); desenhar(); }));
  $('[data-novo]', alvo)?.addEventListener('click', () => editarItem({ escopo }, carregar));
  $('[data-importar]', alvo)?.addEventListener('click', () => importar(escopo, carregar));
  // loja: importa endereço/horários/políticas de UMA filial (escolhe quando a franquia tem mais de uma)
  $('[data-importar-filial]', alvo)?.addEventListener('click', async (e) => {
    const botao = e.currentTarget;
    let filiais = []; try { filiais = await api.filiais(); } catch { /* segue sem lista */ }
    const importar = (filialId) => comBotao(botao, async () => {
      try {
        const r = await api.importarPortalLoja(filialId);
        avisar(r.incluidos.length ? `${r.incluidos.length} item(ns) da filial ${r.filial} entraram como pendentes.${r.ignorados.length ? ` ${r.ignorados.length} já existiam.` : ''} Revise e aprove.` : `Nada novo: a filial ${r.filial} já está na base.`);
        carregar();
      } catch (err) { if (err.status === 401) return ctx.sessaoExpirou(); avisar(err.message, 'erro'); }
    });
    if (filiais.length < 2) return importar(undefined);
    const m = abrirModal({
      titulo: 'Importar da filial',
      corpo: html`<form class="form" id="form-imp-filial"><div class="campo"><label for="imp-filial">Qual filial?</label><select id="imp-filial" name="filialId">${filiais.map((f) => html`<option value="${f.id}">${f.nome}${f.principal ? ' (principal)' : ''}</option>`)}</select><p class="ajuda">Cada filial entra com os próprios itens (ex.: "Endereço e horários — Centro").</p></div></form>`,
      rodape: html`<button class="btn btn-contorno" data-fechar>Cancelar</button><button class="btn btn-primario" form="form-imp-filial" type="submit">Importar</button>`,
    });
    $('#form-imp-filial', m.el).addEventListener('submit', (ev) => { ev.preventDefault(); const id = ev.target.elements.filialId.value; m.fechar(); importar(id); });
  });
  $('[data-importar-portal]', alvo)?.addEventListener('click', async (e) => {
    const botao = e.currentTarget;
    // rede: escolhe de qual filial do portal ler as políticas (padrão: primeira loja ativa)
    let lista = []; try { lista = await api.filiaisLocarx(); } catch { /* sem lista: usa o padrão */ }
    let branchId;
    if (lista.length > 1) {
      branchId = await new Promise((resolve) => {
        const m = abrirModal({
          titulo: 'Importar políticas do portal',
          corpo: html`<form class="form" id="form-imp-rede"><div class="campo"><label for="imp-branch">Ler as políticas de qual filial?</label><select id="imp-branch" name="branchId">${lista.map((f) => html`<option value="${f.branchId ?? f.id}">${f.nome || f.name} (${f.branchId ?? f.id})</option>`)}</select><p class="ajuda">As políticas da rede costumam ser iguais em todas; escolha uma de referência.</p></div></form>`,
          rodape: html`<button class="btn btn-contorno" data-fechar>Cancelar</button><button class="btn btn-primario" form="form-imp-rede" type="submit">Importar</button>`,
        });
        $$('[data-fechar]', m.el).forEach((b) => b.addEventListener('click', () => resolve(null)));
        $('#form-imp-rede', m.el).addEventListener('submit', (ev) => { ev.preventDefault(); const v = Number(ev.target.elements.branchId.value); m.fechar(); resolve(v); });
      });
      if (branchId === null) return;
    }
    comBotao(botao, async () => {
    try {
      const r = await api.importarPoliticasLocarx(branchId);
      avisar(r.incluidos.length ? `${r.incluidos.length} item(ns) do portal entraram como pendentes (filial ${r.filial}).${r.ignorados.length ? ` ${r.ignorados.length} já existiam.` : ''} Revise e aprove.` : 'Nada novo: todas as políticas do portal já estão na base.');
      if (r.incluidos.length && podeAprovar) { filtro = 'pendente'; $$('[data-filtro]', alvo).forEach((x) => x.classList.toggle('ativa', x.dataset.filtro === 'pendente')); }
      carregar();
    } catch (err) { if (err.status === 401) return ctx.sessaoExpirou(); avisar(err.message, 'erro'); }
    });
  });
  carregar();
}
