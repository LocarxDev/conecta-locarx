// Acessos da rede (administração): pessoas da matriz e administradores, e a loja de demonstração.
import { api } from '../api.js';
import { html, render, $, $$, icone, iniciais, avisar, abrirModal, confirmar, comBotao, dadosDoForm, marcarErros, emailValido, quando, PERFIS } from '../util.js';

export async function montar(alvo, ctx) {
  render(alvo, html`
    <div class="cabecalho-pagina">
      <div class="titulos"><h1>Acessos da rede</h1><p>Quem da Matriz LocarX e da administração entra no Conecta. A matriz vê os relatórios e a base da rede, mas não lê as conversas das lojas.</p></div>
      <button class="btn btn-primario" id="convidar-rede">${icone('mais')}Convidar</button>
    </div>
    <section class="painel"><div id="lista-rede"><div class="painel-corpo"><div class="esqueleto"></div></div></div></section>
    <section class="painel">
      <div class="painel-cab"><h2>Loja de demonstração</h2></div>
      <div class="painel-corpo form">
        <p>Cria a loja "LocarX Demonstração" com clientes, conversas, funil e reservas fictícios, para apresentar o Conecta aos franqueados. Convide um dono para ela em Lojas.</p>
        <div class="filtros"><button class="btn btn-contorno" id="criar-demo">Criar loja de demonstração</button><button class="btn btn-texto" id="remover-demo">Remover demonstração</button></div>
      </div>
    </section>`);
  const area = $('#lista-rede', alvo);

  async function carregar() {
    try {
      const lista = await api.usuariosRede();
      render(area, html`<div class="tabela-caixa"><table class="tabela">
        <thead><tr><th>Pessoa</th><th>Acesso</th><th>Situação</th><th class="col-opcional">Último acesso</th><th><span class="sr-only">Ações</span></th></tr></thead>
        <tbody>${lista.map((u) => html`<tr>
          <td><div class="pessoa"><span class="avatar">${iniciais(u.nome)}</span><div><strong>${u.nome}${u.id === ctx.usuario.id ? ' (você)' : ''}</strong><span>${u.email}</span></div></div></td>
          <td>${PERFIS[u.perfil]}${u.doisFatores ? '' : html` <span class="selo alerta">sem 2 etapas</span>`}</td>
          <td>${u.status === 'ativo' ? html`<span class="selo ok">Ativo</span>` : u.status === 'convidado' ? html`<span class="selo alerta">Convite enviado</span>` : html`<span class="selo neutro">Desativado</span>`}</td>
          <td class="col-opcional sub">${quando(u.ultimoAcesso)}</td>
          <td><div class="acoes-linha">${u.id !== ctx.usuario.id ? html`<button class="btn btn-texto" data-nivel="${u.id}" data-novo="${u.perfil === 'admin' ? 'matriz' : 'admin'}" title="Mudar o nível de acesso">${u.perfil === 'admin' ? 'Tornar matriz' : 'Tornar administração'}</button>` : ''}${u.id !== ctx.usuario.id && u.status !== 'convidado' ? html`<button class="btn btn-texto" data-situacao="${u.id}" data-novo="${u.status === 'ativo' ? 'inativo' : 'ativo'}">${u.status === 'ativo' ? 'Desativar' : 'Reativar'}</button>` : ''}</div></td>
        </tr>`)}</tbody></table></div>`);
      $$('[data-nivel]', area).forEach((b) => b.addEventListener('click', async () => {
        const novo = b.dataset.novo;
        if (!(await confirmar({ titulo: 'Mudar nível de acesso', texto: novo === 'admin' ? 'Administração vê e altera tudo da rede: lojas, acessos, padrões, monitor e repasses.' : 'Matriz vê a rede (lojas, relatórios, repasses) sem alterar acessos nem padrões. A pessoa é desconectada e entra de novo com o nível novo.', botao: 'Mudar' }))) return;
        try { await api.nivelUsuarioRede(b.dataset.nivel, novo); carregar(); } catch (err) { avisar(err.message, 'erro'); }
      }));
      $$('[data-situacao]', area).forEach((b) => b.addEventListener('click', async () => {
        if (b.dataset.novo === 'inativo' && !(await confirmar({ titulo: 'Desativar acesso', texto: 'A pessoa perde o acesso ao Conecta na hora.', botao: 'Desativar', perigo: true }))) return;
        try { await api.situacaoUsuarioRede(b.dataset.situacao, b.dataset.novo); carregar(); } catch (err) { avisar(err.message, 'erro'); }
      }));
    } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      render(area, html`<div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div>`);
    }
  }

  $('#convidar-rede', alvo).addEventListener('click', () => {
    const m = abrirModal({
      titulo: 'Convidar para a rede',
      corpo: html`<form class="form" id="form-rede-conv" novalidate>
        <div class="campo"><label for="rc-nome">Nome completo</label><input id="rc-nome" name="nome"></div>
        <div class="campo"><label for="rc-email">E-mail</label><input id="rc-email" name="email" type="email"></div>
        <div class="campo"><label for="rc-perfil">Acesso</label><select id="rc-perfil" name="perfil"><option value="matriz">Matriz LocarX (relatórios e base da rede)</option><option value="admin">Administração (tudo)</option></select></div></form>`,
      rodape: html`<button class="btn btn-contorno" data-fechar>Cancelar</button><button class="btn btn-primario" type="submit" form="form-rede-conv">Enviar convite</button>`,
    });
    const f = $('#form-rede-conv', m.el);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = dadosDoForm(f);
      if (!marcarErros(f, { ...(d.nome.trim().length < 2 ? { nome: 'Informe o nome.' } : {}), ...(emailValido(d.email) ? {} : { email: 'Informe um e-mail válido.' }) })) return;
      await comBotao($('[type=submit]', m.el), async () => {
        try {
          const r = await api.convidarRede(d);
          render($('.modal-corpo', m.el), html`<div class="alerta-caixa ${r.emailEnviado === false ? 'erro' : 'ok'}">${icone('email')}<span>${r.emailEnviado === false ? 'O acesso foi criado, mas o e-mail não saiu. Copie o link abaixo.' : `Convite enviado para ${r.email}.`}</span></div>
            <div class="campo"><label for="rc-link">Link do convite (vale 72 horas)</label><input id="rc-link" readonly value="${r.linkConvite}"></div>`);
          render($('.modal-rodape', m.el), html`<button class="btn btn-primario" data-fechar>Concluir</button>`);
          $('[data-fechar]', m.el).addEventListener('click', m.fechar);
          carregar();
        } catch (err) { if (err.campos) marcarErros(f, err.campos); else avisar(err.message, 'erro'); }
      });
    });
  });

  $('#criar-demo', alvo).addEventListener('click', (e) => comBotao(e.currentTarget, async () => {
    try { const r = await api.criarDemonstracao(); avisar('Loja de demonstração criada.'); ctx.navegar(`lojas/${r.id}`); } catch (err) { avisar(err.message, 'erro'); }
  }));
  $('#remover-demo', alvo).addEventListener('click', async () => {
    if (!(await confirmar({ titulo: 'Remover demonstração', texto: 'Apaga a loja de demonstração e todos os dados fictícios dela.', botao: 'Remover', perigo: true }))) return;
    try { await api.removerDemonstracao(); avisar('Demonstração removida.'); } catch (err) { avisar(err.message, 'erro'); }
  });
  carregar();
}
