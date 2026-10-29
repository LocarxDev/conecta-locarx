// Etapa 6: relatórios da loja e da rede, acessos da rede (matriz/administração) e loja de demonstração.
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { comContexto, comoSistema, contextoDoUsuario } from '../banco/conexao.js';
import { novoToken, hashToken } from '../servicos/seguranca.js';
import { emailConvite } from '../servicos/email.js';
import { nomesDasFiliais } from '../servicos/locarx/filiais.js';
import { garantirFunil } from '../servicos/crm/funis.js';
import { rota, erro, validar, zEmail, zNome, zUuid, exigirPerfil, registrar, usuarioPublico } from '../http.js';

export const relatorioLoja = Router(); // /api/loja
export const relatorioRede = Router(); // /api/admin
const ctx = (req) => contextoDoUsuario(req.usuario);
const zDias = z.object({ dias: z.coerce.number().int().refine((d) => [7, 15, 30, 90].includes(d), 'Período inválido.').default(30) });

// Indicadores de UMA loja. Só números: nenhum conteúdo de conversa sai daqui.
// grupos mais reservados (reservas não canceladas no período); lojaId null = rede inteira
async function gruposMaisReservados(c, lojaId, dias, filial = null) {
  const rows = (await c.query(
    `SELECT coalesce(nullif(trim(grupo), ''), 'Sem grupo') AS grupo, count(*)::int AS n, coalesce(sum(valor), 0)::numeric AS valor
       FROM reservas WHERE ($1::uuid IS NULL OR loja_id = $1) AND status <> 'cancelada' AND criada_em >= now() - make_interval(days => $2) AND ($3::int IS NULL OR branch_id = $3)
      GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 10`, [lojaId, dias, filial])).rows;
  const total = rows.reduce((t, r) => t + r.n, 0);
  return rows.map((r) => ({ grupo: r.grupo, reservas: r.n, valor: Number(r.valor), pct: total ? Math.round((r.n / total) * 100) : 0 }));
}

async function indicadoresDaLoja(c, lojaId, dias, filial = null) {
  const i = (await c.query(`
    WITH cv AS (SELECT * FROM conversas WHERE loja_id = $1 AND ultima_do_cliente >= now() - make_interval(days => $2)),
         humanos AS (SELECT DISTINCT conversa_id FROM mensagens WHERE loja_id = $1 AND autor = 'atendente' AND direcao = 'saida' AND criada_em >= now() - make_interval(days => $2)),
         bot AS (SELECT DISTINCT conversa_id FROM mensagens WHERE loja_id = $1 AND autor = 'assistente' AND criada_em >= now() - make_interval(days => $2))
    SELECT (SELECT count(*) FROM cv) AS conversas,
           (SELECT count(*) FROM cv WHERE id IN (SELECT conversa_id FROM bot) AND id NOT IN (SELECT conversa_id FROM humanos)) AS so_assistente,
           (SELECT count(*) FROM cv WHERE id IN (SELECT conversa_id FROM humanos)) AS com_equipe,
           (SELECT count(*) FROM contatos WHERE loja_id = $1 AND criado_em >= now() - make_interval(days => $2)) AS clientes_novos,
           (SELECT count(*) FROM oportunidades WHERE loja_id = $1 AND criada_em >= now() - make_interval(days => $2)) AS oportunidades,
           (SELECT count(*) FROM oportunidades WHERE loja_id = $1 AND criada_em >= now() - make_interval(days => $2) AND cotou_em IS NOT NULL) AS cotacoes,
           (SELECT count(*) FROM reservas WHERE loja_id = $1 AND criada_em >= now() - make_interval(days => $2) AND status <> 'cancelada' AND ($3::int IS NULL OR branch_id = $3)) AS reservas,
           (SELECT coalesce(sum(valor), 0) FROM reservas WHERE loja_id = $1 AND criada_em >= now() - make_interval(days => $2) AND status <> 'cancelada' AND ($3::int IS NULL OR branch_id = $3)) AS valor,
           (SELECT count(*) FROM reservas WHERE loja_id = $1 AND criada_em >= now() - make_interval(days => $2) AND status <> 'cancelada' AND origem = 'assistente' AND ($3::int IS NULL OR branch_id = $3)) AS reservas_assistente,
           (SELECT coalesce(sum(valor), 0) FROM reservas WHERE loja_id = $1 AND criada_em >= now() - make_interval(days => $2) AND status <> 'cancelada' AND origem = 'assistente' AND ($3::int IS NULL OR branch_id = $3)) AS valor_assistente,
           (SELECT count(*) FROM uso_ia WHERE loja_id = $1 AND criado_em >= now() - make_interval(days => $2)) AS respostas_ia,
           (SELECT coalesce(sum(tokens_in + tokens_out), 0) FROM uso_ia WHERE loja_id = $1 AND criado_em >= now() - make_interval(days => $2)) AS tokens_ia`, [lojaId, dias, filial])).rows[0];
  // tempo da 1ª resposta da equipe: da mensagem do cliente que ficou esperando até a resposta humana seguinte
  const tempo = (await c.query(`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY espera) AS mediana, avg(espera) AS media FROM (
      SELECT extract(epoch FROM (min(h.criada_em) - e.criada_em)) / 60 AS espera
        FROM mensagens e
        JOIN LATERAL (SELECT criada_em FROM mensagens h WHERE h.conversa_id = e.conversa_id AND h.autor = 'atendente' AND h.direcao = 'saida' AND h.criada_em > e.criada_em ORDER BY h.criada_em LIMIT 1) h ON true
       WHERE e.loja_id = $1 AND e.direcao = 'entrada' AND e.criada_em >= now() - make_interval(days => $2)
         AND NOT EXISTS (SELECT 1 FROM mensagens p WHERE p.conversa_id = e.conversa_id AND p.direcao = 'saida' AND p.criada_em BETWEEN e.criada_em - interval '1 hour' AND e.criada_em)
       GROUP BY e.id, e.criada_em) x WHERE espera < 1440`, [lojaId, dias])).rows[0];
  return {
    conversas: Number(i.conversas), soAssistente: Number(i.so_assistente), comEquipe: Number(i.com_equipe), clientesNovos: Number(i.clientes_novos),
    oportunidades: Number(i.oportunidades), cotacoes: Number(i.cotacoes), reservas: Number(i.reservas), valor: Number(i.valor),
    reservasAssistente: Number(i.reservas_assistente), valorAssistente: Number(i.valor_assistente), respostasIa: Number(i.respostas_ia), tokensIa: Number(i.tokens_ia),
    respostaMedianaMin: tempo?.mediana != null ? Math.round(Number(tempo.mediana)) : null,
  };
}

relatorioLoja.get('/relatorio', exigirPerfil('dono'), rota(async (req, res) => {
  const { dias, filial } = validar(zDias.extend({ filial: z.coerce.number().int().positive().optional() }), req.query);
  const lojaId = req.usuario.loja_id;
  const r = await comContexto(ctx(req), async (c) => ({
    ind: await indicadoresDaLoja(c, lojaId, dias, filial || null),
    porDia: (await c.query(`SELECT to_char(d, 'YYYY-MM-DD') AS dia,
        (SELECT count(*) FROM conversas WHERE loja_id = $1 AND ultima_do_cliente::date = d::date) AS conversas,
        (SELECT count(*) FROM reservas WHERE loja_id = $1 AND criada_em::date = d::date AND status <> 'cancelada' AND ($3::int IS NULL OR branch_id = $3)) AS reservas
      FROM generate_series((now() AT TIME ZONE 'America/Bahia')::date - ($2 - 1), (now() AT TIME ZONE 'America/Bahia')::date, interval '1 day') d`, [lojaId, dias, filial || null])).rows,
    perdas: (await c.query(`SELECT motivo_perda AS motivo, count(*)::int AS n FROM oportunidades WHERE loja_id = $1 AND resultado = 'perdido' AND fechada_em >= now() - make_interval(days => $2) GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, [lojaId, dias])).rows,
    semResposta: (await c.query(`SELECT pergunta, criada_em FROM perguntas_sem_resposta WHERE loja_id = $1 AND criada_em >= now() - make_interval(days => $2) ORDER BY criada_em DESC LIMIT 10`, [lojaId, dias])).rows,
    grupos: await gruposMaisReservados(c, lojaId, dias, filial || null),
    equipe: (await c.query(`SELECT u.nome, count(DISTINCT m.conversa_id)::int AS conversas, count(*)::int AS mensagens
        FROM mensagens m JOIN usuarios u ON u.id = m.autor_id WHERE m.loja_id = $1 AND m.autor = 'atendente' AND m.direcao = 'saida' AND m.criada_em >= now() - make_interval(days => $2)
       GROUP BY u.nome ORDER BY 2 DESC LIMIT 20`, [lojaId, dias])).rows,
  }));
  res.json({ dias, filial: filial || null, ...r.ind, porDia: r.porDia.map((d) => ({ dia: d.dia, conversas: Number(d.conversas), reservas: Number(d.reservas) })), perdas: r.perdas, semResposta: r.semResposta, equipe: r.equipe, grupos: r.grupos });
}));

// ---------- Central de Reservas: produtividade (por loja de destino e por atendente) ----------
// Só a loja marcada como Central tem estes números. `destino` filtra por uma loja (uuid) ou por 'fora' (filial que não é loja do Conecta).
relatorioLoja.get('/relatorio/central', exigirPerfil('dono'), rota(async (req, res) => {
  const q = validar(zDias.extend({ destino: z.union([zUuid, z.literal('fora')]).optional() }), req.query);
  const lojaId = req.usuario.loja_id;
  const filtroDestino = q.destino === 'fora' ? 'AND r.loja_destino_id IS NULL' : q.destino ? 'AND r.loja_destino_id = $3::uuid' : '';
  const params = q.destino && q.destino !== 'fora' ? [lojaId, q.dias, q.destino] : [lojaId, q.dias];
  const base = `FROM reservas r WHERE r.loja_id = $1 AND r.status <> 'cancelada' AND r.criada_em >= now() - make_interval(days => $2) ${filtroDestino}`;
  const out = await comContexto(ctx(req), async (c) => {
    const eh = (await c.query('SELECT central FROM lojas WHERE id = $1', [lojaId])).rows[0]?.central;
    if (!eh) return null;
    const tot = (await c.query(`SELECT count(*)::int AS reservas, coalesce(sum(r.valor), 0)::numeric AS valor, count(*) FILTER (WHERE r.origem = 'assistente')::int AS pela_lia ${base}`, params)).rows[0];
    const destinos = (await c.query(`SELECT r.loja_destino_id AS id, r.branch_id, count(*)::int AS reservas, coalesce(sum(r.valor), 0)::numeric AS valor
        FROM reservas r WHERE r.loja_id = $1 AND r.status <> 'cancelada' AND r.criada_em >= now() - make_interval(days => $2) GROUP BY 1, 2`, [lojaId, q.dias])).rows;
    const atendentes = (await c.query(`SELECT coalesce(u.nome, CASE WHEN r.origem = 'assistente' AND cv.atendente_id IS NULL THEN 'Assistente (Lia), sem atendente' ELSE 'Sem atendente registrado' END) AS nome,
           count(*)::int AS reservas, coalesce(sum(r.valor), 0)::numeric AS valor, count(*) FILTER (WHERE r.origem = 'assistente')::int AS pela_lia
        FROM reservas r LEFT JOIN conversas cv ON cv.id = r.conversa_id
        LEFT JOIN usuarios u ON u.id = coalesce(nullif(r.detalhes->>'porUsuarioId', '')::uuid, cv.atendente_id)
       WHERE r.loja_id = $1 AND r.status <> 'cancelada' AND r.criada_em >= now() - make_interval(days => $2) ${filtroDestino}
       GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 30`, params)).rows;
    const nomesFiliais = await nomesDasFiliais(c, lojaId);
    return { tot, destinos, atendentes, nomesFiliais };
  });
  if (!out) throw erro(404, 'Esta loja não é a Central de Reservas.');
  const nomes = new Map((await comoSistema((c) => c.query('SELECT id, nome FROM lojas WHERE id = ANY($1::uuid[])', [out.destinos.map((d) => d.id).filter(Boolean)]))).rows.map((l) => [l.id, l.nome]));
  // por loja de destino: lojas do Conecta agrupadas; filiais que não são loja do Conecta aparecem em um grupo só
  const porLoja = new Map(); let fora = { reservas: 0, valor: 0 };
  for (const d of out.destinos) {
    if (d.id) { const a = porLoja.get(d.id) || { id: d.id, nome: nomes.get(d.id) || 'Loja', reservas: 0, valor: 0 }; a.reservas += d.reservas; a.valor += Number(d.valor); porLoja.set(d.id, a); }
    else { fora.reservas += d.reservas; fora.valor += Number(d.valor); }
  }
  res.json({
    dias: q.dias, destino: q.destino || null,
    totais: { reservas: out.tot.reservas, valor: Number(out.tot.valor), pelaLia: out.tot.pela_lia },
    porDestino: [...porLoja.values()].sort((a, b) => b.reservas - a.reservas || b.valor - a.valor),
    foraDoConecta: fora,
    porAtendente: out.atendentes.map((a) => ({ nome: a.nome, reservas: a.reservas, valor: Number(a.valor), pelaLia: a.pela_lia })),
  });
}));

// ---------- rede ----------
relatorioRede.get('/relatorio', exigirPerfil('admin', 'matriz'), rota(async (req, res) => {
  const { dias } = validar(zDias, req.query);
  // números agregados por loja (contexto do sistema só para contar; nenhum texto de conversa é lido)
  const lojas = await comoSistema(async (c) => {
    const ls = (await c.query(`SELECT l.id, l.nome, l.cidade, l.uf, l.ativa, l.whatsapp, coalesce(a.ativo, false) AS assistente FROM lojas l LEFT JOIN assistentes a ON a.loja_id = l.id ORDER BY l.nome`)).rows;
    const saida = [];
    for (const l of ls) saida.push({ ...l, ...(await indicadoresDaLoja(c, l.id, dias)) });
    return saida;
  });
  const grupos = await comoSistema((c) => gruposMaisReservados(c, null, dias));
  await comContexto(ctx(req), (c) => registrar(c, req, 'viu_relatorio_rede', { detalhes: { dias } }));
  const total = lojas.reduce((t, l) => ({ conversas: t.conversas + l.conversas, reservas: t.reservas + l.reservas, valor: t.valor + l.valor, reservasAssistente: t.reservasAssistente + l.reservasAssistente }), { conversas: 0, reservas: 0, valor: 0, reservasAssistente: 0 });
  res.json({ dias, total, grupos, lojas: lojas.map((l) => ({ id: l.id, nome: l.nome, cidade: l.cidade, uf: l.uf, ativa: l.ativa, whatsapp: l.whatsapp, assistente: l.assistente, conversas: l.conversas, reservas: l.reservas, valor: l.valor, reservasAssistente: l.reservasAssistente, conversao: l.conversas ? Math.round((l.reservas / l.conversas) * 1000) / 10 : 0, respostaMedianaMin: l.respostaMedianaMin })) });
}));

// ---------- acessos da rede (matriz e administração) ----------
relatorioRede.get('/usuarios', exigirPerfil('admin'), rota(async (req, res) => {
  const rows = await comContexto(ctx(req), async (c) => (await c.query(`SELECT * FROM usuarios WHERE perfil IN ('admin', 'matriz') ORDER BY perfil, nome`)).rows);
  res.json(rows.map(usuarioPublico));
}));

relatorioRede.post('/usuarios', exigirPerfil('admin'), rota(async (req, res) => {
  const d = validar(z.object({ nome: zNome, email: zEmail, perfil: z.enum(['matriz', 'admin']) }), req.body);
  const r = await comContexto(ctx(req), async (c) => {
    if ((await c.query('SELECT 1 FROM usuarios WHERE email = $1', [d.email])).rowCount) throw erro(422, 'Confira os campos.', { email: 'Já existe um acesso com este e-mail.' });
    const u = (await c.query(`INSERT INTO usuarios (nome, email, perfil, status) VALUES ($1, $2, $3, 'convidado') RETURNING *`, [d.nome, d.email, d.perfil])).rows[0];
    const token = novoToken();
    await c.query(`INSERT INTO tokens_senha (usuario_id, token_hash, tipo, expira_em) VALUES ($1, $2, 'convite', now() + interval '72 hours')`, [u.id, hashToken(token)]);
    await registrar(c, req, 'convidou_rede', { alvo: u.id, detalhes: { email: d.email, perfil: d.perfil } });
    return { u, link: `${config.appUrl}/#/definir-senha?token=${token}` };
  });
  const enviado = await emailConvite({ para: r.u.email, nome: r.u.nome, link: r.link }).catch(() => false);
  res.status(201).json({ ...usuarioPublico(r.u), linkConvite: r.link, emailEnviado: enviado });
}));

relatorioRede.patch('/usuarios/:id', exigirPerfil('admin'), rota(async (req, res) => {
  if (!zUuid.safeParse(req.params.id).success) throw erro(404, 'Acesso não encontrado.');
  // status (ativar/desativar) e/ou perfil (nível: administração ou matriz)
  const { status, perfil } = validar(z.object({ status: z.enum(['ativo', 'inativo']).optional(), perfil: z.enum(['admin', 'matriz']).optional() }), req.body);
  if (req.params.id === req.usuario.id) throw erro(400, 'Você não pode alterar o seu próprio acesso.');
  const u = await comContexto(ctx(req), async (c) => {
    const alvo = (await c.query(`SELECT * FROM usuarios WHERE id = $1 AND perfil IN ('admin', 'matriz')`, [req.params.id])).rows[0];
    if (!alvo) throw erro(404, 'Acesso não encontrado.');
    if (status && alvo.status === 'convidado') throw erro(400, 'Esta pessoa ainda não aceitou o convite.');
    const ultimoAdmin = async () => alvo.perfil === 'admin' && Number((await c.query(`SELECT count(*) FROM usuarios WHERE perfil = 'admin' AND status = 'ativo'`)).rows[0].count) <= 1;
    if ((status === 'inativo' || (perfil && perfil !== 'admin')) && alvo.status === 'ativo' && await ultimoAdmin()) throw erro(400, 'É preciso ter pelo menos um administrador ativo.');
    const r = (await c.query('UPDATE usuarios SET status = coalesce($2, status), perfil = coalesce($3, perfil) WHERE id = $1 RETURNING *', [alvo.id, status ?? null, perfil ?? null])).rows[0];
    if (status === 'inativo' || (perfil && perfil !== alvo.perfil)) await c.query('DELETE FROM sessoes WHERE usuario_id = $1', [alvo.id]);
    if (status) await registrar(c, req, status === 'inativo' ? 'desativou_rede' : 'reativou_rede', { alvo: alvo.id });
    if (perfil && perfil !== alvo.perfil) await registrar(c, req, 'alterou_nivel_rede', { alvo: alvo.id, detalhes: { de: alvo.perfil, para: perfil } });
    return r;
  });
  res.json(usuarioPublico(u));
}));

// ---------- loja de demonstração (dados fictícios para apresentar o sistema) ----------
const DEMO_BRANCH = 999999;
relatorioRede.post('/demonstracao', exigirPerfil('admin'), rota(async (req, res) => {
  const r = await comoSistema(async (c) => {
    if ((await c.query('SELECT 1 FROM lojas WHERE branch_id = $1', [DEMO_BRANCH])).rowCount) throw erro(409, 'A loja de demonstração já existe.');
    const loja = (await c.query(`INSERT INTO lojas (nome, cidade, uf, branch_id, branch_code, tipo, whatsapp) VALUES ('LocarX Demonstração', 'Salvador', 'BA', $1, 'DEMO', 'Aeroporto', 'conectado') RETURNING *`, [DEMO_BRANCH])).rows[0];
    await c.query(`INSERT INTO canais (loja_id, provedor, instancia, status, numero) VALUES ($1, 'evolution', $2, 'conectado', '5571900000000')`, [loja.id, `demo-${loja.id}`]);
    await c.query(`INSERT INTO assistentes (loja_id, ativo, nome, boas_vindas) VALUES ($1, false, 'Lia', 'Olá! Eu sou a Lia, assistente da LocarX.')`, [loja.id]);
    const clientes = [['Ana Paula Souza', '5571988880001', 'reserva', 380], ['Bruno Lima', '5571988880002', 'cotacao', 290], ['Carla Dias', '5571988880003', 'novo', null], ['Diego Alves', '5571988880004', 'perdido', 450], ['Elaine Rocha', '5571988880005', 'concluido', 520], ['Fábio Nunes', '5575988880006', 'cotacao', 610]];
    const funilId = await garantirFunil(c, loja.id);
    let i = 0;
    for (const [nome, tel, etapa, valor] of clientes) {
      i++;
      const k = (await c.query(`INSERT INTO contatos (loja_id, telefone, nome, optin_em, criado_em) VALUES ($1, $2, $3, now(), now() - make_interval(days => $4)) RETURNING id`,
        [loja.id, tel, nome, i * 2])).rows[0];
      await c.query(`INSERT INTO contato_etiquetas (contato_id, etiqueta_id, loja_id, pelo_assistente) SELECT $1, id, $2, true FROM etiquetas WHERE loja_id IS NULL AND nome = $3`,
        [k.id, loja.id, i % 2 ? 'Turismo' : 'Empresa']);
      await c.query(`INSERT INTO valores_campos (contato_id, campo_id, loja_id, valor, pelo_assistente) SELECT $1, id, $2, $3, true FROM campos_personalizados WHERE loja_id IS NULL AND chave = 'carro_desejado'`,
        [k.id, loja.id, i % 2 ? 'SUV' : 'Compacto']);
      const cv = (await c.query(`INSERT INTO conversas (loja_id, contato_id, estado, ultima_previa, ultima_mensagem_em, ultima_do_cliente, nao_lidas) VALUES ($1, $2, $3, $4, now() - make_interval(hours => $5), now() - make_interval(hours => $5), $6) RETURNING id`,
        [loja.id, k.id, etapa === 'novo' ? 'aguardando' : etapa === 'cotacao' ? 'assistente' : 'encerrada', 'Gostaria de alugar um carro', i * 3, etapa === 'novo' ? 1 : 0])).rows[0];
      await c.query(`INSERT INTO mensagens (conversa_id, loja_id, direcao, autor, tipo, texto, criada_em) VALUES
        ($1, $2, 'entrada', 'cliente', 'texto', 'Boa tarde! Gostaria de alugar um carro para o fim de semana.', now() - make_interval(hours => $3) - interval '10 minutes'),
        ($1, $2, 'saida', 'assistente', 'texto', 'Olá! Eu sou a Lia, assistente da LocarX. Para quais datas e horários você precisa do carro?', now() - make_interval(hours => $3) - interval '9 minutes')`, [cv.id, loja.id, i * 3]);
      let reservaId = null;
      if (['reserva', 'concluido'].includes(etapa)) {
        reservaId = (await c.query(`INSERT INTO reservas (loja_id, contato_id, conversa_id, codigo, status, retirada, devolucao, grupo, valor, origem)
          VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6), now() + make_interval(days => $6 + 3), 'C - COMPACTO ESPECIAL', $7, 'assistente') RETURNING id`,
          [loja.id, k.id, cv.id, 'DEMO' + (1000 + i), etapa === 'concluido' ? 'concluida' : 'confirmada', etapa === 'concluido' ? -6 : 2, valor])).rows[0].id;
      }
      const e = (await c.query(`SELECT id, tipo FROM etapas_funil WHERE funil_id = $1 AND CASE $2::text WHEN 'concluido' THEN tipo = 'ganho' WHEN 'perdido' THEN tipo = 'perdido'
          WHEN 'novo' THEN tipo = 'aberta' ELSE evento = $2::text END ORDER BY ordem LIMIT 1`, [funilId, etapa])).rows[0];
      await c.query(`INSERT INTO oportunidades (loja_id, contato_id, conversa_id, reserva_id, funil_id, etapa_id, resultado, valor_previsto, motivo_perda, fechada_em, cotou_em, reservou_em)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $7::text IS NOT NULL THEN now() END, CASE WHEN $10 THEN now() END, CASE WHEN $4::uuid IS NOT NULL THEN now() END)`,
        [loja.id, k.id, cv.id, reservaId, funilId, e.id, e.tipo === 'aberta' ? null : e.tipo, valor, etapa === 'perdido' ? 'Preço acima do esperado' : null, etapa !== 'novo']);
    }
    await c.query(`INSERT INTO tarefas (loja_id, titulo, vence_em, automatica) VALUES ($1, 'Retomar cotação de Bruno Lima', now(), true), ($1, 'Ligar para confirmar retirada da Ana Paula', now() + interval '1 day', false)`, [loja.id]);
    await c.query(`INSERT INTO conhecimento (escopo, loja_id, titulo, conteudo, status) VALUES ('loja', $1, 'Caução', 'A caução é bloqueada no cartão de crédito do condutor na retirada e liberada após a devolução.', 'aprovado')`, [loja.id]);
    await c.query(`INSERT INTO auditoria (usuario_id, acao, alvo) VALUES ($1, 'criou_demonstracao', $2)`, [req.usuario.id, loja.id]);
    return loja;
  });
  res.status(201).json({ id: r.id, nome: r.nome });
}));

relatorioRede.delete('/demonstracao', exigirPerfil('admin'), rota(async (req, res) => {
  await comoSistema(async (c) => {
    const l = (await c.query('SELECT id FROM lojas WHERE branch_id = $1', [DEMO_BRANCH])).rows[0];
    if (!l) return;
    await c.query('DELETE FROM oportunidades WHERE loja_id = $1', [l.id]);
    await c.query('DELETE FROM usuarios WHERE loja_id = $1', [l.id]);
    await c.query('DELETE FROM lojas WHERE id = $1', [l.id]);
    await c.query(`INSERT INTO auditoria (usuario_id, acao, alvo) VALUES ($1, 'removeu_demonstracao', $2)`, [req.usuario.id, l.id]);
  });
  res.status(204).end();
}));
