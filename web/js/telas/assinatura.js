// v14.8 — Assinatura do Conecta pela loja (Pagar.me): plano → pagamento → pronto. Também mostra a situação, faturas e cancelamento.
// Cartão: os dados vão direto para a Pagar.me (tokenização com a chave pública); o Conecta só recebe o token.
import { api } from '../api.js';
import { html, render, $, $$, icone, avisar, comBotao, confirmar, data } from '../util.js';

const reais = (c) => Number(c || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dia = (v) => data(typeof v === 'string' && v.length === 10 ? v + 'T12:00:00' : v);   // datas sem hora: meio-dia para não voltar um dia no fuso
const STATUS = { pendente: ['Aguardando pagamento', 'alerta'], ativa: ['Ativa', 'ok'], atrasada: ['Pagamento atrasado', 'erro'], suspensa: ['Suspensa por falta de pagamento', 'erro'], cancelada: ['Cancelada', ''], isenta: ['Isenta pela rede', 'ok'] };
const FATURA = { pendente: ['Em aberto', 'alerta'], paga: ['Paga', 'ok'], vencida: ['Vencida', 'erro'], cancelada: ['Cancelada', ''], falhou: ['Falhou', 'erro'] };
const NOTAS = [
  'Os valores apresentados não incluem eventuais custos de reservas, taxas ou cobranças de integradores e plataformas parceiras, que poderão ser cobrados separadamente.',
  'Estes são os planos iniciais, disponibilizados em fase de testes e aprimoramento. Novas versões, com melhorias, funcionalidades adicionais e evoluções tecnológicas, serão disponibilizadas gradualmente.',
];

export async function montar(alvo, ctx) {
  const bloqueando = !!ctx.usuario.assinatura?.pendente;
  const sistema = document.getElementById('sistema');
  if (bloqueando) sistema?.classList.add('so-termos', 'so-assinatura');
  render(alvo, html`<div class="cabecalho-pagina"><div class="titulos"><h1>Assinatura do Conecta</h1><p>Carregando…</p></div></div><div class="painel"><div class="painel-corpo"><div class="esqueleto"></div></div></div>`);
  let s;
  try { s = await api.assinatura(); } catch (err) {
    if (err.status === 401) return ctx.sessaoExpirou();
    return render(alvo, html`<div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar a assinatura</h3><p>${err.message}</p></div></div>`);
  }
  const estado = { passo: 'plano', plano: s.planos[0]?.chave || 'basico', ciclo: 'mensal', forma: 'cartao', resultado: null };

  function desenhar() {
    const a = s.assinatura;
    const emDia = a && ['ativa', 'atrasada', 'suspensa', 'isenta'].includes(a.status);
    const contratando = !emDia && s.podeContratar && s.ligada;
    const miolo = html`
      ${s.simulado ? html`<div class="alerta-caixa">${icone('info')}<span>Ambiente de teste: a Pagar.me está simulada — nada é cobrado de verdade.</span></div>` : ''}
      ${!s.ligada ? html`<div class="alerta-caixa info">${icone('info')}<span>A assinatura online ainda não está disponível. Fale com a administração da rede.</span></div>` : ''}
      ${a?.status === 'atrasada' ? html`<div class="alerta-caixa erro">${icone('alerta')}<span><strong>Pagamento atrasado.</strong> Regularize a fatura em aberto para manter o acesso da loja.</span></div>` : ''}
      ${a?.status === 'suspensa' ? html`<div class="alerta-caixa erro">${icone('alerta')}<span><strong>Acesso suspenso por falta de pagamento.</strong> Pague a fatura em aberto abaixo e o acesso volta sozinho assim que o pagamento for confirmado.</span></div>` : ''}
      ${emDia ? situacao(a) : contratando ? (estado.passo === 'pronto' ? pronto() : estado.passo === 'pagamento' ? pagamento() : planos()) : a?.status === 'pendente' ? aguardando() : html`<section class="painel"><div class="painel-corpo"><p class="sub">${s.podeContratar ? '' : 'Só o gestor da loja contrata a assinatura.'}</p>${planosLista(false)}</div></section>`}
      ${s.faturas?.length ? faturas() : ''}`;
    const titulo = estado.passo === 'pronto' && estado.resultado ? ['Tudo certo', 'Sua loja já está no Conecta.'] : emDia ? ['Assinatura do Conecta', `Plano ${a.planoNome} · ${a.ciclo === 'anual' ? 'anual' : 'mensal'} · ${a.formaNome}.`] : a?.status === 'pendente' ? ['Aguardando o pagamento', 'Assim que a Pagar.me confirmar, o acesso libera sozinho.'] : estado.passo === 'pagamento' ? ['Pagamento', 'Escolha como quer pagar. A cobrança é processada pela Pagar.me.'] : ['Escolha o plano da sua loja', 'Cobrança mensal ou anual, sem fidelidade no mensal. O acesso ao Conecta libera assim que o pagamento for confirmado.'];
    if (!bloqueando) {
      render(alvo, html`<div class="cabecalho-pagina"><div class="titulos"><h1>${titulo[0]}</h1><p>${titulo[1]}</p></div>${a ? html`<span class="selo ${STATUS[a.status]?.[1] || ''}">${STATUS[a.status]?.[0] || a.status}</span>` : ''}</div>${miolo}`);
    } else {
      // tela de entrada (sem menu): faixa preta da marca + passos, como a tela de acesso
      const passo = estado.passo === 'pronto' || emDia ? 3 : estado.passo === 'pagamento' || a?.status === 'pendente' ? 2 : 1;
      const loja = s.loja?.nome || ctx.usuario.loja?.nome || '';
      render(alvo, html`<div class="acesso assinatura-acesso">
        <aside class="acesso-marca">
          <div>
            <img class="logo" src="/assets/logo-locarx-branca.png" alt="LocarX" width="200">
            <div class="chamada assinatura-chamada"><h1>Ative o <span>Conecta</span> na sua loja</h1><p>Atendimento pelo WhatsApp, assistente virtual Lia e CRM da rede LocarX. Pague e comece a usar hoje.</p></div>
            <nav class="passos-assinatura" aria-label="Etapas">
              ${[['Escolher o plano'], ['Pagamento'], ['Pronto para usar']].map(([n], i) => html`<div class="passo-item ${passo === i + 1 ? 'atual' : passo > i + 1 ? 'feito' : ''}"><i>${passo > i + 1 ? '✓' : i + 1}</i> ${n}</div>`)}
            </nav>
          </div>
          <img class="x-fundo" src="/assets/icone-512.png" alt="">
          <div class="rodape-marca">Conecta LocarX · Auniti Tecnologia · Pagamentos processados pela Pagar.me</div>
        </aside>
        <div class="assinatura-area"><div class="assinatura-caixa">
          <header class="cabecalho-pagina"><div class="titulos"><h1>${titulo[0]}</h1><p>${titulo[1]}</p></div>${a ? html`<span class="selo ${STATUS[a.status]?.[1] || ''}">${STATUS[a.status]?.[0] || a.status}</span>` : ''}</header>
          ${loja ? html`<div class="loja-chip"><span class="av">${loja.replace(/^LocarX\s*/i, '').slice(0, 2).toUpperCase()}</span><div><b>${loja}</b><br><small>Gestor: ${ctx.usuario.nome}</small></div></div>` : ''}
          ${miolo}
        </div></div>
      </div>`);
    }
    ligar();
  }

  // ---------- blocos ----------
  function planosLista(interativo = true) {
    return html`<div class="planos-grade">${s.planos.map((p) => html`
      <button class="plano-cartao ${estado.plano === p.chave ? 'ativo' : ''}" type="button" data-plano="${p.chave}" ${interativo ? '' : 'disabled'}>
        ${p.destaque && s.planos.length > 1 ? html`<span class="selo marca plano-selo">Mais escolhido</span>` : ''}
        <div class="plano-cab"><div><div class="plano-rotulo">${p.rotulo}</div><div class="plano-preco num">${estado.ciclo === 'anual' ? reais(p.anual / 100) : reais(p.mensal / 100)}<small>${estado.ciclo === 'anual' ? '/ano' : '/mês'}</small></div>${estado.ciclo === 'anual' ? html`<div class="sub">equivale a ${reais(p.anual / 1200)}/mês</div>` : ''}</div>${interativo ? html`<span class="plano-radio"></span>` : ''}</div>
        <h3>${p.nome}</h3><p class="sub">${p.descricao}</p>
        <ul class="plano-lista">${p.inclui.map((i) => html`<li>${icone('ok')}${i}</li>`)}${p.naoInclui.map((i) => html`<li class="nao">– ${i}</li>`)}</ul>
      </button>`)}</div>`;
  }
  function planos() {
    return html`<section class="painel"><div class="painel-corpo">
      <div class="acoes-linha entre">
        <div class="ciclo-troca" role="group" aria-label="Ciclo"><button type="button" class="${estado.ciclo === 'mensal' ? 'ativo' : ''}" data-ciclo="mensal">Mensal</button><button type="button" class="${estado.ciclo === 'anual' ? 'ativo' : ''}" data-ciclo="anual">Anual <span class="selo ok">menor preço</span></button></div>
        <span class="sub">Sem fidelidade no mensal. O acesso libera assim que o pagamento for confirmado.</span>
      </div>
      ${planosLista(true)}
      <div class="notas-plano">${NOTAS.map((n) => html`<p>${n}</p>`)}</div>
      <div class="acoes-linha entre"><span></span><button class="btn btn-primario" id="ir-pagamento">Continuar com o ${s.planos.find((x) => x.chave === estado.plano)?.nome || 'plano'} →</button></div>
    </div></section>`;
  }
  function pagamento() {
    const p = s.planos.find((x) => x.chave === estado.plano);
    const total = estado.ciclo === 'anual' ? p.anual : p.mensal;
    const hojeD = new Date(); const prox = new Date(hojeD); if (estado.ciclo === 'anual') prox.setFullYear(prox.getFullYear() + 1); else prox.setMonth(prox.getMonth() + 1);
    return html`<div class="assinatura-grade">
      <section class="painel"><form class="painel-corpo form" id="form-pagar" novalidate>
        <h2>Forma de pagamento</h2>
        <div class="formas-grade" role="group">
          ${[['cartao', 'Cartão de crédito', 'renova sozinho a cada ciclo'], ['pix', 'Pix', 'libera em segundos; um código por ciclo'], ['boleto', 'Boleto', 'libera em até 2 dias úteis']].map(([k, n, d]) => html`<button type="button" class="forma-opcao ${estado.forma === k ? 'ativo' : ''}" data-forma="${k}"><strong>${n}</strong><span class="sub">${d}</span></button>`)}
        </div>
        ${estado.forma === 'cartao' ? html`
          <div class="form-linha">
            <div class="campo campo-largo"><label for="ca-num">Número do cartão</label><input id="ca-num" name="numero" inputmode="numeric" autocomplete="cc-number" placeholder="0000 0000 0000 0000"></div>
            <div class="campo campo-largo"><label for="ca-nome">Nome impresso no cartão</label><input id="ca-nome" name="nome" autocomplete="cc-name"></div>
            <div class="campo"><label for="ca-val">Validade (MM/AA)</label><input id="ca-val" name="validade" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/AA"></div>
            <div class="campo"><label for="ca-cvv">CVV</label><input id="ca-cvv" name="cvv" inputmode="numeric" autocomplete="cc-csc" placeholder="123"></div>
          </div>
          <p class="ajuda">${icone('cadeado')} Os dados do cartão vão direto para a Pagar.me, criptografados. O Conecta não guarda o número do cartão.</p>` : estado.forma === 'pix' ? html`
          <div class="alerta-caixa info">${icone('info')}<span>Ao confirmar, geramos o QR Code e o código "copia e cola". O Pix não renova sozinho: a cada ciclo você recebe um código novo aqui e por e-mail, 5 dias antes do vencimento.</span></div>` : html`
          <div class="alerta-caixa info">${icone('info')}<span>O boleto é gerado ao confirmar (vencimento em 3 dias) e enviado para o e-mail de cobrança da loja. O acesso libera em até 2 dias úteis após o pagamento.</span></div>`}
        <div class="acoes-linha entre"><button class="btn btn-texto" type="button" id="voltar-plano">← Trocar o plano</button><button class="btn btn-primario" type="submit">${estado.forma === 'cartao' ? 'Confirmar e pagar' : estado.forma === 'pix' ? 'Gerar Pix de' : 'Gerar boleto de'} ${reais(total / 100)}</button></div>
      </form></section>
      <aside class="painel"><div class="painel-corpo resumo-assinatura">
        <h2>Resumo</h2>
        <div><span>Plano</span><b>${p.nome}</b></div>
        <div><span>Ciclo</span><span>${estado.ciclo === 'anual' ? 'Anual' : 'Mensal'}</span></div>
        <div><span>Loja</span><span>${s.loja?.nome || ctx.usuario.loja?.nome || ''}</span></div>
        <div><span>Primeira cobrança</span><span>hoje, ${hojeD.toLocaleDateString('pt-BR')}</span></div>
        <div class="sub-linha"><span>Próxima</span><span>${estado.forma === 'cartao' || estado.forma === 'boleto' ? prox.toLocaleDateString('pt-BR') : prox.toLocaleDateString('pt-BR') + ' (Pix novo 5 dias antes)'}</span></div>
        <div class="total"><span>Total</span><span class="num">${reais(total / 100)}</span></div>
        <p class="sub">Você pode cancelar a qualquer momento nesta tela. A cobrança é feita pela Pagar.me em nome da Auniti Tecnologia.</p>
      </div></aside>
    </div>`;
  }
  function pronto() {
    const r = estado.resultado; const f = r?.fatura;
    return html`<section class="painel"><div class="painel-corpo pronto-assinatura">
      <div class="ok-grande">${icone('ok')}</div>
      <h2>${r.assinatura.status === 'ativa' ? 'Pagamento confirmado' : f?.pix ? 'Pague o Pix para liberar' : 'Boleto gerado'}</h2>
      <p class="sub">${r.assinatura.status === 'ativa' ? `O ${r.assinatura.planoNome} já está ativo para a loja.` : f?.pix ? 'Assim que o Pix for confirmado, o acesso libera sozinho (pode levar alguns segundos).' : 'O acesso libera em até 2 dias úteis após o pagamento do boleto.'}</p>
      ${f?.pix ? pixBloco(f) : ''}${f?.boleto ? boletoBloco(f) : ''}
      <div class="acoes-linha">${r.assinatura.status === 'ativa' ? html`<button class="btn btn-primario" id="entrar">Entrar no Conecta →</button>` : html`<button class="btn btn-contorno" id="conferir">Já paguei — conferir</button>`}</div>
    </div></section>`;
  }
  function aguardando() {
    const f = s.faturaAberta;
    return html`<section class="painel"><div class="painel-corpo">
      <div class="painel-cab"><div><h2>Aguardando o pagamento</h2><span class="sub">${f ? `Fatura ${f.referencia} · ${reais(f.valor)} · ${f.formaNome}${f.venceEm ? ` · vence ${dia(f.venceEm)}` : ''}` : ''}</span></div></div>
      ${f?.pix ? pixBloco(f) : ''}${f?.boleto ? boletoBloco(f) : ''}
      <div class="acoes-linha"><button class="btn btn-contorno" id="conferir">Já paguei — conferir</button>${s.podeContratar ? html`<button class="btn btn-texto" id="recomecar">Escolher outra forma de pagamento</button>` : ''}</div>
    </div></section>`;
  }
  function pixBloco(f) {
    return html`<div class="pix-assinatura">
      ${f.pix.qrUrl ? html`<img class="pix-imagem" src="${f.pix.qrUrl}" alt="QR Code do Pix" width="180" height="180">` : ''}
      <div class="copia-linha"><input id="pix-codigo" readonly value="${f.pix.codigo}"><button class="btn" type="button" id="pix-copiar">${icone('copiar')}Copiar código</button></div>
      <p class="sub">${f.pix.expiraEm ? `O código vale até ${dia(f.pix.expiraEm)}.` : ''} Abra o app do seu banco, escolha pagar com Pix e cole o código.</p>
    </div>`;
  }
  function boletoBloco(f) {
    return html`<div class="pix-assinatura">
      ${f.boleto.linha ? html`<div class="copia-linha"><input id="boleto-linha" readonly value="${f.boleto.linha}"><button class="btn" type="button" id="boleto-copiar">${icone('copiar')}Copiar linha</button></div>` : ''}
      ${f.boleto.url ? html`<a class="btn btn-contorno" href="${f.boleto.url}" target="_blank" rel="noopener">Abrir o boleto</a>` : ''}
    </div>`;
  }
  function situacao(a) {
    return html`<section class="painel"><div class="painel-corpo">
      <dl class="dados-grade">
        <div class="dado"><dt>Plano</dt><dd>${a.planoNome}${a.status === 'isenta' ? html`<div class="sub">cortesia da rede${a.observacao ? ` · ${a.observacao}` : ''}</div>` : ''}</dd></div>
        <div class="dado"><dt>Valor</dt><dd class="num">${a.valor ? `${reais(a.valor)} / ${a.ciclo === 'anual' ? 'ano' : 'mês'}` : '—'}</dd></div>
        <div class="dado"><dt>Pagamento</dt><dd>${a.formaNome}${a.cartao ? html`<div class="sub">${a.cartao.bandeira || 'cartão'} final ${a.cartao.final}</div>` : ''}</dd></div>
        <div class="dado"><dt>Próxima cobrança</dt><dd>${a.proximaCobranca ? dia(a.proximaCobranca) : '—'}</dd></div>
        <div class="dado"><dt>Desde</dt><dd>${a.inicioEm ? dia(a.inicioEm) : '—'}</dd></div>
      </dl>
      ${s.faturaAberta ? html`<div class="alerta-caixa ${a.status === 'atrasada' ? 'erro' : ''}">${icone('alerta')}<span><strong>Fatura ${s.faturaAberta.referencia} em aberto:</strong> ${reais(s.faturaAberta.valor)}${s.faturaAberta.venceEm ? `, vence ${dia(s.faturaAberta.venceEm)}` : ''}.</span></div>${s.faturaAberta.pix ? pixBloco(s.faturaAberta) : ''}${s.faturaAberta.boleto ? boletoBloco(s.faturaAberta) : ''}` : ''}
      <div class="acoes-linha">
        ${s.faturaAberta ? html`<button class="btn btn-contorno" id="conferir">Já paguei — conferir</button>` : ''}
        ${s.faturaAberta && s.podeContratar && a.status !== 'isenta' ? html`<button class="btn btn-contorno" id="novo-pix">${s.faturaAberta.pix ? 'Gerar Pix novo' : 'Pagar com Pix'}</button>` : ''}
        ${s.podeContratar && a.status !== 'isenta' ? html`<button class="btn btn-texto" id="cancelar-assinatura">Cancelar assinatura</button>` : ''}
      </div>
    </div></section>`;
  }
  function faturas() {
    return html`<section class="painel"><div class="painel-cab"><h2>Faturas</h2></div>
      <div class="tabela-caixa"><table class="tabela"><thead><tr><th>Referência</th><th>Valor</th><th>Forma</th><th>Vencimento</th><th>Situação</th><th>Pago em</th></tr></thead>
      <tbody>${s.faturas.map((f) => html`<tr><td>${f.referencia}</td><td class="num">${reais(f.valor)}</td><td>${f.formaNome}</td><td>${f.venceEm ? dia(f.venceEm) : '—'}</td><td><span class="selo ${FATURA[f.status]?.[1] || ''}">${FATURA[f.status]?.[0] || f.status}</span></td><td>${f.pagaEm ? dia(f.pagaEm) : '—'}</td></tr>`)}</tbody></table></div></section>`;
  }

  // ---------- ações ----------
  async function recarregar() { try { s = await api.assinatura(); } catch (err) { if (err.status === 401) return ctx.sessaoExpirou(); avisar(err.message, 'erro'); } desenhar(); }
  function liberar() {
    sistema?.classList.remove('so-termos', 'so-assinatura');
    ctx.atualizarUsuario({ ...ctx.usuario, assinatura: { ...(ctx.usuario.assinatura || {}), status: 'ativa', pendente: false }, loja: ctx.usuario.loja });
  }
  function ligar() {
    $$('[data-plano]', alvo).forEach((b) => b.addEventListener('click', () => { estado.plano = b.dataset.plano; desenhar(); }));
    $$('[data-ciclo]', alvo).forEach((b) => b.addEventListener('click', () => { estado.ciclo = b.dataset.ciclo; desenhar(); }));
    $$('[data-forma]', alvo).forEach((b) => b.addEventListener('click', () => { estado.forma = b.dataset.forma; desenhar(); }));
    $('#entrar', alvo)?.addEventListener('click', () => { liberar(); ctx.navegar('inicio'); });
    $('#conferir', alvo)?.addEventListener('click', async () => { await recarregar(); if (['ativa', 'isenta'].includes(s.assinatura?.status)) { avisar('Pagamento confirmado!'); liberar(); } else avisar('Ainda não recebemos a confirmação. Tente de novo em instantes.'); });
    $('#ir-pagamento', alvo)?.addEventListener('click', () => { estado.passo = 'pagamento'; desenhar(); window.scrollTo({ top: 0 }); });
    $('#voltar-plano', alvo)?.addEventListener('click', () => { estado.passo = 'plano'; desenhar(); window.scrollTo({ top: 0 }); });
    $('#novo-pix', alvo)?.addEventListener('click', async (e) => { await comBotao(e.currentTarget, async () => { try { await api.novoPixAssinatura(); avisar('Pix gerado. Pague e clique em "Já paguei".'); await recarregar(); } catch (err) { avisar(err.message, 'erro'); } }); });
    $('#recomecar', alvo)?.addEventListener('click', () => { s = { ...s, assinatura: null, faturaAberta: null }; estado.passo = 'plano'; desenhar(); });
    const copiar = (idInput, idBtn) => $(idBtn, alvo)?.addEventListener('click', async (e) => { const i = $(idInput, alvo); const b = e.currentTarget; try { await navigator.clipboard.writeText(i.value); } catch { i.select(); document.execCommand?.('copy'); } b.textContent = 'Copiado'; setTimeout(() => desenhar(), 1500); });
    copiar('#pix-codigo', '#pix-copiar'); copiar('#boleto-linha', '#boleto-copiar');
    $('#cancelar-assinatura', alvo)?.addEventListener('click', async () => {
      const ok = await confirmar({ titulo: 'Cancelar assinatura', texto: 'A loja perde o acesso ao Conecta no fim do ciclo já pago. A Lia para de atender e a equipe não consegue mais entrar. Tem certeza?', botao: 'Cancelar assinatura', perigo: true });
      if (!ok) return;
      try { await api.cancelarAssinatura('cancelada pelo gestor'); avisar('Assinatura cancelada.'); await recarregar(); } catch (err) { avisar(err.message, 'erro'); }
    });
    $('#form-pagar', alvo)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('[type=submit]', e.target);
      await comBotao(btn, async () => {
        try {
          let cardToken;
          if (estado.forma === 'cartao') cardToken = await tokenizar(e.target);
          const r = await api.contratarAssinatura({ plano: estado.plano, ciclo: estado.ciclo, forma: estado.forma, cardToken });
          estado.resultado = r; estado.passo = 'pronto';
          if (r.assinatura.status === 'ativa') { avisar('Assinatura ativa. Bem-vindo ao Conecta!'); if (bloqueando) { liberar(); return ctx.navegar('inicio'); } }
          s = await api.assinatura().catch(() => s);
          if (r.assinatura.status === 'ativa') s = { ...s, assinatura: null };   // mostra o passo "pronto" com o botão de entrar
          desenhar();
        } catch (err) {
          if (err.status === 401) return ctx.sessaoExpirou();
          avisar(err.message, 'erro');
        }
      });
    });
  }

  // tokenização do cartão direto na Pagar.me (chave pública); em modo simulado gera um token local
  async function tokenizar(form) {
    const numero = form.elements.numero.value.replace(/\D/g, ''), nome = form.elements.nome.value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 64), val = form.elements.validade.value.replace(/\D/g, ''), cvv = form.elements.cvv.value.replace(/\D/g, '');
    if (numero.length < 13 || !nome || val.length !== 4 || cvv.length < 3) throw new Error('Confira o número, o nome, a validade (MM/AA) e o CVV do cartão.');
    if (s.simulado || !s.chavePublica) return `token_simulado_${numero.slice(-4)}`;
    const r = await fetch(`https://api.pagar.me/core/v5/tokens?appId=${encodeURIComponent(s.chavePublica)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'card', card: { number: numero, holder_name: nome, exp_month: Number(val.slice(0, 2)), exp_year: Number(val.slice(2)), cvv } }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id) {
      // a Pagar.me manda o motivo em `errors` ({ "card.exp_year": ["..."] }); mostra para o gestor saber o que corrigir
      const detalhes = j.errors && typeof j.errors === 'object' ? Object.entries(j.errors).map(([k, v]) => `${k.replace(/^card\./, '')}: ${[].concat(v).join(', ')}`).join(' · ') : '';
      throw new Error(`A Pagar.me não aceitou o cartão${detalhes ? ' — ' + detalhes : j.message ? ' — ' + j.message : ''}. Confira número, nome (sem números ou acentos), validade e CVV.`);
    }
    return j.id;
  }

  desenhar();
  return { limpar: () => sistema?.classList.remove('so-termos', 'so-assinatura') };
}
