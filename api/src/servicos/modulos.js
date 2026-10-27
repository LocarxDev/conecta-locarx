// Módulos do Conecta que a administração libera por loja (plano contratado). Tudo ligado por padrão.
// A chave é o que vai em lojas.modulos; o front esconde menus e a API barra as rotas (exigirModulo).
export const MODULOS = [
  { chave: 'assistente', nome: 'Assistente virtual (bot no WhatsApp)', descricao: 'Atendimento automático, cotação e reserva pelo bot. Desligado: só a equipe responde.' },
  { chave: 'cotacao', nome: 'Cotação ao vivo e Reservar pela equipe', descricao: 'Consulta de valores no portal e criação de reserva pela equipe.' },
  { chave: 'pix', nome: 'Pagamento Pix pelo WhatsApp', descricao: 'Cobrança Pix (rede ou conta própria), comprovante e relatório de pagamentos online.' },
  { chave: 'funil', nome: 'Funil de vendas e tarefas', descricao: 'Quadro de oportunidades, regras automáticas e tarefas.' },
  { chave: 'clientes', nome: 'Clientes (CRM)', descricao: 'Ficha do cliente, etiquetas, campos personalizados e histórico.' },
  { chave: 'relatorios', nome: 'Relatórios', descricao: 'Indicadores da loja, grupos mais reservados, equipe.' },
  { chave: 'automacoes', nome: 'Mensagens automáticas e respostas rápidas', descricao: 'Modelos automáticos (boas-vindas, retorno) e atalhos de resposta.' },
  { chave: 'base', nome: 'Base de conhecimento da loja', descricao: 'Informações da loja para o assistente e a equipe (a base da rede é sempre visível).' },
  { chave: 'mcp', nome: 'Integração MCP (outros sistemas)', descricao: 'Consulta por outros sistemas da rede via token.' },
];
export const CHAVES = MODULOS.map((m) => m.chave);
export const TODOS = Object.fromEntries(CHAVES.map((k) => [k, true]));
// o que fica ligado num plano básico (sugestão: só atendimento humano + CRM)
export const BASICO = { ...Object.fromEntries(CHAVES.map((k) => [k, false])), clientes: true, automacoes: true, base: true };

export function normalizarModulos(m) {
  const r = { ...TODOS };
  if (m && typeof m === 'object') for (const k of CHAVES) if (k in m) r[k] = !!m[k];
  return r;
}
export const moduloLigado = (modulos, chave) => normalizarModulos(modulos)[chave] !== false;
