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

const base = (escopo) => (escopo === 'rede' ? '/admin' : '/crm');

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
  cotar: (d) => chamar('POST', '/loja/cotacao', d),
  precoCotacao: (d) => chamar('POST', '/loja/cotacao/preco', d),
  reservarEquipe: (d) => chamar('POST', '/loja/reservas', d),
  monitorAssistente: (q) => chamar('GET', '/admin/assistente/monitor?' + new URLSearchParams(Object.entries(q || {}).filter(([, v]) => v))),
  ocorrencias: (q) => chamar('GET', '/admin/ocorrencias?' + new URLSearchParams(Object.entries(q || {}).filter(([, v]) => v))),
  statusWhatsappRede: (aoVivo) => chamar('GET', '/admin/whatsapp' + (aoVivo ? '?aoVivo=1' : '')),
  conectarWhatsappLoja: (lojaId) => chamar('POST', `/admin/whatsapp/${encodeURIComponent(lojaId)}/conectar`, {}),
  qrWhatsappLoja: (lojaId) => chamar('GET', `/admin/whatsapp/${encodeURIComponent(lojaId)}/qr`),
  desconectarWhatsappLoja: (lojaId) => chamar('POST', `/admin/whatsapp/${encodeURIComponent(lojaId)}/desconectar`, {}),

  // etapa 5 — CRM
  contatos: (q) => chamar('GET', '/crm/contatos?' + new URLSearchParams(Object.entries(q || {}).filter(([, v]) => v))),
  contato: (id) => chamar('GET', `/crm/contatos/${encodeURIComponent(id)}`),
  novoContato: (d) => chamar('POST', '/crm/contatos', d),
  salvarContato: (id, d) => chamar('PATCH', `/crm/contatos/${encodeURIComponent(id)}`, d),
  urlExportarContatos: () => '/api/crm/contatos.csv',
  funil: (funilId) => chamar('GET', '/crm/funil' + (funilId ? '?funil=' + encodeURIComponent(funilId) : '')),
  novaOportunidade: (d) => chamar('POST', '/crm/oportunidades', d),
  moverOportunidade: (id, d) => chamar('PATCH', `/crm/oportunidades/${encodeURIComponent(id)}`, d),
  tarefas: (q) => chamar('GET', '/crm/tarefas?' + new URLSearchParams(Object.entries(q || {}).filter(([, v]) => v))),
  novaTarefa: (d) => chamar('POST', '/crm/tarefas', d),
  marcarTarefa: (id, feita) => chamar('PATCH', `/crm/tarefas/${encodeURIComponent(id)}`, { feita }),
  excluirTarefa: (id) => chamar('DELETE', `/crm/tarefas/${encodeURIComponent(id)}`),
  modelos: () => chamar('GET', '/crm/modelos'),
  salvarModelo: (chave, d) => chamar('PUT', `/crm/modelos/${encodeURIComponent(chave)}`, d),
  mensagemAtiva: (id, d) => chamar('POST', `/crm/contatos/${encodeURIComponent(id)}/mensagem`, d),

  // etapa 7 — funis, etiquetas, campos, painel do cliente e roleta
  // escopo: 'loja' (o dono personaliza a loja) ou 'rede' (padrão da rede, administração/matriz)
  funis: () => chamar('GET', '/crm/funis'),
  criarFunil: (d) => chamar('POST', '/crm/funis', d),
  salvarFunil: (id, d) => chamar('PUT', `/crm/funis/${encodeURIComponent(id)}`, d),
  arquivarFunil: (id) => chamar('DELETE', `/crm/funis/${encodeURIComponent(id)}`),
  funilPadrao: () => chamar('GET', '/admin/funil-padrao'),
  salvarFunilPadrao: (d) => chamar('PUT', '/admin/funil-padrao', d),
  etiquetas: (escopo = 'loja') => chamar('GET', `${base(escopo)}/etiquetas`),
  salvarEtiqueta: (escopo, d) => (d.id ? chamar('PUT', `${base(escopo)}/etiquetas/${encodeURIComponent(d.id)}`, d) : chamar('POST', `${base(escopo)}/etiquetas`, d)),
  excluirEtiqueta: (escopo, id) => chamar('DELETE', `${base(escopo)}/etiquetas/${encodeURIComponent(id)}`),
  campos: (escopo = 'loja') => chamar('GET', `${base(escopo)}/campos`),
  salvarCampo: (escopo, d) => (d.id ? chamar('PUT', `${base(escopo)}/campos/${encodeURIComponent(d.id)}`, d) : chamar('POST', `${base(escopo)}/campos`, d)),
  excluirCampo: (escopo, id) => chamar('DELETE', `${base(escopo)}/campos/${encodeURIComponent(id)}`),
  ordenarCampos: (escopo, ids) => chamar('POST', `${base(escopo)}/campos/ordem`, { ids }),
  painelCliente: (id) => chamar('GET', `/crm/contatos/${encodeURIComponent(id)}/painel`),
  salvarCamposCliente: (id, valores) => chamar('PUT', `/crm/contatos/${encodeURIComponent(id)}/campos`, { valores }),
  salvarEtiquetasCliente: (id, etiquetas) => chamar('PUT', `/crm/contatos/${encodeURIComponent(id)}/etiquetas`, { etiquetas }),
  roleta: () => chamar('GET', '/crm/roleta'),
  salvarRoleta: (d) => chamar('PUT', '/crm/roleta', d),
  disponibilidade: (disponivel) => chamar('PATCH', '/eu/disponibilidade', { disponivel }),

  // etapa 6 — relatórios e rede
  relatorioLoja: (dias) => chamar('GET', `/loja/relatorio?dias=${dias}`),
  relatorioRede: (dias) => chamar('GET', `/admin/relatorio?dias=${dias}`),
  usuariosRede: () => chamar('GET', '/admin/usuarios'),
  convidarRede: (d) => chamar('POST', '/admin/usuarios', d),
  situacaoUsuarioRede: (id, status) => chamar('PATCH', `/admin/usuarios/${encodeURIComponent(id)}`, { status }),
  criarDemonstracao: () => chamar('POST', '/admin/demonstracao', {}),
  removerDemonstracao: () => chamar('DELETE', '/admin/demonstracao'),
};

// Na demonstração, telas que ainda não têm dados de exemplo avisam em vez de quebrar.
export const api = USAR_EXEMPLO
  ? new Proxy(exemplo, { get: (alvo, nome) => (nome in alvo ? alvo[nome] : async () => { const e = new Error('Esta tela mostra dados reais quando o Conecta estiver ligado ao servidor.'); e.status = 0; throw e; }) })
  : real;
