// Tela inicial: resumo da loja (dono/atendente) ou visão da rede (administração/matriz).
import { api, USAR_EXEMPLO } from '../api.js';
import { html, render, icone, quando } from '../util.js';

const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const ESTADOS = {
  assistente: html`<span class="selo neutro">Com o assistente</span>`,
  aguardando: html`<span class="selo alerta">Aguardando atendente</span>`,
  reserva: html`<span class="selo ok">Reserva criada</span>`,
  humano: html`<span class="selo ok">Em atendimento</span>`,
  encerrada: html`<span class="selo neutro">Encerrada</span>`,
};

function esqueleto() {
  return html`<div class="resumo">${[1, 2, 3, 4].map(() => html`<div class="resumo-item"><div class="esqueleto"></div><div class="esqueleto"></div></div>`)}</div>`;
}

function aviso2fa(u) {
  if (u.doisFatores || !['admin', 'matriz', 'dono'].includes(u.perfil)) return '';
  return html`<div class="alerta-caixa info">${icone('escudo')}<span>Ative a verificação em 2 etapas para proteger o seu acesso. Para o seu tipo de acesso ela é obrigatória. <a href="#/perfil">Ativar agora</a></span></div>`;
}

function erroTela(alvo, err, ctx) {
  if (err.status === 401) return ctx.sessaoExpirou();
  render(alvo, html`<div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar</h3><p>${err.message}</p><button class="btn btn-contorno" id="tentar">Tentar de novo</button></div></div>`);
  alvo.querySelector('#tentar').addEventListener('click', () => ctx.navegar('inicio'));
}

export async function montar(alvo, ctx) {
  const u = ctx.usuario;
  const primeiroNome = u.nome.split(' ')[0];
  const ehRede = u.perfil === 'admin' || u.perfil === 'matriz';

  render(alvo, html`
    <div class="cabecalho-pagina"><div class="titulos">
      <h1>Olá, ${primeiroNome}</h1>
      <p>${ehRede ? 'Situação das lojas da rede LocarX no Conecta.' : `Resumo do atendimento da ${u.loja?.nome || 'sua loja'}.`}</p>
    </div></div>
    ${esqueleto()}`);

  try {
    if (ehRede) {
      const r = await api.resumoRede();
      render(alvo, html`
        <div class="cabecalho-pagina">
          <div class="titulos"><h1>Olá, ${primeiroNome}</h1><p>Situação das lojas da rede LocarX no Conecta.</p></div>
          ${u.perfil === 'admin' ? html`<a class="btn btn-primario" href="#/lojas?nova=1">${icone('mais')}Cadastrar loja</a>` : ''}
        </div>
        ${aviso2fa(u)}
        <div class="resumo">
          <div class="resumo-item"><span class="rotulo">Lojas ativas</span><span class="valor">${r.lojasAtivas}</span><span class="detalhe">de ${r.lojasTotal} cadastradas</span></div>
          <div class="resumo-item"><span class="rotulo">WhatsApp conectado</span><span class="valor">${r.whatsappConectado}</span><span class="detalhe">liberado na etapa 2</span></div>
          <div class="resumo-item"><span class="rotulo">Pessoas com acesso</span><span class="valor">${r.usuarios}</span><span class="detalhe">acessos ativos</span></div>
          <div class="resumo-item"><span class="rotulo">Reservas pelo assistente</span><span class="valor">—</span><span class="detalhe">liberado na etapa 4</span></div>
        </div>
        <div class="duas-colunas">
          <section class="painel">
            <div class="painel-cab"><h2>Implantação do Conecta</h2></div>
            <div class="painel-corpo">
              <ol class="passos">
                <li class="feito"><div>Base do sistema<span class="sub">Lojas, acessos, login e visual LocarX</span></div></li>
                <li><div>WhatsApp<span class="sub">Conexão do número de cada loja e caixa de conversas</span></div></li>
                <li><div>Assistente virtual<span class="sub">Orientações, base de conhecimento e configuração por loja</span></div></li>
                <li><div>Reservas pelo WhatsApp<span class="sub">Cotação e reserva direto no portal LocarX</span></div></li>
                <li><div>CRM<span class="sub">Clientes, funil, mensagens e automações</span></div></li>
                <li><div>Painel da rede<span class="sub">Relatórios e conta de demonstração</span></div></li>
              </ol>
            </div>
          </section>
          <section class="painel">
            <div class="painel-cab"><h2>Atalhos</h2></div>
            <div class="lista-simples">
              <div><span>Lojas da rede</span><a class="btn btn-texto" href="#/lojas">Abrir ${icone('seta')}</a></div>
              <div><span>Meu perfil e segurança</span><a class="btn btn-texto" href="#/perfil">Abrir ${icone('seta')}</a></div>
            </div>
          </section>
        </div>`);
      return;
    }

    const r = await api.resumoLoja();
    render(alvo, html`
      <div class="cabecalho-pagina"><div class="titulos">
        <h1>Olá, ${primeiroNome}</h1>
        <p>Resumo do atendimento da ${u.loja?.nome || 'sua loja'}.</p>
      </div></div>
      ${aviso2fa(u)}
      ${USAR_EXEMPLO ? html`<div class="faixa-exemplo">${icone('info')}<span>Números de exemplo. Os dados reais aparecem quando o WhatsApp da loja for conectado.</span></div>` : ''}
      <div class="resumo">
        <div class="resumo-item"><span class="rotulo">Clientes que escreveram hoje</span><span class="valor">${r.conversasHoje}</span><span class="detalhe">no WhatsApp da loja</span></div>
        <div class="resumo-item"><span class="rotulo">Aguardando atendente</span><span class="valor">${r.aguardando}</span><span class="detalhe">pediram atendimento humano</span></div>
        <div class="resumo-item"><span class="rotulo">Reservas na semana</span><span class="valor">${r.reservasSemana}</span><span class="detalhe">feitas pelo assistente</span></div>
        <div class="resumo-item"><span class="rotulo">Valor reservado</span><span class="valor">${reais.format(r.valorSemana)}</span><span class="detalhe">nos últimos 7 dias</span></div>
      </div>
      <div class="duas-colunas">
        <section class="painel">
          <div class="painel-cab"><h2>Últimas conversas</h2>${USAR_EXEMPLO ? html`<span class="selo neutro sem-ponto">Exemplo</span>` : ''}</div>
          ${r.ultimas.length ? html`<div class="lista-simples">
            ${r.ultimas.map((c) => html`<div>
              <div>${c.id ? html`<a href="#/conversas/${c.id}"><strong>${c.cliente}</strong></a>` : html`<strong>${c.cliente}</strong>`}<div class="sub">${c.assunto} · ${quando(c.quando)}</div></div>
              ${ESTADOS[c.estado] || ''}
            </div>`)}
          </div>` : html`<div class="estado">${icone('conversas')}<h3>Nenhuma conversa ainda</h3><p>As conversas aparecem aqui quando o WhatsApp da loja for conectado.</p></div>`}
        </section>
        <section class="painel">
          <div class="painel-cab"><h2>Sua equipe</h2></div>
          <div class="lista-simples">
            <div><span>Atendentes ativos</span><strong class="num">${r.equipeAtiva}</strong></div>
            <div><span>Convites pendentes</span><strong class="num">${r.equipeConvidada}</strong></div>
            ${u.perfil === 'dono' ? html`<div><span>Gerenciar atendentes</span><a class="btn btn-texto" href="#/atendentes">Abrir ${icone('seta')}</a></div>` : ''}
          </div>
        </section>
      </div>`);
  } catch (err) {
    erroTela(alvo, err, ctx);
  }
}
