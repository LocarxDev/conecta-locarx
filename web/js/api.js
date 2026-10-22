// Ponte entre as telas e o back-end.
// USAR_EXEMPLO = true liga os DADOS DE EXEMPLO (demonstração sem back-end).
// Em produção fica false: tudo vai para /api, que o Netlify repassa ao Railway.
// O front nunca guarda token: o login vira um cookie seguro (httpOnly) que o navegador envia sozinho.

import { exemplo } from './dados-exemplo.js';

export const USAR_EXEMPLO = false;

let csrf = null; // vem do back-end junto com a sessão; vai no cabeçalho das ações que alteram dados

async function chamar(metodo, caminho, corpo) {
  const cabecalhos = { Accept: 'application/json' };
  if (corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';
  if (metodo !== 'GET' && csrf) cabecalhos['X-CSRF-Token'] = csrf;
  let resp;
  try {
    resp = await fetch('/api' + caminho, {
      method: metodo,
      headers: cabecalhos,
      credentials: 'same-origin',
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    const e = new Error('Sem conexão com o servidor. Verifique sua internet e tente de novo.');
    e.status = 0;
    throw e;
  }
  const dados = resp.status === 204 ? null : await resp.json().catch(() => null);
  if (dados?.csrf) csrf = dados.csrf;
  if (!resp.ok) {
    const e = new Error(dados?.mensagem || 'Não foi possível concluir. Tente de novo em instantes.');
    e.status = resp.status;
    if (dados?.campos) e.campos = dados.campos;
    throw e;
  }
  return dados;
}

const real = {
  entrar: (d) => chamar('POST', '/auth/entrar', d),
  verificar2fa: (d) => chamar('POST', '/auth/2fa', d),
  sessao: () => chamar('GET', '/auth/sessao'),
  sair: () => chamar('POST', '/auth/sair', {}),
  sairDeTodos: () => chamar('POST', '/auth/sair-de-todos', {}),
  pedirNovaSenha: (d) => chamar('POST', '/auth/esqueci-senha', d),
  definirSenha: (d) => chamar('POST', '/auth/definir-senha', d),
  resumoLoja: () => chamar('GET', '/loja/resumo'),
  resumoRede: () => chamar('GET', '/admin/resumo'),
  listarLojas: () => chamar('GET', '/admin/lojas'),
  obterLoja: (id) => chamar('GET', `/admin/lojas/${encodeURIComponent(id)}`),
  salvarLoja: (d) => (d.id ? chamar('PUT', `/admin/lojas/${encodeURIComponent(d.id)}`, d) : chamar('POST', '/admin/lojas', d)),
  alterarSituacaoLoja: (id, ativa) => chamar('PATCH', `/admin/lojas/${encodeURIComponent(id)}`, { ativa }),
  listarEquipe: (lojaId) => chamar('GET', lojaId ? `/admin/lojas/${encodeURIComponent(lojaId)}/usuarios` : '/loja/usuarios'),
  convidar: (d) => chamar('POST', '/usuarios/convites', d),
  atualizarUsuario: (id, d) => chamar('PATCH', `/usuarios/${encodeURIComponent(id)}`, d),
  reenviarConvite: (id) => chamar('POST', `/usuarios/${encodeURIComponent(id)}/convite`, {}),
  excluirUsuario: (id) => chamar('DELETE', `/usuarios/${encodeURIComponent(id)}`),
  atualizarPerfil: (d) => chamar('PATCH', '/eu', d),
  trocarSenha: (d) => chamar('POST', '/eu/senha', d),
  iniciar2fa: () => chamar('POST', '/eu/2fa/iniciar', {}),
  ativar2fa: (d) => chamar('POST', '/eu/2fa/ativar', d),
  desativar2fa: () => chamar('POST', '/eu/2fa/desativar', {}),

  // etapa 2 — WhatsApp e conversas
  canal: () => chamar('GET', '/loja/canal'),
  conectarCanal: () => chamar('POST', '/loja/canal/conectar', {}),
  qrCanal: () => chamar('GET', '/loja/canal/qr'),
  desconectarCanal: () => chamar('POST', '/loja/canal/desconectar', {}),
  listarConversas: ({ desde, busca } = {}) => chamar('GET', '/conversas?' + new URLSearchParams(Object.entries({ desde, busca }).filter(([, v]) => v))),
  mensagens: (id, { depois } = {}) => chamar('GET', `/conversas/${encodeURIComponent(id)}/mensagens` + (depois ? '?depois=' + encodeURIComponent(depois) : '')),
  marcarLida: (id) => chamar('POST', `/conversas/${encodeURIComponent(id)}/lida`, {}),
  enviarTexto: (id, texto) => chamar('POST', `/conversas/${encodeURIComponent(id)}/mensagens`, { texto }),
  enviarMidia: (id, d) => chamar('POST', `/conversas/${encodeURIComponent(id)}/midia`, d),
  nota: (id, texto) => chamar('POST', `/conversas/${encodeURIComponent(id)}/notas`, { texto }),
  acaoConversa: (id, acao, corpo = {}) => chamar('POST', `/conversas/${encodeURIComponent(id)}/${acao}`, corpo),
  equipeAtiva: () => chamar('GET', '/conversas/equipe/ativa'),
  urlArquivo: (id, mid) => `/api/conversas/${encodeURIComponent(id)}/mensagens/${encodeURIComponent(mid)}/arquivo`,
  respostas: () => chamar('GET', '/loja/respostas'),
  salvarResposta: (d) => (d.id ? chamar('PUT', `/loja/respostas/${encodeURIComponent(d.id)}`, d) : chamar('POST', '/loja/respostas', d)),
  excluirResposta: (id) => chamar('DELETE', `/loja/respostas/${encodeURIComponent(id)}`),

  // etapa 3 — assistente e base de conhecimento
  assistente: () => chamar('GET', '/loja/assistente'),
  salvarAssistente: (d) => chamar('PUT', '/loja/assistente', d),
  salvarChaveIa: (d) => chamar('POST', '/loja/assistente/chave', d),
  removerChaveIa: () => chamar('DELETE', '/loja/assistente/chave'),
  testarAssistente: (historico) => chamar('POST', '/loja/assistente/testar', { historico }),
  perguntasSemResposta: () => chamar('GET', '/loja/perguntas'),
  resolverPergunta: (id) => chamar('POST', `/loja/perguntas/${encodeURIComponent(id)}/resolver`, {}),
  conhecimento: (q) => chamar('GET', '/conhecimento?' + new URLSearchParams(Object.entries(q || {}).filter(([, v]) => v))),
  salvarConhecimento: (d) => (d.id ? chamar('PUT', `/conhecimento/${encodeURIComponent(d.id)}`, { titulo: d.titulo, conteudo: d.conteudo }) : chamar('POST', '/conhecimento', d)),
  salvarConhecimentoLote: (itens) => chamar('POST', '/conhecimento/lote', { itens }),
  acaoConhecimento: (id, acao) => chamar('POST', `/conhecimento/${encodeURIComponent(id)}/${acao}`, {}),
  importarConhecimento: (d) => chamar('POST', '/conhecimento/importar', d),
  rede: () => chamar('GET', '/admin/rede'),
  salvarRede: (d) => chamar('PUT', '/admin/rede', d),
  incluirSinonimo: (termos) => chamar('POST', '/admin/sinonimos', { termos }),
  excluirSinonimo: (id) => chamar('DELETE', `/admin/sinonimos/${encodeURIComponent(id)}`),

  // etapa 4 — reservas e API LocarX
  reservas: (q) => chamar('GET', '/loja/reservas?' + new URLSearchParams(Object.entries(q || {}).filter(([, v]) => v))),
  atualizarReserva: (id) => chamar('POST', `/loja/reservas/${encodeURIComponent(id)}/atualizar`, {}),
  filiaisLocarx: () => chamar('GET', '/admin/locarx/filiais'),
  testarLocarx: (branchId) => chamar('GET', `/admin/locarx/teste?branchId=${encodeURIComponent(branchId)}`),
};

export const api = USAR_EXEMPLO ? exemplo : real;
