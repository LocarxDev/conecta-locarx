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

  // ---- etapa 2: WhatsApp e conversas (demonstração) ----
  async canal() { await espera(150); const b = carregar(); return { status: b.canal?.status || 'desconectado', numero: b.canal?.numero || null, configurado: true }; },
  async conectarCanal() { await espera(); const b = carregar(); b.canal = { status: 'conectando', polls: 0 }; salvar(); return { status: 'conectando', qr: null }; },
  async qrCanal() {
    await espera(300); const b = carregar();
    b.canal ||= { status: 'conectando', polls: 0 };
    b.canal.polls = (b.canal.polls || 0) + 1;
    if (b.canal.polls >= 4) { b.canal.status = 'conectado'; b.canal.numero = '5571999990000'; }
    salvar();
    return b.canal.status === 'conectado' ? { status: 'conectado' } : { status: 'conectando', qr: null };
  },
  async desconectarCanal() { await espera(); const b = carregar(); b.canal = { status: 'desconectado' }; salvar(); return { status: 'desconectado' }; },

  async listarConversas({ desde, busca } = {}) {
    await espera(120); const b = conversasExemplo();
    let lista = b.conversas;
    if (desde) lista = lista.filter((c) => c.cursor > desde);
    if (busca) { const t = busca.toLowerCase(); lista = lista.filter((c) => (c.contato.nome || '').toLowerCase().includes(t) || c.contato.telefone.includes(t.replace(/\D/g, '') || '¬')); }
    return { conversas: [...lista].sort((a, z) => z.ultimaMensagemEm.localeCompare(a.ultimaMensagemEm)), cursor: new Date().toISOString() };
  },
  async mensagens(id, { depois } = {}) {
    await espera(120); const b = conversasExemplo();
    const cv = b.conversas.find((c) => c.id === id);
    if (!cv) throw erro(404, 'Conversa não encontrada.');
    const ms = (b.mensagens[id] || []).filter((m) => !depois || m.cursor > depois);
    return { conversa: cv, mensagens: ms };
  },
  async marcarLida(id) { const b = conversasExemplo(); const cv = b.conversas.find((c) => c.id === id); if (cv && cv.naoLidas) { cv.naoLidas = 0; cv.cursor = new Date().toISOString(); salvar(); } },
  async enviarTexto(id, texto) { await espera(); return novaSaida(id, { tipo: 'texto', texto }); },
  async enviarMidia(id, d) { await espera(600); return novaSaida(id, { tipo: d.mimetype.startsWith('image/') ? 'imagem' : 'documento', texto: d.legenda || null, midia: { mimetype: d.mimetype, nome: d.nomeArquivo } }); },
  async nota(id, texto) { await espera(); const u = eu(); return addMensagem(id, { direcao: 'interna', autor: 'atendente', autorNome: u.nome, tipo: 'nota', texto }); },
  async acaoConversa(id, acao, corpo = {}) {
    await espera(); const u = eu(); const b = conversasExemplo(); const cv = b.conversas.find((c) => c.id === id);
    if (acao === 'assumir') { cv.estado = 'humano'; cv.atendente = { id: u.id, nome: u.nome }; addMensagem(id, { direcao: 'interna', autor: 'sistema', tipo: 'evento', texto: `${u.nome} assumiu a conversa` }); }
    if (acao === 'devolver') { cv.estado = 'assistente'; cv.atendente = null; addMensagem(id, { direcao: 'interna', autor: 'sistema', tipo: 'evento', texto: `${u.nome} devolveu a conversa ao assistente` }); }
    if (acao === 'encerrar') { cv.estado = 'encerrada'; cv.naoLidas = 0; addMensagem(id, { direcao: 'interna', autor: 'sistema', tipo: 'evento', texto: `${u.nome} encerrou a conversa` }); }
    if (acao === 'transferir') { const alvo = carregar().usuarios.find((x) => x.id === corpo.atendenteId); cv.estado = 'humano'; cv.atendente = { id: alvo.id, nome: alvo.nome }; addMensagem(id, { direcao: 'interna', autor: 'sistema', tipo: 'evento', texto: `${u.nome} transferiu a conversa para ${alvo.nome}` }); }
    cv.cursor = new Date().toISOString(); salvar();
    return cv;
  },
  async equipeAtiva() { await espera(100); const u = eu(); return carregar().usuarios.filter((x) => x.lojaId === u.lojaId && x.status === 'ativo').map((x) => ({ id: x.id, nome: x.nome, perfil: x.perfil })); },
  urlArquivo: () => 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#E4E1DD"/><text x="160" y="105" font-family="sans-serif" font-size="16" text-anchor="middle" fill="#5E5A55">Foto de exemplo</text></svg>'),
  async respostas() { await espera(100); return carregar().respostas ||= respostasBase(); },
  async salvarResposta(d) {
    await espera(); const b = carregar(); b.respostas ||= respostasBase();
    if (!/^[a-z0-9-]{2,30}$/.test(d.atalho || '')) throw erro(422, 'Confira os campos.', { atalho: 'Use de 2 a 30 letras minúsculas, números ou hífen.' });
    if (b.respostas.some((r) => r.atalho === d.atalho && r.id !== d.id)) throw erro(422, 'Confira os campos.', { atalho: 'Já existe uma resposta com este atalho.' });
    if (d.id) { Object.assign(b.respostas.find((r) => r.id === d.id), { atalho: d.atalho, texto: d.texto }); } else b.respostas.push({ id: id(), atalho: d.atalho, texto: d.texto });
    salvar(); return d;
  },
  async excluirResposta(rid) { await espera(); const b = carregar(); b.respostas = (b.respostas || []).filter((r) => r.id !== rid); salvar(); },

  restaurarExemplo() { banco = base(); salvar(); },
};

function respostasBase() {
  return [
    { id: id(), atalho: 'caucao', texto: 'A caução é bloqueada no cartão de crédito do condutor no momento da retirada e liberada após a devolução do carro.' },
    { id: id(), atalho: 'documentos', texto: 'Para retirar o carro: CNH válida há mais de 2 anos, documento com foto e cartão de crédito no nome do condutor.' },
    { id: id(), atalho: 'endereco', texto: 'Estamos no Aeroporto de Salvador, no balcão de locadoras do desembarque.' },
  ];
}

function conversasExemplo() {
  const b = carregar();
  if (b.conversas) return b;
  const agoraMs = Date.now();
  const t = (min) => new Date(agoraMs - min * 60000).toISOString();
  const mk = (n, nome, tel, estado, naoLidas, msgs) => {
    const cid = 'c0000000-0000-4000-8000-00000000000' + n;
    b.mensagens ||= {};
    b.mensagens[cid] = msgs.map(([min, direcao, autor, tipo, texto, extra], i) => ({ id: `${cid}-${i}`, direcao, autor, autorNome: autor === 'atendente' ? 'Rafael Souza' : null, tipo, texto, midia: extra || null, temArquivo: ['imagem', 'audio'].includes(tipo), status: 'ok', criadaEm: t(min), cursor: t(min) }));
    const ult = msgs[msgs.length - 1];
    return { id: cid, estado, naoLidas, previa: ult[4] || (ult[3] === 'audio' ? 'Áudio' : 'Foto'), ultimaMensagemEm: t(ult[0]), ultimaDoCliente: t(ult[0]), atendente: estado === 'humano' ? { id: 'x', nome: 'Rafael Souza' } : null, contato: { id: 'k' + n, nome, telefone: tel }, cursor: t(ult[0]) };
  };
  b.conversas = [
    mk(1, 'Cliente exemplo 1', '5571988887771', 'aguardando', 2, [[14, 'entrada', 'cliente', 'texto', 'Boa tarde! Queria alugar um carro para o fim de semana.'], [13, 'entrada', 'cliente', 'texto', 'Retirada sexta às 10h no aeroporto, devolução domingo à noite.']]),
    mk(2, 'Cliente exemplo 2', '5571988887772', 'humano', 0, [[50, 'entrada', 'cliente', 'texto', 'Vocês aceitam cartão de débito na caução?'], [48, 'interna', 'sistema', 'evento', 'Rafael Souza assumiu a conversa'], [47, 'saida', 'atendente', 'texto', 'Olá! A caução é feita só no cartão de crédito do condutor.'], [30, 'entrada', 'cliente', 'audio', null, { mimetype: 'audio/ogg', segundos: 9 }]]),
    mk(3, null, '5575999991234', 'aguardando', 1, [[90, 'entrada', 'cliente', 'imagem', 'Essa é a minha CNH', { mimetype: 'image/png' }]]),
    mk(4, 'Cliente exemplo 4', '5571988887774', 'encerrada', 0, [[600, 'entrada', 'cliente', 'texto', 'Obrigado, deu tudo certo na devolução!'], [598, 'saida', 'atendente', 'texto', 'Nós que agradecemos. Boa viagem!'], [597, 'interna', 'sistema', 'evento', 'Rafael Souza encerrou a conversa']]),
  ];
  salvar();
  return b;
}

function addMensagem(cid, m) {
  const b = conversasExemplo();
  const agoraIso = new Date().toISOString();
  const nova = { id: id(), autorNome: null, midia: null, temArquivo: false, status: 'ok', criadaEm: agoraIso, cursor: agoraIso, ...m };
  (b.mensagens[cid] ||= []).push(nova);
  const cv = b.conversas.find((c) => c.id === cid);
  if (m.direcao !== 'interna') { cv.previa = m.texto || 'Arquivo'; cv.ultimaMensagemEm = agoraIso; }
  cv.cursor = agoraIso;
  salvar();
  return nova;
}

function novaSaida(cid, m) {
  const u = eu(); const b = conversasExemplo(); const cv = b.conversas.find((c) => c.id === cid);
  if ((b.canal?.status || 'desconectado') !== 'conectado') throw erro(409, 'O WhatsApp da loja está desconectado. Conecte em "WhatsApp" antes de responder.');
  if (cv.estado !== 'humano' || cv.atendente?.id !== u.id) { cv.estado = 'humano'; cv.atendente = { id: u.id, nome: u.nome }; addMensagem(cid, { direcao: 'interna', autor: 'sistema', tipo: 'evento', texto: `${u.nome} assumiu a conversa` }); }
  return addMensagem(cid, { direcao: 'saida', autor: 'atendente', autorNome: u.nome, ...m });
}
