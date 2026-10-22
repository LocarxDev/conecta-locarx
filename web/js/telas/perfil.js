// Meu perfil: dados pessoais, senha, verificação em 2 etapas e sessões.
import { api } from '../api.js';
import { html, render, $, icone, avisar, confirmar, dadosDoForm, marcarErros, comBotao, emailValido, forcaSenha, ligarMostrarSenha, abrirModal, seguro, PERFIS } from '../util.js';

// Desenho ilustrativo de QR code (no back-end real o servidor gera o QR verdadeiro).
function qrIlustrativo() {
  let quadrados = '';
  let semente = 7;
  for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) {
    const canto = (x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12);
    semente = (semente * 9301 + 49297) % 233280;
    if (!canto && semente / 233280 > 0.52) quadrados += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  }
  const olho = (x, y) => `<rect x="${x}" y="${y}" width="7" height="7"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" class="vazio"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3"/>`;
  return seguro(`<div class="qr-falso"><svg viewBox="0 0 21 21" fill="currentColor" role="img" aria-label="QR code de exemplo">${olho(0, 0)}${olho(14, 0)}${olho(0, 14)}${quadrados}</svg></div>`);
}

export function montar(alvo, ctx) {
  const u = ctx.usuario;
  const obrigatorio = ['admin', 'matriz', 'dono'].includes(u.perfil);

  render(alvo, html`
    <div class="cabecalho-pagina"><div class="titulos"><h1>Meu perfil</h1><p>${PERFIS[u.perfil]}${u.loja ? ` · ${u.loja.nome}` : ''}</p></div></div>
    <div class="perfil-grade">
      <section class="painel">
        <div class="painel-cab"><h2>Dados pessoais</h2></div>
        <form class="form painel-corpo" id="form-dados" novalidate>
          <div class="campo"><label for="pf-nome">Nome</label><input id="pf-nome" name="nome" value="${u.nome}" autocomplete="name" required></div>
          <div class="campo"><label for="pf-email">E-mail de acesso</label><input id="pf-email" name="email" type="email" value="${u.email}" autocomplete="email" required></div>
          <div class="campo" id="campo-senha-email" hidden><label for="pf-senha-email">Sua senha atual</label><input id="pf-senha-email" name="senhaAtual" type="password" autocomplete="current-password"><p class="ajuda">Para trocar o e-mail de acesso, confirme sua senha.</p></div>
          <div><button class="btn btn-primario" type="submit">Salvar dados</button></div>
        </form>
      </section>

      <section class="painel">
        <div class="painel-cab"><h2>Trocar senha</h2></div>
        <form class="form painel-corpo" id="form-senha" novalidate>
          <div class="campo"><label for="pf-atual">Senha atual</label><input id="pf-atual" name="atual" type="password" autocomplete="current-password" required></div>
          <div class="campo"><label for="pf-nova">Nova senha</label>
            <div class="senha-caixa"><input id="pf-nova" name="nova" type="password" autocomplete="new-password" required><button type="button" class="btn btn-texto" data-mostrar-senha aria-pressed="false">Mostrar</button></div>
            <p class="ajuda">Pelo menos 10 caracteres, com letras e números. Ao trocar, os outros aparelhos são desconectados.</p></div>
          <div><button class="btn btn-primario" type="submit">Trocar senha</button></div>
        </form>
      </section>

      <section class="painel">
        <div class="painel-cab"><h2>Verificação em 2 etapas</h2>${u.doisFatores ? html`<span class="selo ok">Ativada</span>` : html`<span class="selo ${obrigatorio ? 'alerta' : 'neutro'}">${obrigatorio ? 'Obrigatória' : 'Desativada'}</span>`}</div>
        <div class="painel-corpo form">
          <p>Além da senha, o Conecta pede um código de 6 números gerado no celular, pelo Google Authenticator ou outro app autenticador.</p>
          ${u.doisFatores
            ? (obrigatorio ? html`<p class="ajuda">Para o seu tipo de acesso a verificação não pode ser desligada.</p>` : html`<div><button class="btn btn-contorno" id="desligar-2fa">Desativar</button></div>`)
            : html`<div><button class="btn btn-primario" id="ligar-2fa">${icone('escudo')}Ativar verificação</button></div>`}
        </div>
      </section>

      <section class="painel">
        <div class="painel-cab"><h2>Aparelhos conectados</h2></div>
        <div class="painel-corpo form">
          <p>Perdeu o celular ou entrou num computador que não é seu? Desconecte todos os aparelhos. Você vai precisar entrar de novo.</p>
          <div><button class="btn btn-perigo" id="sair-todos">${icone('sair')}Sair de todos os aparelhos</button></div>
        </div>
      </section>
    </div>`);

  // dados
  const fDados = $('#form-dados', alvo);
  fDados.elements.email.addEventListener('input', (e) => {
    $('#campo-senha-email', fDados).hidden = e.target.value.trim().toLowerCase() === u.email;
  });
  fDados.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = dadosDoForm(fDados);
    const erros = {};
    if (!d.nome.trim()) erros.nome = 'Informe seu nome.';
    if (!emailValido(d.email)) erros.email = 'Informe um e-mail válido.';
    else if (d.email.trim().toLowerCase() !== u.email && !d.senhaAtual) erros.senhaAtual = 'Confirme sua senha atual.';
    if (!marcarErros(fDados, erros)) return;
    await comBotao($('[type=submit]', fDados), async () => {
      try { const novo = await api.atualizarPerfil(d); avisar('Dados salvos.'); ctx.atualizarUsuario(novo); } catch (err) { if (err.campos) marcarErros(fDados, err.campos); else avisar(err.message, 'erro'); }
    });
  });

  // senha
  const fSenha = $('#form-senha', alvo);
  ligarMostrarSenha(fSenha);
  fSenha.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = dadosDoForm(fSenha);
    const erros = {};
    if (!d.atual) erros.atual = 'Informe a senha atual.';
    const falta = forcaSenha(d.nova);
    if (falta.length) erros.nova = 'A senha precisa ' + falta.join(' e ') + '.';
    if (!marcarErros(fSenha, erros)) return;
    await comBotao($('[type=submit]', fSenha), async () => {
      try { await api.trocarSenha(d); fSenha.reset(); avisar('Senha trocada.'); } catch (err) { if (err.campos) marcarErros(fSenha, err.campos); else avisar(err.message, 'erro'); }
    });
  });

  // 2 etapas
  $('#ligar-2fa', alvo)?.addEventListener('click', async () => {
    let dados;
    try { dados = await api.iniciar2fa(); } catch (err) { return avisar(err.message, 'erro'); }
    const modal = abrirModal({
      titulo: 'Ativar verificação em 2 etapas',
      corpo: html`<ol class="passos">
          <li><div>Instale um app autenticador no celular<span class="sub">Google Authenticator, Microsoft Authenticator ou similar</span></div></li>
          <li><div>No app, leia o QR code abaixo<span class="sub">Ou digite a chave manualmente</span></div></li>
        </ol>
        <div class="filtros">${dados.qr ? html`<div class="qr-falso"><img src="${dados.qr}" alt="QR code para o app autenticador" width="132" height="132"></div>` : qrIlustrativo()}<div class="form"><span class="sub">Chave</span><span class="chave-2fa">${dados.chave}</span></div></div>
        <form class="form" id="form-ativar" novalidate>
          <div class="campo"><label for="cod-2fa">Código de 6 números que aparece no app</label><input id="cod-2fa" name="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></div>
          ${dados.codigoExemplo ? html`<p class="ajuda">Modo demonstração: use ${dados.codigoExemplo}.</p>` : ''}
        </form>`,
      rodape: html`<button class="btn btn-contorno" data-fechar>Cancelar</button><button class="btn btn-primario" type="submit" form="form-ativar">Ativar</button>`,
    });
    const f = $('#form-ativar', modal.el);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const codigo = f.elements.codigo.value.replace(/\D/g, '');
      if (!marcarErros(f, codigo.length === 6 ? {} : { codigo: 'Digite os 6 números.' })) return;
      await comBotao($('[type=submit]', modal.el), async () => {
        try { const novo = await api.ativar2fa({ codigo }); modal.fechar(); avisar('Verificação em 2 etapas ativada.'); ctx.atualizarUsuario(novo); } catch (err) { if (err.campos) marcarErros(f, err.campos); else avisar(err.message, 'erro'); }
      });
    });
  });
  $('#desligar-2fa', alvo)?.addEventListener('click', async () => {
    if (!(await confirmar({ titulo: 'Desativar verificação', texto: 'Seu acesso fica protegido só pela senha.', botao: 'Desativar', perigo: true }))) return;
    try { const novo = await api.desativar2fa(); ctx.atualizarUsuario(novo); avisar('Verificação desativada.'); } catch (err) { avisar(err.message, 'erro'); }
  });

  // sair de todos
  $('#sair-todos', alvo).addEventListener('click', async () => {
    if (!(await confirmar({ titulo: 'Sair de todos os aparelhos', texto: 'Todos os aparelhos conectados com o seu acesso, incluindo este, serão desconectados.', botao: 'Sair de todos', perigo: true }))) return;
    try { await api.sairDeTodos(); } catch { /* segue para o login de qualquer forma */ }
    ctx.sessaoExpirou();
  });
}
