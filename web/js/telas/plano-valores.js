// v14.10 — Plano e valores (administração): preço mensal/anual, acessos inclusos e acesso extra, nome, descrição, itens e notas do plano.
// Vale para contratações novas; quem já assinou mantém o valor da assinatura criada na Pagar.me. Histórico de versões com quem mudou.
import { api } from '../api.js';
import { html, render, $, $$, icone, avisar, quando } from '../util.js';
import { linhaAcessos, notaAcessos } from './assinatura.js';

const reais = (c) => Number(c || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const centavosDe = (texto) => { const n = Number(String(texto).replace(/[R$\s.]/g, '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };
const valorCampo = (c) => (Number(c || 0) / 100).toFixed(2).replace('.', ',');
const desconto = (mensal, anual) => (mensal > 0 ? Math.round((1 - anual / (mensal * 12)) * 100) : 0);

export async function montar(alvo, ctx) {
  render(alvo, html`<div class="cabecalho-pagina"><div class="titulos"><h1>Plano e valores</h1><p>Carregando…</p></div></div><div class="painel"><div class="painel-corpo"><div class="esqueleto"></div></div></div>`);
  let d;
  try { d = await api.planoAdmin(); } catch (err) {
    if (err.status === 401) return ctx.sessaoExpirou();
    return render(alvo, html`<div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div></div>`);
  }
  const p = { ...d.plano };
  const pode = d.podeEditar;

  function previa() {
    const m = centavosDe($('#pl-mensal', alvo)?.value ?? valorCampo(p.mensal)), a = centavosDe($('#pl-anual', alvo)?.value ?? valorCampo(p.anual));
    const ac = { acessosInclusos: Number($('#pl-acessos', alvo)?.value ?? p.acessosInclusos), acessoExtraMensal: centavosDe($('#pl-extra', alvo)?.value ?? valorCampo(p.acessoExtraMensal)) };
    const ok = Number.isFinite(m) && Number.isFinite(a);
    return html`<div class="plano-cartao previa-plano" aria-live="polite">
      <div class="plano-cab"><div><div class="plano-rotulo">${$('#pl-rotulo', alvo)?.value || p.rotulo}</div>
        <div class="plano-preco num">${ok ? reais(m / 100) : '—'}<small>/mês</small></div>
        <div class="sub">anual ${ok ? reais(a / 100) : '—'}${ok && m > 0 ? ` · equivale a ${reais(a / 1200)}/mês · ${desconto(m, a)}% de desconto` : ''}</div></div></div>
      <h3>${$('#pl-nome', alvo)?.value || p.nome}</h3><p class="sub">${$('#pl-descricao', alvo)?.value ?? p.descricao}</p>
      <ul class="plano-lista">${linhaAcessos(ac) ? html`<li>${icone('ok')}${linhaAcessos(ac)}</li>` : ''}${($('#pl-inclui', alvo)?.value ?? p.inclui.join('\n')).split('\n').map((s) => s.trim()).filter(Boolean).map((i) => html`<li>${icone('ok')}${i}</li>`)}</ul>
      <div class="notas-plano">${[...($('#pl-notas', alvo)?.value ?? p.notas.join('\n')).split('\n').map((s) => s.trim()).filter(Boolean), notaAcessos(ac)].filter(Boolean).map((n) => html`<p>${n}</p>`)}</div>
    </div>`;
  }

  function desenhar() {
    const ass = d.assinantes || { n: 0, mensal: 0, anual: 0 };
    render(alvo, html`
      <div class="cabecalho-pagina">
        <div class="titulos"><h1>Plano e valores</h1><p>O que o gestor vê na tela de assinatura. Mudar o preço vale para <strong>contratações novas</strong>: quem já assinou mantém o valor contratado até cancelar e assinar de novo.</p></div>
        ${d.personalizado ? html`<span class="selo alerta">Personalizado${d.atualizadoPor ? ` por ${d.atualizadoPor}` : ''}${d.atualizadoEm ? ` · ${quando(d.atualizadoEm)}` : ''}</span>` : html`<span class="selo neutro">Padrão do sistema</span>`}
      </div>
      ${ass.n ? html`<div class="aviso-desconectado" style="border-radius: var(--raio); margin-bottom: 16px">${icone('info')}<div><strong>${ass.n} loja${ass.n === 1 ? '' : 's'}</strong> com assinatura em andamento neste plano (${reais(ass.mensal / 100)}/mês em mensais + ${reais(ass.anual / 100)}/ano em anuais). Elas não são afetadas por esta tela.</div></div>` : ''}
      <div class="assinatura-grade">
        <section class="painel"><form class="painel-corpo form" id="form-plano" novalidate>
          <h2>Valores</h2>
          <div class="form-linha">
            <div class="campo"><label for="pl-mensal">Mensal (R$)</label><input id="pl-mensal" inputmode="decimal" value="${valorCampo(p.mensal)}" ${pode ? '' : 'disabled'} required></div>
            <div class="campo"><label for="pl-anual">Anual (R$)</label><input id="pl-anual" inputmode="decimal" value="${valorCampo(p.anual)}" ${pode ? '' : 'disabled'} required><p class="ajuda" id="pl-desc">${desconto(p.mensal, p.anual)}% de desconto sobre 12 mensais</p></div>
          </div>
          <div class="form-linha">
            <div class="campo"><label for="pl-acessos">Acessos inclusos por loja</label><input id="pl-acessos" type="number" min="0" max="100" value="${p.acessosInclusos}" ${pode ? '' : 'disabled'}><p class="ajuda">Gestor e atendentes. 0 = não mostrar.</p></div>
            <div class="campo"><label for="pl-extra">Acesso adicional (R$/mês)</label><input id="pl-extra" inputmode="decimal" value="${valorCampo(p.acessoExtraMensal)}" ${pode ? '' : 'disabled'}><p class="ajuda">Combinado com a administração; a cobrança do extra ainda não é automática.</p></div>
          </div>
          <h2>Texto do plano</h2>
          <div class="form-linha">
            <div class="campo"><label for="pl-rotulo">Rótulo</label><input id="pl-rotulo" maxlength="40" value="${p.rotulo}" ${pode ? '' : 'disabled'} required></div>
            <div class="campo"><label for="pl-nome">Nome</label><input id="pl-nome" maxlength="60" value="${p.nome}" ${pode ? '' : 'disabled'} required></div>
          </div>
          <div class="campo"><label for="pl-descricao">Descrição curta</label><input id="pl-descricao" maxlength="200" value="${p.descricao}" ${pode ? '' : 'disabled'}></div>
          <div class="campo"><label for="pl-inclui">O que inclui (um item por linha)</label><textarea id="pl-inclui" rows="8" ${pode ? '' : 'disabled'}>${p.inclui.join('\n')}</textarea></div>
          <div class="campo"><label for="pl-notas">Notas em letra pequena (uma por linha)</label><textarea id="pl-notas" rows="4" ${pode ? '' : 'disabled'}>${p.notas.join('\n')}</textarea><p class="ajuda">A nota dos acessos é montada sozinha a partir dos valores acima.</p></div>
          ${pode ? html`<div class="campo"><label for="pl-motivo">O que mudou (fica no histórico)</label><input id="pl-motivo" maxlength="200" placeholder="Ex.: reajuste de 2027"></div>
          <div class="acoes-linha entre">
            <button type="button" class="btn btn-texto" id="pl-padrao" ${d.personalizado ? '' : 'disabled'}>Voltar ao padrão do sistema</button>
            <button class="btn btn-primario" type="submit">Salvar e publicar</button>
          </div>` : html`<p class="sub">Só a administração altera o plano.</p>`}
        </form></section>
        <aside class="coluna-lateral">
          <section class="painel"><div class="painel-corpo"><h2>Como o gestor vai ver</h2><div id="previa">${previa()}</div></div></section>
          <section class="painel"><div class="painel-corpo"><h2>Histórico</h2>
            ${d.versoes.length ? html`<ul class="lista-simples">${d.versoes.map((v) => html`<li><strong>${reais(v.dados.mensal / 100)}/mês · ${reais(v.dados.anual / 100)}/ano</strong> · ${v.dados.acessosInclusos} acessos${v.dados.acessoExtraMensal ? ` + ${reais(v.dados.acessoExtraMensal / 100)}` : ''}<div class="sub">${v.autor || '—'} · ${quando(v.em)}${v.motivo ? ` · ${v.motivo}` : ''}</div></li>`)}</ul>` : html`<p class="sub">Nenhuma alteração ainda — vale o padrão do sistema (${reais(d.padrao.mensal / 100)}/mês, ${reais(d.padrao.anual / 100)}/ano).</p>`}
          </div></section>
        </aside>
      </div>`);
    const atualiza = () => { render($('#previa', alvo), previa()); const m = centavosDe($('#pl-mensal', alvo).value), a = centavosDe($('#pl-anual', alvo).value); $('#pl-desc', alvo).textContent = Number.isFinite(m) && Number.isFinite(a) && m > 0 ? `${desconto(m, a)}% de desconto sobre 12 mensais` : ''; };
    $$('#form-plano input, #form-plano textarea', alvo).forEach((i) => i.addEventListener('input', atualiza));
    if (!pode) return;
    $('#form-plano', alvo).addEventListener('submit', async (e) => {
      e.preventDefault();
      const dados = {
        mensal: centavosDe($('#pl-mensal', alvo).value), anual: centavosDe($('#pl-anual', alvo).value),
        acessosInclusos: Number($('#pl-acessos', alvo).value), acessoExtraMensal: centavosDe($('#pl-extra', alvo).value),
        rotulo: $('#pl-rotulo', alvo).value.trim(), nome: $('#pl-nome', alvo).value.trim(), descricao: $('#pl-descricao', alvo).value.trim(),
        inclui: $('#pl-inclui', alvo).value.split('\n').map((s) => s.trim()).filter(Boolean),
        notas: $('#pl-notas', alvo).value.split('\n').map((s) => s.trim()).filter(Boolean),
        motivo: $('#pl-motivo', alvo).value.trim() || undefined,
      };
      if (!Number.isFinite(dados.mensal) || !Number.isFinite(dados.anual) || !Number.isFinite(dados.acessoExtraMensal)) return avisar('Confira os valores em reais (ex.: 220,00).', 'erro');
      if (!confirm(`Publicar ${reais(dados.mensal / 100)}/mês e ${reais(dados.anual / 100)}/ano para as próximas contratações?`)) return;
      try {
        const r = await api.salvarPlanoAdmin(dados);
        avisar('Plano publicado. Vale para as próximas contratações.');
        d = await api.planoAdmin(); Object.assign(p, r.plano); desenhar();
      } catch (err) { avisar(err.campos ? Object.values(err.campos)[0] : err.message, 'erro'); }
    });
    $('#pl-padrao', alvo).addEventListener('click', async () => {
      if (!confirm('Voltar ao padrão do sistema? A personalização atual fica no histórico.')) return;
      try { await api.planoPadraoAdmin(); avisar('Plano voltou ao padrão.'); d = await api.planoAdmin(); Object.assign(p, d.plano); desenhar(); } catch (err) { avisar(err.message, 'erro'); }
    });
  }
  desenhar();
}
