// Telas de acesso: login, verificação em 2 etapas, esqueci minha senha, definir senha (convite).
import { api, USAR_EXEMPLO } from '../api.js';
import { html, render, $, $$, icone, dadosDoForm, marcarErros, comBotao, emailValido, forcaSenha, ligarMostrarSenha } from '../util.js';

function moldura(conteudo) {
  return html`
    <div class="acesso">
      <section class="acesso-marca" aria-hidden="true">
        <img class="logo" src="/assets/logo-locarx-branca.png" alt="" width="200" height="79">
        <div class="chamada">
          <h1>Cada cliente atendido. <span>Cada reserva</span> no portal.</h1>
          <p>Atendimento pelo WhatsApp com assistente virtual, CRM e reservas direto no portal LocarX, para todas as lojas da rede.</p>
        </div>
        <p class="rodape-marca">Conecta LocarX · plataforma exclusiva da rede</p>
        <img class="x-fundo" src="/assets/icone-512.png" alt="">
      </section>
      <section class="acesso-form">
        <div class="acesso-caixa">
          <img class="logo-movel logo-tema-claro" src="/assets/logo-locarx.png" alt="LocarX" width="150" height="59">
          <img class="logo-movel logo-tema-escuro" src="/assets/logo-locarx-branca.png" alt="LocarX" width="150" height="59">
          ${conteudo}
        </div>
      </section>
    </div>`;
}

function mostrarErroGeral(form, mensagem) {
  let caixa = $('.alerta-caixa', form);
  if (!mensagem) { caixa?.remove(); return; }
  if (!caixa) { caixa = document.createElement('div'); caixa.className = 'alerta-caixa erro'; caixa.setAttribute('role', 'alert'); form.prepend(caixa); }
  render(caixa, html`${icone('alerta')}<span>${mensagem}</span>`);
}

// ---------- login ----------
export function login(alvo, ctx) {
  render(alvo, moldura(html`
    <header>
      <h1>Entrar</h1>
      <p>Use o e-mail e a senha do seu acesso.</p>
    </header>
    <form class="form" id="form-login" novalidate>
      <div class="campo">
        <label for="email">E-mail</label>
        <input id="email" name="email" type="email" autocomplete="username" inputmode="email" required>
      </div>
      <div class="campo">
        <label for="senha">Senha</label>
        <div class="senha-caixa">
          <input id="senha" name="senha" type="password" autocomplete="current-password" required>
          <button type="button" class="btn btn-texto" data-mostrar-senha aria-pressed="false">Mostrar</button>
        </div>
      </div>
      <button class="btn btn-primario btn-bloco" type="submit">Entrar</button>
      <div class="acesso-links"><a href="#/esqueci-senha">Esqueci minha senha</a></div>
    </form>
    ${USAR_EXEMPLO ? html`
      <div class="demo-caixa">
        <span class="etiqueta">Modo demonstração · entrar como</span>
        <div class="demo-botoes">
          <button type="button" class="btn btn-contorno" data-demo="silas@auniti.com.br">Administração</button>
          <button type="button" class="btn btn-contorno" data-demo="dono.ssa@exemplo.com.br">Dono da loja</button>
          <button type="button" class="btn btn-contorno" data-demo="rafael.ssa@exemplo.com.br">Atendente</button>
        </div>
        <p class="ajuda">Senha de todos: ${api.SENHA_DEMO}. Na administração, o código de verificação é ${api.CODIGO_2FA_DEMO}.</p>
      </div>` : ''}
  `));

  const form = $('#form-login', alvo);
  ligarMostrarSenha(form);
  $('#email', form).focus();

  $$('[data-demo]', alvo).forEach((b) => b.addEventListener('click', () => {
    form.elements.email.value = b.dataset.demo;
    form.elements.senha.value = api.SENHA_DEMO;
    form.requestSubmit();
  }));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = dadosDoForm(form);
    mostrarErroGeral(form, null);
    const erros = {};
    if (!emailValido(d.email)) erros.email = 'Informe um e-mail válido.';
    if (!d.senha) erros.senha = 'Informe sua senha.';
    if (!marcarErros(form, erros)) return;
    await comBotao($('[type=submit]', form), async () => {
      try {
        const r = await api.entrar({ email: d.email.trim(), senha: d.senha });
        if (r.precisa2fa) ctx.navegar('verificacao');
        else ctx.entrou(r.usuario);
      } catch (err) {
        form.elements.senha.value = '';
        mostrarErroGeral(form, err.message);
        form.elements.senha.focus();
      }
    });
  });
}

// ---------- verificação em 2 etapas ----------
export function verificacao(alvo, ctx) {
  render(alvo, moldura(html`
    <header>
      <h1>Verificação em 2 etapas</h1>
      <p>Digite o código de 6 números que aparece no seu app autenticador.</p>
    </header>
    <form class="form" id="form-2fa" novalidate>
      <fieldset class="codigo-2fa campo" aria-label="Código de verificação">
        ${[0, 1, 2, 3, 4, 5].map((i) => html`<input name="d${i}" inputmode="numeric" autocomplete="${i === 0 ? 'one-time-code' : 'off'}" maxlength="1" aria-label="Dígito ${i + 1}" pattern="[0-9]">`)}
      </fieldset>
      <button class="btn btn-primario btn-bloco" type="submit">Confirmar</button>
      <div class="acesso-links"><a href="#/login">${'← Voltar para o login'}</a></div>
    </form>`));

  const form = $('#form-2fa', alvo);
  const caixas = $$('.codigo-2fa input', form);
  caixas[0].focus();
  caixas.forEach((cx, i) => {
    cx.addEventListener('input', () => {
      cx.value = cx.value.replace(/\D/g, '').slice(-1);
      if (cx.value && i < 5) caixas[i + 1].focus();
      if (caixas.every((c) => c.value)) form.requestSubmit();
    });
    cx.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !cx.value && i > 0) caixas[i - 1].focus(); });
    cx.addEventListener('paste', (e) => {
      const numeros = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
      if (!numeros) return;
      e.preventDefault();
      numeros.split('').forEach((n, j) => { if (caixas[j]) caixas[j].value = n; });
      caixas[Math.min(numeros.length, 5)].focus();
      if (numeros.length === 6) form.requestSubmit();
    });
  });

  let enviando = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (enviando) return;
    const codigo = caixas.map((c) => c.value).join('');
    mostrarErroGeral(form, null);
    if (codigo.length !== 6) return mostrarErroGeral(form, 'Digite os 6 números do código.');
    enviando = true;
    await comBotao($('[type=submit]', form), async () => {
      try {
        const r = await api.verificar2fa({ codigo });
        ctx.entrou(r.usuario);
      } catch (err) {
        mostrarErroGeral(form, err.message);
        caixas.forEach((c) => { c.value = ''; });
        caixas[0].focus();
        if (err.status === 401) setTimeout(() => ctx.navegar('login'), 1800);
      } finally { enviando = false; }
    });
  });
}

// ---------- esqueci minha senha ----------
export function esqueciSenha(alvo) {
  render(alvo, moldura(html`
    <header>
      <h1>Esqueci minha senha</h1>
      <p>Informe o e-mail do seu acesso. Se ele estiver cadastrado, você recebe um link para criar uma nova senha.</p>
    </header>
    <form class="form" id="form-esqueci" novalidate>
      <div class="campo">
        <label for="email">E-mail</label>
        <input id="email" name="email" type="email" autocomplete="username" inputmode="email" required>
      </div>
      <button class="btn btn-primario btn-bloco" type="submit">Enviar link</button>
      <div class="acesso-links"><a href="#/login">← Voltar para o login</a></div>
    </form>`));

  const form = $('#form-esqueci', alvo);
  $('#email', form).focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = dadosDoForm(form);
    if (!marcarErros(form, emailValido(d.email) ? {} : { email: 'Informe um e-mail válido.' })) return;
    await comBotao($('[type=submit]', form), async () => {
      try { await api.pedirNovaSenha({ email: d.email.trim() }); } catch { /* resposta sempre igual: não revela se o e-mail existe */ }
      render(form, html`
        <div class="alerta-caixa ok" role="status">${icone('email')}<span>Pronto. Se ${d.email.trim()} tiver acesso ao Conecta, o link chega em alguns minutos. Confira também a caixa de spam.</span></div>
        <a class="btn btn-contorno btn-bloco" href="#/login">Voltar para o login</a>`);
    });
  });
}

// ---------- definir senha (convite ou recuperação) ----------
export function definirSenha(alvo, ctx) {
  const token = ctx.query.get('token') || '';
  render(alvo, moldura(html`
    <header>
      <h1>Crie sua senha</h1>
      <p>Esta será a senha do seu acesso ao Conecta LocarX.</p>
    </header>
    ${token ? html`
      <form class="form" id="form-senha" novalidate>
        <div class="campo">
          <label for="senha">Nova senha</label>
          <div class="senha-caixa">
            <input id="senha" name="senha" type="password" autocomplete="new-password" required>
            <button type="button" class="btn btn-texto" data-mostrar-senha aria-pressed="false">Mostrar</button>
          </div>
          <p class="ajuda" id="ajuda-senha">Use pelo menos 10 caracteres, misturando letras e números.</p>
        </div>
        <div class="campo">
          <label for="confirmar">Repita a senha</label>
          <input id="confirmar" name="confirmar" type="password" autocomplete="new-password" required>
        </div>
        <button class="btn btn-primario btn-bloco" type="submit">Salvar senha</button>
      </form>` : html`
      <div class="alerta-caixa erro" role="alert">${icone('alerta')}<span>Este link está incompleto ou expirou. Peça ao responsável da sua loja um novo convite.</span></div>
      <a class="btn btn-contorno btn-bloco" href="#/login">Ir para o login</a>`}
  `));

  const form = $('#form-senha', alvo);
  if (!form) return;
  ligarMostrarSenha(form);
  $('#senha', form).focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = dadosDoForm(form);
    const erros = {};
    const falta = forcaSenha(d.senha);
    if (falta.length) erros.senha = 'A senha precisa ' + falta.join(' e ') + '.';
    else if (d.senha !== d.confirmar) erros.confirmar = 'As senhas não são iguais.';
    if (!marcarErros(form, erros)) return;
    await comBotao($('[type=submit]', form), async () => {
      try {
        await api.definirSenha({ token, senha: d.senha });
        render(form, html`
          <div class="alerta-caixa ok" role="status">${icone('ok')}<span>Senha criada. Agora é só entrar com o seu e-mail e a nova senha.</span></div>
          <a class="btn btn-primario btn-bloco" href="#/login">Entrar</a>`);
      } catch (err) {
        if (err.campos) marcarErros(form, err.campos);
        else mostrarErroGeral(form, err.message);
      }
    });
  });
}
