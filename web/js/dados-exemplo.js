// DADOS DE EXEMPLO — simula o back-end enquanto ele não existe.
// Este arquivo SAI do projeto quando o back-end entrar (api.js passa a chamar /api).
// Nada aqui é real: nomes, e-mails e números são fictícios. Senha de todos: Conecta2026

const CHAVE = 'conecta.exemplo.v1';
const SENHA_DEMO = 'Conecta2026';
const CODIGO_2FA_DEMO = '123456';

const agora = Date.now();
const horasAtras = (h) => new Date(agora - h * 3600e3).toISOString();
const id = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

function base() {
  const lojas = [
    { id: 'b6f1c2d0-0001-4a00-9000-000000000001', nome: 'LocarX Salvador Aeroporto', cidade: 'Salvador', uf: 'BA', filial: { branchId: 5, branchCode: 'SSA1', tipo: 'Aeroporto' }, ativa: true, whatsapp: 'desconectado', assistente: 'desligado', criadaEm: horasAtras(240) },
    { id: 'b6f1c2d0-0002-4a00-9000-000000000002', nome: 'LocarX Salvador Centro', cidade: 'Salvador', uf: 'BA', filial: { branchId: 3, branchCode: 'SSA', tipo: 'Cidade' }, ativa: true, whatsapp: 'desconectado', assistente: 'desligado', criadaEm: horasAtras(200) },
    { id: 'b6f1c2d0-0003-4a00-9000-000000000003', nome: 'LocarX Natal Aeroporto', cidade: 'Natal', uf: 'RN', filial: { branchId: 12, branchCode: 'NAT1', tipo: 'Aeroporto' }, ativa: true, whatsapp: 'desconectado', assistente: 'desligado', criadaEm: horasAtras(150) },
    { id: 'b6f1c2d0-0004-4a00-9000-000000000004', nome: 'LocarX Feira de Santana', cidade: 'Feira de Santana', uf: 'BA', filial: { branchId: 18, branchCode: 'FEC', tipo: 'Cidade' }, ativa: false, whatsapp: 'desconectado', assistente: 'desligado', criadaEm: horasAtras(90) },
  ];
  const L1 = lojas[0].id, L2 = lojas[1].id;
  const usuarios = [
    { id: id(), nome: 'Silas Moreira', email: 'silas@auniti.com.br', perfil: 'admin', lojaId: null, status: 'ativo', doisFatores: true, ultimoAcesso: horasAtras(0.2) },
    { id: id(), nome: 'Equipe Matriz LocarX', email: 'matriz@exemplo.com.br', perfil: 'matriz', lojaId: null, status: 'ativo', doisFatores: false, ultimoAcesso: horasAtras(30) },
    { id: id(), nome: 'Carla Menezes', email: 'dono.ssa@exemplo.com.br', perfil: 'dono', lojaId: L1, status: 'ativo', doisFatores: false, ultimoAcesso: horasAtras(3) },
    { id: id(), nome: 'Rafael Souza', email: 'rafael.ssa@exemplo.com.br', perfil: 'atendente', lojaId: L1, status: 'ativo', doisFatores: false, ultimoAcesso: horasAtras(1) },
    { id: id(), nome: 'Juliana Prado', email: 'juliana.ssa@exemplo.com.br', perfil: 'atendente', lojaId: L1, status: 'ativo', doisFatores: false, ultimoAcesso: horasAtras(26) },
    { id: id(), nome: 'Bruno Lima', email: 'bruno.ssa@exemplo.com.br', perfil: 'atendente', lojaId: L1, status: 'convidado', doisFatores: false, ultimoAcesso: null },
    { id: id(), nome: 'Marcos Teixeira', email: 'dono.centro@exemplo.com.br', perfil: 'dono', lojaId: L2, status: 'ativo', doisFatores: false, ultimoAcesso: horasAtras(50) },
  ];
  return { lojas, usuarios, sessao: null, pendente2fa: null };
}

let banco;
function carregar() {
  if (banco) return banco;
  try { banco = JSON.parse(localStorage.getItem(CHAVE)) || null; } catch { banco = null; }
  banco ||= base();
  return banco;
}
function salvar() { try { localStorage.setItem(CHAVE, JSON.stringify(banco)); } catch { /* sem armazenamento: dura só esta aba */ } }

const espera = (ms = 350) => new Promise((r) => setTimeout(r, ms + Math.random() * 200));

function erro(status, mensagem, campos) {
  const e = new Error(mensagem);
  e.status = status;
  if (campos) e.campos = campos;
  return e;
}

function eu() {
  const b = carregar();
  const u = b.usuarios.find((x) => x.id === b.sessao);
  if (!u || u.status !== 'ativo') throw erro(401, 'Sua sessão terminou. Entre novamente.');
  return u;
}
const publico = (u) => { const { ...resto } = u; return resto; };
const comLoja = (u) => ({ ...publico(u), loja: carregar().lojas.find((l) => l.id === u.lojaId) || null });

function podeGerirLoja(quem, lojaId) {
  return quem.perfil === 'admin' || (quem.perfil === 'dono' && quem.lojaId === lojaId);
}

export const exemplo = {
  SENHA_DEMO,
  CODIGO_2FA_DEMO,

  async entrar({ email, senha }) {
    await espera();
    const b = carregar();
    const u = b.usuarios.find((x) => x.email.toLowerCase() === String(email).trim().toLowerCase());
    if (!u || senha !== SENHA_DEMO || u.status === 'inativo') throw erro(401, 'E-mail ou senha incorretos.');
    if (u.status === 'convidado') throw erro(403, 'Este acesso ainda não foi ativado. Use o link do convite para criar sua senha.');
    if (u.doisFatores) { b.pendente2fa = u.id; salvar(); return { precisa2fa: true }; }
    b.sessao = u.id; u.ultimoAcesso = new Date().toISOString(); salvar();
    return { usuario: comLoja(u) };
  },

  async verificar2fa({ codigo }) {
    await espera();
    const b = carregar();
    const u = b.usuarios.find((x) => x.id === b.pendente2fa);
    if (!u) throw erro(401, 'O tempo para digitar o código acabou. Entre novamente.');
    if (codigo !== CODIGO_2FA_DEMO) throw erro(400, 'Código incorreto. Confira o app autenticador e tente de novo.');
    b.sessao = u.id; b.pendente2fa = null; u.ultimoAcesso = new Date().toISOString(); salvar();
    return { usuario: comLoja(u) };
  },

  async sessao() {
    await espera(120);
    const b = carregar();
    const u = b.usuarios.find((x) => x.id === b.sessao && x.status === 'ativo');
    return u ? { usuario: comLoja(u) } : { usuario: null };
  },

  async sair() { await espera(100); const b = carregar(); b.sessao = null; salvar(); },

  async sairDeTodos() { await espera(); const b = carregar(); b.sessao = null; salvar(); },

  async pedirNovaSenha() { await espera(); return { ok: true }; },

  async definirSenha({ token, senha }) {
    await espera();
    if (!token) throw erro(400, 'Link inválido ou expirado. Peça um novo convite.');
    if (senha.length < 10) throw erro(400, 'Senha fraca.', { senha: 'Use pelo menos 10 caracteres.' });
    return { ok: true };
  },

  async resumoLoja() {
    await espera();
    const u = eu();
    const lojaId = u.lojaId || carregar().lojas[0].id;
    const equipe = carregar().usuarios.filter((x) => x.lojaId === lojaId);
    return {
      conversasHoje: 23, aguardando: 4, reservasSemana: 11, valorSemana: 18640,
      equipeAtiva: equipe.filter((x) => x.status === 'ativo').length,
      equipeConvidada: equipe.filter((x) => x.status === 'convidado').length,
      ultimas: [
        { cliente: 'Cliente exemplo 1', assunto: 'Cotação · Grupo C · 3 diárias', quando: horasAtras(0.3), estado: 'assistente' },
        { cliente: 'Cliente exemplo 2', assunto: 'Reserva criada · SSA586587', quando: horasAtras(1.2), estado: 'reserva' },
        { cliente: 'Cliente exemplo 3', assunto: 'Pediu atendente humano', quando: horasAtras(2), estado: 'aguardando' },
        { cliente: 'Cliente exemplo 4', assunto: 'Dúvida sobre caução', quando: horasAtras(5), estado: 'assistente' },
      ],
    };
  },

  async resumoRede() {
    await espera();
    const b = carregar();
    return { lojasAtivas: b.lojas.filter((l) => l.ativa).length, lojasTotal: b.lojas.length, usuarios: b.usuarios.filter((u) => u.status === 'ativo').length, whatsappConectado: b.lojas.filter((l) => l.whatsapp === 'conectado').length };
  },

  // ---- lojas ----
  async listarLojas() {
    await espera();
    const u = eu();
    if (!['admin', 'matriz'].includes(u.perfil)) throw erro(403, 'Você não tem acesso a esta área.');
    const b = carregar();
    return b.lojas.map((l) => ({ ...l, usuarios: b.usuarios.filter((x) => x.lojaId === l.id).length, dono: b.usuarios.find((x) => x.lojaId === l.id && x.perfil === 'dono')?.nome || null }));
  },

  async obterLoja(lojaId) {
    await espera();
    const u = eu();
    if (!['admin', 'matriz'].includes(u.perfil) && u.lojaId !== lojaId) throw erro(403, 'Você não tem acesso a esta loja.');
    const b = carregar();
    const loja = b.lojas.find((l) => l.id === lojaId);
    if (!loja) throw erro(404, 'Loja não encontrada.');
    return { ...loja, usuarios: b.usuarios.filter((x) => x.lojaId === lojaId).map(publico) };
  },

  async salvarLoja(dados) {
    await espera();
    const u = eu();
    if (u.perfil !== 'admin') throw erro(403, 'Só a administração pode cadastrar lojas.');
    const b = carregar();
    const campos = {};
    if (!dados.nome?.trim()) campos.nome = 'Informe o nome da loja.';
    if (!dados.cidade?.trim()) campos.cidade = 'Informe a cidade.';
    if (!/^[A-Z]{2}$/.test(dados.uf || '')) campos.uf = 'Escolha o estado.';
    if (!dados.branchId || !/^\d+$/.test(String(dados.branchId))) campos.branchId = 'Informe o código numérico da filial (branchId).';
    if (!/^[A-Z0-9]{2,6}$/.test(String(dados.branchCode || '').toUpperCase())) campos.branchCode = 'Use de 2 a 6 letras ou números, ex.: SSA1.';
    const repetida = b.lojas.find((l) => l.filial.branchId === Number(dados.branchId) && l.id !== dados.id);
    if (repetida) campos.branchId = `Esta filial já está ligada à loja ${repetida.nome}.`;
    if (Object.keys(campos).length) throw erro(422, 'Confira os campos destacados.', campos);
    const registro = {
      nome: dados.nome.trim(), cidade: dados.cidade.trim(), uf: dados.uf,
      filial: { branchId: Number(dados.branchId), branchCode: String(dados.branchCode).toUpperCase(), tipo: dados.tipo === 'Aeroporto' ? 'Aeroporto' : 'Cidade' },
    };
    if (dados.id) {
      const loja = b.lojas.find((l) => l.id === dados.id);
      Object.assign(loja, registro);
      salvar();
      return loja;
    }
    const nova = { id: id(), ...registro, ativa: true, whatsapp: 'desconectado', assistente: 'desligado', criadaEm: new Date().toISOString() };
    b.lojas.push(nova); salvar();
    return nova;
  },

  async alterarSituacaoLoja(lojaId, ativa) {
    await espera();
    if (eu().perfil !== 'admin') throw erro(403, 'Só a administração pode fazer isso.');
    const loja = carregar().lojas.find((l) => l.id === lojaId);
    loja.ativa = !!ativa; salvar();
    return loja;
  },

  // ---- usuários da loja ----
  async listarEquipe(lojaId) {
    await espera();
    const u = eu();
    const alvo = lojaId || u.lojaId;
    if (!podeGerirLoja(u, alvo) && u.perfil !== 'matriz') throw erro(403, 'Você não tem acesso a esta equipe.');
    return carregar().usuarios.filter((x) => x.lojaId === alvo).map(publico);
  },

  async convidar({ nome, email, perfil, lojaId }) {
    await espera();
    const u = eu();
    const alvo = lojaId || u.lojaId;
    if (!podeGerirLoja(u, alvo)) throw erro(403, 'Você não pode convidar pessoas para esta loja.');
    if (perfil === 'dono' && u.perfil !== 'admin') throw erro(403, 'Só a administração convida o dono da loja.');
    const campos = {};
    if (!nome?.trim()) campos.nome = 'Informe o nome.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email || '')) campos.email = 'Informe um e-mail válido.';
    else if (carregar().usuarios.some((x) => x.email.toLowerCase() === email.trim().toLowerCase())) campos.email = 'Já existe um acesso com este e-mail.';
    if (Object.keys(campos).length) throw erro(422, 'Confira os campos destacados.', campos);
    const novo = { id: id(), nome: nome.trim(), email: email.trim().toLowerCase(), perfil: perfil === 'dono' ? 'dono' : 'atendente', lojaId: alvo, status: 'convidado', doisFatores: false, ultimoAcesso: null };
    carregar().usuarios.push(novo); salvar();
    return { ...novo, linkConvite: `${location.origin}/#/definir-senha?token=exemplo-${novo.id.slice(0, 8)}` };
  },

  async atualizarUsuario(usuarioId, dados) {
    await espera();
    const u = eu();
    const alvo = carregar().usuarios.find((x) => x.id === usuarioId);
    if (!alvo || !podeGerirLoja(u, alvo.lojaId)) throw erro(403, 'Você não pode alterar este acesso.');
    if (alvo.id === u.id && dados.status === 'inativo') throw erro(400, 'Você não pode desativar o seu próprio acesso.');
    if (dados.nome !== undefined) {
      if (!dados.nome.trim()) throw erro(422, 'Confira os campos.', { nome: 'Informe o nome.' });
      alvo.nome = dados.nome.trim();
    }
    if (dados.status) alvo.status = dados.status;
    salvar();
    return publico(alvo);
  },

  async reenviarConvite(usuarioId) {
    await espera();
    const alvo = carregar().usuarios.find((x) => x.id === usuarioId);
    return { linkConvite: `${location.origin}/#/definir-senha?token=exemplo-${alvo.id.slice(0, 8)}` };
  },

  async excluirUsuario(usuarioId) {
    await espera();
    const u = eu();
    const b = carregar();
    const alvo = b.usuarios.find((x) => x.id === usuarioId);
    if (!alvo || !podeGerirLoja(u, alvo.lojaId)) throw erro(403, 'Você não pode excluir este acesso.');
    if (alvo.id === u.id) throw erro(400, 'Você não pode excluir o seu próprio acesso.');
    if (alvo.ultimoAcesso) throw erro(409, 'Este acesso já tem histórico de atendimento. Desative em vez de excluir, para manter os registros.');
    b.usuarios = b.usuarios.filter((x) => x.id !== usuarioId); salvar();
  },

  // ---- meu perfil ----
  async atualizarPerfil({ nome, email }) {
    await espera();
    const u = eu();
    const campos = {};
    if (!nome?.trim()) campos.nome = 'Informe seu nome.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email || '')) campos.email = 'Informe um e-mail válido.';
    else if (carregar().usuarios.some((x) => x.id !== u.id && x.email === email.trim().toLowerCase())) campos.email = 'Este e-mail já é usado por outro acesso.';
    if (Object.keys(campos).length) throw erro(422, 'Confira os campos destacados.', campos);
    u.nome = nome.trim(); u.email = email.trim().toLowerCase(); salvar();
    return comLoja(u);
  },

  async trocarSenha({ atual, nova }) {
    await espera();
    eu();
    if (atual !== SENHA_DEMO) throw erro(422, 'Confira os campos.', { atual: 'Senha atual incorreta.' });
    if (nova.length < 10) throw erro(422, 'Confira os campos.', { nova: 'Use pelo menos 10 caracteres.' });
    return { ok: true };
  },

  async iniciar2fa() {
    await espera();
    eu();
    return { chave: 'JBSW Y3DP EHPK 3PXP', codigoExemplo: CODIGO_2FA_DEMO };
  },

  async ativar2fa({ codigo }) {
    await espera();
    const u = eu();
    if (codigo !== CODIGO_2FA_DEMO) throw erro(422, 'Confira o código.', { codigo: 'Código incorreto.' });
    u.doisFatores = true; salvar();
    return comLoja(u);
  },

  async desativar2fa() {
    await espera();
    const u = eu();
    if (['admin', 'matriz', 'dono'].includes(u.perfil)) throw erro(400, 'A verificação em 2 etapas é obrigatória para o seu tipo de acesso.');
    u.doisFatores = false; salvar();
    return comLoja(u);
  },

  restaurarExemplo() { banco = base(); salvar(); },
};
