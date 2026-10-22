// Senhas, tokens, criptografia e verificação em 2 etapas.
import { createHash, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { config } from '../config.js';

// ---------- senhas (argon2id) ----------
const OPCOES_ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const hashSenha = (senha) => argonHash(senha, OPCOES_ARGON);
// hash falso para gastar o mesmo tempo quando o e-mail não existe (não revela quem tem conta)
let hashFalso;
export async function conferirSenha(hash, senha) {
  hashFalso ||= await argonHash('senha-falsa-para-tempo-constante', OPCOES_ARGON);
  try { return await argonVerify(hash || hashFalso, senha) && !!hash; } catch { return false; }
}

export function problemasSenha(senha = '') {
  const faltando = [];
  if (senha.length < 10) faltando.push('ter pelo menos 10 caracteres');
  if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) faltando.push('misturar letras e números');
  if (senha.length > 200) faltando.push('ter no máximo 200 caracteres');
  return faltando;
}

// ---------- tokens aleatórios (sessão, convite) ----------
// O token vai para o usuário; no banco fica só o hash dele. Vazou o banco, não vazou acesso.
export const novoToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token) => createHash('sha256').update(String(token)).digest();
export function iguais(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---------- criptografia de dados sensíveis (AES-256-GCM) ----------
export function cifrar(texto) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', config.chaveCriptografia, iv);
  const dados = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), dados.toString('base64')].join('.');
}
export function decifrar(pacote) {
  const [versao, iv, tag, dados] = String(pacote).split('.');
  if (versao !== 'v1') throw new Error('Formato de dado cifrado desconhecido.');
  const d = createDecipheriv('aes-256-gcm', config.chaveCriptografia, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(dados, 'base64')), d.final()]).toString('utf8');
}

// ---------- verificação em 2 etapas (TOTP, compatível com Google Authenticator) ----------
authenticator.options = { window: 1, step: 30, digits: 6 };
export const novoSegredo2fa = () => authenticator.generateSecret(20);
export const codigo2faValido = (segredo, codigo) => /^\d{6}$/.test(String(codigo)) && authenticator.check(String(codigo), segredo);
export async function qrDo2fa(email, segredo) {
  const uri = authenticator.keyuri(email, 'Conecta LocarX', segredo);
  return QRCode.toDataURL(uri, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
}
export const formatarChave = (s) => s.replace(/(.{4})/g, '$1 ').trim();
