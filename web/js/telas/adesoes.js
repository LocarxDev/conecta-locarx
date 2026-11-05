// v14.12 — Adesões (administração): quem preencheu a página pública e pagou a entrada; criar a loja a partir da adesão
// (formulário de loja já preenchido) e vincular: assinatura ativa + convites do gestor e do atendente.
import { api } from '../api.js';
import { html, render, $, $$, icone, avisar, quando, abrirModal, confirmar } from '../util.js';
import { abrirFormLoja } from './lojas.js';

const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ST = { paga: ['Paga — criar a loja', 'alerta'], aguardando: ['Aguardando pagamento', ''], loja_criada: ['Loja criada', 'ok'], falhou: ['Pagamento falhou', 'erro'], expirada: ['Pix expirado', ''], cancelada: ['Cancelada', ''] };
const fmtCnpj = (c) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const fmtFone = (t) => { const d = String(t || '').replace(/\D/g, ''); return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : t || ''; };

export async function montar(alvo, ctx) {
  render(alvo, html`<div class="cabecalho-pagina"><div class="titulos"><h1>Adesões</h1><p>Carregando…</p></div></div><div class="painel"><div class="painel-corpo"><div class="esqueleto"></div></div></div>`);
  let v, filtro = 'atencao';
  async function carregar() {
    try { v = await api.adesoesAdmin(); } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      return render(alvo, html`<div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div></div>`);
    }
    desenhar();
  }
  function desenhar() {
    const c = v.contagem, pode = v.podeEditar;
    const lista = v.adesoes.filter((a) => filtro === 'todas' ? true : filtro === 'atencao' ? ['paga', 'aguardando'].includes(a.status) : a.status === filtro);
    render(alvo, html`
      <div class="cabecalho-pagina">
        <div class="titulos"><h1>Adesões</h1><p>Quem entrou pela página de adesão (${location.origin}/adesao). Quando o pagamento cai, crie a loja a partir da adesão: o cadastro vem preenchido, a assinatura nasce ativa e os convites saem sozinhos.</p></div>
        <a class="btn btn-contorno" href="#/adesao" target="_blank" rel="noopener">${icone('info')}Abrir a página de adesão</a>
      </div>
      <div class="resumo resumo-4">
        <div class="resumo-item"><span class="rotulo">Pagas, aguardando a loja</span><span class="valor ${c.paga ? 'erro' : ''}">${c.paga || 0}</span><span class="detalhe">criar a loja em até 1 dia útil</span></div>
        <div class="resumo-item"><span class="rotulo">Aguardando pagamento</span><span class="valor">${c.aguardando || 0}</span><span class="detalhe">Pix gerado e não pago</span></div>
        <div class="resumo-item"><span class="rotulo">Lojas criadas</span><span class="valor ok">${c.loja_criada || 0}</span><span class="detalhe">adesões concluídas</span></div>
        <div class="resumo-item"><span class="rotulo">Falhas / expiradas</span><span class="valor">${(c.falhou || 0) + (c.expirada || 0)}</span><span class="detalhe">${c.cancelada || 0} cancelada${c.cancelada === 1 ? '' : 's'}</span></div>
      </div>
      <section class="painel">
        <div class="painel-cab"><div class="filtros">${[['atencao', 'Precisam de ação'], ['todas', 'Todas'], ['loja_criada', 'Lojas criadas'], ['falhou', 'Falhas'], ['cancelada', 'Canceladas']].map(([k, n]) => html`<button class="btn ${filtro === k ? 'btn-primario' : 'btn-texto'}" data-filtro="${k}">${n}</button>`)}</div></div>
        <div class="tabela-caixa"><table class="tabela">
          <thead><tr><th>Loja</th><th>Gestor</th><th>Plano</th><th>Pagamento</th><th>Situação</th><th>Quando</th><th></th></tr></thead>
          <tbody>${lista.length ? lista.map((a) => html`<tr class="${a.status === 'paga' ? 'linha-alerta' : ''}">
            <td><strong>${a.nomeLoja}</strong><div class="sub">${fmtCnpj(a.cnpj)}${a.cidade ? ` · ${a.cidade}/${a.uf}` : ''}${a.lojaNome ? html` · <a href="#/lojas/${a.lojaId}">${a.lojaNome}</a>` : ''}</div></td>
            <td>${a.gestorNome}<div class="sub">${a.gestorEmail}</div></td>
            <td>${a.planoNome}<div class="sub">${a.ciclo}</div></td>
            <td class="num">${reais(a.valor)}<div class="sub">${a.formaNome}${a.cartao ? ` final ${a.cartao.final}` : ''}</div></td>
            <td><span class="selo ${ST[a.status]?.[1] || ''}">${ST[a.status]?.[0] || a.status}</span>${a.observacao && ['falhou', 'cancelada'].includes(a.status) ? html`<div class="sub">${a.observacao}</div>` : ''}</td>
            <td>${quando(a.pagaEm || a.criadaEm)}</td>
            <td class="acoes-linha"><button class="btn btn-texto" data-ver="${a.id}">Detalhes</button>${pode && a.status === 'paga' ? html`<button class="btn btn-primario" data-criar="${a.id}">Criar loja</button>` : ''}</td>
          </tr>`) : html`<tr><td colspan="7"><div class="estado">${icone('info')}<p>Nenhuma adesão neste filtro.</p></div></td></tr>`}</tbody>
        </table></div>
      </section>`);
    $$('[data-filtro]', alvo).forEach((b) => b.addEventListener('click', () => { filtro = b.dataset.filtro; desenhar(); }));
    $$('[data-ver]', alvo).forEach((b) => b.addEventListener('click', () => detalhes(v.adesoes.find((a) => a.id === b.dataset.ver))));
    $$('[data-criar]', alvo).forEach((b) => b.addEventListener('click', () => criarLoja(v.adesoes.find((a) => a.id === b.dataset.criar))));
  }

  function detalhes(a) {
    const pode = v.podeEditar;
    const m = abrirModal({
      titulo: `Adesão — ${a.nomeLoja}`,
      corpo: html`
        <span class="selo ${ST[a.status]?.[1] || ''}">${ST[a.status]?.[0] || a.status}</span>
        <dl class="dados-grade" style="margin-top: 12px">
          <div class="dado"><dt>CNPJ</dt><dd>${fmtCnpj(a.cnpj)}</dd></div><div class="dado"><dt>Razão social</dt><dd>${a.razaoSocial}</dd></div>
          <div class="dado"><dt>Endereço</dt><dd>${a.endereco} · CEP ${a.cep}</dd></div><div class="dado"><dt>Cidade / UF</dt><dd>${a.cidade ? `${a.cidade}/${a.uf}` : '— (informar ao criar a loja)'}</dd></div>
          <div class="dado"><dt>WhatsApp da loja</dt><dd>${fmtFone(a.whatsapp)}</dd></div><div class="dado"><dt>Gestor</dt><dd>${a.gestorNome}<div class="sub">${a.gestorEmail}</div></dd></div>
          <div class="dado"><dt>Atendente</dt><dd>${a.atendenteEmail ? html`${a.atendenteNome}<div class="sub">${a.atendenteEmail}</div>` : '—'}</dd></div>
          <div class="dado"><dt>Plano</dt><dd>${a.planoNome} · ${a.ciclo} · ${reais(a.valor)} · ${a.formaNome}${a.cartao ? ` final ${a.cartao.final}` : ''}</dd></div>
          <div class="dado"><dt>Pagamento</dt><dd>${a.pagaEm ? `pago ${quando(a.pagaEm)}` : 'não pago'}${a.pagarme?.cobrancaId ? html`<div class="sub">cobrança ${a.pagarme.cobrancaId}</div>` : ''}${a.pagarme?.assinaturaId ? html`<div class="sub">assinatura ${a.pagarme.assinaturaId}</div>` : ''}</dd></div>
          <div class="dado"><dt>Recebida</dt><dd>${quando(a.criadaEm)}${a.ip ? html`<div class="sub">IP ${a.ip}</div>` : ''}</dd></div>
        </dl>
        ${a.particularidades ? html`<h3 style="margin-top: 14px">Particularidades informadas</h3><p class="texto-corrido" style="white-space: pre-wrap">${a.particularidades}</p><p class="ajuda">Use nas orientações da Lia e na base da loja ao configurar.</p>` : html`<p class="sub" style="margin-top: 14px">Sem particularidades: padrão da rede.</p>`}
        ${a.observacao ? html`<p class="sub">Observação: ${a.observacao}</p>` : ''}`,
      rodape: html`<button class="btn btn-texto" data-fechar>Fechar</button>
        ${pode && ['aguardando', 'falhou', 'expirada'].includes(a.status) ? html`<button class="btn btn-contorno" id="ad-paga">Marcar como paga</button>` : ''}
        ${pode && a.status !== 'loja_criada' && a.status !== 'cancelada' ? html`<button class="btn btn-texto" id="ad-cancelar">Cancelar adesão</button>` : ''}
        ${pode && a.status === 'paga' ? html`<button class="btn btn-contorno" id="ad-vincular">Já criei a loja — vincular</button><button class="btn btn-primario" id="ad-criar">Criar loja a partir desta</button>` : ''}`,
    });
    m.el.classList.add('modal-grande');
    $('#ad-paga', m.el)?.addEventListener('click', async () => {
      const ok = await confirmar({ titulo: 'Marcar como paga', texto: 'Use só se conferiu o pagamento no painel da Pagar.me (ou recebeu de outra forma). Depois você cria a loja normalmente.', botao: 'Marcar como paga' });
      if (!ok) return;
      try { await api.marcarAdesaoPaga(a.id, { observacao: 'conferido pela administração' }); m.fechar(); avisar('Adesão marcada como paga.'); carregar(); } catch (err) { avisar(err.message, 'erro'); }
    });
    $('#ad-cancelar', m.el)?.addEventListener('click', async () => {
      const ok = await confirmar({ titulo: 'Cancelar a adesão', texto: 'A adesão some das pendências. Se houve pagamento, o estorno é feito no painel da Pagar.me.', botao: 'Cancelar adesão', perigo: true });
      if (!ok) return;
      try { await api.cancelarAdesao(a.id, 'cancelada pela administração'); m.fechar(); avisar('Adesão cancelada.'); carregar(); } catch (err) { avisar(err.message, 'erro'); }
    });
    $('#ad-criar', m.el)?.addEventListener('click', () => { m.fechar(); criarLoja(a); });
    $('#ad-vincular', m.el)?.addEventListener('click', async () => {
      let lojas = []; try { lojas = await api.listarLojas(); } catch (err) { return avisar(err.message, 'erro'); }
      const candidatas = lojas.filter((l) => !l.central && (!l.cadastro?.cnpj || l.cadastro.cnpj === a.cnpj));
      const mm = abrirModal({
        titulo: 'Vincular a uma loja existente',
        corpo: html`<p class="sub">Escolha a loja criada para esta adesão (sem assinatura ativa). A assinatura nasce ativa e os convites são enviados.</p>
          <div class="campo"><label for="ad-loja">Loja</label><select id="ad-loja"><option value="">Escolha</option>${candidatas.map((l) => html`<option value="${l.id}" ${l.cadastro?.cnpj === a.cnpj ? 'selected' : ''}>${l.nome} · ${l.cidade}/${l.uf}${l.cadastro?.cnpj ? ' · ' + fmtCnpj(l.cadastro.cnpj) : ' · sem CNPJ'}</option>`)}</select></div>`,
        rodape: html`<button class="btn btn-texto" data-fechar>Cancelar</button><button class="btn btn-primario" id="ad-vincular-ok">Vincular</button>`,
      });
      $('#ad-vincular-ok', mm.el).addEventListener('click', async () => {
        const lojaId = $('#ad-loja', mm.el).value; if (!lojaId) return avisar('Escolha a loja.', 'erro');
        try { const r = await api.vincularAdesao(a.id, lojaId); mm.fechar(); m.fechar(); avisar(`Vinculada: assinatura ativa e ${r.convites.length} convite(s).`); carregar(); } catch (err) { avisar(err.message, 'erro'); }
      });
    });
  }

  // abre o formulário de loja já preenchido; ao salvar, vincula (assinatura ativa + convites)
  function criarLoja(a) {
    const prefill = { nome: a.nomeLoja, cidade: a.cidade || '', uf: a.uf || '', filial: { tipo: /aeroporto/i.test(a.nomeLoja) ? 'Aeroporto' : 'Cidade' },
      cadastro: { cnpj: a.cnpj, razaoSocial: a.razaoSocial, endereco: a.endereco, cep: a.cep, responsavelNome: a.gestorNome, responsavelEmail: a.gestorEmail, responsavelTelefone: a.whatsapp, financeiroEmail: a.gestorEmail, financeiroNome: a.gestorNome } };
    abrirFormLoja(prefill, async (loja) => {
      try {
        const r = await api.vincularAdesao(a.id, loja.id);
        const m = abrirModal({
          titulo: 'Loja criada e assinatura ativa',
          corpo: html`<p>A loja <strong>${loja.nome}</strong> nasceu com a assinatura ${r.adesao.ciclo} ativa (${r.adesao.formaNome}) e o cadastro fiscal preenchido.</p>
            <h3 style="margin-top: 12px">Convites</h3>
            <ul class="lista-simples">${r.convites.map((cv) => html`<li><strong>${cv.perfil === 'dono' ? 'Gestor' : 'Atendente'}</strong> · ${cv.email}${cv.aviso ? html` <span class="sub">— ${cv.aviso}</span>` : cv.emailEnviado ? html` <span class="selo ok">e-mail enviado</span>` : html` <span class="selo alerta">e-mail não saiu</span>`}${cv.link ? html`<div class="copia-linha" style="margin-top: 6px"><input readonly value="${cv.link}"><button class="btn btn-mini" type="button" data-copiar="${cv.link}">${icone('copiar')}Copiar link</button></div>` : ''}</li>`)}</ul>
            <p class="ajuda" style="margin-top: 10px">Próximo passo: <a href="#/lojas/${loja.id}">abrir a loja</a> para configurar a Lia, a base e o WhatsApp (as particularidades informadas estão nos detalhes da adesão).</p>`,
          rodape: html`<button class="btn btn-texto" data-fechar>Fechar</button><a class="btn btn-primario" href="#/lojas/${loja.id}">Abrir a loja →</a>`,
        });
        $$('[data-copiar]', m.el).forEach((b) => b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(b.dataset.copiar); avisar('Link copiado.'); } catch { /* ok */ } }));
        carregar();
      } catch (err) {
        avisar(`A loja foi criada, mas a adesão não foi vinculada: ${err.message}. Abra a loja e use Assinatura → Liberar, ou tente de novo em Detalhes.`, 'erro');
        carregar();
      }
    });
  }
  carregar();
}
