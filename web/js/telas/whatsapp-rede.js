// Status do WhatsApp (administração e matriz): servidor Evolution no ar, instância de cada loja,
// número conectado, equipe online, mensagens nas últimas 24 h e alertas. A administração reconecta e desconecta.
// Nenhuma conversa é mostrada aqui — só situação e números.
import { api } from '../api.js';
import { html, render, $, $$, icone, avisar, confirmar, comBotao, quando, abrirModal } from '../util.js';

const formatarNumero = (n) => {
  const d = String(n || '').replace(/\D/g, '');
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (d ? '+' + d : '—');
};
const SELO = {
  conectado: html`<span class="selo ok">Conectado</span>`,
  conectando: html`<span class="selo alerta">Conectando</span>`,
  desconectado: html`<span class="selo erro">Desconectado</span>`,
  nunca: html`<span class="selo neutro">Nunca conectado</span>`,
};
const ASSISTENTE = { ligado: html`<span class="selo ok sem-ponto">Ligado</span>`, 'sem chave': html`<span class="selo alerta sem-ponto">Sem chave</span>`, desligado: html`<span class="selo neutro sem-ponto">Desligado</span>` };

export async function montar(alvo, ctx) {
  const admin = ctx.usuario.perfil === 'admin';
  let dados = null, timerQr = null, timerAuto = null;
  const pararQr = () => { clearTimeout(timerQr); timerQr = null; };

  render(alvo, html`
    <div class="cabecalho-pagina">
      <div class="titulos"><h1>Status do WhatsApp</h1><p>Servidor do WhatsApp (Evolution) e o número conectado em cada loja. ${admin ? 'Daqui você reconecta e desconecta as lojas.' : 'Só consulta: a conexão é feita pelo dono da loja.'}</p></div>
      <button class="btn btn-contorno" id="verificar-tudo" title="Pergunta à Evolution a situação real de cada instância">${icone('roleta')}Verificar agora</button>
    </div>
    <div id="area-status"><div class="resumo">${[1, 2, 3, 4].map(() => html`<div class="resumo-item"><div class="esqueleto"></div><div class="esqueleto"></div></div>`)}</div></div>`);
  const area = $('#area-status', alvo);

  function desenhar() {
    const ev = dados.evolution, t = dados.totais;
    const comAlerta = dados.lojas.filter((l) => l.alertas.length);
    render(area, html`
      <div class="resumo">
        <div class="resumo-item"><span class="rotulo">Servidor do WhatsApp</span>
          <span class="valor">${ev.naoConfigurada ? html`<span class="selo neutro">Não configurado</span>` : ev.noAr ? html`<span class="selo ok">No ar</span>` : html`<span class="selo erro">Fora do ar</span>`}</span>
          <span class="detalhe">${ev.naoConfigurada ? 'EVOLUTION_URL não definida no servidor' : ev.noAr ? `Evolution ${ev.versao || ''}`.trim() : (ev.erro || 'sem resposta')}</span></div>
        <div class="resumo-item"><span class="rotulo">Lojas conectadas</span><span class="valor">${t.conectadas}<span class="sub"> / ${t.lojas}</span></span><span class="detalhe">lojas ativas com número ligado</span></div>
        <div class="resumo-item"><span class="rotulo">Com alerta</span><span class="valor">${t.comAlerta}</span><span class="detalhe">${t.comAlerta ? 'precisam de atenção' : 'tudo em ordem'}</span></div>
        <div class="resumo-item"><span class="rotulo">Mensagens em 24 h</span><span class="valor">${dados.lojas.reduce((s, l) => s + l.recebidas24h, 0)}</span><span class="detalhe">recebidas em toda a rede</span></div>
      </div>
      ${comAlerta.length ? html`<section class="painel"><div class="painel-cab"><h2>${icone('alerta')} Alertas</h2></div>
        <div class="lista-simples">${comAlerta.map((l) => html`<div><div><strong>${l.nome}</strong><div class="sub">${l.alertas.join(' · ')}</div></div>${SELO[l.status]}</div>`)}</div></section>` : ''}
      <section class="painel">
        <div class="painel-cab"><h2>Lojas</h2><span class="sub">"Verificar agora" confere a situação ao vivo na Evolution.</span></div>
        <div class="tabela-caixa"><table class="tabela tabela-status">
          <thead><tr><th>Loja</th><th>WhatsApp</th><th class="col-opcional">Número</th><th class="col-opcional">Assistente</th><th class="col-opcional">Equipe</th><th class="col-opcional">Mensagens</th><th><span class="sr-only">Ações</span></th></tr></thead>
          <tbody>${dados.lojas.map((l) => html`<tr class="${l.ativa ? '' : 'inativo'}">
            <td><strong>${l.nome}</strong><div class="sub">${l.cidade}/${l.uf} · filial ${l.filial ?? '—'}${l.ativa ? '' : ' · desativada'}</div></td>
            <td>${SELO[l.status] || SELO.nunca}${l.estadoVivo && l.estadoVivo !== 'erro' ? html`<div class="sub">ao vivo: ${l.estadoVivo}</div>` : ''}${l.atualizadoEm ? html`<div class="sub">${quando(l.atualizadoEm)}</div>` : ''}</td>
            <td class="col-opcional num nowrap">${formatarNumero(l.numero)}</td>
            <td class="col-opcional">${ASSISTENTE[l.assistente]}</td>
            <td class="col-opcional num">${l.online} <span class="sub">de ${l.equipe}</span>${l.aguardando ? html`<div class="sub">${l.aguardando} aguardando</div>` : ''}</td>
            <td class="col-opcional num">${l.recebidas24h} <span class="sub">↓ ${l.enviadas24h} ↑ em 24 h</span><div class="sub">${l.ultimaMensagemEm ? 'última ' + quando(l.ultimaMensagemEm).toLowerCase() : 'nenhuma ainda'}</div></td>
            <td class="nowrap"><div class="acoes-linha">
              ${admin && l.ativa && l.status !== 'conectado' ? html`<button class="btn btn-texto" data-conectar="${l.id}" title="Gera o QR code para o celular da loja ler">Reconectar</button>` : ''}
              ${admin && l.status === 'conectado' ? html`<button class="btn btn-texto" data-desconectar="${l.id}">Desconectar</button>` : ''}
              <a class="btn btn-texto" href="#/lojas/${l.id}" title="Abrir a loja">${icone('seta')}</a>
            </div></td>
          </tr>`)}</tbody></table></div>
      </section>`);
    $$('[data-conectar]', area).forEach((b) => b.addEventListener('click', () => conectar(dados.lojas.find((l) => l.id === b.dataset.conectar))));
    $$('[data-desconectar]', area).forEach((b) => b.addEventListener('click', () => desconectar(dados.lojas.find((l) => l.id === b.dataset.desconectar))));
  }

  // ---------- reconectar: QR code numa janela (quem lê é o celular da loja) ----------
  function conectar(l) {
    if (!l) return;
    const m = abrirModal({
      titulo: `Reconectar ${l.nome}`,
      corpo: html`<div class="whats-grade"><div class="qr-caixa" id="qr-area"><div class="qr-espera">Gerando o QR code…</div></div>
        <ol class="passos">
          <li><div>No celular da loja, abra o WhatsApp</div></li>
          <li><div>Configurações → Dispositivos conectados → Conectar dispositivo</div></li>
          <li><div>Aponte a câmera para o QR code</div></li>
        </ol></div>
        <p class="ajuda">O QR code se renova sozinho. A janela fecha quando a loja conectar.</p>`,
      rodape: html`<button class="btn btn-contorno" data-fechar>Fechar</button>`,
    });
    const qrArea = $('#qr-area', m.el);
    const mostrar = (r) => render(qrArea, r.qr ? html`<img src="${r.qr}" alt="QR code para conectar o WhatsApp" width="264" height="264">` : html`<div class="qr-espera">Gerando o QR code…</div>`);
    const terminou = () => { pararQr(); m.fechar(); avisar(`${l.nome}: WhatsApp conectado.`); carregar(true); };
    const acompanhar = async () => {
      if (!m.el.isConnected) return pararQr();
      try { const r = await api.qrWhatsappLoja(l.id); if (r.status === 'conectado') return terminou(); mostrar(r); }
      catch (err) { if (err.status === 401) return ctx.sessaoExpirou(); avisar(err.message, 'erro'); }
      timerQr = setTimeout(acompanhar, 3000);
    };
    api.conectarWhatsappLoja(l.id).then((r) => { if (r.status === 'conectado') return terminou(); mostrar(r); timerQr = setTimeout(acompanhar, 3000); })
      .catch((err) => { if (err.status === 401) return ctx.sessaoExpirou(); avisar(err.message, 'erro'); m.fechar(); });
  }

  async function desconectar(l) {
    if (!l || !(await confirmar({ titulo: `Desconectar ${l.nome}`, texto: 'A loja para de receber mensagens no Conecta até alguém conectar o número de novo. O histórico continua guardado.', botao: 'Desconectar', perigo: true }))) return;
    try { await api.desconectarWhatsappLoja(l.id); avisar('WhatsApp desconectado.'); carregar(); } catch (err) { avisar(err.message, 'erro'); }
  }

  async function carregar(aoVivo = false) {
    try { dados = await api.statusWhatsappRede(aoVivo); desenhar(); } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      render(area, html`<div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div></div>`);
    }
  }

  $('#verificar-tudo', alvo).addEventListener('click', (e) => comBotao(e.currentTarget, () => carregar(true).then(() => avisar('Situação conferida com a Evolution.'))));
  await carregar();
  timerAuto = setInterval(() => carregar(), 60_000);   // atualiza sozinho a cada minuto (sem perguntar à Evolution)
  return () => { pararQr(); clearInterval(timerAuto); };
}
