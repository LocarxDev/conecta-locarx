// Respostas rápidas da loja (dono cadastra; a equipe usa digitando "/" na conversa).
import { api } from '../api.js';
import { html, render, $, $$, icone, avisar, abrirModal, confirmar, dadosDoForm, marcarErros, comBotao } from '../util.js';

export async function montar(alvo, ctx) {
  let lista = [];
  render(alvo, html`
    <div class="cabecalho-pagina">
      <div class="titulos"><h1>Respostas rápidas</h1><p>Textos prontos para a equipe. Na conversa, digite "/" e o atalho para usar.</p></div>
      <button class="btn btn-primario" id="nova-resposta">${icone('mais')}Nova resposta</button>
    </div>
    <section class="painel"><div id="lista-respostas"><div class="painel-corpo"><div class="esqueleto"></div></div></div></section>`);
  const area = $('#lista-respostas', alvo);

  function desenhar() {
    if (!lista.length) {
      render(area, html`<div class="estado">${icone('editar')}<h3>Nenhuma resposta cadastrada</h3><p>Cadastre as respostas que a equipe mais repete, como documentos para retirada, caução e endereço da loja.</p><button class="btn btn-primario" data-nova>${icone('mais')}Cadastrar a primeira</button></div>`);
    } else {
      render(area, html`<div class="tabela-caixa"><table class="tabela">
        <thead><tr><th>Atalho</th><th>Texto</th><th><span class="sr-only">Ações</span></th></tr></thead>
        <tbody>${lista.map((r) => html`<tr>
          <td><code class="chave-2fa">/${r.atalho}</code></td>
          <td class="sub">${r.texto.length > 140 ? r.texto.slice(0, 140) + '…' : r.texto}</td>
          <td><div class="acoes-linha">
            <button class="btn btn-texto btn-icone" data-editar="${r.id}" aria-label="Editar /${r.atalho}">${icone('editar')}</button>
            <button class="btn btn-texto btn-icone" data-excluir="${r.id}" aria-label="Excluir /${r.atalho}">${icone('lixo')}</button>
          </div></td></tr>`)}</tbody></table></div>`);
    }
    $$('[data-nova]', area).forEach((b) => b.addEventListener('click', () => editar()));
    $$('[data-editar]', area).forEach((b) => b.addEventListener('click', () => editar(lista.find((r) => r.id === b.dataset.editar))));
    $$('[data-excluir]', area).forEach((b) => b.addEventListener('click', async () => {
      const r = lista.find((x) => x.id === b.dataset.excluir);
      if (!(await confirmar({ titulo: 'Excluir resposta', texto: `Excluir a resposta /${r.atalho}?`, botao: 'Excluir', perigo: true }))) return;
      try { await api.excluirResposta(r.id); lista = lista.filter((x) => x.id !== r.id); desenhar(); avisar('Resposta excluída.'); } catch (err) { avisar(err.message, 'erro'); }
    }));
  }

  function editar(r) {
    const m = abrirModal({
      titulo: r ? 'Editar resposta' : 'Nova resposta',
      corpo: html`<form class="form" id="form-resposta" novalidate>
        <div class="campo"><label for="r-atalho">Atalho</label><input id="r-atalho" name="atalho" value="${r?.atalho || ''}" placeholder="ex.: caucao" autocomplete="off">
          <p class="ajuda">Letras minúsculas, números ou hífen. A equipe digita /atalho na conversa.</p></div>
        <div class="campo"><label for="r-texto">Texto</label><textarea id="r-texto" name="texto" rows="6" maxlength="2000">${r?.texto || ''}</textarea></div>
      </form>`,
      rodape: html`<button class="btn btn-contorno" data-fechar>Cancelar</button><button class="btn btn-primario" type="submit" form="form-resposta">Salvar</button>`,
    });
    const f = $('#form-resposta', m.el);
    f.elements.atalho.addEventListener('input', (e) => { e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = dadosDoForm(f);
      const erros = {};
      if (!/^[a-z0-9-]{2,30}$/.test(d.atalho)) erros.atalho = 'Use de 2 a 30 letras minúsculas, números ou hífen.';
      if (!d.texto.trim()) erros.texto = 'Escreva o texto da resposta.';
      if (!marcarErros(f, erros)) return;
      await comBotao($('[type=submit]', m.el), async () => {
        try { await api.salvarResposta({ ...d, id: r?.id }); m.fechar(); avisar('Resposta salva.'); carregar(); } catch (err) { if (err.campos) marcarErros(f, err.campos); else avisar(err.message, 'erro'); }
      });
    });
  }

  async function carregar() {
    try { lista = await api.respostas(); desenhar(); } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      render(area, html`<div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div>`);
    }
  }
  $('#nova-resposta', alvo).addEventListener('click', () => editar());
  carregar();
}
