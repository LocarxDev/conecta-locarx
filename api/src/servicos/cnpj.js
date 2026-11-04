// CNPJ: limpeza, validação dos dígitos verificadores e formatação (v14.6 — dados cadastrais da loja).
export const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/** true se os 14 dígitos fecham com os dois verificadores (rejeita sequências repetidas, ex.: 00000000000000). */
export function cnpjValido(v) {
  const d = soDigitos(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (base) => {
    let peso = base.length - 7, soma = 0;
    for (let i = 0; i < base.length; i++) { soma += Number(base[i]) * peso; peso = peso === 2 ? 9 : peso - 1; }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const dv1 = calc(d.slice(0, 12));
  const dv2 = calc(d.slice(0, 12) + dv1);
  return d === d.slice(0, 12) + String(dv1) + String(dv2);
}

export const cnpjFormatado = (v) => { const d = soDigitos(v); return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d; };
