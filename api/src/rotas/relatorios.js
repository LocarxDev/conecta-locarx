// Etapa 6: relatórios da loja e da rede, acessos da rede (matriz/administração) e loja de demonstração.
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { comContexto, comoSistema, contextoDoUsuario } from '../banco/conexao.js';
import { novoToken, hashToken } from '../servicos/seguranca.js';
import { emailConvite } from '../servicos/email.js';
import { rota, erro, validar, zEmail, zNome, zUuid, exigirPerfil, registrar, usuarioPublico } from '../http.js';

export const relatorioLoja = Router(); // /api/loja
export const relatorioRede = Router(); // /api/admin
const ctx = (req) => contextoDoUsuario(req.usuario);
const zDias = z.object({ dias: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d), 'Período inválido.').default(30) });

// Indicadores de UMA loja. Só números: nenhum conteúdo de conversa sai daqui.
async function indicadoresDaLoja(c, lojaId, dias) {
  const i = (await c.query(`
    WITH cv AS (SELECT * FROM conversas WHERE loja_id = $1 AND ultima_do_cliente >= now() - make_interval(days => $2)),
         humanos AS (SELECT DISTINCT conversa_id FROM mensagens WHERE loja_id = $1 AND autor = 'atendente' AND direcao = 'saida' AND criada_em >= now() - make_interval(days => $2)),
         bot AS (SELECT DISTINCT conversa_id FROM mensagens WHERE loja_id = $1 AND autor = 'assistente' AND criada_em >= now() - make_interval(days => $2))
    SELECT (SELECT count(*) FROM cv) AS conversas,
           (SELECT count(*) FROM cv WHERE id IN (SELECT conversa_id FROM bot) AND id NOT IN (SELECT conversa_id FROM humanos)) AS so_assistente,
           (SELECT count(*) FROM cv WHERE id IN (SELECT conversa_id FROM humanos)) AS com_equipe,
           (SELECT count(*) FROM contatos WHERE loja_id = $1 AND criado_em >= now() - make_interval(days => $2)) AS clientes_novos,
           (SELECT count(*) FROM oportunidades WHERE loja_id = $1 AND criada_em >= now() - make_interval(days => $2)) AS oportunidades,
           (SELECT count(*) FROM oportunidades WHERE loja_id = $1 AND criada_em >= now() - make_interval(days => $2) AND etapa <> 'novo') AS cotacoes,
           (SELECT count(*) FROM reservas WHERE loja_id = $1 AND criada_em >= now() - make_interval(days => $2) AND status <> 'cancelada') AS reservas,
           (SELECT coalesce(sum(valor), 0) FROM reservas WHERE loja_id = $1 AND criada_em >= now() - make_interval(days => $2) AND status <> 'cancelada') AS valor,
           (SELECT count(*) FROM reservas WHERE loja_id = $1 AND criada_em >= now() - make_interval(days => $2) AND status <> 'cancelada' AND origem = 'assistente') AS reservas_assistente,
           (SELECT coalesce(sum(valor), 0) FROM reservas WHERE loja_id = $1 AND criada_em >= now() - make_interval(days => $2) AND status <> 'cancelada' AND origem = 'assistente') AS valor_assistente,
           (SELECT count(*) FROM uso_ia WHERE loja_id = $1 AND criado_em >= now() - make_interval(days => $2)) AS respostas_ia,
           (SELECT coalesce(sum(tokens_in + tokens_out), 0) FROM uso_ia WHERE loja_id = $1 AND criado_em >= now() - make_interval(days => $2)) AS tokens_ia`, [lojaId, dias])).rows[0];
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
  const { dias } = validar(zDias, req.query);
  const lojaId = req.usuario.loja_id;
  const r = await comContexto(ctx(req), async (c) => ({
    ind: await indicadoresDaLoja(c, lojaId, dias),
    porDia: (await c.query(`SELECT to_char(d, 'YYYY-MM-DD') AS dia,
        (SELECT count(*) FROM conversas WHERE loja_id = $1 AND ultima_do_cliente::date = d::date) AS conversas,
        (SELECT count(*) FROM reservas WHERE loja_id = $1 AND criada_em::date = d::date AND status <> 'cancelada') AS reservas
      FROM generate_series((now() AT TIME ZONE 'America/Bahia')::date - ($2 - 1), (now() AT TIME ZONE 'America/Bahia')::date, interval '1 day') d`, [lojaId, dias])).rows,
    perdas: (await c.query(`SELECT motivo_perda AS motivo, count(*)::int AS n FROM oportunidades WHERE loja_id = $1 AND etapa = 'perdido' AND fechada_em >= now() - make_interval(days => $2) GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, [lojaId, dias])).rows,
    semResposta: (await c.query(`SELECT pergunta, criada_em FROM perguntas_sem_resposta WHERE loja_id = $1 AND criada_em >= now() - make_interval(days => $2) ORDER BY criada_em DESC LIMIT 10`, [lojaId, dias])).rows,
    equipe: (await c.query(`SELECT u.nome, count(DISTINCT m.conversa_id)::int AS conversas, count(*)::int AS mensagens
        FROM mensagens m JOIN usuarios u ON u.id = m.autor_id WHERE m.loja_id = $1 AND m.autor = 'atendente' AND m.direcao = 'saida' AND m.criada_em >= now() - make_interval(days => $2)
       GROUP BY u.nome ORDER BY 2 DESC LIMIT 20`, [lojaId, dias])).rows,
  }));
  res.json({ dias, ...r.ind, porDia: r.porDia.map((d) => ({ dia: d.dia, conversas: Number(d.conversas), reservas: Number(d.reservas) })), perdas: r.perdas, semResposta: r.semResposta, equipe: r.equipe });
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
  await comContexto(ctx(req), (c) => registrar(c, req, 'viu_relatorio_rede', { detalhes: { dias } }));
  const total = lojas.reduce((t, l) => ({ conversas: t.conversas + l.conversas, reservas: t.reservas + l.reservas, valor: t.valor + l.valor, reservasAssistente: t.reservasAssistente + l.reservasAssistente }), { conversas: 0, reservas: 0, valor: 0, reservasAssistente: 0 });
  res.json({ dias, total, lojas: lojas.map((l) => ({ id: l.id, nome: l.nome, cidade: l.cidade, uf: l.uf, ativa: l.ativa, whatsapp: l.whatsapp, assistente: l.assistente, conversas: l.conversas, reservas: l.reservas, valor: l.valor, reservasAssistente: l.reservasAssistente, conversao: l.conversas ? Math.round((l.reservas / l.conversas) * 1000) / 10 : 0, respostaMedianaMin: l.respostaMedianaMin })) });
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
  const { status } = validar(z.object({ status: z.enum(['ativo', 'inativo']) }), req.body);
  if (req.params.id === req.usuario.id) throw erro(400, 'Você não pode desativar o seu próprio acesso.');
  const u = await comContexto(ctx(req), async (c) => {
    const alvo = (await c.query(`SELECT * FROM usuarios WHERE id = $1 AND perfil IN ('admin', 'matriz')`, [req.params.id])).rows[0];
    if (!alvo) throw erro(404, 'Acesso não encontrado.');
    if (alvo.status === 'convidado') throw erro(400, 'Esta pessoa ainda não aceitou o convite.');
    if (status === 'inativo' && alvo.perfil === 'admin' && Number((await c.query(`SELECT count(*) FROM usuarios WHERE perfil = 'admin' AND status = 'ativo'`)).rows[0].count) <= 1) throw erro(400, 'É preciso ter pelo menos um administrador ativo.');
    const r = (await c.query('UPDATE usuarios SET status = $2 WHERE id = $1 RETURNING *', [alvo.id, status])).rows[0];
    if (status === 'inativo') await c.query('DELETE FROM sessoes WHERE usuario_id = $1', [alvo.id]);
    await registrar(c, req, status === 'inativo' ? 'desativou_rede' : 'reativou_rede', { alvo: alvo.id });
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
    let i = 0;
    for (const [nome, tel, etapa, valor] of clientes) {
      i++;
      const k = (await c.query(`INSERT INTO contatos (loja_id, telefone, nome, etiquetas, optin_em, criado_em) VALUES ($1, $2, $3, $4, now(), now() - make_interval(days => $5)) RETURNING id`,
        [loja.id, tel, nome, i % 2 ? ['aeroporto'] : ['recorrente'], i * 2])).rows[0];
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
      await c.query(`INSERT INTO oportunidades (loja_id, contato_id, conversa_id, reserva_id, etapa, valor_previsto, motivo_perda, fechada_em) VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $5 IN ('concluido', 'perdido') THEN now() END)`,
        [loja.id, k.id, cv.id, reservaId, etapa, valor, etapa === 'perdido' ? 'Preço acima do esperado' : null]);
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
    await c.query('DELETE FROM usuarios WHERE loja_id = $1', [l.id]);
    await c.query('DELETE FROM lojas WHERE id = $1', [l.id]);
    await c.query(`INSERT INTO auditoria (usuario_id, acao, alvo) VALUES ($1, 'removeu_demonstracao', $2)`, [req.usuario.id, l.id]);
  });
  res.status(204).end();
}));
