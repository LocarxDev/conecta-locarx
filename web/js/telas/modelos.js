// Mensagens automáticas e modelos de mensagem da loja (dono).
import { api } from '../api.js';
import { html, render, $, $$, icone, avisar, comBotao } from '../util.js';

export async function montar(alvo, ctx) {
  render(alvo, html`<div class="cabecalho-pagina"><div class="titulos"><h1>Mensagens automáticas</h1><p>Carregando…</p></div></div>`);
  let modelos;
  try { modelos = await api.modelos(); } catch (err) {
    if (err.status === 401) return ctx.sessaoExpirou();
    return render(alvo, html`<div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div></div>`);
  }
  const auto = modelos.filter((m) => m.automatico), manuais = modelos.filter((m) => !m.automatico);
  const cartao = (m) => html`<form class="painel modelo" data-chave="${m.chave}" novalidate>
    <div class="painel-cab"><div><h2>${m.nome}</h2><span class="sub">${m.quando}</span></div>
      <label class="checkbox"><input type="checkbox" name="ativo" ${m.ativo ? 'checked' : ''}> ${m.automatico ? 'Enviar automaticamente' : 'Disponível'}</label></div>
    <div class="painel-corpo form">
      <div class="campo"><label for="mod-${m.chave}">Texto</label><textarea id="mod-${m.chave}" name="texto" rows="4" maxlength="1000">${m.texto}</textarea></div>
      <div class="filtros"><button class="btn btn-contorno" type="submit">Salvar</button></div>
    </div></form>`;
  render(alvo, html`
    <div class="cabecalho-pagina"><div class="titulos"><h1>Mensagens automáticas</h1>
      <p>Lembretes enviados sozinhos para os clientes com reserva, e modelos para a equipe iniciar conversas. Nada é enviado no horário de silêncio nem para quem pediu para não receber.</p></div></div>
    <div class="alerta-caixa info">${icone('info')}<span>Campos que o sistema preenche: {nome}, {loja}, {codigo}, {data_retirada}, {hora_retirada}, {data_devolucao} e {hora_devolucao}.</span></div>
    <h2>Enviadas automaticamente</h2>
    <div class="grade-modelos">${auto.map(cartao)}</div>
    <h2>Modelos para a equipe</h2>
    <div class="grade-modelos">${manuais.map(cartao)}</div>`);
  $$('form.modelo', alvo).forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const texto = f.elements.texto.value.trim();
    if (texto.length < 2) return avisar('Escreva o texto.', 'erro');
    await comBotao($('[type=submit]', f), async () => {
      try { await api.salvarModelo(f.dataset.chave, { texto, ativo: f.elements.ativo.checked }); avisar('Modelo salvo.'); } catch (err) { avisar(err.campos ? Object.values(err.campos)[0] : err.message, 'erro'); }
    });
  }));
}
