// v14.12 — tokenização do cartão direto na Pagar.me (chave pública). O número do cartão não passa pela API do Conecta.
// Em modo simulado (ambiente de teste sem chave) devolve um token local.
export async function tokenizarCartao({ numero, nome, validade, cvv }, { simulado = false, chavePublica = null } = {}) {
  const num = String(numero || '').replace(/\D/g, '');
  const nomeLimpo = String(nome || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 64);
  const val = String(validade || '').replace(/\D/g, ''), cvvLimpo = String(cvv || '').replace(/\D/g, '');
  if (num.length < 13 || !nomeLimpo || val.length !== 4 || cvvLimpo.length < 3) throw new Error('Confira o número, o nome, a validade (MM/AA) e o CVV do cartão.');
  if (simulado || !chavePublica) return `token_simulado_${num.slice(-4)}`;
  const r = await fetch(`https://api.pagar.me/core/v5/tokens?appId=${encodeURIComponent(chavePublica)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'card', card: { number: num, holder_name: nomeLimpo, exp_month: Number(val.slice(0, 2)), exp_year: Number(val.slice(2)), cvv: cvvLimpo } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) {
    const detalhes = j.errors && typeof j.errors === 'object' ? Object.entries(j.errors).map(([k, v]) => `${k.replace(/^card\./, '')}: ${[].concat(v).join(', ')}`).join(' · ') : '';
    throw new Error(`A Pagar.me não aceitou o cartão${detalhes ? ' — ' + detalhes : j.message ? ' — ' + j.message : ''}. Confira número, nome (sem números ou acentos), validade e CVV.`);
  }
  return j.id;
}

/** Campos do cartão (mesmo visual na tela de assinatura e na página de adesão). */
export const camposCartaoHtml = (html, icone) => html`
  <div class="form-linha">
    <div class="campo campo-largo"><label for="ca-num">Número do cartão</label><input id="ca-num" name="numero" inputmode="numeric" autocomplete="cc-number" placeholder="0000 0000 0000 0000"></div>
    <div class="campo campo-largo"><label for="ca-nome">Nome impresso no cartão</label><input id="ca-nome" name="nome" autocomplete="cc-name"></div>
    <div class="campo"><label for="ca-val">Validade (MM/AA)</label><input id="ca-val" name="validade" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/AA"></div>
    <div class="campo"><label for="ca-cvv">CVV</label><input id="ca-cvv" name="cvv" inputmode="numeric" autocomplete="cc-csc" placeholder="123"></div>
  </div>
  <p class="ajuda">${icone('cadeado')} Os dados do cartão vão direto para a Pagar.me, criptografados. O Conecta não guarda o número do cartão.</p>`;
