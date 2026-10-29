// Base da rede (administração e matriz): orientações gerais, modelo padrão do assistente, base e sinônimos.
import { api } from '../api.js';
import { html, render, $, $$, icone, avisar, comBotao } from '../util.js';
import { painelBase } from './base.js';

export async function montar(alvo, ctx) {
  render(alvo, html`<div class="cabecalho-pagina"><div class="titulos"><h1>Base da rede</h1><p>Carregando…</p></div></div>`);
  let r;
  try { r = await api.rede(); } catch (err) {
    if (err.status === 401) return ctx.sessaoExpirou();
    return render(alvo, html`<div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div></div>`);
  }
  const m = r.modeloAssistente || {};
  render(alvo, html`
    <div class="cabecalho-pagina"><div class="titulos"><h1>Base da rede</h1><p>O que vale para os assistentes de todas as lojas LocarX.</p></div></div>
    <form class="form" id="form-rede" novalidate>
      <div class="perfil-grade">
        <section class="painel"><div class="painel-cab"><h2>Regras da rede para a Lia</h2></div>
          <div class="painel-corpo"><p>As regras que valem para todas as lojas agora ficam em <a href="#/prompt"><strong>Prompt da Lia</strong></a>, com histórico de versões e prévia do prompt completo.</p>
            <p class="sub">${r.orientacoes ? `${r.orientacoes.length} caracteres em vigor.` : 'Nenhuma regra cadastrada ainda.'}</p></div></section>
        <section class="painel"><div class="painel-cab"><h2>Modelo padrão para lojas novas</h2></div>
          <div class="painel-corpo form">
            <div class="campo"><label for="r-nome">Nome do assistente</label><input id="r-nome" name="nome" value="${m.nome || ''}" maxlength="60" placeholder="Assistente LocarX"></div>
            <div class="campo"><label for="r-boas">Saudação</label><input id="r-boas" name="boasVindas" value="${m.boasVindas || ''}" maxlength="1000"></div>
            <div class="campo"><label for="r-instr">Orientações iniciais da loja</label><textarea id="r-instr" name="instrucoes" rows="4" maxlength="8000">${m.instrucoes || ''}</textarea></div>
            <div class="campo"><label for="r-repasse">Mensagem ao chamar a equipe</label><input id="r-repasse" name="msgRepasse" value="${m.msgRepasse || ''}" maxlength="1000"></div>
            <p class="ajuda">Cada loja nova começa com estes textos e pode mudar depois.</p>
          </div></section>
      </div>
      <div class="barra-salvar"><button class="btn btn-primario" type="submit">Salvar</button></div>
    </form>
    <div id="base"></div>
    <section class="painel">
      <div class="painel-cab"><h2>Sinônimos</h2><span class="sub">Ajudam o assistente a entender palavras diferentes para a mesma coisa</span></div>
      <div class="painel-corpo form">
        <div class="lista-sinonimos" id="sinonimos"></div>
        <form class="filtros" id="form-sin" novalidate><label class="sr-only" for="sin-novo">Novo grupo</label>
          <input id="sin-novo" class="campo-inline" placeholder="Ex.: franquia, coparticipação, participação" maxlength="400">
          <button class="btn btn-contorno" type="submit">${icone('mais')}Incluir grupo</button></form>
      </div>
    </section>`);

  const f = $('#form-rede', alvo);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = {
      modeloAssistente: { nome: f.elements.nome.value.trim() || undefined, boasVindas: f.elements.boasVindas.value, instrucoes: f.elements.instrucoes.value, msgRepasse: f.elements.msgRepasse.value },
    };
    await comBotao($('.barra-salvar [type=submit]', f), async () => { try { await api.salvarRede(d); avisar('Orientações da rede salvas.'); } catch (err) { avisar(err.message, 'erro'); } });
  });

  painelBase($('#base', alvo), { ctx, escopo: 'rede', titulo: 'Base de conhecimento da rede', podeEditar: true, podeAprovar: true, importarPortal: true });

  let sinonimos = r.sinonimos;
  const desenharSin = () => {
    render($('#sinonimos', alvo), html`${sinonimos.map((s) => html`<span class="grupo-sin">${s.termos.join(' · ')}<button type="button" class="btn btn-texto btn-icone" data-sin="${s.id}" aria-label="Excluir grupo">${icone('fechar')}</button></span>`)}`);
    $$('[data-sin]', alvo).forEach((b) => b.addEventListener('click', async () => {
      try { await api.excluirSinonimo(b.dataset.sin); sinonimos = sinonimos.filter((s) => s.id !== b.dataset.sin); desenharSin(); } catch (err) { avisar(err.message, 'erro'); }
    }));
  };
  desenharSin();
  $('#form-sin', alvo).addEventListener('submit', async (e) => {
    e.preventDefault();
    const termos = $('#sin-novo', alvo).value.split(',').map((t) => t.trim()).filter(Boolean);
    if (termos.length < 2) return avisar('Informe pelo menos 2 palavras separadas por vírgula.', 'erro');
    try { sinonimos.push(await api.incluirSinonimo(termos)); $('#sin-novo', alvo).value = ''; desenharSin(); } catch (err) { avisar(err.campos ? Object.values(err.campos)[0] : err.message, 'erro'); }
  });
}
