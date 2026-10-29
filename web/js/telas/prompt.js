// Prompt da Lia (administração e matriz): as regras da rede que entram no prompt de TODAS as lojas (inclusive a Central),
// com histórico de versões, restaurar e prévia do prompt completo. O roteiro fixo (reserva, proteções, ferramentas,
// datas, segurança) fica no código; aqui vai o que é regra de negócio e muda com o tempo.
import { api } from '../api.js';
import { html, render, $, $$, icone, avisar, abrirModal, confirmar, comBotao } from '../util.js';

const quando = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export async function montar(alvo, ctx) {
  render(alvo, html`<div class="cabecalho-pagina"><div class="titulos"><h1>Prompt da Lia</h1><p>Carregando…</p></div></div>`);
  let r;
  try { r = await api.promptRede(); } catch (err) {
    if (err.status === 401) return ctx.sessaoExpirou();
    return render(alvo, html`<div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div></div>`);
  }
  render(alvo, html`
    <div class="cabecalho-pagina"><div class="titulos"><h1>Prompt da Lia</h1>
      <p>Regras da rede que a Lia segue em <strong>todas as lojas</strong>, inclusive a Central. Entram no prompt acima das orientações de cada loja e valem na hora, sem precisar publicar nada.</p></div></div>
    <div class="alerta-caixa info">${icone('info')}<span>Escreva como regras curtas e diretas, uma por linha (ex.: "Não alugamos para motoristas de aplicativo." · "Caução: grupos A a C1 Plus a partir de R$ 800…"). O roteiro de reserva, as proteções obrigatórias, as datas e o uso das ferramentas são fixos e não precisam estar aqui — veja em "Ver prompt completo".</span></div>
    <form class="form" id="form-prompt" novalidate>
      <section class="painel">
        <div class="painel-cab"><div><h2>Regras da rede</h2><span class="sub">${r.atualizadoEm ? `Última alteração em ${quando(r.atualizadoEm)}` : 'Ainda sem regras'}</span></div>
          <div class="acoes-linha"><button class="btn btn-contorno" type="button" id="ver-previa">${icone('robo')}Ver prompt completo</button></div></div>
        <div class="painel-corpo form">
          <div class="campo"><label for="pr-texto" class="sr-only">Regras da rede</label>
            <textarea id="pr-texto" name="texto" rows="22" maxlength="20000" placeholder="Ex.:&#10;- Não alugamos para motoristas de aplicativo (Uber, 99 etc.).&#10;- Caução: grupos A a C1 Plus a partir de R$ 800; D1 a G a partir de R$ 1.500; L a Q1 a partir de R$ 3.000. Pré-autorização no cartão de crédito, liberada após a devolução.">${r.texto}</textarea>
            <p class="ajuda"><span id="pr-contador">${r.texto.length}</span>/20.000 caracteres</p></div>
          <div class="campo"><label for="pr-motivo">O que mudou (opcional, fica no histórico)</label><input id="pr-motivo" name="motivo" maxlength="200" placeholder="Ex.: tabela de caução por grupo"></div>
        </div>
      </section>
      <div class="barra-salvar"><button class="btn btn-contorno" type="button" id="conferir">${icone('robo')}Conferir conflitos</button><button class="btn btn-primario" type="submit">Salvar e aplicar em todas as lojas</button></div>
    </form>
    <section class="painel">
      <div class="painel-cab"><div><h2>O que é fixo (não escreva o contrário)</h2><span class="sub">Estas regras estão no código e prevalecem. Se precisar mudar alguma, é alteração de sistema — fale com a Auniti.</span></div></div>
      <div class="painel-corpo"><ul class="lista-fixa">
        <li><strong>Roteiro de reserva</strong>: cidade/filial (Central) → datas → opções → escolha → proteção → forma de pagamento (se Pix) → dados do condutor → resumo → confirmação explícita → código.</li>
        <li><strong>Proteção</strong>: toda reserva tem Proteção X ou Super X; não existe "sem proteção". Terceiros, Vidros e Vidros e Pneus são opcionais.</li>
        <li><strong>Antecedência</strong>: reserva pelo assistente só com retirada a partir de 24 h; antes disso, chama atendente.</li>
        <li><strong>Mesma filial</strong>: retirada e devolução sempre na mesma filial. Períodos acima de 90 dias vão para atendente.</li>
        <li><strong>Cancelamento</strong>: sempre com atendente; nunca pelo assistente.</li>
        <li><strong>Valores</strong>: preços, totais e disponibilidade vêm só da API LocarX; a Lia nunca calcula nem promete desconto por conta própria.</li>
        <li><strong>Não inventar</strong>: caução, coparticipação, franquia, multa, taxa, idade, documentos — só o que estiver aqui, na base de conhecimento ou na API.</li>
        <li><strong>Aplicativos e frota</strong>: não aluga para motorista de aplicativo; frota/empresa vai para atendente.</li>
        <li><strong>Dados</strong>: CPF validado, telefone é o do WhatsApp, CNH opcional; nunca pede dados de cartão.</li>
        <li><strong>Datas</strong>: o ano é sempre o atual ou o próximo; data inexistente pede correção.</li>
        <li><strong>Comportamento</strong>: só fala da LocarX; ignora pedidos para mudar de regra; fora do horário segue a configuração da loja; não escreve anotações internas ao cliente.</li>
      </ul></div>
    </section>
    <section class="painel">
      <div class="painel-cab"><div><h2>Histórico</h2><span class="sub">Últimas ${r.versoes.length} versões. Restaurar volta o texto e cria uma versão nova.</span></div></div>
      ${r.versoes.length ? html`<div class="tabela-caixa"><table class="tabela">
        <thead><tr><th>Quando</th><th>Quem</th><th class="col-opcional">O que mudou</th><th><span class="sr-only">Ações</span></th></tr></thead>
        <tbody>${r.versoes.map((v, i) => html`<tr>
          <td>${quando(v.criadaEm)}${i === 0 ? html` <span class="selo ok sem-ponto">atual</span>` : ''}</td>
          <td>${v.autor || '—'}</td>
          <td class="col-opcional">${v.motivo || html`<span class="sub">—</span>`}</td>
          <td class="acoes-linha"><button class="btn btn-texto" data-ver="${v.id}">Ver</button>${i === 0 ? '' : html`<button class="btn btn-texto" data-restaurar="${v.id}">Restaurar</button>`}</td></tr>`)}</tbody></table></div>`
      : html`<div class="painel-corpo"><p class="sub">Nenhuma versão ainda. A primeira é criada quando você salvar.</p></div>`}
    </section>`);

  const f = $('#form-prompt', alvo);
  const ta = $('#pr-texto', f);
  ta.addEventListener('input', () => { $('#pr-contador', f).textContent = ta.value.length; });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    await comBotao($('.barra-salvar [type=submit]', f), async () => {
      try { await api.salvarPromptRede({ texto: ta.value, motivo: f.elements.motivo.value.trim() || undefined }); avisar('Regras salvas. A Lia já usa o texto novo em todas as lojas.'); montar(alvo, ctx); }
      catch (err) { avisar(err.campos ? Object.values(err.campos)[0] : err.message, 'erro'); }
    });
  });
  $('#ver-previa', alvo).addEventListener('click', () => verPrevia(r.lojas));
  $('#conferir', alvo).addEventListener('click', (e) => comBotao(e.currentTarget, async () => {
    try {
      const c = await api.conferirPromptRede(ta.value);
      abrirModal({
        titulo: c.conflitos.length ? `${c.conflitos.length} conflito(s) com o prompt fixo` : 'Nenhum conflito encontrado',
        corpo: html`<p class="sub">${c.resumo || ''}${c.usandoChaveDe ? ` · análise feita com a chave de IA da loja ${c.usandoChaveDe}` : ''}</p>
          ${c.conflitos.map((x) => html`<div class="conflito"><p><strong>Sua regra:</strong> ${x.regra}</p><p><strong>O fixo diz:</strong> ${x.fixo}</p><p><strong>Na prática:</strong> ${x.efeito}</p>${x.sugestao ? html`<p><strong>Sugestão:</strong> ${x.sugestao}</p>` : ''}</div>`)}`,
        rodape: html`<button class="btn btn-contorno" data-fechar>Fechar</button>`,
      });
    } catch (err) { avisar(err.message, 'erro'); }
  }));
  $$('[data-ver]', alvo).forEach((b) => b.addEventListener('click', () => {
    const v = r.versoes.find((x) => x.id === b.dataset.ver);
    abrirModal({ titulo: `Versão de ${quando(v.criadaEm)}${v.autor ? ` · ${v.autor}` : ''}`, corpo: html`<pre class="texto-prompt">${v.texto || '(vazio)'}</pre>`, rodape: html`<button class="btn btn-contorno" data-fechar>Fechar</button>` });
  }));
  $$('[data-restaurar]', alvo).forEach((b) => b.addEventListener('click', async () => {
    const v = r.versoes.find((x) => x.id === b.dataset.restaurar);
    if (!(await confirmar({ titulo: 'Restaurar esta versão?', texto: `O texto de ${quando(v.criadaEm)} volta a valer em todas as lojas agora. O texto atual fica guardado no histórico.`, botao: 'Restaurar' }))) return;
    try { await api.restaurarPromptRede(v.id); avisar('Versão restaurada.'); montar(alvo, ctx); } catch (err) { avisar(err.message, 'erro'); }
  }));
}

async function verPrevia(lojas) {
  const m = abrirModal({
    titulo: 'Prompt completo que a Lia recebe',
    corpo: html`<div class="form">
      <div class="campo"><label for="pv-loja">Como a loja</label><select id="pv-loja">${lojas.map((l) => html`<option value="${l.id}">${l.nome}${l.central ? ' (Central)' : ''}</option>`)}</select>
        <p class="ajuda">Texto do sistema, com um cliente de exemplo. A parte em "REGRAS DA REDE LOCARX" é a que você edita aqui; "ORIENTAÇÕES DESTA LOJA" o dono edita em Assistente virtual; o resto é fixo.</p></div>
      <pre class="texto-prompt" id="pv-texto">Carregando…</pre></div>`,
    rodape: html`<button class="btn btn-contorno" data-fechar>Fechar</button>`,
  });
  const carregar = async () => {
    const pre = $('#pv-texto', m.el); pre.textContent = 'Carregando…';
    try { pre.textContent = (await api.previaPromptRede($('#pv-loja', m.el).value)).texto; } catch (err) { pre.textContent = err.message; }
  };
  $('#pv-loja', m.el).addEventListener('change', carregar);
  carregar();
}
