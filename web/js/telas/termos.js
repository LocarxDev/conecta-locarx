// v14.5 — Termos de adesão (gestores), de uso e de privacidade (gestores e atendentes): aparecem no primeiro acesso e sempre que a
// administração publicar uma versão nova. Sem aceitar, o sistema não abre (o roteador e a API bloqueiam).
import { api } from '../api.js';
import { html, render, $, icone, avisar, comBotao, seguro } from '../util.js';

export async function montar(alvo, ctx) {
  const sistema = document.getElementById('sistema');
  sistema?.classList.add('so-termos');
  render(alvo, html`<div class="termo-pagina"><div class="painel"><div class="painel-corpo"><div class="esqueleto"></div></div></div></div>`);
  let lista = [];
  try { lista = await api.termosPendentes(); } catch (err) { if (err.status === 401) return ctx.sessaoExpirou(); return render(alvo, html`<div class="painel"><div class="estado">${icone('alerta')}<h3>Não foi possível carregar o termo</h3><p>${err.message}</p></div></div>`); }
  if (!lista.length) { ctx.atualizarUsuario({ ...ctx.usuario, termosPendentes: 0 }); return; }

  const total = lista.length;
  function desenhar() {
    const t = lista[0];
    const n = total - lista.length + 1;
    render(alvo, html`<div class="termo-pagina">
      <section class="painel termo-caixa">
        <div class="painel-cab"><div><h2>${t.titulo}</h2><span class="sub">${total > 1 ? `Termo ${n} de ${total} · ` : ''}${t.nome} · versão ${t.versao} · publicado em ${new Date(t.publicadoEm).toLocaleDateString('pt-BR')}</span></div></div>
        <div class="alerta-caixa info">${icone('info')}<span>Para usar o Conecta LocarX, leia o termo até o fim e clique em "Li e concordo". O aceite fica registrado com nome, e-mail, loja, data, hora, endereço IP e navegador.${total > 1 ? ` São ${total} termos; este é o ${n}º.` : ''}</span></div>
        <div class="termo-texto ${t.formato === 'html' ? 'formatado' : ''}" id="termo-texto" tabindex="0">${t.formato === 'html' ? seguro(t.texto) : t.texto}</div>
        <label class="checkbox termo-confirmo"><input type="checkbox" id="termo-li"> Li e compreendi o termo acima e concordo com ele.</label>
        <div class="termo-acoes">
          <button class="btn btn-texto" id="termo-sair">Sair sem aceitar</button>
          <button class="btn btn-primario" id="termo-aceitar" disabled>${icone('ok')}Li e concordo</button>
        </div>
      </section>
    </div>`);
    const texto = $('#termo-texto', alvo), li = $('#termo-li', alvo), btn = $('#termo-aceitar', alvo);
    // o botão só libera depois de rolar o texto até o fim (ou se ele couber na tela) e marcar a caixa
    let leu = texto.scrollHeight <= texto.clientHeight + 4;
    const conferir = () => { btn.disabled = !(leu && li.checked); };
    texto.addEventListener('scroll', () => { if (texto.scrollTop + texto.clientHeight >= texto.scrollHeight - 8) { leu = true; conferir(); } });
    li.addEventListener('change', () => { if (!leu) { avisar('Role o texto até o fim antes de concordar.'); li.checked = false; texto.focus(); } conferir(); });
    $('#termo-sair', alvo).addEventListener('click', async () => { try { await api.sair(); } catch { /* segue */ } location.hash = '#/login'; location.reload(); });
    btn.addEventListener('click', () => comBotao(btn, async () => {
      try {
        const r = await api.aceitarTermo(t.id, t.hash);
        lista.shift();
        if (r.pendentes > 0 && lista.length) { avisar(`Aceite registrado. Falta${lista.length > 1 ? 'm' : ''} ${lista.length} termo${lista.length > 1 ? 's' : ''}.`); return desenhar(); }
        avisar('Aceite registrado. Bem-vindo ao Conecta LocarX!');
        sistema?.classList.remove('so-termos');
        ctx.atualizarUsuario({ ...ctx.usuario, termosPendentes: 0 });
        ctx.navegar('inicio');
      } catch (err) {
        if (err.status === 401) return ctx.sessaoExpirou();
        if (err.status === 409) { avisar(err.message, 'erro'); try { lista = await api.termosPendentes(); } catch { /* mantém */ } return desenhar(); }
        avisar(err.message, 'erro');
      }
    }));
  }
  desenhar();
  return { limpar: () => sistema?.classList.remove('so-termos') };
}
