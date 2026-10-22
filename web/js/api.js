// Ponte entre as telas e o back-end.
// Hoje usa os DADOS DE EXEMPLO. Quando o back-end estiver no Railway:
//   1) trocar USAR_EXEMPLO para false
//   2) apagar dados-exemplo.js
// O front nunca guarda token: o login vira um cookie seguro (httpOnly) que o navegador envia sozinho.

import { exemplo } from './dados-exemplo.js';

export const USAR_EXEMPLO = true;

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
};

export const api = USAR_EXEMPLO ? exemplo : real;
