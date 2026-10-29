// Textos do chat do site: máscara de dados pessoais ao reabrir a conversa, telefone brasileiro e número de WhatsApp.

// CPF e e-mail digitados pelo cliente não voltam inteiros quando ele reabre o chat (computador compartilhado, aba esquecida).
export function mascarar(texto) {
  return String(texto ?? '')
    .replace(/\b(\d{3})[.\s]?(\d{3})[.\s]?(\d{3})[-.\s]?(\d{2})\b/g, '•••.•••.•••-$4')
    .replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '$1•••@$2')
    .replace(/\b9\d{4}[-\s]?(\d{4})\b/g, '•••••-$1');
}

// aceita (71) 99999-9999, 71999999999, +55 71 99999-9999… e devolve 5571999999999 (ou null)
export function telefoneBr(bruto) {
  let d = String(bruto ?? '').replace(/\D/g, '');
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (!/^55\d{10,11}$/.test(d)) return null;
  const ddd = Number(d.slice(2, 4));
  if (ddd < 11 || ddd > 99) return null;
  const numero = d.slice(4);
  if (numero.length === 9 && numero[0] !== '9') return null;           // celular com 9 dígitos começa com 9
  if (numero.length === 8 && !/^[2-5]/.test(numero)) return null;      // fixo ou celular antigo
  if (/^(\d)\1+$/.test(numero)) return null;                           // 99999999 etc.
  return d;
}

export function telefoneMascarado(tel) {
  const d = String(tel || '');
  return d.length >= 12 ? `(${d.slice(2, 4)}) •••••-${d.slice(-4)}` : '';
}

export const primeiroNome = (nome) => String(nome || '').trim().split(/\s+/)[0] || '';
