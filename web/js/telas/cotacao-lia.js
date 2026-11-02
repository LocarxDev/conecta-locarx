// Cartão "Cotação da Lia" no painel lateral da conversa (v14 Parte C).
// Mostra o que a Lia consultou e cotou (período, filial, grupos, proteção, adicionais, total), deixa o atendente trocar
// grupo/proteção/adicionais, recalcular o preço pela API e reservar com o formulário já preenchido.
import { api } from '../api.js';
import { html, render, $, $$, icone, avisar, comBotao } from '../util.js';
import { reservaModal } from './cotacao.js';

const reais = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dataBr = (x) => (x?.date ? `${x.date.split('-').reverse().slice(0, 2).join('/')} · ${x.time}` : '—');
const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const nomeDoGrupo = (grupo) => String(grupo || '').replace(/^\s*[A-Z0-9]{1,3}\s*[-–.]\s*/i, '') || grupo;
// Só para cotações antigas (antes da v14.1), que não guardaram as proteções do grupo: nomes sem valor.
const RESERVA = [
  { codigo: 'PROTECAO_X', nome: 'Proteção X', base: true }, { codigo: 'PROTECAO_SUPER_X', nome: 'Super X', base: true },
  { codigo: 'TERCEIROS', nome: 'Terceiros' }, { codigo: 'VIDROS', nome: 'Vidros' }, { codigo: 'VIDROS_E_PNEUS', nome: 'Vidros e pneus' },
];
const ehBasica = (p) => p.base || /^PROTECAO_(SUPER_)?X$/.test(p.codigo);
const comValor = (p) => (p.diaria != null ? ` · ${reais(p.diaria)}/diária` : '');

/**
 * @param {HTMLElement} el
 * @param {{ ctx, conversa, aoUsarTexto?: (texto) => void, aoReservar?: () => void }} op
 */
export function montarCartaoCotacao(el, { ctx, conversa, aoUsarTexto, aoReservar }) {
  let d = null, preco = null, precoEm = null, vivo = true, mexeu = false, escolha = null;   // escolha: o que o atendente marcou, mantido ao trocar de grupo

  async function carregar() {
    try {
      const r = await api.cotacaoDaLia(conversa.id);
      if (!vivo) return;
      d = r.lia;
      if (!d) { el.hidden = true; render(el, ''); return; }
      // preço mais recente: o recálculo da equipe (se for do mesmo período) ou a cotação da Lia
      preco = r.equipe && r.equipe.periodo?.retirada?.date === d.periodo.retirada.date ? r.equipe : null;
      precoEm = preco ? (preco.em || r.equipeEm) : d.cotacao?.em || null;
      mexeu = false; escolha = null;
      el.hidden = false;
      desenhar();
    } catch (err) { if (vivo) { el.hidden = true; render(el, ''); if (err.status === 401) ctx.sessaoExpirou?.(); } }
  }

  const selecao = () => {
    const fleetId = $('[name="cl-grupo"]', el)?.value;
    const basica = $('[name="cl-basica"]', el)?.value;
    const opc = $$('[name="cl-opc"]:checked', el).map((i) => i.value);
    const adicionais = $$('[data-ad]:checked', el).map((i) => { const a = d.adicionaisDisponiveis.find((x) => String(x.id) === i.dataset.ad); const qtd = Number($(`[data-qtd="${i.dataset.ad}"]`, el)?.value || 1) || 1; return { id: a.id, nome: a.nome, qtd: a.maximo ? Math.min(qtd, a.maximo) : qtd, valor: a.diaria }; });
    return { fleetId, protecoes: [basica, ...opc].filter(Boolean), adicionais };
  };

  function desenhar() {
    const c = d.cotacao;
    const fleetSel = escolha?.fleetId ?? preco?.fleetId ?? c?.fleetId ?? d.grupos[0]?.fleetId;
    // proteções do grupo escolhido, como o portal ofereceu (recálculo da equipe > consulta da Lia > lista de reserva)
    const doGrupo = (preco && String(preco.fleetId) === String(fleetSel) && preco.protecoesDisponiveis?.length) ? preco.protecoesDisponiveis
      : (d.grupos.find((g) => String(g.fleetId) === String(fleetSel))?.protecoes || []);
    const listaProt = doGrupo.length ? doGrupo : RESERVA;
    const basicas = listaProt.filter(ehBasica), opcionais = listaProt.filter((p) => !ehBasica(p));
    const prot = (escolha?.protecoes || preco?.codigos || c?.protecoes || []).filter((x) => listaProt.some((p) => p.codigo === x));
    const basica = prot.find((x) => basicas.some((p) => p.codigo === x)) || basicas.find((p) => p.padrao)?.codigo || basicas[0]?.codigo;
    const adSel = escolha?.adicionais || preco?.adicionais || c?.adicionais || [];
    const total = preco?.total ?? c?.total ?? null;
    const grupoDe = (fid) => d.grupos.find((g) => String(g.fleetId) === String(fid));
    render(el, html`<section class="pc-bloco cl-cartao" aria-label="Cotação da Lia">
      <h4>${icone('busca')}Cotação da Lia <span class="sub cl-quando">${precoEm ? `feita às ${hora(precoEm)}` : ''}${d.vencida ? ' · vencida' : ' · vale 24 h'}</span></h4>
      ${d.vencida ? html`<p class="alerta-caixa aviso">${icone('alerta')}<span>Cotação vencida (mais de 24 h ou retirada passada). Use o botão Cotação para consultar de novo.</span></p>` : ''}
      <div class="cl-grade">
        <div><span class="sub">Retirada</span><strong>${dataBr(d.periodo.retirada)}</strong></div>
        <div><span class="sub">Devolução</span><strong>${dataBr(d.periodo.devolucao)}</strong></div>
        <div><span class="sub">Filial</span><strong>${d.filial || ctx.usuario.loja?.nome || '—'}</strong></div>
        <div><span class="sub">Diárias</span><strong>${d.diarias ?? '—'}</strong></div>
      </div>
      <div class="form-linha">
        <div class="campo"><label for="cl-grupo">Grupo</label><select id="cl-grupo" name="cl-grupo">${d.grupos.map((g) => html`<option value="${g.fleetId}" ${String(g.fleetId) === String(fleetSel) ? 'selected' : ''}>${g.letra} – ${nomeDoGrupo(g.grupo)}${g.total != null ? ` · ${reais(g.total)}` : ''}</option>`)}</select></div>
        <div class="campo"><label for="cl-basica">Proteção</label><select id="cl-basica" name="cl-basica">${basicas.map((p) => html`<option value="${p.codigo}" ${p.codigo === basica ? 'selected' : ''}>${p.nome}${comValor(p)}</option>`)}</select></div>
      </div>
      ${opcionais.length ? html`<div class="cl-opcionais">${opcionais.map((p) => html`<label class="checkbox"><input type="checkbox" name="cl-opc" value="${p.codigo}" ${prot.includes(p.codigo) ? 'checked' : ''}> ${p.nome}${p.diaria != null ? html` <span class="sub num">${reais(p.diaria)}/diária</span>` : ''}</label>`)}</div>` : ''}
      <p class="sub">${doGrupo.length ? 'Proteções e valores por diária do portal para este grupo.' : 'Valores das proteções: clique em Atualizar preço.'}</p>
      <div class="campo"><label>Serviços adicionais <span class="sub">(valor por diária, da API)</span></label>
        ${d.adicionaisDisponiveis.length ? html`<div class="cl-adicionais">${d.adicionaisDisponiveis.map((a) => { const s = adSel.find((x) => String(x.id) === String(a.id)); return html`<label class="checkbox"><input type="checkbox" data-ad="${a.id}" ${s ? 'checked' : ''}> <span class="cl-ad-nome">${a.nome}</span>${a.maximo && a.maximo > 1 ? html`<input type="number" class="cl-qtd" data-qtd="${a.id}" min="1" max="${a.maximo}" value="${s?.qtd || 1}" aria-label="Quantidade de ${a.nome}">` : ''}<span class="sub num" title="por diária">${a.diaria != null ? reais(a.diaria) + '/diária' : 'valor na API'}</span></label>`; })}</div>`
          : html`<p class="sub">Nenhum serviço adicional veio da API nesta consulta.</p>`}
      </div>
      <div class="cl-total"><span>Total (com proteção${adSel.length ? ', adicionais' : ''} e taxas)</span><strong class="num">${reais(total)}</strong>${preco?.caucao != null || c?.caucao != null ? html`<span class="sub">Caução: ${reais(preco?.caucao ?? c?.caucao)}</span>` : ''}</div>
      ${!preco && c?.resumoEnviado ? html`<p class="sub">A Lia já enviou o resumo ao cliente e está aguardando a confirmação.</p>` : ''}
      <div class="pc-acoes">
        <button type="button" class="btn btn-contorno" id="cl-atualizar" ${d.vencida ? 'disabled' : ''}>Atualizar preço</button>
        <button type="button" class="btn btn-primario" id="cl-reservar" ${d.vencida ? 'disabled' : ''}>Reservar</button>
        ${preco?.textoWhatsapp && aoUsarTexto ? html`<button type="button" class="btn btn-texto" id="cl-usar" title="Coloca o texto do valor no campo de mensagem">${icone('whatsapp')}Enviar ao cliente</button>` : ''}
      </div>
    </section>`);

    // regras de proteção: Vidros e Vidros e pneus não se combinam
    $$('[name="cl-opc"]', el).forEach((i) => i.addEventListener('change', () => {
      if (i.checked && (i.value === 'VIDROS' || i.value === 'VIDROS_E_PNEUS')) $$('[name="cl-opc"]', el).forEach((o) => { if (o !== i && /VIDROS/.test(o.value)) o.checked = false; });
      marcarMexeu();
    }));
    // trocar de grupo muda as proteções oferecidas: redesenha mantendo o que dá para manter
    $('[name="cl-grupo"]', el).addEventListener('change', () => { escolha = selecao(); desenhar(); marcarMexeu(); });
    $$('[name="cl-basica"], [data-ad], [data-qtd]', el).forEach((i) => i.addEventListener('change', marcarMexeu));
    $('#cl-atualizar', el).addEventListener('click', (e) => atualizar(e.currentTarget));
    $('#cl-reservar', el).addEventListener('click', () => reservar(grupoDe));
    $('#cl-usar', el)?.addEventListener('click', () => { if (preco?.textoWhatsapp) aoUsarTexto(preco.textoWhatsapp); });
  }

  function marcarMexeu() {
    mexeu = true;
    const t = $('.cl-total strong', el); if (t) { t.textContent = '—'; t.title = 'Clique em Atualizar preço'; }
    $('#cl-usar', el)?.remove();
  }

  async function atualizar(botao) {
    const s = selecao();
    await comBotao(botao, async () => {
      try {
        preco = await api.recalcularCotacao(conversa.id, { fleetId: s.fleetId, protecoes: s.protecoes, adicionais: s.adicionais.map((a) => ({ id: a.id, qtd: a.qtd })) });
        precoEm = new Date().toISOString(); mexeu = false; escolha = null;
        if (preco.adicionaisDisponiveis?.length) d.adicionaisDisponiveis = preco.adicionaisDisponiveis;
        desenhar();
        avisar(`Preço atualizado: ${reais(preco.total)}.`);
      } catch (err) {
        if (err.status === 401) return ctx.sessaoExpirou?.();
        if (err.status === 409) { avisar(err.message, 'erro'); carregar(); return; }
        avisar(err.message, 'erro');
      }
    });
  }

  function reservar(grupoDe) {
    const s = selecao();
    const g = grupoDe(s.fleetId);
    if (!g) return avisar('Escolha o grupo.', 'erro');
    const nome = nomeDoGrupo(g.grupo);
    reservaModal({
      ctx, conversa,
      periodo: { dataRetirada: d.periodo.retirada.date, horaRetirada: d.periodo.retirada.time, dataDevolucao: d.periodo.devolucao.date, horaDevolucao: d.periodo.devolucao.time, filialId: d.branchId ? String(d.branchId) : undefined },
      g: { fleetId: g.fleetId, letra: g.letra, nome, protecoes: [] },
      protecoes: s.protecoes, adicionais: s.adicionais,
      usar: (texto) => aoUsarTexto?.(texto),
      aoReservar: () => { aoReservar?.(); carregar(); },
    });
  }

  render(el, html`<div class="pc"><div class="esqueleto"></div></div>`);
  carregar();
  return {
    // a Lia pode cotar enquanto o atendente olha; recarrega se ele não estiver mexendo no cartão
    recarregar: () => { if (!mexeu && !el.contains(document.activeElement)) carregar(); },
    destruir: () => { vivo = false; },
  };
}
