// v14.12 — Página pública de adesão (#/adesao): dados da loja → acessos e particularidades → plano e pagamento (cartão ou Pix) → pronto.
// Sem login. O pagamento é tokenizado direto na Pagar.me; a situação do Pix é consultada com a chave devolvida na criação.
import { api } from '../api.js';
import { tokenizarCartao, camposCartaoHtml } from '../pagarme.js';
import { html, render, $, $$, icone, avisar, comBotao, marcarErros, emailValido } from '../util.js';
import { linhaAcessos, notaAcessos } from './assinatura.js';

const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const PASSOS = ['Sua loja', 'Acessos', 'Pagamento', 'Pronto'];
const CHAVE_LOCAL = 'adesao-em-andamento';
const descontoAnual = (p) => (p && p.mensal ? Math.round((1 - p.anual / (p.mensal * 12)) * 100) : 0);

export async function montar(alvo) {
  document.title = 'Adesão — Conecta LocarX';
  let cfg;
  try { cfg = await api.adesaoPublica(); } catch (err) {
    return render(alvo, moldura(html`<header><h1>Adesão ao Conecta</h1></header><div class="alerta-caixa erro">${icone('alerta')}<span>${err.message}</span></div><div class="acesso-links"><a href="#/login">Já tenho acesso</a></div>`));
  }
  const plano = cfg.planos?.[0];
  const d = { nomeLoja: '', cnpj: '', razaoSocial: '', endereco: '', cep: '', cidadeUf: '', whatsapp: '', gestorNome: '', gestorEmail: '', atendenteNome: '', atendenteEmail: '', particularidades: '', ciclo: 'mensal', forma: 'cartao', aceite: false };
  let passo = 0, resultado = null, chave = null, vigia = null, turnstileId = null;
  // volta para a adesão Pix em andamento (se a pessoa fechou a aba)
  try { const g = JSON.parse(localStorage.getItem(CHAVE_LOCAL) || 'null'); if (g?.id && g?.chave && Date.now() - g.em < 2 * 86400000) { resultado = { id: g.id }; chave = g.chave; passo = 3; } } catch { /* sem storage */ }

  function moldura(conteudo) {
    return html`<div class="acesso adesao-pagina">
      <section class="acesso-marca" aria-hidden="true">
        <img class="logo" src="/assets/logo-locarx-branca.png" alt="" width="200" height="79">
        <div class="chamada"><h1>Sua loja no <span>Conecta</span> em 1 dia útil.</h1><p>Atendimento pelo WhatsApp com a assistente Lia, CRM, cotação e reserva direto no portal LocarX — tudo pronto, entregue pela administração da rede.</p></div>
        <p class="rodape-marca">Conecta LocarX · Auniti Tecnologia · Pagamentos processados pela Pagar.me</p>
        <img class="x-fundo" src="/assets/icone-512.png" alt="">
      </section>
      <section class="acesso-form"><div class="acesso-caixa adesao-caixa">
        <img class="logo-movel logo-tema-claro" src="/assets/logo-locarx.png" alt="LocarX" width="150" height="59">
        <img class="logo-movel logo-tema-escuro" src="/assets/logo-locarx-branca.png" alt="LocarX" width="150" height="59">
        ${conteudo}
      </div></section>
    </div>`;
  }
  const passos = () => html`<ol class="passos passos-adesao" aria-label="Etapas">${PASSOS.map((n, i) => html`<li class="${i < passo ? 'feito' : i === passo ? 'atual' : ''}">${n}</li>`)}</ol>`;
  const campo = (id, rotulo, extra = '', tipo = 'text') => html`<div class="campo ${extra.includes('largo') ? 'campo-largo' : ''}"><label for="ad-${id}">${rotulo}</label><input id="ad-${id}" name="${id}" type="${tipo}" value="${d[id] || ''}" ${extra.includes('obrig') ? 'required' : ''} ${extra.replace(/largo|obrig/g, '')}></div>`;

  // ---------- passo 1: loja ----------
  function passoLoja() {
    return html`<header><h1>Adesão ao Conecta</h1><p>Leva 3 minutos. A administração da rede recebe seus dados, cria a loja e você recebe o convite de acesso por e-mail em até 1 dia útil.</p></header>
      ${passos()}
      <form id="f-loja" class="form" novalidate>
        <h2>Sua loja</h2>
        <div class="form-linha">
          ${campo('nomeLoja', 'Nome da loja (como aparece para o cliente)', 'largo obrig placeholder="Ex.: LocarX Salvador Aeroporto"')}
          ${campo('cnpj', 'CNPJ', 'obrig inputmode="numeric" placeholder="00.000.000/0000-00"')}
          ${campo('razaoSocial', 'Razão social', 'obrig')}
          ${campo('endereco', 'Endereço completo', 'largo obrig placeholder="Rua, número, bairro"')}
          ${campo('cep', 'CEP', 'obrig inputmode="numeric" placeholder="00000-000"')}
          ${campo('cidadeUf', 'Cidade / UF', 'obrig placeholder="Salvador / BA"')}
          ${campo('whatsapp', 'WhatsApp que será usado no atendimento', 'largo obrig inputmode="tel" placeholder="(71) 99999-0000"', 'tel')}
        </div>
        <p class="ajuda">${icone('info')} O número precisa ser exclusivo da loja, em um celular que fica na loja. Não use o celular pessoal.</p>
        <div class="acoes-linha entre"><a class="btn btn-texto" href="#/login">Já tenho acesso</a><button class="btn btn-primario" type="submit">Continuar →</button></div>
      </form>`;
  }
  // ---------- passo 2: acessos e particularidades ----------
  function passoAcessos() {
    return html`<header><h1>Acessos e particularidades</h1><p>${plano ? notaAcessos(plano) : ''}</p></header>
      ${passos()}
      <form id="f-acessos" class="form" novalidate>
        <h2>Acesso 1 — Gestor da loja</h2>
        <div class="form-linha">${campo('gestorNome', 'Nome completo', 'obrig')}${campo('gestorEmail', 'E-mail (recebe o convite e as faturas)', 'obrig', 'email')}</div>
        <h2>Acesso 2 — Atendente <span class="sub">(opcional; dá para convidar depois pelo sistema)</span></h2>
        <div class="form-linha">${campo('atendenteNome', 'Nome completo')}${campo('atendenteEmail', 'E-mail', '', 'email')}</div>
        <h2>Sua loja tem algo diferente do padrão da rede? <span class="sub">(opcional)</span></h2>
        <div class="campo"><label for="ad-particularidades">Conte aqui. Em branco = padrão da rede, ajustável depois com o suporte.</label>
          <textarea id="ad-particularidades" name="particularidades" rows="5" maxlength="2000" placeholder="Exemplos: funciona 24 horas; devolução expressa (cliente deixa o carro no estacionamento e a chave na caixa, conferência depois); retirada e devolução no aeroporto; atende em feriados; entrega do carro em hotel; só retira com agendamento; estacionamento próprio; taxa de retorno fora do horário.">${d.particularidades}</textarea></div>
        <div class="acoes-linha entre"><button class="btn btn-texto" type="button" data-voltar>← Voltar</button><button class="btn btn-primario" type="submit">Continuar →</button></div>
      </form>`;
  }
  // ---------- passo 3: plano e pagamento ----------
  function passoPagamento() {
    const total = d.ciclo === 'anual' ? plano.anual : plano.mensal;
    return html`<header><h1>Plano e pagamento</h1><p>${d.ciclo === 'anual' ? `Anual: 12 meses pagos de uma vez, com ${descontoAnual(plano)}% de desconto.` : 'Mensal: sem fidelidade, renova a cada 30 dias.'} A primeira cobrança é agora; o acesso chega por e-mail em até 1 dia útil.</p></header>
      ${passos()}
      <form id="f-pagar" class="form" novalidate>
        <div class="ciclo-troca" role="group" aria-label="Ciclo">${[['mensal', 'Mensal'], ['anual', `Anual · ${descontoAnual(plano)}% off`]].map(([k, n]) => html`<button type="button" class="${d.ciclo === k ? 'ativo' : ''}" data-ciclo="${k}">${n}</button>`)}</div>
        <div class="plano-cartao selecionado adesao-plano">
          <div class="plano-cab"><div><div class="plano-rotulo">${plano.rotulo}</div><div class="plano-preco num">${reais((d.ciclo === 'anual' ? plano.anual / 12 : plano.mensal) / 100)}<small>/mês</small></div>
            <div class="sub">${d.ciclo === 'anual' ? `${reais(plano.anual / 100)} por ano · economize ${reais((plano.mensal * 12 - plano.anual) / 100)}` : `no anual: ${reais(plano.anual / 100)}/ano, ${descontoAnual(plano)}% de desconto`}</div></div></div>
          <h3>${plano.nome}</h3><p class="sub">${plano.descricao || ''}</p>
          <ul class="plano-lista">${linhaAcessos(plano) ? html`<li>${icone('ok')}${linhaAcessos(plano)}</li>` : ''}${plano.inclui.map((i) => html`<li>${icone('ok')}${i}</li>`)}</ul>
        </div>
        <h2>Forma de pagamento</h2>
        <div class="formas-grade" role="group">
          ${[['cartao', 'Cartão de crédito', 'renova sozinho a cada ciclo'], ['pix', 'Pix', 'QR Code na hora; um código por ciclo']].map(([k, n, s]) => html`<button type="button" class="forma-opcao ${d.forma === k ? 'ativo' : ''}" data-forma="${k}"><strong>${n}</strong><span class="sub">${s}</span></button>`)}
        </div>
        ${d.forma === 'cartao' ? camposCartaoHtml(html, icone) : html`<div class="alerta-caixa info">${icone('info')}<span>Ao confirmar, geramos o QR Code e o código "copia e cola". O Pix não renova sozinho: a cada ciclo você recebe um código novo no Conecta e por e-mail, 5 dias antes do vencimento.</span></div>`}
        ${cfg.turnstile ? html`<div id="turnstile-adesao" class="turnstile-caixa"></div>` : ''}
        <div class="campo campo-aceite"><label class="opcao-modo"><input type="checkbox" name="aceite" ${d.aceite ? 'checked' : ''}><span>Li e concordo: o WhatsApp informado será usado só pelo Conecta (sem outras ferramentas no mesmo número), as mensagens automáticas do aparelho serão desligadas, e a cobrança é feita pela Pagar.me em nome da Auniti Tecnologia. Posso cancelar a qualquer momento no painel.</span></label></div>
        <div class="notas-plano">${[...(plano.notas || []), notaAcessos(plano)].filter(Boolean).map((n) => html`<p>${n}</p>`)}</div>
        <div class="acoes-linha entre"><button class="btn btn-texto" type="button" data-voltar>← Voltar</button><button class="btn btn-primario" type="submit">${d.forma === 'cartao' ? 'Confirmar e pagar' : 'Gerar Pix de'} ${reais(total / 100)}</button></div>
      </form>`;
  }
  // ---------- passo 4: pronto ----------
  function passoPronto() {
    const a = resultado;
    const pago = a?.status === 'paga' || a?.status === 'loja_criada';
    return html`<header><h1>${pago ? 'Adesão confirmada' : a?.pix ? 'Pague o Pix para concluir' : a?.status === 'falhou' ? 'Pagamento não aprovado' : a?.status === 'expirada' ? 'Pix expirado' : 'Carregando…'}</h1>
        <p>${pago ? `Recebemos o pagamento da ${a.nomeLoja}. A administração da rede cria o acesso em até 1 dia útil e manda o convite para ${a.gestorEmail}. Enquanto isso, separe o celular que vai ficar com o WhatsApp da loja.` : a?.pix ? 'Assim que o Pix for confirmado, esta página avisa sozinha (pode levar alguns segundos). Você também recebe um e-mail.' : a?.status === 'falhou' ? 'A operadora não aprovou o pagamento. Você pode tentar de novo com outro cartão ou por Pix.' : a?.status === 'expirada' ? 'O código venceu. Faça a adesão de novo para gerar um Pix novo.' : ''}</p></header>
      ${passos()}
      <section class="painel"><div class="painel-corpo pronto-assinatura">
        ${pago ? html`<div class="ok-grande">${icone('ok')}</div>` : ''}
        ${a?.pix ? html`<div class="pix-assinatura">
          ${a.pix.qrUrl ? html`<img class="pix-imagem" src="${a.pix.qrUrl}" alt="QR Code do Pix" width="180" height="180">` : ''}
          <div class="copia-linha"><input id="pix-codigo" readonly value="${a.pix.codigo}"><button class="btn" type="button" id="pix-copiar">${icone('copiar')}Copiar código</button></div>
          <p class="sub">${a.pix.expiraEm ? `O código vale até ${new Date(a.pix.expiraEm).toLocaleString('pt-BR')}.` : ''} Abra o app do seu banco, escolha pagar com Pix e cole o código. Valor: ${reais(a.valor)}.</p>
        </div>` : ''}
        ${pago ? html`<dl class="dados-grade"><div class="dado"><dt>Plano</dt><dd>${a.planoNome} · ${a.ciclo}</dd></div><div class="dado"><dt>Pagamento</dt><dd>${a.formaNome}${a.cartao ? ` · final ${a.cartao.final}` : ''}</dd></div><div class="dado"><dt>Valor</dt><dd class="num">${reais(a.valor)}</dd></div><div class="dado"><dt>Protocolo</dt><dd class="num">${String(a.id).slice(0, 8).toUpperCase()}</dd></div></dl>` : ''}
        <div class="acoes-linha">
          ${pago ? html`<a class="btn btn-primario" href="#/login">Já tenho acesso → Entrar</a>` : a?.pix ? html`<button class="btn btn-contorno" id="conferir">Já paguei — conferir</button>` : html`<button class="btn btn-primario" id="de-novo">Tentar de novo</button>`}
        </div>
      </div></section>`;
  }

  function desenhar() {
    render(alvo, moldura(passo === 0 ? passoLoja() : passo === 1 ? passoAcessos() : passo === 2 ? passoPagamento() : passoPronto()));
    window.scrollTo(0, 0);
    $$('[data-voltar]', alvo).forEach((b) => b.addEventListener('click', () => { guardar(b.closest('form')); passo--; desenhar(); }));
    const f = $('form', alvo);
    if (passo === 0 && f) {
      f.addEventListener('submit', (e) => { e.preventDefault(); guardar(f); const erros = validarLoja(); if (Object.keys(erros).length) return marcarErros(f, erros); passo = 1; desenhar(); });
      $('#ad-cnpj', f).addEventListener('input', (e) => { e.target.value = mascaraCnpj(e.target.value); });
      $('#ad-cep', f).addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2'); });
    }
    if (passo === 1 && f) f.addEventListener('submit', (e) => { e.preventDefault(); guardar(f); const erros = validarAcessos(); if (Object.keys(erros).length) return marcarErros(f, erros); passo = 2; desenhar(); });
    if (passo === 2 && f) {
      $$('[data-ciclo]', f).forEach((b) => b.addEventListener('click', () => { guardarPagamento(f); d.ciclo = b.dataset.ciclo; desenhar(); }));
      $$('[data-forma]', f).forEach((b) => b.addEventListener('click', () => { guardarPagamento(f); d.forma = b.dataset.forma; desenhar(); }));
      if (cfg.turnstile) montarTurnstile();
      f.addEventListener('submit', (e) => { e.preventDefault(); enviar(f); });
    }
    if (passo === 3) {
      $('#pix-copiar', alvo)?.addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#pix-codigo', alvo).value); avisar('Código copiado.'); } catch { $('#pix-codigo', alvo).select(); } });
      $('#conferir', alvo)?.addEventListener('click', () => atualizarSituacao(true));
      $('#de-novo', alvo)?.addEventListener('click', () => { pararVigia(); resultado = null; chave = null; try { localStorage.removeItem(CHAVE_LOCAL); } catch { /* ok */ } passo = 2; desenhar(); });
      if (!resultado?.status || (resultado?.status === 'aguardando')) { atualizarSituacao(); if (!vigia) vigia = setInterval(() => atualizarSituacao(), 5000); }
    }
  }
  const guardar = (f) => { if (!f) return; for (const el of f.elements) if (el.name && el.name in d && el.type !== 'checkbox') d[el.name] = el.value.trim(); };
  const guardarPagamento = (f) => { d.aceite = !!f.elements.aceite?.checked; };
  const mascaraCnpj = (v) => v.replace(/\D/g, '').slice(0, 14).replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
  function validarLoja() {
    const e = {};
    if (d.nomeLoja.length < 2) e.nomeLoja = 'Informe o nome da loja.';
    if (d.cnpj.replace(/\D/g, '').length !== 14) e.cnpj = 'CNPJ com 14 números.';
    if (d.razaoSocial.length < 2) e.razaoSocial = 'Informe a razão social.';
    if (d.endereco.length < 5) e.endereco = 'Informe o endereço completo.';
    if (!/^\d{5}-?\d{3}$/.test(d.cep)) e.cep = 'CEP com 8 números.';
    if (!/^.{2,}\s*[\/\-–,]\s*[A-Za-z]{2}$/.test(d.cidadeUf)) e.cidadeUf = 'Use o formato Cidade / UF.';
    if (d.whatsapp.replace(/\D/g, '').length < 10) e.whatsapp = 'WhatsApp com DDD.';
    return e;
  }
  function validarAcessos() {
    const e = {};
    if (d.gestorNome.length < 3) e.gestorNome = 'Informe o nome do gestor.';
    if (!emailValido(d.gestorEmail)) e.gestorEmail = 'E-mail inválido.';
    if (d.atendenteEmail && !emailValido(d.atendenteEmail)) e.atendenteEmail = 'E-mail inválido.';
    if (d.atendenteEmail && !d.atendenteNome) e.atendenteNome = 'Informe o nome do atendente.';
    if (d.atendenteEmail && d.atendenteEmail.toLowerCase() === d.gestorEmail.toLowerCase()) e.atendenteEmail = 'Use um e-mail diferente do gestor.';
    return e;
  }
  function montarTurnstile() {
    const caixa = $('#turnstile-adesao', alvo); if (!caixa) return;
    const render_ = () => { try { turnstileId = window.turnstile.render(caixa, { sitekey: cfg.turnstile, theme: 'auto', language: 'pt-BR' }); } catch { /* ignora */ } };
    if (window.turnstile) return render_();
    if (!document.querySelector('script[data-turnstile]')) { const s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true; s.dataset.turnstile = '1'; s.onload = render_; document.head.appendChild(s); } else { const t = setInterval(() => { if (window.turnstile) { clearInterval(t); render_(); } }, 200); }
  }
  async function enviar(f) {
    guardarPagamento(f); marcarErros(f, {});
    if (!d.aceite) return avisar('Marque a confirmação para continuar.', 'erro');
    const botao = $('button[type=submit]', f);
    await comBotao(botao, async () => {
      try {
        const corpo = { ...d, atendenteEmail: d.atendenteEmail || undefined, atendenteNome: d.atendenteNome || '', aceite: true };
        if (d.forma === 'cartao') corpo.cardToken = await tokenizarCartao({ numero: f.elements.numero.value, nome: f.elements.nome.value, validade: f.elements.validade.value, cvv: f.elements.cvv.value }, { simulado: cfg.simulado, chavePublica: cfg.chavePublica });
        if (cfg.turnstile) corpo.desafio = (turnstileId != null && window.turnstile?.getResponse(turnstileId)) || '';
        const r = await api.criarAdesao(corpo);
        resultado = r.adesao; chave = r.chave;
        try { localStorage.setItem(CHAVE_LOCAL, JSON.stringify({ id: resultado.id, chave, em: Date.now() })); } catch { /* ok */ }
        passo = 3; desenhar();
      } catch (err) {
        if (err.campos) { const campos = { ...err.campos }; const geral = campos.cartao || campos.desafio; marcarErros(f, campos); if (geral) avisar(geral, 'erro'); else if (campos.cnpj || campos.gestorEmail || campos.atendenteEmail) { avisar(Object.values(campos)[0], 'erro'); passo = campos.cnpj ? 0 : 1; desenhar(); setTimeout(() => marcarErros($('form', alvo), campos), 50); } else avisar(err.message, 'erro'); }
        else avisar(err.message, 'erro');
        if (cfg.turnstile && window.turnstile && turnstileId != null) { try { window.turnstile.reset(turnstileId); } catch { /* ok */ } }
      }
    });
  }
  async function atualizarSituacao(manual = false) {
    if (!resultado?.id || !chave) return;
    try {
      const r = await api.situacaoAdesao(resultado.id, chave);
      const antes = resultado.status; resultado = r.adesao;
      if (resultado.status !== 'aguardando') { pararVigia(); try { localStorage.removeItem(CHAVE_LOCAL); } catch { /* ok */ } }
      if (antes !== resultado.status || manual) { desenhar(); if (resultado.status === 'paga') avisar('Pagamento confirmado!'); else if (manual && resultado.status === 'aguardando') avisar('Ainda não recebemos o pagamento. Pode levar alguns segundos depois de pagar.', 'erro'); }
      else if (!antes) desenhar();
    } catch (err) { if (err.status === 404) { pararVigia(); try { localStorage.removeItem(CHAVE_LOCAL); } catch { /* ok */ } resultado = null; chave = null; passo = 0; desenhar(); } }
  }
  const pararVigia = () => { if (vigia) { clearInterval(vigia); vigia = null; } };

  desenhar();
  return { limpar: () => { pararVigia(); document.title = 'Conecta LocarX'; } };
}
