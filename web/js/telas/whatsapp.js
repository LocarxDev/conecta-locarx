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
    <div class="cabecalho-pagina"><div class="titulos"><h1>Canais da loja</h1>
      <p>Por onde os clientes falam com a ${ctx.usuario.loja?.nome || 'loja'}: WhatsApp e Instagram. As conversas dos dois aparecem em Conversas.</p></div></div>
    <h2 class="titulo-secao">${icone('whatsapp')}WhatsApp</h2>
    <div id="area-whats"><div class="painel"><div class="painel-corpo"><div class="esqueleto"></div></div></div></div>
    <h2 class="titulo-secao">${icone('instagram')}Instagram</h2>
    <div id="area-insta"><div class="painel"><div class="painel-corpo"><div class="esqueleto"></div></div></div></div>`);
  const area = $('#area-whats', alvo);
  montarInstagram($('#area-insta', alvo), ctx);

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
            ${c.instavelAte ? html`<div class="alerta-caixa aviso">${icone('alerta')}<span><strong>Conexão instável.</strong> O WhatsApp conectou e caiu várias vezes seguidas; para não piorar, Conectar fica bloqueado até ${new Date(c.instavelAte).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Confira se este número está aberto em outro aparelho ou sistema (WhatsApp → Dispositivos conectados) e, se continuar, use "Trocar de número".</span></div>` : ''}
            ${c.ultimaQuedaEm && !conectado ? html`<p class="sub">Última queda: ${new Date(c.ultimaQuedaEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>` : ''}
            <div>${conectado
              ? html`<div class="acoes-linha"><button class="btn btn-contorno" id="trocar">Trocar de número</button><button class="btn btn-perigo" id="desconectar">Desconectar número</button></div>`
              : html`<button class="btn btn-primario" id="conectar" ${c.configurado && !c.instavelAte ? '' : 'disabled'}>${icone('whatsapp')}Conectar WhatsApp</button>`}</div>
          </div>
        </section>
        <section class="painel">
          <div class="painel-cab"><h2>Antes de conectar</h2></div>
          <div class="painel-corpo">
            <ol class="passos">
              <li><div>Use um chip só da loja<span class="sub">Em um celular que fica na loja, carregando e no Wi-Fi. Evite o celular pessoal de alguém.</span></div></li>
              <li><div>Saia dos outros aparelhos antes de ler o QR<span class="sub">No celular: WhatsApp → Dispositivos conectados → encerrar todas as sessões (WhatsApp Web, computador, outra ferramenta). Um número só pode estar em <strong>um</strong> sistema de atendimento.</span></div></li>
              <li><div>Uma tela, uma pessoa, uma leitura<span class="sub">Leia o QR e espere aparecer "Conectado". Não fique clicando em Conectar; se o QR não vier em 30 s, use "Trocar de número".</span></div></li>
              <li><div>Depois de conectado, atenda pelo Conecta<span class="sub">Respostas pelo celular ou pelo WhatsApp Web não entram no CRM e a Lia pode responder por cima. Para falar pelo celular, assuma a conversa antes.</span></div></li>
              <li><div>Celular sempre ligado e com internet<span class="sub">Não troque de chip ou de aparelho nem reinstale o WhatsApp sem antes desconectar aqui. Evite grupos com este número.</span></div></li>
              <li><div>Não mande mensagens em massa<span class="sub">Disparos para muita gente de uma vez podem bloquear o número. Número novo: use normalmente alguns dias antes de ligar o assistente.</span></div></li>
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


// ---------- Instagram (API oficial da Meta): conectar a conta profissional da loja, ligar/desligar a Lia, desconectar ----------
async function montarInstagram(area, ctx) {
  // voltou do login da Meta? (#/whatsapp?instagram=ok|erro)
  const q = new URLSearchParams((location.hash.split('?')[1] || ''));
  if (q.get('instagram') === 'ok') { avisar(`Instagram ${q.get('usuario') ? '@' + q.get('usuario') + ' ' : ''}conectado.`); history.replaceState(null, '', '#/whatsapp'); }
  if (q.get('instagram') === 'erro') { avisar(q.get('motivo') || 'Não foi possível conectar o Instagram.', 'erro'); history.replaceState(null, '', '#/whatsapp'); }
  let r;
  try { r = await api.instagram(); } catch (err) {
    if (err.status === 401) return ctx.sessaoExpirou();
    return render(area, html`<div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p></div></div>`);
  }
  const dono = ctx.usuario.perfil === 'dono';
  render(area, html`
    <div class="whats-grade">
      <section class="painel">
        <div class="painel-cab"><h2>Situação</h2>${r.conectado ? html`<span class="selo ok">Conectado</span>` : html`<span class="selo neutro">Desconectado</span>`}</div>
        <div class="painel-corpo form">
          <div class="status-grande">
            <span class="icone-status ${r.conectado ? 'ok' : ''}">${icone('instagram')}</span>
            <div>${r.conectado
              ? html`<strong>${r.usuario ? '@' + r.usuario : 'Instagram conectado'}</strong><div class="sub">${r.pagina ? `Página do Facebook: ${r.pagina}` : 'Recebendo mensagens do direct'}</div>`
              : html`<strong>Nenhuma conta conectada</strong><div class="sub">As mensagens do direct ainda não chegam ao Conecta.</div>`}</div>
          </div>
          ${!r.configurado ? html`<div class="alerta-caixa info">${icone('info')}<span>A integração com o Instagram ainda não está ativa no servidor. Fale com a administração do Conecta.</span></div>` : ''}
          ${r.erro ? html`<div class="alerta-caixa aviso">${icone('alerta')}<span>${r.erro}</span></div>` : ''}
          ${r.conectado ? html`<label class="checkbox"><input type="checkbox" id="ig-lia" ${r.assistente ? 'checked' : ''} ${dono ? '' : 'disabled'}> A Lia responde no Instagram (desligado: só a equipe responde)</label>` : ''}
          ${dono ? html`<div class="acoes-linha">${r.conectado
            ? html`<button class="btn btn-contorno" id="ig-trocar">Trocar conta</button><button class="btn btn-perigo" id="ig-desconectar">Desconectar</button>`
            : html`<button class="btn btn-primario" id="ig-conectar" ${r.configurado ? '' : 'disabled'}>${icone('instagram')}Conectar Instagram</button>`}</div>` : ''}
        </div>
      </section>
      <section class="painel">
        <div class="painel-cab"><h2>Antes de conectar</h2></div>
        <div class="painel-corpo"><ol class="passos">
          <li><div>Conta profissional<span class="sub">O Instagram da loja precisa ser Comercial ou Criador de conteúdo (Configurações → Tipo de conta).</span></div></li>
          <li><div>Vinculado a uma Página do Facebook<span class="sub">No Instagram: Configurações → Central de Contas → Páginas. Quem conecta precisa ser administrador dessa Página.</span></div></li>
          <li><div>Autorize com a conta certa<span class="sub">Ao clicar em Conectar, entre no Facebook com o perfil que administra a Página da loja e marque a conta do Instagram da loja.</span></div></li>
          <li><div>Como funciona<span class="sub">Mensagens do direct viram conversas aqui (selo Instagram). A Lia responde como no WhatsApp; para reservar, ela pede o WhatsApp do cliente. Pela regra da Meta, a resposta automática só sai até 24 h depois da última mensagem do cliente; a equipe pode responder por até 7 dias.</span></div></li>
        </ol></div>
      </section>
    </div>`);
  const recarregar = () => montarInstagram(area, ctx);
  $('#ig-conectar', area)?.addEventListener('click', (e) => comBotao(e.currentTarget, async () => {
    try { const { url } = await api.conectarInstagram(); location.href = url; } catch (err) { avisar(err.message, 'erro'); }
  }));
  $('#ig-trocar', area)?.addEventListener('click', (e) => comBotao(e.currentTarget, async () => {
    try { const { url } = await api.conectarInstagram(); location.href = url; } catch (err) { avisar(err.message, 'erro'); }
  }));
  $('#ig-desconectar', area)?.addEventListener('click', async () => {
    if (!(await confirmar({ titulo: 'Desconectar o Instagram', texto: 'As mensagens do direct param de chegar ao Conecta. O histórico das conversas continua guardado.', botao: 'Desconectar', perigo: true }))) return;
    try { await api.desconectarInstagram(); avisar('Instagram desconectado.'); recarregar(); } catch (err) { avisar(err.message, 'erro'); }
  });
  $('#ig-lia', area)?.addEventListener('change', async (e) => {
    try { await api.assistenteInstagram(e.target.checked); avisar(e.target.checked ? 'A Lia passa a responder no Instagram.' : 'A Lia não responde mais no Instagram; só a equipe.'); } catch (err) { avisar(err.message, 'erro'); recarregar(); }
  });
}
