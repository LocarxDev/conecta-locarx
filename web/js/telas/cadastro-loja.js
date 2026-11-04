// v14.6 — Dados cadastrais e fiscais da loja (CNPJ, razão social, endereço, responsáveis, cobrança).
// Usado pela administração (Lojas → Editar / detalhe) e pelo gestor (Dados da loja).
import { html } from '../util.js';

export const cnpjFormatado = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d; };
export const cepFormatado = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };
export const telefoneFormatado = (v) => { const d = String(v || '').replace(/\D/g, ''); if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`; if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`; return d; };

/** Campos do cadastro (sem a tag <form>): quem usa coloca dentro do próprio formulário. */
export function camposCadastro(cad = {}, { prefixo = 'c' } = {}) {
  const r = cad.responsavel || {}, f = cad.financeiro || {};
  const id = (n) => `${prefixo}-${n}`;
  return html`
    <h3 class="form-secao">Dados fiscais</h3>
    <div class="form-linha">
      <div class="campo"><label for="${id('cnpj')}">CNPJ</label><input id="${id('cnpj')}" name="cnpj" inputmode="numeric" value="${cnpjFormatado(cad.cnpj)}" placeholder="00.000.000/0000-00" data-mascara="cnpj" autocomplete="off"></div>
      <div class="campo"><label for="${id('rz')}">Razão social</label><input id="${id('rz')}" name="razaoSocial" value="${cad.razaoSocial || ''}" placeholder="Como está no CNPJ"></div>
    </div>
    <div class="form-linha">
      <div class="campo campo-largo"><label for="${id('end')}">Endereço da loja</label><input id="${id('end')}" name="endereco" value="${cad.endereco || ''}" placeholder="Rua, número, bairro, cidade/UF"></div>
      <div class="campo"><label for="${id('cep')}">CEP</label><input id="${id('cep')}" name="cep" inputmode="numeric" value="${cepFormatado(cad.cep)}" placeholder="00000-000" data-mascara="cep"></div>
    </div>
    <h3 class="form-secao">Gestor responsável</h3>
    <div class="form-linha">
      <div class="campo"><label for="${id('rn')}">Nome</label><input id="${id('rn')}" name="responsavelNome" value="${r.nome || ''}"></div>
      <div class="campo"><label for="${id('re')}">E-mail</label><input id="${id('re')}" name="responsavelEmail" type="email" value="${r.email || ''}"></div>
      <div class="campo"><label for="${id('rt')}">Celular (com DDD)</label><input id="${id('rt')}" name="responsavelTelefone" inputmode="tel" value="${telefoneFormatado(r.telefone)}" placeholder="(71) 99999-9999" data-mascara="tel"></div>
    </div>
    <h3 class="form-secao">Cobrança e nota fiscal</h3>
    <div class="form-linha">
      <div class="campo"><label for="${id('fn')}">Responsável financeiro</label><input id="${id('fn')}" name="financeiroNome" value="${f.nome || ''}" placeholder="Se for o gestor, repita o nome"></div>
      <div class="campo"><label for="${id('fe')}">E-mail para cobrança e NF</label><input id="${id('fe')}" name="financeiroEmail" type="email" value="${f.email || ''}"></div>
    </div>
    <div class="campo"><label for="${id('ec')}">Endereço de cobrança</label><input id="${id('ec')}" name="enderecoCobranca" value="${cad.enderecoCobranca || ''}" placeholder="Só se for diferente do endereço da loja"><p class="ajuda">Esses dados vão para a assinatura do Conecta, as notas fiscais e os termos. Campo em branco fica sem valor.</p></div>`;
}

/** Máscaras de digitação (CNPJ, CEP, telefone) nos campos do formulário. */
export function ligarMascaras(form) {
  form.querySelectorAll('[data-mascara]').forEach((i) => i.addEventListener('input', () => {
    const d = i.value.replace(/\D/g, '');
    i.value = i.dataset.mascara === 'cnpj' ? (d.length === 14 ? cnpjFormatado(d) : d.slice(0, 14)) : i.dataset.mascara === 'cep' ? (d.length === 8 ? cepFormatado(d) : d.slice(0, 8)) : (d.length >= 10 ? telefoneFormatado(d.slice(0, 11)) : d);
  }));
}

/** Validação local (os mesmos limites da API) — devolve {campo: mensagem}. */
export function validarCadastro(d) {
  const erros = {};
  const cnpj = String(d.cnpj || '').replace(/\D/g, '');
  if (cnpj && !cnpjValido(cnpj)) erros.cnpj = 'CNPJ inválido. Confira os 14 dígitos.';
  const cep = String(d.cep || '').replace(/\D/g, '');
  if (cep && cep.length !== 8) erros.cep = 'CEP com 8 dígitos.';
  const tel = String(d.responsavelTelefone || '').replace(/\D/g, '');
  if (tel && (tel.length < 10 || tel.length > 13)) erros.responsavelTelefone = 'Telefone com DDD.';
  for (const k of ['responsavelEmail', 'financeiroEmail']) if (d[k] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d[k].trim())) erros[k] = 'Informe um e-mail válido.';
  return erros;
}

export function cnpjValido(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (base) => { let peso = base.length - 7, soma = 0; for (let i = 0; i < base.length; i++) { soma += Number(base[i]) * peso; peso = peso === 2 ? 9 : peso - 1; } const r = soma % 11; return r < 2 ? 0 : 11 - r; };
  const dv1 = calc(d.slice(0, 12));
  return d === d.slice(0, 12) + String(dv1) + String(calc(d.slice(0, 12) + dv1));
}

/** Bloco de leitura (dl) com os dados cadastrais; `vazio` é o que mostrar quando não há dado. */
export function listaCadastro(cad = {}) {
  const r = cad.responsavel || {}, f = cad.financeiro || {};
  const ou = (v, fmt = (x) => x) => (v ? fmt(v) : html`<span class="sub">não informado</span>`);
  return html`<dl class="dados-grade">
    <div class="dado"><dt>CNPJ</dt><dd class="num">${ou(cad.cnpj, cnpjFormatado)}</dd></div>
    <div class="dado"><dt>Razão social</dt><dd>${ou(cad.razaoSocial)}</dd></div>
    <div class="dado"><dt>Endereço</dt><dd>${ou(cad.endereco)}${cad.cep ? html`<div class="sub num">CEP ${cepFormatado(cad.cep)}</div>` : ''}</dd></div>
    <div class="dado"><dt>Gestor responsável</dt><dd>${ou(r.nome)}${r.email || r.telefone ? html`<div class="sub">${[r.email, telefoneFormatado(r.telefone)].filter(Boolean).join(' · ')}</div>` : ''}</dd></div>
    <div class="dado"><dt>Cobrança e NF</dt><dd>${ou(f.nome)}${f.email ? html`<div class="sub">${f.email}</div>` : ''}</dd></div>
    <div class="dado"><dt>Endereço de cobrança</dt><dd>${cad.enderecoCobranca || html`<span class="sub">o mesmo da loja</span>`}</dd></div>
  </dl>`;
}

export const seloCadastro = (cad) => (cad?.completo ? html`<span class="selo ok">Cadastro completo</span>` : html`<span class="selo alerta">Cadastro incompleto</span>`);


