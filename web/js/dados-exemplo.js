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
    const crm = crmExemplo();
    return { conversas: [...lista].map((c) => ({ ...c, etiquetas: crm.clientes[c.contato.id] ? etiquetasDe(crm, crm.clientes[c.contato.id]) : [] })).sort((a, z) => z.ultimaMensagemEm.localeCompare(a.ultimaMensagemEm)), cursor: new Date().toISOString() };
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

  // ---- etapas 3 a 6 (demonstração, somente leitura na maior parte) ----
  async assistente() { await espera(); return { ativo: true, nome: 'Lia', instrucoes: 'Seja simpática e objetiva. Sempre ofereça a proteção Super X.', boasVindas: 'Olá! Eu sou a Lia, assistente da LocarX Salvador Aeroporto.', msgAusencia: '', msgRepasse: 'Vou chamar um atendente da loja, é só aguardar um instante.', horario: {}, foraHorario: 'assistente', palavrasAtendente: ['atendente', 'humano', 'reclamação'], retornoHoras: 2, provedor: 'anthropic', modelo: 'claude-haiku-5-5', temChave: true, chaveFinal: 'x9Qa', temChaveAudio: false, limiteDiario: 400, silencioInicio: 21, silencioFim: 8, iaSimulada: false, apiLocarx: true }; },
  async salvarAssistente(d) { await espera(); return d; },
  async testarAssistente(historico) {
    await espera(900);
    const t = historico[historico.length - 1].texto.toLowerCase();
    if (/cau[cç][aã]o|calção/.test(t)) return { resposta: 'A caução é de R$ 700, bloqueada no cartão de crédito do condutor e liberada em até 5 dias úteis após a devolução.', ferramentas: ['buscar_informacoes'] };
    if (/carro|alugar|reserv/.test(t)) return { resposta: 'Para quais datas e horários você precisa do carro? A retirada e a devolução são aqui no Aeroporto de Salvador.', ferramentas: [] };
    return { resposta: 'Olá! Eu sou a Lia, assistente da LocarX Salvador Aeroporto. Posso ajudar com reservas e dúvidas sobre a locação.', ferramentas: [] };
  },
  async perguntasSemResposta() { await espera(); return [{ id: 'p1', pergunta: 'Vocês aceitam pet no carro?', conversaId: null, criadaEm: horasAtras(5) }]; },
  async resolverPergunta() { await espera(); },
  async conhecimento({ escopo }) {
    await espera();
    return escopo === 'rede'
      ? [{ id: 'r1', escopo: 'rede', titulo: 'Idade mínima e CNH', conteudo: 'O condutor precisa ter 21 anos ou mais e CNH definitiva há pelo menos 2 anos.', status: 'aprovado', autor: 'Matriz LocarX', atualizadoEm: horasAtras(48) }]
      : [{ id: 'l1', escopo: 'loja', titulo: 'Caução', conteudo: 'A caução é de R$ 700, bloqueada no cartão de crédito do condutor e liberada em até 5 dias úteis após a devolução.', status: 'aprovado', autor: 'Carla Menezes', atualizadoEm: horasAtras(20) },
         { id: 'l2', escopo: 'loja', titulo: 'Lavagem', conteudo: 'Carro devolvido muito sujo paga taxa de lavagem de R$ 50.', status: 'pendente', autor: 'Rafael Souza', atualizadoEm: horasAtras(3) }];
  },
  async reservas() {
    await espera();
    const d = (h) => new Date(agora + h * 3600e3).toISOString();
    return [
      { id: 'r1', codigo: 'SSA586587', status: 'confirmada', retirada: d(20), devolucao: d(92), grupo: 'C - COMPACTO ESPECIAL', valor: 345.5, origem: 'assistente', contato: { id: 'k1', nome: 'Cliente exemplo 1', telefone: '5571988887771' }, conversaId: null },
      { id: 'r2', codigo: 'SSA586601', status: 'confirmada', retirada: d(70), devolucao: d(140), grupo: 'B - ECONÔMICO', valor: 279.8, origem: 'assistente', contato: { id: 'k2', nome: 'Cliente exemplo 2', telefone: '5571988887772' }, conversaId: null },
    ];
  },
  async contatos({ busca, etiqueta } = {}) {
    await espera(); const c = crmExemplo();
    let lista = Object.values(c.clientes).map((k) => contatoDemo(c, k));
    if (busca) { const t = busca.toLowerCase(); lista = lista.filter((k) => (k.nome || '').toLowerCase().includes(t) || k.telefone.includes(t.replace(/\D/g, '') || '¬')); }
    if (etiqueta) lista = lista.filter((k) => k.etiquetas.some((e) => e.id === etiqueta));
    return { contatos: lista, total: lista.length, etiquetas: c.etiquetas };
  },
  async contato(cid) {
    await espera(); const c = crmExemplo();
    const k = contatoDemo(c, c.clientes[cid] || Object.values(c.clientes)[0]);
    const oportunidades = c.ops.filter((o) => o.contatoId === k.id).map((o) => { const f = c.funis.find((x) => x.id === o.funilId); const e = f.etapas.find((x) => x.id === o.etapaId); return { id: o.id, funil: f.nome, etapa: { nome: e.nome, cor: e.cor }, resultado: o.resultado || null, valor: o.valor, motivoPerda: o.motivoPerda || null, criadaEm: horasAtras(10) }; });
    return { ...k, janelaAbertaAte: new Date(agora + 20 * 3600e3).toISOString(), reservas: k.reservas ? [{ id: 'r1', codigo: 'SSA586587', status: 'confirmada', retirada: new Date(agora + 20 * 3600e3).toISOString(), grupo: 'C - COMPACTO ESPECIAL', valor: 345.5 }] : [], oportunidades, tarefas: [] };
  },
  async salvarContato(cid, d) { await espera(); const c = crmExemplo(); Object.assign(c.clientes[cid], { nome: d.nome || c.clientes[cid].nome, email: d.email || null, observacoes: d.observacoes || '', optout: !!d.optout }); salvar(); return contatoDemo(c, c.clientes[cid]); },
  async funil(funilId) {
    await espera(); const c = crmExemplo();
    const f = c.funis.find((x) => x.id === funilId && !x.arquivado) || c.funis.find((x) => x.principal);
    return { funilId: f.id, oportunidades: c.ops.filter((o) => o.funilId === f.id).map((o) => { const k = c.clientes[o.contatoId]; return { ...o, contato: { id: k.id, nome: k.nome, telefone: k.telefone, etiquetas: etiquetasDe(c, k) }, atualizadaEm: o.atualizadaEm || horasAtras(3) }; }) };
  },
  async moverOportunidade(oid, d) {
    await espera(); const c = crmExemplo(); const o = c.ops.find((x) => x.id === oid);
    const f = c.funis.find((x) => x.etapas.some((e) => e.id === d.etapaId)); const e = f.etapas.find((x) => x.id === d.etapaId);
    if (e.tipo === 'perdido' && !(d.motivoPerda || '').trim()) throw erro(422, 'Informe o motivo da perda.');
    Object.assign(o, { funilId: f.id, etapaId: e.id, resultado: e.tipo === 'aberta' ? null : e.tipo, motivoPerda: e.tipo === 'perdido' ? d.motivoPerda : null, atualizadaEm: new Date().toISOString() });
    salvar(); return o;
  },
  async novaOportunidade({ contatoId, funilId }) {
    await espera(); const c = crmExemplo(); const f = c.funis.find((x) => x.id === funilId) || c.funis.find((x) => x.principal);
    if (c.ops.some((o) => o.contatoId === contatoId && o.funilId === f.id && !o.resultado)) throw erro(409, 'Este cliente já está em andamento neste funil.');
    const o = { id: id(), contatoId, funilId: f.id, etapaId: f.etapas.find((e) => e.tipo === 'aberta').id, valor: null, atualizadaEm: new Date().toISOString() };
    c.ops.push(o); salvar(); return o;
  },

  // ---- etapa 7: funis, etiquetas, campos, painel do cliente e roleta (demonstração) ----
  async funis() { await espera(); const c = crmExemplo(); return c.funis.filter((f) => !f.arquivado).map((f) => funilDemo(c, f)); },
  async criarFunil(d) { await espera(); const c = crmExemplo(); const f = { id: id(), nome: d.nome, principal: false, personalizado: true, etapas: d.etapas.map((e, i) => ({ ...e, id: id(), ordem: i })) }; c.funis.push(f); salvar(); return funilDemo(c, f); },
  async salvarFunil(fid, d) { await espera(); const c = crmExemplo(); const f = c.funis.find((x) => x.id === fid); aplicarEtapasDemo(c, f, d); if (d.principal) c.funis.forEach((x) => { x.principal = x.id === fid; }); f.personalizado = true; salvar(); return funilDemo(c, f); },
  async arquivarFunil(fid) { await espera(); const c = crmExemplo(); const f = c.funis.find((x) => x.id === fid); if (f.principal) throw erro(409, 'Este é o funil principal. Escolha outro como principal antes.'); const n = c.ops.filter((o) => o.funilId === fid && !o.resultado).length; if (n) throw erro(409, `Há ${n} cliente(s) em andamento neste funil.`); f.arquivado = true; salvar(); },
  async funilPadrao() { await espera(); const c = crmExemplo(); return { funil: funilDemo(c, c.padrao), lojas: { acompanham: 2, personalizaram: 1 } }; },
  async salvarFunilPadrao(d) { await espera(); const c = crmExemplo(); aplicarEtapasDemo(c, c.padrao, d); salvar(); return { funil: funilDemo(c, c.padrao), lojasAtualizadas: 2 }; },
  async etiquetas(escopo = 'loja') { await espera(150); const c = crmExemplo(); return c.etiquetas.filter((e) => escopo === 'loja' || e.daRede).map((e) => ({ ...e, uso: Object.values(c.clientes).filter((k) => k.aplicadas.some((a) => a.id === e.id)).length })); },
  async salvarEtiqueta(escopo, d) {
    await espera(); const c = crmExemplo();
    if (c.etiquetas.some((e) => e.id !== d.id && e.nome.toLowerCase() === d.nome.toLowerCase())) throw erro(422, 'Já existe uma etiqueta com este nome.', { nome: 'Já existe uma etiqueta com este nome.' });
    let e = c.etiquetas.find((x) => x.id === d.id);
    if (e) Object.assign(e, { nome: d.nome, cor: d.cor, descricaoBot: d.descricaoBot || null });
    else { e = { id: id(), nome: d.nome, cor: d.cor || '#64748b', descricaoBot: d.descricaoBot || null, daRede: escopo === 'rede' }; c.etiquetas.push(e); }
    salvar(); return e;
  },
  async excluirEtiqueta(escopo, eid) { await espera(); const c = crmExemplo(); c.etiquetas = c.etiquetas.filter((e) => e.id !== eid); Object.values(c.clientes).forEach((k) => { k.aplicadas = k.aplicadas.filter((a) => a.id !== eid); }); salvar(); },
  async campos(escopo = 'loja') { await espera(150); const c = crmExemplo(); return c.campos.filter((x) => escopo === 'loja' || x.daRede); },
  async salvarCampo(escopo, d) {
    await espera(); const c = crmExemplo(); let x = c.campos.find((y) => y.id === d.id);
    if (x) Object.assign(x, { nome: d.nome, opcoes: d.opcoes, instrucaoBot: d.instrucaoBot, ativo: d.ativo });
    else { x = { id: id(), chave: d.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_'), nome: d.nome, tipo: d.tipo, opcoes: d.opcoes, instrucaoBot: d.instrucaoBot, ativo: true, daRede: escopo === 'rede' }; c.campos.push(x); }
    salvar(); return x;
  },
  async excluirCampo(escopo, cid) { await espera(); const c = crmExemplo(); c.campos = c.campos.filter((x) => x.id !== cid); salvar(); },
  async ordenarCampos(escopo, ids) { await espera(); const c = crmExemplo(); c.campos.sort((a, z) => (ids.indexOf(a.id) + 1 || -99) - (ids.indexOf(z.id) + 1 || -99)); salvar(); },
  async painelCliente(cid) { await espera(200); return painelDemo(crmExemplo(), cid); },
  async salvarCamposCliente(cid, valores) {
    await espera(200); const c = crmExemplo(); const k = c.clientes[cid];
    for (const [campoId, v] of Object.entries(valores)) {
      const campo = c.campos.find((x) => x.id === campoId);
      if (campo.tipo === 'lista' && v && !campo.opcoes.some((o) => o.toLowerCase() === v.toLowerCase())) throw erro(422, `"${campo.nome}" aceita só: ${campo.opcoes.join(', ')}.`, { [campoId]: `"${campo.nome}" aceita só: ${campo.opcoes.join(', ')}.` });
      if (campo.tipo === 'numero' && v && !Number.isFinite(Number(v.replace(',', '.')))) throw erro(422, `"${campo.nome}" precisa ser um número.`, { [campoId]: `"${campo.nome}" precisa ser um número.` });
      if (v) k.valores[campoId] = { valor: campo.tipo === 'lista' ? campo.opcoes.find((o) => o.toLowerCase() === v.toLowerCase()) : v, peloAssistente: false }; else delete k.valores[campoId];
    }
    salvar(); return painelDemo(c, cid);
  },
  async salvarEtiquetasCliente(cid, ids) { await espera(200); const c = crmExemplo(); const k = c.clientes[cid]; k.aplicadas = ids.map((x) => k.aplicadas.find((a) => a.id === x) || { id: x, peloAssistente: false }); const cv = conversasExemplo().conversas.find((y) => y.contato.id === cid); if (cv) cv.cursor = new Date().toISOString(); salvar(); return painelDemo(c, cid); },
  async roleta() {
    await espera(); const c = crmExemplo(); const u = eu();
    const equipe = carregar().usuarios.filter((x) => x.lojaId === u.lojaId && x.status === 'ativo').map((x, i) => ({ id: x.id, nome: x.nome, perfil: x.perfil, disponivel: !!x.disponivel, marcouDisponivel: !!x.disponivel, online: !!x.disponivel || i === 1, naRoleta: c.roleta.fora.indexOf(x.id) < 0, emAndamento: x.perfil === 'atendente' ? 2 - i % 2 : 0 }));
    return { modo: c.roleta.modo, limite: c.roleta.limite, aguardando: conversasExemplo().conversas.filter((x) => x.estado === 'aguardando').length, equipe };
  },
  async salvarRoleta(d) { await espera(); const c = crmExemplo(); c.roleta.modo = d.modo; c.roleta.limite = d.limite; c.roleta.fora = Object.entries(d.participantes || {}).filter(([, v]) => !v).map(([k]) => k); salvar(); return this.roleta(); },
  async disponibilidade(disponivel) { await espera(150); const u = eu(); u.disponivel = disponivel; salvar(); return comLoja(u); },
  async tarefas({ situacao }) {
    await espera();
    if (situacao === 'feitas') return [];
    return [{ id: 't1', titulo: 'Retomar cotação de Cliente exemplo 3', venceEm: horasAtras(2), feitaEm: null, automatica: true, contatoId: 'k3', contatoNome: 'Cliente exemplo 3', responsavel: null },
      { id: 't2', titulo: 'Ligar para confirmar a retirada', venceEm: new Date(agora + 5 * 3600e3).toISOString(), feitaEm: null, automatica: false, contatoId: 'k1', contatoNome: 'Cliente exemplo 1', responsavel: { nome: 'Rafael Souza' } }];
  },
  async marcarTarefa() { await espera(); },
  async modelos() {
    await espera();
    const m = (chave, nome, automatico, quando, texto) => ({ chave, nome, automatico, quando, texto, ativo: true });
    return [m('lembrete_retirada', 'Lembrete de retirada', true, 'Na véspera da retirada', 'Olá, {nome}! Sua reserva {codigo} na {loja} tem retirada em {data_retirada} às {hora_retirada}.'),
      m('aviso_devolucao', 'Aviso de devolução', true, 'No dia da devolução', 'Olá, {nome}! Hoje é o dia da devolução do carro da reserva {codigo}, às {hora_devolucao}.'),
      m('pesquisa_satisfacao', 'Pesquisa de satisfação', true, 'No dia seguinte à devolução', 'Olá, {nome}! De 0 a 10, quanto você recomendaria a LocarX para um amigo?'),
      m('retomar_cotacao', 'Retomar cotação', false, 'Enviar manualmente', 'Olá, {nome}! Ainda posso ajudar com a sua locação na {loja}?')];
  },
  async relatorioLoja(dias) {
    await espera();
    const porDia = [...Array(dias).keys()].map((i) => { const d = new Date(agora - (dias - 1 - i) * 86400e3); const s = Math.sin(i * 1.3) + 1; return { dia: d.toISOString().slice(0, 10), conversas: Math.round(12 + s * 8 + (i % 7 === 5 ? 9 : 0)), reservas: Math.round(2 + s * 2) }; });
    const conv = porDia.reduce((t, d) => t + d.conversas, 0), res = porDia.reduce((t, d) => t + d.reservas, 0);
    return { dias, conversas: conv, soAssistente: Math.round(conv * 0.62), comEquipe: Math.round(conv * 0.38), clientesNovos: Math.round(conv * 0.7), oportunidades: Math.round(conv * 0.5), cotacoes: Math.round(conv * 0.45), reservas: res, valor: res * 312, reservasAssistente: Math.round(res * 0.7), valorAssistente: Math.round(res * 0.7) * 312, respostasIa: conv * 4, tokensIa: 0, respostaMedianaMin: 7, porDia,
      perdas: [{ motivo: 'Preço acima do esperado', n: 9 }, { motivo: 'Sem carro disponível', n: 4 }, { motivo: 'Não respondeu mais', n: 3 }], semResposta: [{ pergunta: 'Vocês aceitam pet no carro?' }], equipe: [{ nome: 'Rafael Souza', conversas: 41, mensagens: 230 }, { nome: 'Juliana Prado', conversas: 33, mensagens: 188 }] };
  },
  async relatorioRede(dias) {
    await espera();
    const l = (nome, cidade, uf, conversas, reservas, whatsapp, assistente) => ({ id: nome, nome, cidade, uf, ativa: true, whatsapp, assistente, conversas: conversas * dias / 30, reservas: reservas * dias / 30, valor: reservas * 312 * dias / 30, reservasAssistente: Math.round(reservas * 0.7), conversao: Math.round(reservas / conversas * 1000) / 10, respostaMedianaMin: 5 + reservas % 9 });
    const lojas = [l('LocarX Salvador Aeroporto', 'Salvador', 'BA', 540, 96, 'conectado', true), l('LocarX Salvador Centro', 'Salvador', 'BA', 310, 41, 'conectado', true), l('LocarX Natal Aeroporto', 'Natal', 'RN', 220, 35, 'conectado', false), l('LocarX Feira de Santana', 'Feira de Santana', 'BA', 0, 0, 'desconectado', false)];
    return { dias, lojas, total: lojas.reduce((t, x) => ({ conversas: t.conversas + x.conversas, reservas: t.reservas + x.reservas, valor: t.valor + x.valor, reservasAssistente: t.reservasAssistente + x.reservasAssistente }), { conversas: 0, reservas: 0, valor: 0, reservasAssistente: 0 }) };
  },
  urlExportarContatos: () => '#/clientes',
  async rede() { await espera(); return { orientacoes: 'Nunca ofereça desconto. O pagamento é sempre feito na loja, na retirada.', modeloAssistente: { nome: 'Lia', boasVindas: 'Olá! Eu sou a Lia, assistente da LocarX.' }, sinonimos: [{ id: 's1', termos: ['caução', 'calção', 'depósito', 'garantia'] }, { id: 's2', termos: ['cnh', 'carteira', 'habilitação'] }] }; },
  async usuariosRede() { await espera(); return carregar().usuarios.filter((u) => ['admin', 'matriz'].includes(u.perfil)).map(publico); },

  restaurarExemplo() { banco = base(); salvar(); },
};
// ---------- CRM de demonstração (funis, etiquetas, campos) ----------
function crmExemplo() {
  const b = carregar();
  if (b.crm) return b.crm;
  const e = (id, nome, cor, tipo = 'aberta', evento = null) => ({ id, nome, cor, tipo, evento });
  const padrao = { id: 'f-rede', nome: 'Locação', principal: true, etapas: [e('r1', 'Novo contato', '#64748b'), e('r2', 'Em cotação', '#2563eb', 'aberta', 'cotacao'), e('r3', 'Reserva criada', '#7c3aed', 'aberta', 'reserva'), e('r4', 'Carro retirado', '#d97706', 'aberta', 'retirada'), e('r5', 'Concluído', '#16a34a', 'ganho'), e('r6', 'Perdido', '#dc2626', 'perdido')] };
  const funis = [
    { id: 'f1', nome: 'Locação', principal: true, personalizado: false, etapas: padrao.etapas.map((x, i) => ({ ...x, id: 'e' + (i + 1) })) },
    { id: 'f2', nome: 'Mensalistas', principal: false, personalizado: true, etapas: [e('m1', 'Interessado', '#64748b'), e('m2', 'Proposta enviada', '#0891b2'), e('m3', 'Contrato assinado', '#16a34a', 'ganho'), e('m4', 'Perdido', '#dc2626', 'perdido')] },
  ];
  const etiquetas = [
    { id: 't1', nome: 'Urgente', cor: '#dc2626', descricaoBot: 'O cliente precisa do carro hoje ou amanhã.', daRede: true },
    { id: 't2', nome: 'Mensal', cor: '#7c3aed', descricaoBot: 'Locação de 30 dias ou mais.', daRede: true },
    { id: 't3', nome: 'Empresa', cor: '#2563eb', descricaoBot: 'O cliente aluga em nome de uma empresa ou pede nota para CNPJ.', daRede: true },
    { id: 't4', nome: 'Aplicativo', cor: '#d97706', descricaoBot: 'O cliente vai usar o carro para Uber, 99 ou outro aplicativo.', daRede: true },
    { id: 't5', nome: 'Turismo', cor: '#0891b2', descricaoBot: 'O cliente está viajando a passeio.', daRede: true },
    { id: 't6', nome: 'Cliente VIP', cor: '#db2777', descricaoBot: null, daRede: false },
  ];
  const campos = [
    { id: 'c1', chave: 'periodo', nome: 'Período desejado', tipo: 'texto', opcoes: [], instrucaoBot: 'Datas e horários de retirada e devolução.', ativo: true, daRede: true },
    { id: 'c2', chave: 'carro_desejado', nome: 'Carro ou grupo desejado', tipo: 'texto', opcoes: [], instrucaoBot: 'Modelo, categoria ou grupo que o cliente pediu.', ativo: true, daRede: true },
    { id: 'c3', chave: 'motivo', nome: 'Motivo da locação', tipo: 'lista', opcoes: ['Turismo', 'Trabalho', 'Aplicativo', 'Carro reserva', 'Outro'], instrucaoBot: 'Para que o cliente vai usar o carro.', ativo: true, daRede: true },
    { id: 'c4', chave: 'como_conheceu', nome: 'Como conheceu a LocarX', tipo: 'lista', opcoes: ['Google', 'Instagram', 'Indicação', 'Já é cliente', 'Outro'], instrucaoBot: null, ativo: true, daRede: true },
    { id: 'c5', chave: 'forma_de_pagamento', nome: 'Forma de pagamento', tipo: 'lista', opcoes: ['Pix', 'Cartão de crédito', 'Faturado'], instrucaoBot: 'Como o cliente pretende pagar.', ativo: true, daRede: false },
  ];
  const k = (n, nome, tel, aplicadas, valores, extra = {}) => ({ id: 'k' + n, nome, telefone: tel, email: null, observacoes: '', optout: false, aplicadas: aplicadas.map(([id, bot]) => ({ id, peloAssistente: !!bot })), valores: Object.fromEntries(valores.map(([c, v, bot]) => [c, { valor: v, peloAssistente: !!bot }])), ...extra });
  const clientes = Object.fromEntries([
    k(1, 'Cliente exemplo 1', '5571988887771', [['t5', 1], ['t1', 1]], [['c1', 'Sexta 10h a domingo 20h', 1], ['c2', 'SUV', 1], ['c3', 'Turismo', 1]], { reservas: 1, h: 1 }),
    k(2, 'Cliente exemplo 2', '5571988887772', [['t3']], [['c2', 'Compacto', 1], ['c5', 'Faturado']], { reservas: 3, h: 4 }),
    k(3, null, '5575999991234', [['t4', 1]], [['c3', 'Aplicativo', 1]], { reservas: 0, h: 6 }),
    k(4, 'Cliente exemplo 4', '5571988887774', [['t6']], [], { reservas: 2, h: 30 }),
    k(5, 'Cliente exemplo 5', '5571988887775', [], [], { reservas: 0, h: 2 }),
    k(6, 'Cliente exemplo 6', '5571988887776', [['t2', 1]], [['c1', '30 dias a partir de 01/11', 1]], { reservas: 0, h: 9 }),
    k(7, 'Cliente exemplo 7', '5571988887777', [], [], { reservas: 0, h: 50 }),
  ].map((x) => [x.id, x]));
  const o = (n, contatoId, funilId, etapaId, valor, extra = {}) => ({ id: 'o' + n, contatoId, funilId, etapaId, valor, atualizadaEm: horasAtras(n * 2), ...extra });
  const ops = [o(1, 'k5', 'f1', 'e1', null), o(2, 'k3', 'f1', 'e2', 290), o(3, 'k6', 'f1', 'e2', 610), o(4, 'k1', 'f1', 'e3', 345.5), o(5, 'k2', 'f1', 'e4', 279.8),
    o(6, 'k4', 'f1', 'e5', 520, { resultado: 'ganho' }), o(7, 'k7', 'f1', 'e6', 450, { resultado: 'perdido', motivoPerda: 'Preço acima do esperado' }), o(8, 'k6', 'f2', 'm2', 3900)];
  b.crm = { padrao, funis, etiquetas, campos, clientes, ops, roleta: { modo: 'rodizio', limite: 0, fora: [] } };
  salvar();
  return b.crm;
}
const etiquetasDe = (c, k) => k.aplicadas.map((a) => c.etiquetas.find((e) => e.id === a.id)).filter(Boolean).map((e) => ({ id: e.id, nome: e.nome, cor: e.cor }));
function contatoDemo(c, k) {
  const op = c.ops.filter((o) => o.contatoId === k.id).sort((a, z) => (a.resultado ? 1 : 0) - (z.resultado ? 1 : 0))[0];
  const f = op && c.funis.find((x) => x.id === op.funilId); const e = f?.etapas.find((x) => x.id === op.etapaId);
  return { id: k.id, nome: k.nome, telefone: k.telefone, email: k.email, etiquetas: etiquetasDe(c, k), observacoes: k.observacoes, cpf: null, optout: k.optout, criadoEm: horasAtras((k.h || 1) * 3), ultimaConversa: horasAtras(k.h || 1), conversaId: null, etapa: e ? { nome: e.nome, cor: e.cor, tipo: e.tipo, funil: f.nome } : null, reservas: k.reservas || 0 };
}
function funilDemo(c, f) {
  return { id: f.id, nome: f.nome, principal: f.principal, arquivado: !!f.arquivado, personalizado: !!f.personalizado, abertas: c.ops.filter((o) => o.funilId === f.id && !o.resultado).length,
    etapas: f.etapas.map((e, i) => ({ ...e, ordem: i, abertas: c.ops.filter((o) => o.etapaId === e.id && !o.resultado).length })) };
}
function aplicarEtapasDemo(c, f, d) {
  const antigas = f.etapas;
  f.nome = d.nome;
  f.etapas = d.etapas.map((e) => ({ ...antigas.find((a) => a.id === e.id), ...e, id: e.id || id() }));
  for (const a of antigas) if (!f.etapas.some((e) => e.id === a.id)) { const destino = f.etapas.find((e) => e.tipo === a.tipo); c.ops.filter((o) => o.etapaId === a.id).forEach((o) => { o.etapaId = destino.id; }); }
}
function painelDemo(c, cid) {
  const k = c.clientes[cid] || Object.values(c.clientes)[0];
  return {
    contato: { id: k.id, nome: k.nome, telefone: k.telefone, email: k.email, cpf: null, optout: k.optout },
    campos: c.campos.filter((x) => x.ativo).map((x) => ({ ...x, valor: k.valores[x.id]?.valor ?? null, peloAssistente: !!k.valores[x.id]?.peloAssistente })),
    etiquetas: c.etiquetas, aplicadas: k.aplicadas,
    funis: c.funis.filter((f) => !f.arquivado).map((f) => ({ id: f.id, nome: f.nome, principal: f.principal, etapas: f.etapas })),
    oportunidades: c.ops.filter((o) => o.contatoId === k.id && !o.resultado).map((o) => ({ id: o.id, funilId: o.funilId, etapaId: o.etapaId, valor: o.valor })),
    reservas: k.reservas ? [{ id: 'r1', codigo: 'SSA586587', status: 'confirmada', retirada: new Date(agora + 20 * 3600e3).toISOString(), valor: 345.5 }] : [],
  };
}

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
