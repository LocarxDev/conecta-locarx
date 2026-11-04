// v14.6 — Dados da loja (gestor): cadastro fiscal, responsáveis e cobrança. O gestor confere e corrige; o atendente só vê.
import { api } from '../api.js';
import { html, render, $, icone, avisar, dadosDoForm, marcarErros, comBotao, data } from '../util.js';
import { camposCadastro, ligarMascaras, validarCadastro, listaCadastro, seloCadastro } from './cadastro-loja.js';

export async function montar(alvo, ctx) {
  render(alvo, html`<div class="cabecalho-pagina"><div class="titulos"><h1>Dados da loja</h1><p>Carregando…</p></div></div><div class="painel"><div class="painel-corpo"><div class="esqueleto"></div></div></div>`);
  let loja;
  try { loja = await api.dadosDaLoja(); } catch (err) {
    if (err.status === 401) return ctx.sessaoExpirou();
    return render(alvo, html`<div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar os dados</h3><p>${err.message}</p></div></div>`);
  }
  let editando = false;

  function desenhar() {
    const cad = loja.cadastro || {};
    render(alvo, html`
      <div class="cabecalho-pagina">
        <div class="titulos"><h1>${loja.nome}</h1><p>${loja.cidade} · ${loja.uf}${loja.filial?.branchCode ? ` · filial ${loja.filial.branchCode}` : ''} · no Conecta desde ${data(loja.criadaEm)}</p></div>
        ${loja.podeEditar && !editando ? html`<button class="btn btn-primario" id="editar-cadastro">${icone('editar')}${cad.completo ? 'Corrigir dados' : 'Completar cadastro'}</button>` : ''}
      </div>
      ${!cad.completo && !editando ? html`<div class="alerta-caixa aviso">${icone('alerta')}<span><strong>Cadastro incompleto.</strong> Precisamos do CNPJ, da razão social, do endereço, do gestor responsável e do e-mail de cobrança para a assinatura do Conecta e as notas fiscais.${loja.podeEditar ? ' Clique em "Completar cadastro".' : ' A administração da rede completa com você — mande os dados para o Conecta.'}</span></div>` : ''}
      <section class="painel">
        <div class="painel-cab"><div><h2>Cadastro e faturamento</h2><span class="sub">${cad.atualizadoEm ? `Atualizado em ${data(cad.atualizadoEm)}.` : 'Ainda não preenchido.'} ${loja.podeEditar ? 'Alterações ficam registradas.' : 'Mantido pela administração da rede.'}</span></div>${seloCadastro(cad)}</div>
        ${editando ? html`<form class="painel-corpo form" id="form-cadastro" novalidate>
          ${camposCadastro(cad, { prefixo: 'ml' })}
          <div class="acoes-form"><button class="btn btn-primario" type="submit">Salvar dados</button><button class="btn btn-contorno" type="button" id="cancelar-cadastro">Cancelar</button></div>
        </form>` : html`<div class="painel-corpo">${listaCadastro(cad)}</div>`}
      </section>
      <section class="painel">
        <div class="painel-cab"><h2>Filial no portal LocarX</h2></div>
        <div class="painel-corpo"><dl class="dados-grade">
          <div class="dado"><dt>Filial principal</dt><dd>${loja.filial?.branchId == null ? 'Central de Reservas (todas as filiais)' : html`<code>${loja.filial.branchCode}</code> · nº ${loja.filial.branchId} · ${loja.filial.tipo}`}</dd></div>
          <div class="dado"><dt>Recebimento do Pix</dt><dd>${loja.pix?.proprio ? 'Conta própria da loja (AbacatePay)' : 'Conta da rede, com repasse'}</dd></div>
        </dl><p class="ajuda">Nome da loja, cidade e filial são alterados pela administração da rede.</p></div>
      </section>`);
    $('#editar-cadastro', alvo)?.addEventListener('click', () => { editando = true; desenhar(); $('#ml-cnpj', alvo)?.focus(); });
    $('#cancelar-cadastro', alvo)?.addEventListener('click', () => { editando = false; desenhar(); });
    const form = $('#form-cadastro', alvo);
    if (form) {
      ligarMascaras(form);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = dadosDoForm(form);
        if (!marcarErros(form, validarCadastro(d))) return;
        await comBotao($('[type=submit]', form), async () => {
          try { loja = await api.salvarDadosDaLoja(d); editando = false; avisar(loja.cadastro?.completo ? 'Dados da loja salvos. Cadastro completo!' : 'Dados salvos. Ainda faltam campos para completar o cadastro.'); desenhar(); }
          catch (err) { if (err.status === 401) return ctx.sessaoExpirou(); if (err.campos) marcarErros(form, err.campos); else avisar(err.message, 'erro'); }
        });
      });
    }
  }
  desenhar();
}
