// v14.8 — Plano do Conecta para os franqueados (decisão de 04/11/2026): um plano só, "Básico", com CRM + Lia.
// Mensal R$ 220; anual R$ 2.000 (sai por R$ 166,67/mês — o Silas chamou de "200 por mês", 10 meses). Valores em centavos.
// O Pix pelo WhatsApp e a integração MCP não entram no plano: são extras que a administração liga por loja.
export const PLANOS = {
  basico: {
    nome: 'Conecta + LIA', rotulo: 'Plano básico', descricao: 'CRM, Portal LocarX e atendimento automatizado pela Lia.', destaque: true,
    mensal: 22000, anual: 200000,
    acessosInclusos: 2, acessoExtraMensal: 2990,   // v14.9.3 — 2 acessos por loja no plano; acesso adicional R$ 29,90/mês (cobrança do extra ainda manual: backlog)
    modulos: { funil: true, clientes: true, relatorios: true, automacoes: true, assistente: true, cotacao: true, base: true },
    inclui: ['Funil de vendas e tarefas', 'Clientes (CRM)', 'Relatórios', 'Mensagens automáticas', 'Assistente virtual LIA', 'Cotação e reserva', 'Integração com Portal', 'Base de conhecimento da loja'],
    naoInclui: [],
  },
};
// v14.10 — valores editáveis pela administração (tela "Plano e valores"): ficam em plano_config e sobrepõem o padrão acima.
// Carregados no boot e depois de cada salvamento; em memória, porque todo o código lê PLANOS de forma síncrona.
const PADRAO = structuredClone(PLANOS);
export const CAMPOS_EDITAVEIS = ['nome', 'rotulo', 'descricao', 'mensal', 'anual', 'acessosInclusos', 'acessoExtraMensal', 'inclui', 'notas'];
export function aplicarConfigPlano(chave, cfg) {
  if (!PLANOS[chave]) return;
  const base = PADRAO[chave];
  PLANOS[chave] = { ...base, nome: cfg.nome ?? base.nome, rotulo: cfg.rotulo ?? base.rotulo, descricao: cfg.descricao ?? base.descricao,
    mensal: cfg.mensal ?? base.mensal, anual: cfg.anual ?? base.anual, acessosInclusos: cfg.acessosInclusos ?? base.acessosInclusos, acessoExtraMensal: cfg.acessoExtraMensal ?? base.acessoExtraMensal,
    inclui: Array.isArray(cfg.inclui) && cfg.inclui.length ? cfg.inclui : base.inclui, notas: Array.isArray(cfg.notas) ? cfg.notas : NOTAS };
}
export const configDeLinha = (r) => ({ nome: r.nome, rotulo: r.rotulo, descricao: r.descricao, mensal: r.mensal, anual: r.anual, acessosInclusos: r.acessos_inclusos, acessoExtraMensal: r.acesso_extra_mensal, inclui: r.inclui, notas: r.notas });
/** Lê plano_config e aplica em memória. Sem linha, fica o padrão do código. */
export async function carregarConfigPlanos(c) {
  const rows = (await c.query('SELECT * FROM plano_config')).rows;
  for (const r of rows) aplicarConfigPlano(r.chave, configDeLinha(r));
  return rows.length;
}
export const padraoDoPlano = (chave) => ({ ...PADRAO[chave], notas: NOTAS });
export const notasDoPlano = (chave) => PLANOS[chave]?.notas || NOTAS;

export const CICLOS = { mensal: { meses: 1 }, anual: { meses: 12 } };
export const FORMAS = { cartao: 'Cartão de crédito', pix: 'Pix', boleto: 'Boleto', isenta: 'Isenta pela rede', manual: 'Confirmação manual' };
export const NOTAS = [
  'Os valores apresentados não incluem eventuais custos de reservas, taxas ou cobranças de integradores e plataformas parceiras, que poderão ser cobrados separadamente.',
  'Estes são os planos iniciais, disponibilizados em fase de testes e aprimoramento. Novas versões, com melhorias, funcionalidades adicionais e evoluções tecnológicas, serão disponibilizadas gradualmente.',
];

export const valorDoPlano = (plano, ciclo = 'mensal') => (ciclo === 'anual' ? PLANOS[plano].anual : PLANOS[plano].mensal);

/** Módulos da loja depois de aplicar o plano: o que o plano define manda; pix e mcp (extras) ficam como a administração deixou. */
export function modulosComPlano(modulosAtuais, plano) {
  const atual = modulosAtuais && typeof modulosAtuais === 'object' ? modulosAtuais : {};
  return { ...atual, ...PLANOS[plano].modulos, pix: atual.pix ?? false, mcp: atual.mcp ?? false };
}

/** Referência do ciclo (AAAA-MM ou AAAA) e vencimento seguinte a partir de uma data. */
export function referenciaDe(data, ciclo) {
  const d = typeof data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data) ? new Date(data + 'T12:00:00Z') : data instanceof Date && data.getHours() === 0 && data.getMinutes() === 0 ? new Date(dataISO(data) + 'T12:00:00Z') : new Date(data);
  return ciclo === 'anual' ? String(d.getUTCFullYear()) : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
/** Data (string AAAA-MM-DD, Date do pg ou timestamp) → AAAA-MM-DD. */
export const dataISO = (v) => (v instanceof Date ? new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(v).slice(0, 10));
export function somarCiclo(data, ciclo) {
  const d = new Date(dataISO(data) + 'T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + (CICLOS[ciclo]?.meses || 1));
  return d.toISOString().slice(0, 10);
}
export const planosPublicos = () => Object.entries(PLANOS).map(([chave, p]) => ({ chave, notas: p.notas || NOTAS, rotulo: p.rotulo, nome: p.nome, descricao: p.descricao, destaque: !!p.destaque, mensal: p.mensal, anual: p.anual, acessosInclusos: p.acessosInclusos, acessoExtraMensal: p.acessoExtraMensal, inclui: p.inclui, naoInclui: p.naoInclui }));
