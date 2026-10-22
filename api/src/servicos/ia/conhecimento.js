// Busca na base de conhecimento (rede + loja) usando a busca em português do PostgreSQL, com sinônimos.
// Só conteúdo APROVADO entra nas respostas do assistente.

const MIN_RANK = 0.05;

function normalizar(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// expande a pergunta com os sinônimos cadastrados (ex.: "calção" → caução, depósito, garantia)
async function expandir(c, pergunta) {
  const termos = (await c.query('SELECT termos FROM sinonimos')).rows.map((r) => r.termos);
  const p = normalizar(pergunta);
  const extras = new Set();
  for (const grupo of termos) {
    if (grupo.some((t) => p.includes(normalizar(t)))) grupo.forEach((t) => extras.add(t));
  }
  return [...extras];
}

/**
 * @returns {Promise<Array<{id, titulo, conteudo, escopo, rank}>>}
 */
export async function buscarConhecimento(c, lojaId, pergunta, limite = 4) {
  const texto = String(pergunta || '').slice(0, 500);
  if (!texto.trim()) return [];
  const extras = await expandir(c, texto);
  // palavras soltas com OU (mais tolerante que a frase inteira)
  const palavras = normalizar([texto, ...extras].join(' ')).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2).slice(0, 40);
  if (!palavras.length) return [];
  const consulta = palavras.join(' | ');
  // savepoint: se a consulta falhar, não derruba o resto da transação
  await c.query('SAVEPOINT busca_conhecimento');
  const { rows } = await c.query(
    `SELECT id, titulo, conteudo, escopo, ts_rank_cd(busca, q) AS rank
       FROM conhecimento, to_tsquery('pt_sem_acento', $2) q
      WHERE status = 'aprovado' AND (escopo = 'rede' OR loja_id = $1) AND busca @@ q
      ORDER BY (escopo = 'loja') DESC, rank DESC
      LIMIT $3`,
    [lojaId, consulta.replace(/'/g, ''), limite * 2],
  ).catch(async () => { await c.query('ROLLBACK TO SAVEPOINT busca_conhecimento'); return { rows: [] }; });
  return rows.filter((r) => r.rank >= MIN_RANK).sort((a, b) => b.rank - a.rank).slice(0, limite);
}

// Divide um texto longo (colado ou extraído de PDF/Word) em blocos para revisar antes de salvar
export function dividirEmBlocos(texto) {
  const limpo = String(texto || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim();
  if (!limpo) return [];
  const partes = limpo.split(/\n\s*\n+/).map((p) => p.trim()).filter((p) => p.length > 1);
  const blocos = [];
  let atual = null;
  for (const p of partes) {
    const linhas = p.split('\n');
    const primeira = linhas[0].trim();
    const pareceTitulo = linhas.length === 1 && primeira.length <= 90 && !/[.!]$/.test(primeira);
    if (pareceTitulo) { if (atual) blocos.push(atual); atual = { titulo: primeira.replace(/^#+\s*/, '').replace(/:$/, ''), conteudo: '' }; continue; }
    if (!atual) atual = { titulo: primeira.slice(0, 80).replace(/[.:!?]+$/, ''), conteudo: '' };
    atual.conteudo += (atual.conteudo ? '\n\n' : '') + p;
    if (atual.conteudo.length > 1500) { blocos.push(atual); atual = null; }
  }
  if (atual) blocos.push(atual);
  return blocos.filter((b) => b.conteudo).map((b) => ({ titulo: b.titulo.slice(0, 200), conteudo: b.conteudo.slice(0, 6000) })).slice(0, 100);
}
