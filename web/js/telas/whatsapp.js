// WhatsApp da loja (dono): conectar pelo QR code, ver a situação e desconectar.
import { api, USAR_EXEMPLO } from '../api.js';
import { html, render, $, icone, avisar, confirmar, comBotao } from '../util.js';

const formatarNumero = (n) => {
  const d = String(n || '').replace(/\D/g, '');
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (d ? '+' + d : '');
};

export async function montar(alvo, ctx) {
  let espera = null;
  const parar = () => { clearTimeout(espera); espera = null; };

  render(alvo, html`
    <div class="cabecalho-pagina"><div class="titulos"><h1>WhatsApp da loja</h1>
      <p>O número que os clientes usam para falar com a ${ctx.usuario.loja?.nome || 'loja'}. As conversas aparecem em Conversas.</p></div></div>
    <div id="area-whats"><div class="painel"><div class="painel-corpo"><div class="esqueleto"></div></div></div></div>`);
  const area = $('#area-whats', alvo);

  function desenharStatus(c) {
    const conectado = c.status === 'conectado';
    render(area, html`
      <div class="whats-grade">
        <section class="painel">
          <div class="painel-cab"><h2>Situação</h2>${conectado ? html`<span class="selo ok">Conectado</span>` : html`<span class="selo neutro">Desconectado</span>`}</div>
          <div class="painel-corpo form">
            <div class="status-grande">
              <span class="icone-status ${conectado ? 'ok' : ''}">${icone('whatsapp')}</span>
              <div>${conectado
                ? html`<strong>WhatsApp conectado</strong><div class="sub">${c.numero ? `Número ${formatarNumero(c.numero)}` : 'Recebendo mensagens normalmente'}</div>`
                : html`<strong>Nenhum número conectado</strong><div class="sub">Os clientes ainda não conseguem falar com a loja por aqui.</div>`}</div>
            </div>
            ${!c.configurado ? html`<div class="alerta-caixa info">${icone('info')}<span>O servidor do WhatsApp ainda não foi configurado. Fale com a administração do Conecta.</span></div>` : ''}
            <div>${conectado
              ? html`<div class="acoes-linha"><button class="btn btn-contorno" id="trocar">Trocar de número</button><button class="btn btn-perigo" id="desconectar">Desconectar número</button></div>`
              : html`<button class="btn btn-primario" id="conectar" ${c.configurado ? '' : 'disabled'}>${icone('whatsapp')}Conectar WhatsApp</button>`}</div>
          </div>
        </section>
        <section class="painel">
          <div class="painel-cab"><h2>Antes de conectar</h2></div>
          <div class="painel-corpo">
            <ol class="passos">
              <li><div>Use um chip só da loja<span class="sub">O número fica ligado ao Conecta. Evite o celular pessoal de alguém.</span></div></li>
              <li><div>Deixe o celular ligado e com internet<span class="sub">O WhatsApp do celular precisa ficar ativo para as mensagens chegarem.</span></div></li>
              <li><div>Não mande mensagens em massa<span class="sub">Disparos para muita gente de uma vez podem bloquear o número.</span></div></li>
            </ol>
          </div>
        </section>
      </div>`);
    $('#conectar', area)?.addEventListener('click', (e) => comBotao(e.currentTarget, conectar));
    $('#desconectar', area)?.addEventListener('click', desconectar);
    $('#trocar', area)?.addEventListener('click', (e) => trocar(e.currentTarget));
  }

  function desenharQr(r) {
    render(area, html`
      <section class="painel">
        <div class="painel-cab"><h2>Conectar o WhatsApp da loja</h2><button class="btn btn-texto" id="cancelar-qr">Cancelar</button></div>
        <div class="painel-corpo whats-grade">
          <div class="qr-caixa">
            ${r.qr ? html`<img src="${r.qr}" alt="QR code para conectar o WhatsApp" width="264" height="264">`
                   : html`<div class="qr-espera">${USAR_EXEMPLO ? 'Demonstração: o QR code real aparece aqui. Conectando em instantes…' : 'Gerando o QR code…'}</div>`}
            <span class="sub">O QR code se renova sozinho. Esta tela atualiza quando conectar.</span>
          </div>
          <ol class="passos">
            <li><div>Abra o WhatsApp no celular da loja</div></li>
            <li><div>Toque em Configurações (ou nos três pontos) e depois em Dispositivos conectados</div></li>
            <li><div>Toque em Conectar dispositivo</div></li>
            <li><div>Aponte a câmera do celular para o QR code ao lado</div></li>
          </ol>
        </div>
      </section>`);
    $('#cancelar-qr', area).addEventListener('click', () => { parar(); carregar(); });
  }

  async function acompanhar() {
    try {
      const r = await api.qrCanal();
      if (r.status === 'conectado') { parar(); avisar('WhatsApp conectado.'); return carregar(); }
      desenharQr(r);
    } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      avisar(err.message, 'erro');
    }
    espera = setTimeout(acompanhar, 3000);
  }

  async function conectar(iniciar = api.conectarCanal) {
    try {
      const r = await iniciar();
      if (r.aviso) avisar(r.aviso, 'erro');
      if (r.status === 'conectado') { avisar('WhatsApp conectado.'); return carregar(); }
      desenharQr(r);
      espera = setTimeout(acompanhar, 3000);
    } catch (err) { avisar(err.message, 'erro'); carregar(); }
  }

  async function trocar(botao) {
    if (!(await confirmar({ titulo: 'Trocar o número do WhatsApp', texto: 'O número atual deixa de receber mensagens no Conecta. Em seguida aparece um QR code novo: leia com o celular do número novo. O histórico das conversas continua guardado.', botao: 'Trocar número', perigo: true }))) return;
    comBotao(botao, () => conectar(api.trocarNumeroCanal));
  }

  async function desconectar() {
    if (!(await confirmar({ titulo: 'Desconectar WhatsApp', texto: 'A loja para de receber mensagens no Conecta até conectar de novo. O histórico de conversas continua guardado.', botao: 'Desconectar', perigo: true }))) return;
    try { const r = await api.desconectarCanal(); avisar(r.aviso || 'WhatsApp desconectado.', r.aviso ? 'erro' : undefined); carregar(); } catch (err) { avisar(err.message, 'erro'); }
  }

  async function carregar() {
    try { desenharStatus(await api.canal()); } catch (err) {
      if (err.status === 401) return ctx.sessaoExpirou();
      render(area, html`<div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div></div>`);
    }
  }

  await carregar();
  return parar;
}
