// Monitor do assistente (administração): acompanha cada resposta da IA em tempo real — loja, modelo, tempo,
// ferramentas chamadas, erros da API LocarX/IA e "promessas sem ação". Não mostra o conteúdo das conversas.
import { api } from '../api.js';
import { html, render, $, $$, icone, avisar, quando, abrirModal, comBotao, paginar, ligarPaginacao } from '../util.js';

const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const ms = (v) => (v == null ? '—' : v >= 1000 ? (v / 1000).toFixed(1).replace('.', ',') + ' s' : v + ' ms');
const num = (v) => Number(v || 0).toLocaleString('pt-BR');
const NOMES = {
  buscar_informacoes: 'Base de conhecimento', dados_da_loja: 'Dados da loja', consultar_disponibilidade: 'Disponibilidade', calcular_preco: 'Preço',
  criar_reserva: 'Criar reserva', consultar_reserva: 'Consultar reserva', cancelar_reserva: 'Cancelar reserva', salvar_informacoes: 'Anotou na ficha',
  aplicar_etiqueta: 'Etiqueta', chamar_atendente: 'Chamou atendente',
};

function situacao(u) {
  if (!u.ok && u.erro && /IA respondeu|indisponível/.test(u.erro)) return { selo: 'erro', texto: 'Erro na IA' };
  if (u.eventos.some((e) => e.tipo === 'ferramenta' && !e.ok)) return { selo: 'erro', texto: 'Erro em ferramenta' };
  if (u.eventos.some((e) => e.tipo === 'limite')) return { selo: 'erro', texto: 'Limite' };
  if (u.erro) return { selo: 'erro', texto: 'Erro' };
  if (u.eventos.some((e) => e.tipo === 'nudge')) return { selo: 'alerta', texto: 'Cobrada' };
  if (u.pedidoAtendente) return { selo: 'neutro', texto: 'Chamou equipe' };
  if (u.eventos.some((e) => e.aviso)) return { selo: 'alerta', texto: 'Aviso' };
  return { selo: 'ok', texto: 'OK' };
}

function chipsFerramentas(u) {
  const evs = u.eventos.filter((e) => e.tipo === 'ferramenta');
  if (!evs.length && !u.ferramentas.length) return html`<span class="sub">só texto</span>`;
  const lista = evs.length ? evs : u.ferramentas.map((nome) => ({ nome, ok: true }));
  return html`<div class="chips">${lista.map((e) => html`<span class="selo ${e.ok === false ? 'erro' : e.aviso ? 'alerta' : 'neutro'} sem-ponto" title="${e.erro || e.aviso || ''}">${NOMES[e.nome] || e.nome}${e.ms != null ? html` <span class="sub">${ms(e.ms)}</span>` : ''}</span>`)}</div>`;
}

function detalhar(u) {
  const st = situacao(u);
  abrirModal({
    titulo: `${u.loja.nome} · ${hora(u.em)}`,
    corpo: html`
      <div class="lista-simples lista-detalhe">
        <div><span>Situação</span><span class="selo ${st.selo}">${st.texto}</span></div>
        <div><span>Modelo</span><span>${u.provedor} · ${u.modelo}</span></div>
        <div><span>Tempo total</span><span>${ms(u.duracaoMs)} · ${u.voltas ?? '—'} volta(s) · parada: ${u.parada || '—'}</span></div>
        <div><span>Tokens</span><span>${num(u.tokens.entrada)} entrada · ${num(u.tokens.saida)} saída</span></div>
        <div><span>Resposta ao cliente</span><span>${u.tamanho ? `${num(u.tamanho)} caracteres` : 'vazia'}${u.pedidoAtendente ? ` · chamou a equipe: ${u.pedidoAtendente}` : ''}</span></div>
        ${u.erro ? html`<div><span>Erro</span><span class="erro-texto">${u.erro}</span></div>` : ''}
      </div>
      <h3 class="sub-titulo">Linha do tempo</h3>
      ${u.semDetalhes ? html`<p class="sub">Resposta registrada antes desta atualização do Conecta: não há linha do tempo. As próximas terão.</p>` : ''}
      ${u.eventos.length ? html`<ol class="passos">${u.eventos.map((e) => html`<li class="${e.erro ? 'falhou' : e.ok ? 'feito' : ''}"><div>
        ${e.tipo === 'ferramenta' ? html`<strong>${NOMES[e.nome] || e.nome}</strong> <span class="sub">${ms(e.ms)}</span>
          ${Object.keys(e.args || {}).length ? html`<span class="sub">${JSON.stringify(e.args)}</span>` : ''}
          ${e.aviso ? html`<span class="sub aviso-texto">${e.aviso}</span>` : ''}
          ${e.erro ? html`<span class="sub erro-texto">${e.erro}${e.status ? ` (HTTP ${e.status})` : ''}</span>` : ''}
          ${e.respostaApi ? html`<pre class="pre-diag">${e.respostaApi}</pre>` : ''}`
        : e.tipo === 'nudge' ? html`<strong>Prometeu sem agir — cobrada pelo sistema</strong><span class="sub">A IA escreveu "${e.texto}" e não chamou ferramenta. O sistema pediu para ela executar.</span>`
        : html`<strong>${e.tipo === 'limite' ? 'Limite' : 'Erro'}</strong><span class="sub erro-texto">${e.erro}</span>`}
      </div></li>`)}</ol>` : u.semDetalhes ? '' : html`<p class="sub">Nenhuma ferramenta foi chamada: a IA respondeu só com texto.</p>`}
      ${u.conversaId ? html`<p class="ajuda">Conversa ${u.conversaId.slice(0, 8)}… — o conteúdo só pode ser visto pela equipe da loja.</p>` : ''}`,
    rodape: html`<button class="btn btn-contorno" data-fechar>Fechar</button>`,
  });
}

const POR_PAGINA = 20;

export async function montar(alvo, ctx) {
  let itens = [], ultimoId = 0, filtroLoja = '', soErros = false, timer = null, lojas = [], pagIa = 1, pagOc = 1, fimIa = false, fimOc = false;
  render(alvo, html`
    <div class="cabecalho-pagina">
      <div class="titulos"><h1>Monitor do assistente</h1><p>Cada resposta da IA, em tempo real: ferramentas chamadas, erros da API LocarX e da IA, tempo e tokens. Sem conteúdo das conversas.</p></div>
      <div class="filtros"><select id="filtro-loja" aria-label="Loja" class="select-filial"><option value="">Todas as lojas</option></select><span class="selo ok" id="ao-vivo">Ao vivo</span></div>
    </div>
    <div class="resumo" id="resumo-monitor"><div class="resumo-item"><div class="esqueleto"></div></div><div class="resumo-item"><div class="esqueleto"></div></div><div class="resumo-item"><div class="esqueleto"></div></div><div class="resumo-item"><div class="esqueleto"></div></div></div>
    <section class="painel">
      <div class="painel-cab">
        <h2>Reservas e cotações</h2>
        <div class="filtros"><label class="checkbox"><input type="checkbox" id="so-falhas"> Só erros e avisos</label></div>
      </div>
      <div id="lista-ocorrencias"><div class="painel-corpo"><div class="esqueleto"></div></div></div>
    </section>
    <section class="painel">
      <div class="painel-cab">
        <h2>Respostas da IA</h2>
        <div class="filtros"><label class="checkbox"><input type="checkbox" id="so-erros"> Só com erro</label></div>
      </div>
      <div id="lista-monitor"><div class="painel-corpo"><div class="esqueleto"></div></div></div>
    </section>`);
  const resumoEl = $('#resumo-monitor', alvo), lista = $('#lista-monitor', alvo), sel = $('#filtro-loja', alvo), listaOc = $('#lista-ocorrencias', alvo);
  let ocorrencias = [], ultimaOc = 0, soFalhas = false;
  const NIVEL = { erro: 'erro', aviso: 'alerta', info: 'ok' };
  const TIPO = { reserva: 'Reserva', cotacao: 'Cotação', ia: 'IA', whatsapp: 'WhatsApp' };

  function detalharOcorrencia(o) {
    const d = o.detalhes || {};
    abrirModal({
      titulo: `${TIPO[o.tipo] || o.tipo} · ${o.loja.nome} · ${hora(o.em)}`,
      corpo: html`
        <div class="lista-simples lista-detalhe">
          <div><span>Situação</span><span class="selo ${NIVEL[o.nivel]}">${o.nivel}</span></div>
          <div><span>Quem</span><span>${o.quem} (${o.origem})</span></div>
          <div><span>O que aconteceu</span><span class="${o.nivel === 'erro' ? 'erro-texto' : ''}">${o.mensagem}</span></div>
          ${d.status ? html`<div><span>HTTP da API LocarX</span><span>${d.status}</span></div>` : ''}
          ${d.periodo ? html`<div><span>Período</span><span>${JSON.stringify(d.periodo)}</span></div>` : ''}
          ${d.fleetId != null || d.fleet_id != null ? html`<div><span>Grupo (fleetId)</span><span>${d.fleetId ?? d.fleet_id}${d.protecoes ? ' · ' + d.protecoes.join(', ') : ''}</span></div>` : ''}
          ${d.codigo ? html`<div><span>Código</span><span>${d.codigo}</span></div>` : ''}
        </div>
        ${d.respostaApi ? html`<h3 class="sub-titulo">Resposta crua da API LocarX</h3><pre class="pre-diag">${d.respostaApi}</pre>` : ''}
        ${d.erro && d.erro !== o.mensagem ? html`<h3 class="sub-titulo">Erro técnico</h3><pre class="pre-diag">${d.erro}</pre>` : ''}
        ${d.args ? html`<h3 class="sub-titulo">Argumentos</h3><pre class="pre-diag">${JSON.stringify(d.args, null, 1)}</pre>` : ''}`,
      rodape: html`<button class="btn btn-contorno" data-fechar>Fechar</button>`,
    });
  }

  function desenharOcorrencias() {
    const todas = ocorrencias.filter((o) => !soFalhas || o.nivel !== 'info');
    if (!todas.length) return render(listaOc, html`<div class="estado">${icone('reservas')}<h3>Nenhuma ocorrência</h3><p>Reservas e cotações feitas (ou que falharam) pela equipe e pelo assistente aparecem aqui, com o motivo.</p></div>`);
    const pg = paginar(todas, pagOc, POR_PAGINA, { rotulo: 'ocorrências', extra: !fimOc && pagOc === pg_fim(todas) ? html`<button class="btn btn-texto" data-mais-oc>Carregar mais antigas</button>` : '' });
    pagOc = pg.pagina; const vis = pg.fatia;
    render(listaOc, html`<div class="tabela-caixa"><table class="tabela tabela-monitor">
      <thead><tr><th>Quando</th><th>Loja</th><th>Tipo</th><th>O que aconteceu</th><th class="col-opcional">Quem</th><th><span class="sr-only">Detalhes</span></th></tr></thead>
      <tbody>${vis.map((o) => html`<tr class="clicavel" data-oc="${o.id}">
        <td class="num nowrap">${hora(o.em)}<div class="sub">${quando(o.em)}</div></td>
        <td><strong>${o.loja.nome}</strong></td>
        <td><span class="selo ${NIVEL[o.nivel]} sem-ponto">${TIPO[o.tipo] || o.tipo}</span></td>
        <td class="${o.nivel === 'erro' ? 'erro-texto' : ''}">${o.mensagem}</td>
        <td class="col-opcional"><span class="sub">${o.quem}</span></td>
        <td><button class="btn btn-texto btn-icone" aria-label="Ver detalhes">${icone('seta')}</button></td>
      </tr>`)}</tbody></table></div>${pg.controles}`);
    $$('tr[data-oc]', listaOc).forEach((tr) => tr.addEventListener('click', () => detalharOcorrencia(ocorrencias.find((o) => o.id === Number(tr.dataset.oc)))));
    ligarPaginacao(listaOc, (d) => { pagOc += d; desenharOcorrencias(); });
    $('[data-mais-oc]', listaOc)?.addEventListener('click', (e) => comBotao(e.currentTarget, () => carregarOcorrencias('antigas')));
  }
  const pg_fim = (lista) => Math.max(1, Math.ceil(lista.length / POR_PAGINA));

  // modo: false = carga inicial (zera), true = só novas (ao vivo), 'antigas' = página seguinte no servidor
  async function carregarOcorrencias(modo) {
    try {
      const antigas = modo === 'antigas';
      const r = await api.ocorrencias({ desde: modo === true ? ultimaOc : undefined, antes: antigas ? Math.min(...ocorrencias.map((o) => o.id)) : undefined, loja: filtroLoja || undefined, limite: modo === true ? 50 : 100 });
      if (modo === false) { ocorrencias = []; ultimaOc = 0; fimOc = false; pagOc = 1; }
      if (antigas && r.length < 100) fimOc = true;
      if (r.length) {
        const novos = r.filter((o) => !ocorrencias.some((x) => x.id === o.id));
        ocorrencias = antigas ? [...ocorrencias, ...novos] : [...novos, ...ocorrencias];
        ultimaOc = Math.max(ultimaOc, ...r.map((o) => o.id));
        if (modo === true && novos.some((o) => o.nivel === 'erro')) avisar(novos.find((o) => o.nivel === 'erro').mensagem, 'erro');
      } else if (antigas) fimOc = true;
      desenharOcorrencias();
    } catch (err) { if (err.status === 401) return ctx.sessaoExpirou(); if (modo === false) render(listaOc, html`<div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div>`); }
  }

  function desenharResumo(r, porLoja) {
    render(resumoEl, html`
      <div class="resumo-item"><span class="rotulo">Respostas em 24 h</span><span class="valor">${num(r.respostas)}</span><span class="detalhe">em ${num(r.conversas)} conversas</span></div>
      <div class="resumo-item"><span class="rotulo">Com erro</span><span class="valor ${r.comErro ? 'erro-texto' : ''}">${num(r.comErro)}</span><span class="detalhe">${r.promessas ? `${r.promessas} cobrada(s) por prometer sem agir` : 'IA ou API LocarX'}</span></div>
      <div class="resumo-item"><span class="rotulo">Tempo médio</span><span class="valor">${ms(r.mediaMs)}</span><span class="detalhe">da mensagem à resposta</span></div>
      <div class="resumo-item"><span class="rotulo">Tokens em 24 h</span><span class="valor">${num(r.tokens)}</span><span class="detalhe">entrada + saída</span></div>`);
    if (!lojas.length && porLoja.length) {
      lojas = porLoja;
      render(sel, html`<option value="">Todas as lojas</option>${porLoja.map((l) => html`<option value="${l.id}">${l.nome}</option>`)}`);
    }
  }

  function desenharLista() {
    const todas = itens.filter((u) => !soErros || u.erro || !u.ok);
    if (!todas.length) return render(lista, html`<div class="estado">${icone('robo')}<h3>Nenhuma resposta ainda</h3><p>Assim que o assistente de alguma loja responder, aparece aqui.</p></div>`);
    const pg = paginar(todas, pagIa, POR_PAGINA, { rotulo: 'respostas', extra: !fimIa && pagIa === pg_fim(todas) ? html`<button class="btn btn-texto" data-mais-ia>Carregar mais antigas</button>` : '' });
    pagIa = pg.pagina; const vis = pg.fatia;
    render(lista, html`<div class="tabela-caixa"><table class="tabela tabela-monitor">
      <thead><tr><th>Quando</th><th>Loja</th><th>Situação</th><th>Ferramentas</th><th class="col-opcional">Tempo</th><th class="col-opcional">Modelo</th><th><span class="sr-only">Detalhes</span></th></tr></thead>
      <tbody>${vis.map((u) => { const st = situacao(u); return html`<tr class="clicavel" data-id="${u.id}">
        <td class="num nowrap">${hora(u.em)}<div class="sub">${quando(u.em)}</div></td>
        <td><strong>${u.loja.nome}</strong>${u.conversaId ? html`<div class="sub">conversa ${u.conversaId.slice(0, 8)}</div>` : ''}</td>
        <td><span class="selo ${st.selo}">${st.texto}</span>${u.erro ? html`<div class="sub erro-texto">${u.erro.slice(0, 90)}</div>` : ''}</td>
        <td>${chipsFerramentas(u)}</td>
        <td class="col-opcional num">${ms(u.duracaoMs)}<div class="sub">${num(u.tokens.entrada + u.tokens.saida)} tokens</div></td>
        <td class="col-opcional"><span class="sub">${u.modelo}</span></td>
        <td><button class="btn btn-texto btn-icone" aria-label="Ver detalhes">${icone('seta')}</button></td>
      </tr>`; })}</tbody></table></div>${pg.controles}`);
    $$('tr[data-id]', lista).forEach((tr) => tr.addEventListener('click', () => detalhar(itens.find((u) => u.id === Number(tr.dataset.id)))));
    ligarPaginacao(lista, (d) => { pagIa += d; desenharLista(); });
    $('[data-mais-ia]', lista)?.addEventListener('click', (e) => comBotao(e.currentTarget, () => carregar('antigas')));
  }

  async function carregar(modo) {
    try {
      const antigas = modo === 'antigas';
      const r = await api.monitorAssistente({ desde: modo === true ? ultimoId : undefined, antes: antigas ? Math.min(...itens.map((u) => u.id)) : undefined, loja: filtroLoja || undefined, limite: modo === true ? 50 : 100 });
      desenharResumo(r.resumo, r.porLoja);
      if (modo === false) { itens = []; ultimoId = 0; fimIa = false; pagIa = 1; }
      if (antigas && r.itens.length < 100) fimIa = true;
      if (r.itens.length) {
        const novos = r.itens.filter((u) => !itens.some((x) => x.id === u.id));
        itens = antigas ? [...itens, ...novos] : [...novos, ...itens];
        ultimoId = Math.max(ultimoId, ...r.itens.map((u) => u.id));
        if (modo === true && novos.some((u) => u.erro)) avisar(`${novos.filter((u) => u.erro).length} resposta(s) com erro no assistente.`, 'erro');
      } else if (antigas) fimIa = true;
      desenharLista();
      $('#ao-vivo', alvo).className = 'selo ok';
    } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      $('#ao-vivo', alvo).className = 'selo erro'; $('#ao-vivo', alvo).textContent = 'Sem conexão';
      if (modo === false) render(lista, html`<div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div>`);
    }
  }

  // filtro por loja vale para as duas listas e é aplicado no servidor (não só no que já carregou)
  sel.addEventListener('change', () => { filtroLoja = sel.value; carregar(false); carregarOcorrencias(false); });
  $('#so-erros', alvo).addEventListener('change', (e) => { soErros = e.target.checked; pagIa = 1; desenharLista(); });
  $('#so-falhas', alvo).addEventListener('change', (e) => { soFalhas = e.target.checked; pagOc = 1; desenharOcorrencias(); });
  await Promise.all([carregar(false), carregarOcorrencias(false)]);
  timer = setInterval(() => { if (!document.hidden) { carregar(true); carregarOcorrencias(true); } }, 5000);
  return () => clearInterval(timer);
}
