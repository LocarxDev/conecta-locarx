// Equipe da loja: tela "Atendentes" do dono e o bloco de usuários no detalhe da loja (administração).
import { api } from '../api.js';
import { html, render, $, $$, icone, iniciais, quando, avisar, abrirModal, confirmar, dadosDoForm, marcarErros, comBotao, emailValido } from '../util.js';

const SITUACAO = {
  ativo: html`<span class="selo ok">Ativo</span>`,
  convidado: html`<span class="selo alerta">Convite enviado</span>`,
  inativo: html`<span class="selo neutro">Desativado</span>`,
};
const PAPEL = { dono: 'Dono da loja', atendente: 'Atendente' };

export async function montar(alvo, ctx) {
  render(alvo, html`
    <div class="cabecalho-pagina">
      <div class="titulos"><h1>Atendentes</h1><p>Quem atende os clientes da ${ctx.usuario.loja?.nome || 'sua loja'} no Conecta.</p></div>
      <button class="btn btn-primario" id="convidar-topo">${icone('mais')}Convidar atendente</button>
    </div>
    <div id="roleta"></div>
    <div id="equipe"></div>`);
  const painel = painelEquipe($('#equipe', alvo), { ctx, lojaId: null, podeGerir: true, podeConvidarDono: false });
  $('#convidar-topo', alvo).addEventListener('click', painel.convidar);
  painelRoleta($('#roleta', alvo), ctx);
}

// Roleta de atendimento: para quem vão as conversas quando o assistente chama um atendente.
const MODOS = [
  ['rodizio', 'Rodízio', 'Uma conversa para cada pessoa disponível, na ordem.'],
  ['menos_ocupado', 'Quem está com menos conversas', 'Vai para quem tem menos atendimentos em andamento.'],
  ['desligada', 'Desligada', 'A conversa fica em "Aguardando" e quem pegar primeiro atende.'],
];
async function painelRoleta(alvo, ctx) {
  let r;
  try { r = await api.roleta(); } catch (err) { return render(alvo, html`<div class="alerta-caixa erro">${icone('alerta')}<span>${err.message}</span></div>`); }
  const situacao = (u) => (!u.marcouDisponivel ? html`<span class="selo neutro">Em pausa</span>`
    : u.online ? html`<span class="selo ok">Disponível</span>` : html`<span class="selo alerta" title="Marcou disponível, mas está sem o Conecta aberto">Disponível, fora do Conecta</span>`);
  render(alvo, html`<section class="painel">
    <div class="painel-cab"><div><h2>${icone('roleta')} Roleta de atendimento</h2>
      <span class="sub">Quando o assistente chama um atendente (ou a conversa chega sem assistente), ela vai para alguém que está <strong>Disponível</strong>. Quem entra no Conecta já fica Disponível; cada pessoa pode pausar no botão do topo da tela. O dono pode desligar a própria participação (só ele escolhe isso para si): continua podendo abrir qualquer conversa e tocar em <strong>Assumir</strong>.${r.aguardando ? ` Agora: ${r.aguardando} conversa(s) aguardando.` : ''}</span></div></div>
    <form class="painel-corpo form" id="form-roleta" novalidate>
      <fieldset class="opcoes-modo"><legend class="rotulo-campo">Como distribuir</legend>
        ${MODOS.map(([v, t, ajuda]) => html`<label class="opcao-modo"><input type="radio" name="modo" value="${v}" ${r.modo === v ? 'checked' : ''}><span><strong>${t}</strong><span class="sub">${ajuda}</span></span></label>`)}
      </fieldset>
      <div class="campo campo-curto"><label for="r-limite">Máximo de conversas em andamento por pessoa</label>
        <input id="r-limite" name="limite" type="number" min="0" max="100" value="${r.limite}" inputmode="numeric"><p class="ajuda">0 = sem limite. Quem chegar no limite deixa de receber até encerrar alguma.</p></div>
      <div class="tabela-caixa"><table class="tabela">
        <thead><tr><th>Pessoa</th><th>Situação</th><th class="col-opcional">Em andamento</th><th>Participa da roleta</th></tr></thead>
        <tbody>${r.equipe.map((u) => html`<tr><td><strong>${u.nome}</strong>${u.id === ctx.usuario.id ? html` <span class="sub">(você)</span>` : ''}<br><span class="sub">${u.perfil === 'dono' ? 'Dono da loja' : 'Atendente'}</span>${u.perfil === 'dono' && !u.naRoleta ? html`<br><span class="sub">Fora da roleta: só atende quando assumir uma conversa.</span>` : ''}</td>
          <td>${situacao(u)}</td><td class="col-opcional num">${u.emAndamento}</td>
          <td><label class="interruptor"><input type="checkbox" data-participa="${u.id}" ${u.naRoleta ? 'checked' : ''}><span class="sr-only">${u.nome} participa da roleta</span><span class="trilho"></span></label></td></tr>`)}</tbody></table></div>
      <div><button class="btn btn-primario" type="submit">Salvar roleta</button></div>
    </form></section>`);
  const f = $('#form-roleta', alvo);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const limite = Number(f.elements.limite.value || 0);
    if (!Number.isInteger(limite) || limite < 0 || limite > 100) return marcarErros(f, { limite: 'Use um número de 0 a 100.' });
    const participantes = Object.fromEntries($$('[data-participa]', f).map((c) => [c.dataset.participa, c.checked]));
    await comBotao($('[type=submit]', f), async () => {
      try { await api.salvarRoleta({ modo: f.elements.modo.value, limite, participantes }); avisar('Roleta salva.'); painelRoleta(alvo, ctx); }
      catch (err) { avisar(err.message, 'erro'); }
    });
  });
}

export function painelEquipe(alvo, { ctx, lojaId, podeGerir, podeConvidarDono, titulo = 'Equipe' }) {
  let lista = [];
  let filtro = 'todos';
  let busca = '';

  render(alvo, html`
    <section class="painel">
      <div class="painel-cab">
        <h2>${titulo}</h2>
        <div class="filtros">
          <label class="busca"><span class="sr-only">Buscar por nome ou e-mail</span>${icone('busca')}<input id="busca-equipe" type="search" placeholder="Buscar por nome ou e-mail"></label>
          <div class="abas" role="tablist" aria-label="Filtrar por situação">
            ${[['todos', 'Todos'], ['ativo', 'Ativos'], ['convidado', 'Convites'], ['inativo', 'Desativados']].map(([v, t]) =>
              html`<button role="tab" data-filtro="${v}" class="${v === filtro ? 'ativa' : ''}" aria-selected="${v === filtro}">${t}</button>`)}
          </div>
          ${podeGerir && lojaId ? html`<button class="btn btn-contorno" data-convidar>${icone('mais')}Convidar</button>` : ''}
        </div>
      </div>
      <div id="tabela-equipe"><div class="painel-corpo"><div class="esqueleto"></div></div></div>
    </section>`);

  const area = $('#tabela-equipe', alvo);

  function desenhar() {
    const termo = busca.trim().toLowerCase();
    const visiveis = lista
      .filter((p) => filtro === 'todos' || p.status === filtro)
      .filter((p) => !termo || p.nome.toLowerCase().includes(termo) || p.email.includes(termo))
      .sort((a, b) => (a.perfil === 'dono' ? -1 : 0) - (b.perfil === 'dono' ? -1 : 0) || a.nome.localeCompare(b.nome, 'pt-BR'));

    if (!lista.length) {
      render(area, html`<div class="estado">${icone('atendentes')}<h3>Ninguém na equipe ainda</h3><p>Convide as pessoas que vão atender os clientes. Elas recebem um link por e-mail para criar a senha.</p>${podeGerir ? html`<button class="btn btn-primario" data-convidar>${icone('mais')}Convidar a primeira pessoa</button>` : ''}</div>`);
    } else if (!visiveis.length) {
      render(area, html`<div class="estado">${icone('busca')}<h3>Nada encontrado</h3><p>Nenhuma pessoa corresponde a essa busca ou filtro.</p></div>`);
    } else {
      render(area, html`
        <div class="tabela-caixa"><table class="tabela">
          <thead><tr><th>Pessoa</th><th class="col-opcional">Função</th><th>Situação</th><th class="col-opcional">Último acesso</th>${podeGerir ? html`<th><span class="sr-only">Ações</span></th>` : ''}</tr></thead>
          <tbody>
            ${visiveis.map((p) => html`<tr>
              <td><div class="pessoa"><span class="avatar">${iniciais(p.nome)}</span><div><strong>${p.nome}${p.id === ctx.usuario.id ? ' (você)' : ''}</strong><span>${p.email}</span></div></div></td>
              <td class="col-opcional">${PAPEL[p.perfil] || p.perfil}</td>
              <td>${SITUACAO[p.status]}</td>
              <td class="col-opcional sub">${quando(p.ultimoAcesso)}</td>
              ${podeGerir ? html`<td><div class="acoes-linha">
                ${p.id === ctx.usuario.id ? '' : html`<button class="btn btn-texto btn-icone" data-acao="opcoes" data-id="${p.id}" aria-label="Opções de ${p.nome}" title="Opções">${icone('editar')}</button>`}
              </div></td>` : ''}
            </tr>`)}
          </tbody>
        </table></div>`);
    }
    $$('[data-convidar]', alvo).forEach((b) => { b.onclick = convidar; });
    $$('[data-acao="opcoes"]', area).forEach((b) => b.addEventListener('click', () => opcoes(lista.find((p) => p.id === b.dataset.id))));
  }

  async function carregar() {
    try {
      lista = await api.listarEquipe(lojaId);
      desenhar();
    } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      render(area, html`<div class="estado">${icone('alerta')}<h3>Não foi possível carregar a equipe</h3><p>${err.message}</p><button class="btn btn-contorno" id="tentar-equipe">Tentar de novo</button></div>`);
      $('#tentar-equipe', area).addEventListener('click', carregar);
    }
  }

  $('#busca-equipe', alvo).addEventListener('input', (e) => { busca = e.target.value; desenhar(); });
  $$('[data-filtro]', alvo).forEach((b) => b.addEventListener('click', () => {
    filtro = b.dataset.filtro;
    $$('[data-filtro]', alvo).forEach((x) => { x.classList.toggle('ativa', x === b); x.setAttribute('aria-selected', String(x === b)); });
    desenhar();
  }));

  function mostrarLinkConvite(modal, pessoa, link, enviado) {
    render($('.modal-corpo', modal.el), html`
      ${enviado === false
        ? html`<div class="alerta-caixa erro">${icone('alerta')}<span>O acesso foi criado, mas o e-mail para ${pessoa.email} não saiu. Copie o link abaixo e mande para a pessoa. O link vale por 72 horas.</span></div>`
        : html`<div class="alerta-caixa ok">${icone('email')}<span>Convite enviado para ${pessoa.email}. O link vale por 72 horas.</span></div>`}
      <div class="campo">
        <label for="link-convite">Se preferir, copie o link e mande pelo WhatsApp</label>
        <input id="link-convite" readonly value="${link}">
      </div>`);
    render($('.modal-rodape', modal.el), html`<button class="btn btn-contorno" data-copiar>${icone('copiar')}Copiar link</button><button class="btn btn-primario" data-fechar>Concluir</button>`);
    $('.modal-rodape [data-fechar]', modal.el).addEventListener('click', modal.fechar);   // o botão novo do rodapé (o X do topo já tem o seu)
    $('[data-copiar]', modal.el).addEventListener('click', async () => {
      const campo = $('#link-convite', modal.el);
      try { await navigator.clipboard.writeText(campo.value); avisar('Link copiado.'); } catch { campo.select(); avisar('Selecione e copie o link (Ctrl+C).'); }
    });
  }

  function convidar() {
    const modal = abrirModal({
      titulo: 'Convidar para a equipe',
      corpo: html`<form class="form" id="form-convite" novalidate>
        <div class="campo"><label for="c-nome">Nome completo</label><input id="c-nome" name="nome" autocomplete="off" required></div>
        <div class="campo"><label for="c-email">E-mail</label><input id="c-email" name="email" type="email" inputmode="email" autocomplete="off" required>
          <p class="ajuda">A pessoa recebe neste e-mail o link para criar a senha.</p></div>
        ${podeConvidarDono ? html`<div class="campo"><label for="c-perfil">Função</label><select id="c-perfil" name="perfil"><option value="atendente">Atendente</option><option value="dono">Dono da loja</option></select></div>` : ''}
      </form>`,
      rodape: html`<button class="btn btn-contorno" data-fechar>Cancelar</button><button class="btn btn-primario" form="form-convite" type="submit">Enviar convite</button>`,
    });
    const form = $('#form-convite', modal.el);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = dadosDoForm(form);
      const erros = {};
      if (!d.nome.trim()) erros.nome = 'Informe o nome.';
      if (!emailValido(d.email)) erros.email = 'Informe um e-mail válido.';
      if (!marcarErros(form, erros)) return;
      await comBotao($('[type=submit]', modal.el), async () => {
        try {
          const novo = await api.convidar({ ...d, perfil: d.perfil || 'atendente', lojaId });
          lista.push(novo); desenhar();
          mostrarLinkConvite(modal, novo, novo.linkConvite, novo.emailEnviado);
        } catch (err) {
          if (err.campos) marcarErros(form, err.campos); else avisar(err.message, 'erro');
        }
      });
    });
  }

  function opcoes(p) {
    const modal = abrirModal({
      titulo: p.nome,
      corpo: html`<form class="form" id="form-pessoa" novalidate>
        <div class="campo"><label for="p-nome">Nome</label><input id="p-nome" name="nome" value="${p.nome}" required></div>
        <div class="campo"><label for="p-email">E-mail</label><input id="p-email" value="${p.email}" disabled><p class="ajuda">O e-mail é trocado pela própria pessoa, em Meu perfil.</p></div>
        <div class="campo"><label for="p-perfil">Nível de acesso</label>
          <select id="p-perfil" name="perfil"><option value="atendente" ${p.perfil === 'atendente' ? 'selected' : ''}>Atendente — conversas, clientes, funil, cotação e reservas</option><option value="dono" ${p.perfil === 'dono' ? 'selected' : ''}>Dono da loja — tudo da loja: equipe, WhatsApp, assistente, relatórios e pagamentos</option></select>
          <p class="ajuda">Ao mudar o nível, a pessoa é desconectada e entra de novo já com o acesso novo.</p></div>
        <div class="lista-simples painel">
          ${p.status === 'convidado' ? html`<div><span>Convite ainda não aceito</span><button type="button" class="btn btn-texto" data-reenviar>Reenviar convite</button></div>` : ''}
          ${p.status === 'ativo' ? html`<div><span>Bloquear o acesso desta pessoa</span><button type="button" class="btn btn-texto" data-situacao="inativo">Desativar</button></div>` : ''}
          ${p.status === 'inativo' ? html`<div><span>Liberar o acesso de novo</span><button type="button" class="btn btn-texto" data-situacao="ativo">Reativar</button></div>` : ''}
          <div><span>Remover da equipe</span><button type="button" class="btn btn-texto" data-excluir>Excluir</button></div>
        </div>
      </form>`,
      rodape: html`<button class="btn btn-contorno" data-fechar>Cancelar</button><button class="btn btn-primario" form="form-pessoa" type="submit">Salvar</button>`,
    });
    const form = $('#form-pessoa', modal.el);
    const trocar = (novo) => { lista = lista.map((x) => (x.id === novo.id ? novo : x)); desenhar(); };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nome = form.elements.nome.value;
      const perfil = form.elements.perfil.value;
      if (!marcarErros(form, nome.trim() ? {} : { nome: 'Informe o nome.' })) return;
      await comBotao($('[type=submit]', modal.el), async () => {
        try { trocar(await api.atualizarUsuario(p.id, { nome, ...(perfil !== p.perfil ? { perfil } : {}) })); modal.fechar(); avisar(perfil !== p.perfil ? `${p.nome} agora é ${PAPEL[perfil].toLowerCase()}.` : 'Alterações salvas.'); } catch (err) { avisar(err.message, 'erro'); }
      });
    });
    $('[data-reenviar]', form)?.addEventListener('click', async () => {
      try { const r = await api.reenviarConvite(p.id); mostrarLinkConvite(modal, p, r.linkConvite, r.emailEnviado); } catch (err) { avisar(err.message, 'erro'); }
    });
    $('[data-situacao]', form)?.addEventListener('click', async (e) => {
      const novaSituacao = e.currentTarget.dataset.situacao;
      modal.fechar();
      if (novaSituacao === 'inativo' && !(await confirmar({ titulo: 'Desativar acesso', texto: `${p.nome} não vai mais conseguir entrar no Conecta. O histórico de atendimentos continua guardado.`, botao: 'Desativar', perigo: true }))) return;
      try { trocar(await api.atualizarUsuario(p.id, { status: novaSituacao })); avisar(novaSituacao === 'inativo' ? 'Acesso desativado.' : 'Acesso reativado.'); } catch (err) { avisar(err.message, 'erro'); }
    });
    $('[data-excluir]', form).addEventListener('click', async () => {
      modal.fechar();
      if (!(await confirmar({ titulo: 'Excluir da equipe', texto: `Excluir ${p.nome}? Isso não pode ser desfeito.`, botao: 'Excluir', perigo: true }))) return;
      try { await api.excluirUsuario(p.id); lista = lista.filter((x) => x.id !== p.id); desenhar(); avisar('Pessoa excluída.'); } catch (err) { avisar(err.message, 'erro'); }
    });
  }

  carregar();
  return { convidar, recarregar: carregar };
}
