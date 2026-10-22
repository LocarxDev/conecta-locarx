// Conecta LocarX — inicialização, rotas e estrutura das telas logadas.
// As rotas usam o endereço depois do "#" (ex.: #/lojas). Assim o F5 recarrega na MESMA tela,
// e ao recarregar o sistema pergunta ao back-end quem está logado antes de mostrar qualquer coisa.

import { api, USAR_EXEMPLO } from './api.js';
import { html, render, $, $$, icone, iniciais, preferencia, avisar, PERFIS } from './util.js';
import * as acesso from './telas/acesso.js';
import * as inicio from './telas/inicio.js';
import * as equipe from './telas/equipe.js';
import * as lojas from './telas/lojas.js';
import * as perfil from './telas/perfil.js';
import * as emBreve from './telas/em-breve.js';
import * as whatsapp from './telas/whatsapp.js';
import * as respostasRapidas from './telas/respostas.js';
import * as conversas from './telas/conversas.js';

const app = document.getElementById('app');
const estado = { usuario: null, destino: null };

const MODULOS_LOJA = [
  { rota: 'em-breve/clientes', rotulo: 'Clientes', icone: 'clientes' },
  { rota: 'em-breve/funil', rotulo: 'Funil de vendas', icone: 'funil' },
  { rota: 'em-breve/reservas', rotulo: 'Reservas', icone: 'reservas' },
];

function menuDoPerfil(perfilUsuario) {
  if (perfilUsuario === 'admin' || perfilUsuario === 'matriz') {
    return [
      { grupo: 'Rede LocarX' },
      { rota: 'inicio', rotulo: 'Visão da rede', icone: 'inicio' },
      { rota: 'lojas', rotulo: 'Lojas', icone: 'lojas' },
      { rota: 'em-breve/base-rede', rotulo: 'Base da rede', icone: 'assistente', travado: true },
      { rota: 'em-breve/relatorios-rede', rotulo: 'Relatórios', icone: 'relatorios', travado: true },
    ];
  }
  const itens = [
    { grupo: 'Atendimento' },
    { rota: 'inicio', rotulo: 'Início', icone: 'inicio' },
    { rota: 'conversas', rotulo: 'Conversas', icone: 'conversas', contador: true },
    ...MODULOS_LOJA.map((m) => ({ ...m, travado: true })),
  ];
  if (perfilUsuario === 'dono') {
    itens.push(
      { grupo: 'Gestão da loja' },
      { rota: 'whatsapp', rotulo: 'WhatsApp da loja', icone: 'whatsapp' },
      { rota: 'respostas', rotulo: 'Respostas rápidas', icone: 'editar' },
      { rota: 'em-breve/assistente', rotulo: 'Assistente virtual', icone: 'assistente', travado: true },
      { rota: 'em-breve/relatorios', rotulo: 'Relatórios', icone: 'relatorios', travado: true },
      { rota: 'atendentes', rotulo: 'Atendentes', icone: 'atendentes' },
    );
  }
  return itens;
}

// rota → tela, quem pode ver
const ROTAS = [
  { padrao: /^login$/, tela: acesso.login, publica: true },
  { padrao: /^verificacao$/, tela: acesso.verificacao, publica: true },
  { padrao: /^esqueci-senha$/, tela: acesso.esqueciSenha, publica: true },
  { padrao: /^definir-senha$/, tela: acesso.definirSenha, publica: true },
  { padrao: /^inicio$/, tela: inicio.montar },
  { padrao: /^atendentes$/, tela: equipe.montar, perfis: ['dono'] },
  { padrao: /^lojas$/, tela: lojas.lista, perfis: ['admin', 'matriz'] },
  { padrao: /^lojas\/([\w-]+)$/, tela: lojas.detalhe, perfis: ['admin', 'matriz'] },
  { padrao: /^perfil$/, tela: perfil.montar },
  { padrao: /^conversas(?:\/([\w-]+))?$/, tela: conversas.montar, perfis: ['dono', 'atendente'] },
  { padrao: /^whatsapp$/, tela: whatsapp.montar, perfis: ['dono'] },
  { padrao: /^respostas$/, tela: respostasRapidas.montar, perfis: ['dono'] },
  { padrao: /^em-breve\/([\w-]+)$/, tela: emBreve.montar },
];

function lerRota() {
  const bruto = location.hash.replace(/^#\/?/, '');
  const [caminho, busca = ''] = bruto.split('?');
  return { caminho: caminho || '', query: new URLSearchParams(busca) };
}

export function navegar(caminho) {
  const alvo = '#/' + caminho.replace(/^#?\/?/, '');
  if (location.hash === alvo) despachar(); else location.hash = alvo;
}

let limparTela = null;
let telaAtiva = null;
let controleTela = null;

async function despachar() {
  const { caminho, query } = lerRota();
  const achada = ROTAS.find((r) => r.padrao.test(caminho));
  if (!achada) return navegar(estado.usuario ? 'inicio' : 'login');

  if (!achada.publica && !estado.usuario) {
    estado.destino = caminho;
    return navegar('login');
  }
  if (achada.publica && estado.usuario && ['login', 'verificacao'].includes(caminho)) return navegar('inicio');
  if (achada.perfis && !achada.perfis.includes(estado.usuario.perfil)) {
    avisar('Você não tem acesso a essa tela.', 'erro');
    return navegar('inicio');
  }

  const params = caminho.match(achada.padrao).slice(1);
  // mesma tela, só mudou o detalhe (ex.: outra conversa): atualiza sem redesenhar tudo
  if (achada.tela === telaAtiva && controleTela?.atualizar && estado.usuario) {
    controleTela.atualizar({ params, query });
    return;
  }
  limparTela?.();
  limparTela = null;
  controleTela = null;
  telaAtiva = achada.tela;
  const ctx = {
    usuario: estado.usuario, params, query, navegar,
    entrou: (usuario) => { estado.usuario = usuario; const d = estado.destino; estado.destino = null; navegar(d || 'inicio'); },
    atualizarUsuario: (usuario) => { estado.usuario = usuario; despachar(); },
    sessaoExpirou: () => { conversas.pararVigia(); limparTela?.(); limparTela = null; telaAtiva = null; controleTela = null; estado.usuario = null; avisar('Sua sessão terminou. Entre novamente.', 'erro'); navegar('login'); },
  };

  const guardar = (r) => {
    if (typeof r === 'function') limparTela = r;
    else if (r && typeof r === 'object') { controleTela = r; limparTela = r.limpar || null; }
  };
  if (achada.publica) {
    app.className = '';
    guardar(await achada.tela(app, ctx));
  } else {
    desenharEstrutura(caminho);
    if (['dono', 'atendente'].includes(estado.usuario.perfil)) { conversas.iniciarVigia(ctx); conversas.atualizarContadores(); }
    const area = $('#conteudo');
    area.classList.toggle('conteudo-largo', !!achada.largo || /^conversas/.test(caminho));
    guardar(await achada.tela(area, ctx));
    area.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

// ---------- estrutura logada: menu lateral + topo ----------
function desenharEstrutura(caminhoAtual) {
  const u = estado.usuario;
  const ehRede = u.perfil === 'admin' || u.perfil === 'matriz';
  const temaAtual = document.documentElement.getAttribute('data-theme');
  const escuro = temaAtual ? temaAtual === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;

  render(app, html`
    <div class="sistema" id="sistema">
      <nav class="menu" id="menu" aria-label="Menu principal">
        <a class="logo-menu" href="#/inicio" aria-label="Conecta LocarX — início">
          <img src="/assets/logo-locarx-branca.png" alt="LocarX" width="128" height="51">
        </a>
        ${menuDoPerfil(u.perfil).map((item) => item.grupo
          ? html`<div class="menu-grupo">${item.grupo}</div>`
          : html`<a class="menu-item${caminhoAtual === item.rota || caminhoAtual.startsWith(item.rota + '/') ? ' ativo' : ''}${item.travado ? ' travado' : ''}"
                   href="#/${item.rota}" ${caminhoAtual === item.rota ? html`aria-current="page"` : ''}>
                ${icone(item.icone)}<span>${item.rotulo}</span>${item.travado ? html`<span class="selo">Em breve</span>` : ''}${item.contador ? html`<span class="contador" id="contador-conversas" hidden></span>` : ''}
              </a>`)}
        <div class="menu-rodape">Conecta LocarX${USAR_EXEMPLO ? ' · modo demonstração' : ''}</div>
      </nav>
      <div class="menu-sombra" id="menu-sombra" hidden></div>
      <div class="principal">
        <header class="topo">
          <button class="btn btn-texto btn-icone abrir-menu" id="abrir-menu" aria-label="Abrir menu" aria-controls="menu" aria-expanded="false">${icone('menu')}</button>
          <div class="contexto">
            <strong>${ehRede ? 'Rede LocarX' : (u.loja?.nome || 'Minha loja')}</strong>
            <span>${PERFIS[u.perfil]}</span>
          </div>
          <div class="acoes">
            <button class="btn btn-texto btn-icone" id="trocar-tema" aria-label="${escuro ? 'Usar modo claro' : 'Usar modo escuro'}" title="${escuro ? 'Modo claro' : 'Modo escuro'}">${icone(escuro ? 'sol' : 'lua')}</button>
            <div class="usuario-menu">
              <button class="usuario-btn" id="usuario-btn" aria-haspopup="menu" aria-expanded="false">
                <span class="avatar">${iniciais(u.nome)}</span><span class="nome-curto">${u.nome.split(' ')[0]}</span>
              </button>
              <div class="usuario-pop" id="usuario-pop" role="menu" hidden>
                <div class="cab"><strong>${u.nome}</strong><span>${u.email}</span></div>
                <a href="#/perfil" role="menuitem">${icone('perfil')}Meu perfil</a>
                <button type="button" role="menuitem" id="sair">${icone('sair')}Sair</button>
              </div>
            </div>
          </div>
        </header>
        <main class="conteudo" id="conteudo" tabindex="-1"></main>
      </div>
    </div>`);

  // menu no celular
  const sistema = $('#sistema'), sombra = $('#menu-sombra'), abrir = $('#abrir-menu');
  const fecharMenu = () => { sistema.classList.remove('menu-aberto'); sombra.hidden = true; abrir.setAttribute('aria-expanded', 'false'); };
  abrir.addEventListener('click', () => { sistema.classList.add('menu-aberto'); sombra.hidden = false; abrir.setAttribute('aria-expanded', 'true'); });
  sombra.addEventListener('click', fecharMenu);
  $$('.menu-item', app).forEach((a) => a.addEventListener('click', fecharMenu));

  // tema
  const botaoTema = $('#trocar-tema');
  let modoEscuro = escuro;
  botaoTema.addEventListener('click', () => {
    modoEscuro = !modoEscuro;
    document.documentElement.setAttribute('data-theme', modoEscuro ? 'dark' : 'light');
    preferencia.gravar('tema', modoEscuro ? 'escuro' : 'claro');
    render(botaoTema, icone(modoEscuro ? 'sol' : 'lua'));
    botaoTema.setAttribute('aria-label', modoEscuro ? 'Usar modo claro' : 'Usar modo escuro');
    botaoTema.title = modoEscuro ? 'Modo claro' : 'Modo escuro';
  });

  // menu do usuário
  const btn = $('#usuario-btn'), pop = $('#usuario-pop');
  const fecharPop = (e) => { if (!e || !pop.parentElement.contains(e.target)) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', fecharPop); } };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
    btn.setAttribute('aria-expanded', String(!pop.hidden));
    if (!pop.hidden) document.addEventListener('click', fecharPop);
  });
  $('#sair').addEventListener('click', async () => {
    await api.sair().catch(() => {});
    conversas.pararVigia();
    limparTela?.(); limparTela = null; telaAtiva = null; controleTela = null;
    estado.usuario = null;
    navegar('login');
  });
}

// ---------- início ----------
async function iniciar() {
  try {
    const { usuario } = await api.sessao();
    estado.usuario = usuario;
  } catch {
    estado.usuario = null;
  }
  window.addEventListener('hashchange', despachar);
  despachar();
}

iniciar();
