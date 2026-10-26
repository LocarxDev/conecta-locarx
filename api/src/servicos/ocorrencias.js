// Ocorrências: o que deu errado (ou que vale acompanhar) nas reservas e cotações, pela equipe ou pelo assistente.
// Aparece no Monitor do assistente (administração) com o motivo. Nunca guarda dados pessoais do cliente.
import { comoSistema } from '../banco/conexao.js';

const SENSIVEIS = ['cpf', 'cnh', 'email', 'nome', 'telefone', 'customer', 'cliente'];
export function semDadosPessoais(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(semDadosPessoais);
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !SENSIVEIS.includes(k)).map(([k, v]) => [k, typeof v === 'object' ? semDadosPessoais(v) : v]));
}

/**
 * @param {object} o { lojaId, usuarioId?, conversaId?, origem: 'equipe'|'assistente'|'sistema', tipo: 'reserva'|'cotacao'|'ia', nivel: 'erro'|'aviso'|'info', mensagem, detalhes? }
 */
export async function registrarOcorrencia(o) {
  try {
    await comoSistema((c) => c.query(
      `INSERT INTO ocorrencias (loja_id, usuario_id, conversa_id, origem, tipo, nivel, mensagem, detalhes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [o.lojaId, o.usuarioId || null, o.conversaId || null, o.origem, o.tipo, o.nivel, String(o.mensagem || '').slice(0, 500), o.detalhes ? semDadosPessoais(o.detalhes) : null]));
  } catch (e) { console.error('[ocorrencias]', e.message); }
}

// transforma um erro da API LocarX (ErroLocarx) ou qualquer erro em detalhes legíveis
export function detalhesDoErro(e, extra = {}) {
  return { ...extra, erro: String(e?.message || e).slice(0, 300), status: e?.status || null, respostaApi: e?.resposta ? JSON.stringify(e.resposta).slice(0, 800) : null };
}
