// Ferramentas de tela usadas por todo o sistema.
// Segurança: todo texto vindo de dados passa por escapar() — nunca vira HTML executável (proteção contra XSS).

class HtmlSeguro {
  constructor(texto) { this.texto = texto; }
  toString() { return this.texto; }
}

export function escapar(valor) {
  if (valor instanceof HtmlSeguro) return valor.texto;
  if (Array.isArray(valor)) return valor.map(escapar).join('');
  if (valor === null || valor === undefined || valor === false) return '';
  return String(valor)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Uso: html`<p>${nome}</p>` — o nome é escapado automaticamente.
export function html(partes, ...valores) {
  let saida = '';
  partes.forEach((parte, i) => { saida += parte + (i < valores.length ? escapar(valores[i]) : ''); });
  return new HtmlSeguro(saida);
}

// Só para HTML montado pelo próprio sistema (nunca com dados digitados por alguém).
export function seguro(texto) { return new HtmlSeguro(texto); }

export const PERFIS = {
  admin: 'Administração Auniti',
  matriz: 'Matriz LocarX',
  dono: 'Dono da loja',
  atendente: 'Atendente',
};

export function $(seletor, raiz = document) { return raiz.querySelector(seletor); }
export function $$(seletor, raiz = document) { return [...raiz.querySelectorAll(seletor)]; }

export function render(alvo, conteudo) { alvo.innerHTML = String(conteudo); aplicarCores(alvo); }

// Cores escolhidas pela loja (etiquetas, etapas do funil). A CSP não deixa usar style="" no HTML,
// então a cor vai em data-cor e é aplicada aqui como variável CSS (--cor).
export function aplicarCores(raiz) {
  raiz.querySelectorAll?.('[data-cor]').forEach((el) => { if (/^#[0-9a-f]{6}$/i.test(el.dataset.cor)) el.style.setProperty('--cor', el.dataset.cor); });
}
export const CORES = [['#64748b', 'Cinza'], ['#2563eb', 'Azul'], ['#0891b2', 'Turquesa'], ['#16a34a', 'Verde'], ['#d97706', 'Laranja'], ['#dc2626', 'Vermelho'], ['#7c3aed', 'Roxo'], ['#db2777', 'Rosa']];
export const chipEtiqueta = (e, extra = '') => html`<span class="etiqueta cor" data-cor="${e.cor}">${e.nome}${extra}</span>`;
export function seletorCor(nome, atual) {
  return html`<div class="cores" role="radiogroup" aria-label="Cor">${CORES.map(([c, n]) => html`<label class="cor-opcao" data-cor="${c}" title="${n}"><input type="radio" name="${nome}" value="${c}" ${c === atual ? 'checked' : ''} aria-label="${n}"><span></span></label>`)}</div>`;
}

// Armazenamento do navegador: só para preferências (tema). Nunca guarda senha ou token.
export const preferencia = {
  ler(chave) { try { return localStorage.getItem('conecta.' + chave); } catch { return null; } },
  gravar(chave, valor) { try { localStorage.setItem('conecta.' + chave, valor); } catch { /* sem armazenamento */ } },
  apagar(chave) { try { localStorage.removeItem('conecta.' + chave); } catch { /* sem armazenamento */ } },
};

export function iniciais(nome = '') {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?';
}

const fmtData = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDataHora = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
export function data(iso) { return iso ? fmtData.format(new Date(iso)) : '—'; }
export function quando(iso) {
  if (!iso) return 'Nunca acessou';
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 2) return 'Agora';
  if (min < 60) return `Há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `Há ${h} h`;
  return fmtDataHora.format(new Date(iso));
}

// ---------- ícones (traço simples, herdam a cor do texto) ----------
const caminhos = {
  inicio: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-5h4v5"/>',
  conversas: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
  clientes: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.7 3.1 2.4 3.5 5.2"/>',
  funil: '<path d="M3 4h18l-7 8.5V19l-4 2v-8.5z"/>',
  reservas: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="m9 15 2 2 4-4"/>',
  assistente: '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 12.5h.01M15 12.5h.01M9.5 16h5"/>',
  relatorios: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  atendentes: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6"/>',
  lojas: '<path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5c0 1.4 1.1 2.5 2.7 2.5s2.6-1.1 2.6-2.5c0 1.4 1.1 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1 2.5 2.6 2.5S20 10.9 20 9.5"/><path d="M5.5 12v8h13v-8M10 20v-4.5h4V20"/>',
  perfil: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6"/>',
  sair: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  lua: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  fechar: '<path d="M6 6l12 12M18 6 6 18"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  busca: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  editar: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  lixo: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  cadeado: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  escudo: '<path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
  ok: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alerta: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  seta: '<path d="m9 6 6 6-6 6"/>',
  voltar: '<path d="m15 6-6 6 6 6"/>',
  whatsapp: '<path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-2-2l.8-1-1-2z"/>',
  vazio: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 13h5l1.5 2h4l1.5-2h5"/>',
  copiar: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  etiqueta: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  ajustes: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  subir: '<path d="m6 15 6-6 6 6"/>',
  descer: '<path d="m6 9 6 6 6-6"/>',
  painel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  roleta: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4h-4"/><circle cx="12" cy="12" r="2"/>',
  robo: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9.5 13h.01M14.5 13h.01"/>',
};
export function icone(nome) {
  return new HtmlSeguro(`<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${caminhos[nome] || ''}</svg>`);
}

// ---------- avisos rápidos ----------
export function avisar(texto, tipo = 'ok') {
  const caixa = document.getElementById('avisos');
  const el = document.createElement('div');
  el.className = 'aviso' + (tipo === 'erro' ? ' erro' : '');
  el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
  render(el, html`${icone(tipo === 'erro' ? 'alerta' : 'ok')}<span>${texto}</span>`);
  caixa.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

// ---------- janela (modal) ----------
const janelasAbertas = new Set();
// ao trocar de tela (ex.: link "Abrir conversa" dentro da ficha), as janelas da tela anterior fecham
export function fecharJanelas() { [...janelasAbertas].forEach((f) => f()); }

export function abrirModal({ titulo, corpo, rodape }) {
  const anterior = document.activeElement;
  const fundo = document.createElement('div');
  fundo.className = 'modal-fundo';
  render(fundo, html`
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-titulo">
      <div class="modal-cab">
        <h2 id="modal-titulo">${titulo}</h2>
        <button class="btn btn-texto btn-icone" data-fechar aria-label="Fechar">${icone('fechar')}</button>
      </div>
      <div class="modal-corpo">${corpo}</div>
      ${rodape ? html`<div class="modal-rodape">${rodape}</div>` : ''}
    </div>`);
  document.body.appendChild(fundo);
  // A janela só fecha pelo X, por "Cancelar"/"Fechar" ou pelo Esc — nunca com clique fora,
  // para ninguém perder o que digitou. Se já digitou algo, o Esc também não fecha.
  let sujo = false;
  fundo.addEventListener('input', (e) => { if (!e.target.closest('[data-salva-sozinho]')) sujo = true; }); // painéis que salvam sozinhos não contam
  const fechar = () => { janelasAbertas.delete(fechar); fundo.remove(); document.removeEventListener('keydown', tecla); anterior?.focus?.(); };
  janelasAbertas.add(fechar);
  const avisarQueFica = () => { const m = fundo.querySelector('.modal'); m.classList.remove('chamar-atencao'); void m.offsetWidth; m.classList.add('chamar-atencao'); };
  const tecla = (e) => {
    if (e.key !== 'Escape' || document.querySelector('.modal-fundo:last-of-type') !== fundo) return;
    if (sujo) avisarQueFica(); else fechar();
  };
  document.addEventListener('keydown', tecla);
  fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) avisarQueFica(); });
  $$('[data-fechar]', fundo).forEach((b) => b.addEventListener('click', fechar));
  setTimeout(() => ($('input, select, textarea', fundo) || $('.modal-rodape .btn-primario, .modal-rodape .btn-perigo', fundo))?.focus(), 30);
  return { el: fundo, fechar };
}

export function confirmar({ titulo, texto, botao = 'Confirmar', perigo = false }) {
  return new Promise((resolver) => {
    let respondido = false;
    const m = abrirModal({
      titulo,
      corpo: html`<p>${texto}</p>`,
      rodape: html`<button class="btn btn-contorno" data-fechar>Cancelar</button>
                   <button class="btn ${perigo ? 'btn-perigo' : 'btn-primario'}" data-sim>${botao}</button>`,
    });
    $('[data-sim]', m.el).addEventListener('click', () => { respondido = true; m.fechar(); resolver(true); });
    new MutationObserver((_, obs) => {
      if (!m.el.isConnected) { obs.disconnect(); if (!respondido) resolver(false); }
    }).observe(document.body, { childList: true });
  });
}

// ---------- formulários ----------
export function dadosDoForm(form) { return Object.fromEntries(new FormData(form).entries()); }

export function marcarErros(form, erros = {}) {
  $$('.campo', form).forEach((c) => { c.classList.remove('invalido'); $('.erro-campo', c)?.remove(); });
  let primeiro = null;
  for (const [nome, msg] of Object.entries(erros)) {
    const entrada = form.elements[nome];
    const campo = entrada?.closest?.('.campo');
    if (!campo) continue;
    campo.classList.add('invalido');
    const p = document.createElement('p');
    p.className = 'erro-campo';
    p.id = `erro-${nome}`;
    p.textContent = msg;
    campo.appendChild(p);
    entrada.setAttribute('aria-describedby', p.id);
    primeiro ||= entrada;
  }
  primeiro?.focus();
  return !primeiro;
}

export async function comBotao(botao, tarefa) {
  const texto = botao.innerHTML;
  botao.disabled = true;
  botao.textContent = 'Aguarde…';
  try { return await tarefa(); } finally { botao.disabled = false; botao.innerHTML = texto; }
}

export const emailValido = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim());

export function forcaSenha(s = '') {
  const faltando = [];
  if (s.length < 10) faltando.push('ter pelo menos 10 caracteres');
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) faltando.push('misturar letras e números');
  return faltando;
}

export function ligarMostrarSenha(raiz) {
  $$('[data-mostrar-senha]', raiz).forEach((b) => b.addEventListener('click', () => {
    const entrada = b.parentElement.querySelector('input');
    const mostrar = entrada.type === 'password';
    entrada.type = mostrar ? 'text' : 'password';
    b.textContent = mostrar ? 'Ocultar' : 'Mostrar';
    b.setAttribute('aria-pressed', String(mostrar));
  }));
}

// Telefone brasileiro para exibição: tira o 55 do WhatsApp, repõe o 9 do celular quando faltar, formata (71) 99999-0000
export function telefoneBr(v) {
  let d = String(v || '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length === 10 && /[6-9]/.test(d[2])) d = d.slice(0, 2) + '9' + d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(v || '');
}

// Paginação no navegador para listas já carregadas: devolve a fatia e os controles (mesmo visual da tela Clientes).
// `aoMudar(pagina)` é chamado quando a pessoa clica; quem chama redesenha.
export function paginar(lista, pagina, porPagina, { rotulo = 'itens', extra = '' } = {}) {
  const paginas = Math.max(1, Math.ceil(lista.length / porPagina));
  const p = Math.min(Math.max(1, pagina), paginas);
  const fatia = lista.slice((p - 1) * porPagina, p * porPagina);
  const controles = lista.length > porPagina || extra ? html`<div class="paginacao">
    <button class="btn btn-texto" data-pag="-1" ${p <= 1 ? 'disabled' : ''}>${icone('voltar')}Anterior</button>
    <span class="sub num">Página ${p} de ${paginas} · ${lista.length} ${rotulo}${extra ? html` · ${extra}` : ''}</span>
    <button class="btn btn-texto" data-pag="1" ${p >= paginas ? 'disabled' : ''}>Próxima ${icone('seta')}</button></div>` : '';
  return { fatia, controles, pagina: p, paginas };
}
export function ligarPaginacao(area, aoMudar) {
  $$('[data-pag]', area).forEach((b) => b.addEventListener('click', () => aoMudar(Number(b.dataset.pag))));
}
