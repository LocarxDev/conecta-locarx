// Cotação ao vivo: a equipe informa só data e hora; a filial é a da loja (cada loja cota no próprio contexto).
// Mostra os grupos e valores da tabela vigente da API LocarX, calcula com proteções, coloca o texto na conversa
// para o atendente revisar e, se quiser, reserva pela API com o mesmo resumo e confirmação do assistente.
// A mesma peça aparece na tela Cotação (#/cotacao) e numa janela dentro da conversa (botão "Cotação").
import { api } from '../api.js';
import { html, render, $, $$, icone, avisar, abrirModal, comBotao, marcarErros, dadosDoForm } from '../util.js';

const reais = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const cambio = (c) => (c ? String(c).toLowerCase().replace('automatic', 'automático') : '—');
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dataBr = (x) => `${x.date.split('-').reverse().join('/')} às ${x.time}`;
const mascaraCpf = (v) => v.replace(/\D/g, '').slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');

/**
 * Monta a cotação dentro de `alvo`.
 * @param {object} op
 *  ctx          contexto da tela (usuário, navegar, sessaoExpirou)
 *  conversa     { id, contato: { id, nome, telefone, email } } quando aberta de dentro de uma conversa
 *  compacto     true dentro da janela (sem o painel em volta do formulário)
 *  aoUsarTexto  (texto) → coloca o texto no campo de mensagem da conversa para o atendente revisar
 *  aoReservar   (reserva) → avisa a conversa que uma reserva foi criada (atualiza o histórico)
 */
export function montarCotacao(alvo, { ctx, conversa = null, compacto = false, aoUsarTexto = null, aoReservar = null }) {
  let periodo = null, resultado = null;
  const naConversa = !!(conversa && aoUsarTexto);
  // padrão: retirada depois de amanhã às 10h, devolução 3 dias depois (a API não mostra carros com menos de 24 h)
  const r = new Date(Date.now() + 2 * 86_400_000), d = new Date(Date.now() + 5 * 86_400_000);

  const formulario = html`
    <form class="${compacto ? 'form' : 'painel-corpo form'}" id="form-cotacao" novalidate>
      <div class="form-linha periodo-cotacao">
        <div class="campo"><label for="dataRetirada">Retirada</label><input id="dataRetirada" name="dataRetirada" type="date" value="${iso(r)}" required></div>
        <div class="campo"><label for="horaRetirada">Hora</label><input id="horaRetirada" name="horaRetirada" type="time" value="10:00" step="900" required></div>
        <div class="campo"><label for="dataDevolucao">Devolução</label><input id="dataDevolucao" name="dataDevolucao" type="date" value="${iso(d)}" required></div>
        <div class="campo"><label for="horaDevolucao">Hora</label><input id="horaDevolucao" name="horaDevolucao" type="time" value="10:00" step="900" required></div>
      </div>
      <div class="acoes-form"><button class="btn btn-primario" type="submit" id="consultar">${icone('busca')}Consultar valores</button>
        <span class="sub">Retirada e devolução nesta loja. Os totais incluem a Proteção X e as taxas.</span></div>
    </form>`;
  render(alvo, html`${compacto ? formulario : html`<section class="painel">${formulario}</section>`}<div id="resultado-cotacao" hidden></div>`);

  const form = $('#form-cotacao', alvo), area = $('#resultado-cotacao', alvo);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const dados = dadosDoForm(form);
    const erros = {};
    for (const [k, rotulo] of [['dataRetirada', 'Informe a data de retirada.'], ['horaRetirada', 'Informe a hora.'], ['dataDevolucao', 'Informe a data de devolução.'], ['horaDevolucao', 'Informe a hora.']]) if (!dados[k]) erros[k] = rotulo;
    if (!Object.keys(erros).length && `${dados.dataDevolucao}T${dados.horaDevolucao}` <= `${dados.dataRetirada}T${dados.horaRetirada}`) erros.dataDevolucao = 'A devolução precisa ser depois da retirada.';
    if (!marcarErros(form, erros)) return;
    comBotao($('#consultar', form), async () => {
      try {
        resultado = await api.cotar(dados);
        periodo = dados;
        desenhar();
      } catch (err) {
        if (err.status === 401) return ctx.sessaoExpirou();
        if (err.campos) marcarErros(form, err.campos);
        avisar(err.message, 'erro');
      }
    });
  });

  function desenhar() {
    area.hidden = false;
    const p = resultado.periodo;
    const cab = html`<div class="painel-cab"><h2>${dataBr(p.retirada)} → ${dataBr(p.devolucao)}</h2>
      ${resultado.grupos.length ? html`<div class="acoes-cab">
        <button class="btn btn-contorno" id="copiar-opcoes" title="Copiar as 3 opções mais baratas no formato do WhatsApp">${icone('copiar')}Copiar texto</button>
        ${naConversa ? html`<button class="btn btn-primario" id="usar-opcoes" title="Coloca as 3 opções mais baratas no campo de mensagem, para você revisar e enviar">${icone('whatsapp')}Enviar ao cliente</button>` : ''}
      </div>` : ''}</div>`;
    if (!resultado.grupos.length) {
      render(area, html`<section class="painel">${cab}<div class="estado">${icone('vazio')}<h3>Nenhum carro disponível</h3><p>${resultado.aviso || 'O portal LocarX não retornou grupos para este período nesta loja.'}</p></div></section>`);
      return;
    }
    render(area, html`<section class="painel">${cab}
      <div class="tabela-caixa"><table class="tabela">
        <thead><tr><th>Grupo</th><th class="col-opcional">Modelos</th><th class="col-opcional">Câmbio</th><th>Diária</th><th>Total</th><th><span class="sr-only">Ações</span></th></tr></thead>
        <tbody>${resultado.grupos.map((g) => html`<tr>
          <td><strong>${g.letra} – ${g.nome}</strong><div class="sub">${[g.passageiros ? `${g.passageiros} lugares` : null, g.malas ? `${g.malas} malas` : null].filter(Boolean).join(' · ')}</div></td>
          <td class="col-opcional">${g.exemplos || '—'}</td>
          <td class="col-opcional">${cambio(g.cambio)}</td>
          <td class="num">${reais(g.diaria)}<div class="sub">${g.diarias ? `${g.diarias} diária${g.diarias > 1 ? 's' : ''}` : ''}</div></td>
          <td class="num"><strong>${reais(g.total)}</strong></td>
          <td><div class="acoes-linha"><button class="btn btn-texto" data-protecoes="${g.fleetId}" title="Proteções, valor final e reserva">${naConversa ? 'Proteções / Reservar' : 'Proteções'}</button></div></td>
        </tr>`)}</tbody></table></div>
      ${resultado.km ? html`<div class="painel-corpo rodape-cotacao"><p class="sub">${typeof resultado.km === 'string' ? resultado.km : 'Quilometragem: ' + JSON.stringify(resultado.km)}</p></div>` : ''}</section>`);

    $('#copiar-opcoes', area)?.addEventListener('click', () => copiar(resultado.textoWhatsapp));
    $('#usar-opcoes', area)?.addEventListener('click', () => usar(resultado.textoWhatsapp));
    $$('[data-protecoes]', area).forEach((b) => b.addEventListener('click', () => abrirProtecoes(resultado.grupos.find((g) => String(g.fleetId) === b.dataset.protecoes))));
  }

  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); avisar('Texto copiado. É só colar na conversa.'); }
    catch { avisar('Não foi possível copiar. Selecione o texto e copie manualmente.', 'erro'); }
  }

  // coloca o texto no campo de mensagem da conversa (o atendente revisa e clica em Enviar)
  function usar(texto) { aoUsarTexto?.(texto); }

  // ---------- proteções: Super X e opcionais, calculadas pela API; daqui sai a reserva ----------
  function abrirProtecoes(g) {
    if (!g) return;
    const basicas = g.protecoes.filter((p) => p.basica || /^PROTECAO_(SUPER_)?X$/.test(p.codigo || ''));
    const opcionais = g.protecoes.filter((p) => !basicas.includes(p));
    const linhaP = (p, tipo, marcada) => html`<label class="opcao-modo"><input type="${tipo}" name="${tipo === 'radio' ? 'basica' : 'opc'}" value="${p.codigo}" ${marcada ? 'checked' : ''}>
      <div><strong>${p.nome}</strong>${p.descricao ? html`<div class="sub">${p.descricao}</div>` : ''}<div class="sub">${p.diaria != null ? reais(p.diaria) + ' por diária' : ''}${p.total != null ? ' · ' + reais(p.total) + ' no período' : ''}</div></div></label>`;
    const m = abrirModal({
      titulo: `${g.letra} – ${g.nome}`,
      corpo: html`<form class="form" id="form-protecoes" novalidate>
        ${basicas.length ? html`<div class="campo"><label>Proteção básica (obrigatória)</label><div class="lista-opcoes">${basicas.map((p, i) => linhaP(p, 'radio', i === 0))}</div></div>` : ''}
        ${opcionais.length ? html`<div class="campo"><label>Opcionais</label><div class="lista-opcoes">${opcionais.map((p) => linhaP(p, 'checkbox', false))}</div></div>` : ''}
        <div id="total-protecoes" class="total-cotacao"><span class="sub">Total com Proteção X: </span><strong>${reais(g.total)}</strong></div>
      </form>`,
      rodape: html`<button class="btn btn-contorno" data-fechar>Fechar</button>
        <button class="btn btn-contorno" id="copiar-preco" hidden>${icone('copiar')}Copiar</button>
        ${naConversa ? html`<button class="btn btn-contorno" id="usar-preco" hidden>${icone('whatsapp')}Enviar ao cliente</button>` : ''}
        ${naConversa ? html`<button class="btn btn-contorno" id="reservar" title="Cria a reserva no portal LocarX com os dados do cliente">${icone('reservas')}Reservar</button>` : ''}
        <button class="btn btn-primario" type="submit" form="form-protecoes">Calcular</button>`,
    });
    const f = $('#form-protecoes', m.el), totalEl = $('#total-protecoes', m.el);
    const escolhidas = () => [...f.querySelectorAll('input:checked')].map((i) => i.value).filter(Boolean);
    let preco = null;
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      await comBotao($('[type="submit"]', m.el), async () => {
        try {
          preco = await api.precoCotacao({ ...periodo, fleetId: g.fleetId, protecoes: escolhidas() });
          render(totalEl, html`<span class="sub">${preco.protecoes.join(' + ')}: </span><strong>${reais(preco.total)}</strong>${preco.diarias ? html`<span class="sub"> · ${preco.diarias} diária${preco.diarias > 1 ? 's' : ''} de ${reais(preco.diaria)}</span>` : ''}`);
          $('#copiar-preco', m.el).hidden = false;
          const u = $('#usar-preco', m.el); if (u) u.hidden = false;
        } catch (err) { if (err.status === 401) return ctx.sessaoExpirou(); avisar(err.message, 'erro'); }
      });
    });
    // o preço muda se trocar a proteção: esconde os botões até calcular de novo
    f.addEventListener('change', () => { preco = null; $('#copiar-preco', m.el).hidden = true; const u = $('#usar-preco', m.el); if (u) u.hidden = true; });
    $('#copiar-preco', m.el).addEventListener('click', () => preco && copiar(preco.textoWhatsapp));
    $('#usar-preco', m.el)?.addEventListener('click', () => { if (preco) { usar(preco.textoWhatsapp); m.fechar(); } });
    $('#reservar', m.el)?.addEventListener('click', () => abrirReserva(g, escolhidas(), () => m.fechar()));
  }

  // ---------- reserva pela equipe: dados do cliente → resumo → confirmação (igual ao assistente) ----------
  function abrirReserva(g, protecoes, aoConcluir) {
    const ct = conversa?.contato || {};
    const m = abrirModal({
      titulo: `Reservar ${g.letra} – ${g.nome}`,
      corpo: html`<form class="form" id="form-reserva" novalidate>
        <p class="sub">${dataBr({ date: periodo.dataRetirada, time: periodo.horaRetirada })} → ${dataBr({ date: periodo.dataDevolucao, time: periodo.horaDevolucao })} · ${protecoes.length ? protecoes.map((p) => (g.protecoes.find((x) => x.codigo === p) || {}).nome || p).join(', ') : 'Proteção X'} · pagamento na loja, na retirada</p>
        <div class="campo"><label for="r-nome">Nome completo do condutor</label><input id="r-nome" name="nome" value="${ct.nome || ''}" autocomplete="off" required></div>
        <div class="form-linha">
          <div class="campo"><label for="r-cpf">CPF</label><input id="r-cpf" name="cpf" inputmode="numeric" placeholder="000.000.000-00" required></div>
          <div class="campo"><label for="r-cnh">CNH (opcional)</label><input id="r-cnh" name="cnh" inputmode="numeric" placeholder="Só números"></div>
        </div>
        <div class="form-linha">
          <div class="campo"><label for="r-email">E-mail</label><input id="r-email" name="email" type="email" value="${ct.email || ''}" required></div>
          <div class="campo"><label for="r-tel">Telefone</label><input id="r-tel" name="telefone" inputmode="tel" value="${ct.telefone || ''}" required><p class="ajuda">Vem do WhatsApp do cliente.</p></div>
        </div>
        <div id="resumo-reserva" hidden></div>
      </form>`,
      rodape: html`<button class="btn btn-contorno" data-fechar>Cancelar</button>
        <button class="btn btn-primario" type="submit" form="form-reserva" id="ver-resumo">Ver resumo</button>
        <button class="btn btn-primario" id="confirmar-reserva" hidden>Confirmar reserva</button>`,
    });
    const f = $('#form-reserva', m.el), resumoEl = $('#resumo-reserva', m.el), btnResumo = $('#ver-resumo', m.el), btnConfirmar = $('#confirmar-reserva', m.el);
    f.elements.cpf.addEventListener('input', (e) => { e.target.value = mascaraCpf(e.target.value); });
    const dadosReserva = () => ({ ...periodo, fleetId: g.fleetId, protecoes, ...dadosDoForm(f), contatoId: ct.id || undefined, conversaId: conversa?.id || undefined });
    // qualquer mudança nos dados invalida o resumo mostrado
    f.addEventListener('input', () => { resumoEl.hidden = true; btnConfirmar.hidden = true; btnResumo.hidden = false; });

    f.addEventListener('submit', (e) => {
      e.preventDefault();
      comBotao(btnResumo, async () => {
        try {
          const r = await api.reservarEquipe({ ...dadosReserva(), confirmar: false });
          render(resumoEl, html`<div class="total-cotacao resumo-reserva">${r.resumo}</div><p class="ajuda">Confira com o cliente antes de confirmar. A reserva sai com pagamento na loja.</p>`);
          resumoEl.hidden = false; btnResumo.hidden = true; btnConfirmar.hidden = false; btnConfirmar.focus();
        } catch (err) {
          if (err.status === 401) return ctx.sessaoExpirou();
          if (err.campos) marcarErros(f, err.campos);
          avisar(err.message, 'erro');
        }
      });
    });
    btnConfirmar.addEventListener('click', () => comBotao(btnConfirmar, async () => {
      try {
        const r = await api.reservarEquipe({ ...dadosReserva(), confirmar: true });
        avisar(`Reserva ${r.codigo || ''} criada no portal LocarX.`.replace('  ', ' '));
        if (r.atencao) avisar(r.atencao, 'erro');
        usar(r.textoWhatsapp);
        aoReservar?.(r);
        m.fechar(); aoConcluir?.();
      } catch (err) {
        if (err.status === 401) return ctx.sessaoExpirou();
        if (err.campos) marcarErros(f, err.campos);
        avisar(err.message, 'erro');
      }
    }));
  }
}

/**
 * Janela de cotação dentro da conversa (botão "Cotação" ao lado de "Dados do cliente").
 * O atendente cota, calcula proteções, coloca o texto na mensagem e pode reservar, sem sair do chat.
 */
export function abrirCotacao({ ctx, conversa, aoUsarTexto, aoReservar }) {
  const m = abrirModal({ titulo: `Cotação${conversa?.contato?.nome ? ' para ' + conversa.contato.nome : ''}`, corpo: html`<div id="cotacao-janela"></div>`, rodape: html`<button class="btn btn-contorno" data-fechar>Fechar</button>` });
  m.el.querySelector('.modal').classList.add('modal-largo');
  // a janela tem formulário, mas é de consulta: o Esc e o X fecham sem travar
  $('#cotacao-janela', m.el).setAttribute('data-salva-sozinho', '');
  montarCotacao($('#cotacao-janela', m.el), { ctx, conversa, compacto: true, aoUsarTexto: (texto) => { aoUsarTexto?.(texto); m.fechar(); }, aoReservar });
  return m;
}

// ---------- tela #/cotacao (menu "Cotação"): consulta sem conversa aberta ----------
export async function montar(alvo, ctx) {
  const loja = ctx.usuario.loja;
  render(alvo, html`
    <div class="cabecalho-pagina">
      <div class="titulos"><h1>Cotação</h1><p>Valores da tabela vigente no portal LocarX para ${loja?.nome || 'esta loja'}${loja?.cidade ? ` (${loja.cidade}/${loja.uf})` : ''}. Informe só o período. Para enviar ao cliente ou reservar, use o botão Cotação dentro da conversa.</p></div>
    </div>
    <div class="pilha" id="cotacao-tela"></div>`);
  montarCotacao($('#cotacao-tela', alvo), { ctx });
}
