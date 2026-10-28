// Etapa 7: personalização do CRM.
// - Funis: a rede monta o padrão (administração/matriz); cada dono cria e muda os da própria loja.
// - Etiquetas e campos personalizados: os da rede valem para todas as lojas; cada loja pode ter os seus.
// - Painel do cliente na conversa (campos, etiquetas, funil) e roleta de atendimento.
import { Router } from 'express';
import { z } from 'zod';
import { comContexto, comoSistema, contextoDoUsuario } from '../banco/conexao.js';
import { rota, erro, validar, zUuid, exigirPerfil, registrar } from '../http.js';
import { garantirModelos } from '../servicos/crm/modelos.js';
import { zFunil, ETAPAS_NOVO_FUNIL, garantirFunil, listarFunis, salvarFunil, arquivarFunil, propagarPadrao, etapaPublica, zRegrasFunil, regrasDaLoja } from '../servicos/crm/funis.js';
import {
  zEtiqueta, zCampo, etiquetaPublica, campoPublico, listarEtiquetas, listarCampos, chaveDoNome,
  salvarValores, definirEtiquetas, dadosDoPainel,
} from '../servicos/crm/personalizacao.js';
import { MODOS, configDaRoleta, distribuirPendentes } from '../servicos/crm/roleta.js';

export const personalizacaoLoja = Router(); // /api/crm
export const personalizacaoRede = Router(); // /api/admin
const ctx = (req) => contextoDoUsuario(req.usuario);
const id = (v, msg = 'Não encontrado.') => { if (!zUuid.safeParse(v).success) throw erro(404, msg); return v; };
const daEquipe = exigirPerfil('dono', 'atendente');
const dono = exigirPerfil('dono');
const rede = exigirPerfil('admin', 'matriz');
const unico = (msg) => (e) => { if (e.code === '23505') throw erro(422, msg); throw e; };

// =====================================================================
// FUNIS
// =====================================================================
personalizacaoLoja.get('/funis', daEquipe, rota(async (req, res) => {
  const lista = await comContexto(ctx(req), async (c) => { await garantirFunil(c, req.usuario.loja_id); return listarFunis(c, req.usuario.loja_id); });
  res.json(lista);
}));

// regras automáticas (perdido / concluído)
personalizacaoLoja.get('/funis/regras', daEquipe, rota(async (req, res) => {
  res.json(await comContexto(ctx(req), (c) => regrasDaLoja(c, req.usuario.loja_id)));
}));
personalizacaoLoja.put('/funis/regras', dono, rota(async (req, res) => {
  const d = validar(zRegrasFunil, req.body);
  const r = await comContexto(ctx(req), async (c) => {
    await c.query('UPDATE lojas SET regras_funil = $2 WHERE id = $1', [req.usuario.loja_id, d]);
    await registrar(c, req, 'editou_regras_funil', { detalhes: d });
    return regrasDaLoja(c, req.usuario.loja_id);
  });
  res.json(r);
}));

personalizacaoLoja.post('/funis', dono, rota(async (req, res) => {
  const d = validar(zFunil, { etapas: ETAPAS_NOVO_FUNIL, ...req.body });
  const novo = await comContexto(ctx(req), async (c) => {
    await garantirFunil(c, req.usuario.loja_id);
    await garantirModelos(c, req.usuario.loja_id);
    const fid = await salvarFunil(c, req.usuario.loja_id, null, d);
    await registrar(c, req, 'criou_funil', { alvo: fid });
    return (await listarFunis(c, req.usuario.loja_id)).find((f) => f.id === fid);
  });
  res.status(201).json(novo);
}));

personalizacaoLoja.put('/funis/:id', dono, rota(async (req, res) => {
  const fid = id(req.params.id, 'Funil não encontrado.');
  const d = validar(zFunil, req.body);
  const f = await comContexto(ctx(req), async (c) => {
    await garantirModelos(c, req.usuario.loja_id);
    await salvarFunil(c, req.usuario.loja_id, fid, d);
    await registrar(c, req, 'editou_funil', { alvo: fid });
    return (await listarFunis(c, req.usuario.loja_id)).find((x) => x.id === fid);
  });
  res.json(f);
}));

personalizacaoLoja.delete('/funis/:id', dono, rota(async (req, res) => {
  const fid = id(req.params.id, 'Funil não encontrado.');
  await comContexto(ctx(req), async (c) => { await arquivarFunil(c, req.usuario.loja_id, fid); await registrar(c, req, 'arquivou_funil', { alvo: fid }); });
  res.status(204).end();
}));

// funil padrão da rede: uma loja nova recebe uma cópia; lojas que ainda não personalizaram acompanham as mudanças
personalizacaoRede.get('/funil-padrao', rede, rota(async (req, res) => {
  const funil = await comContexto(ctx(req), async (c) => (await listarFunis(c, null))[0] || null);
  // só contagens (a administração não lê os funis das lojas diretamente)
  const lojas = await comoSistema(async (c) => (await c.query(
    `SELECT count(*) FILTER (WHERE NOT f.personalizado)::int AS acompanham, count(*) FILTER (WHERE f.personalizado)::int AS personalizaram
       FROM funis f WHERE f.loja_id IS NOT NULL AND f.principal`)).rows[0]);
  res.json({ funil, lojas });
}));

personalizacaoRede.put('/funil-padrao', rede, rota(async (req, res) => {
  const d = validar(zFunil, req.body);
  const r = await comContexto(ctx(req), async (c) => {
    const atual = (await listarFunis(c, null))[0];
    const fid = await salvarFunil(c, null, atual?.id || null, { ...d, principal: true }, { marcarPersonalizado: false });
    if (!atual) await c.query('UPDATE funis SET principal = true WHERE id = $1', [fid]);
    await registrar(c, req, 'editou_funil_padrao', { alvo: fid });
    return { fid };
  });
  // leva às lojas que não personalizaram (precisa enxergar os funis de todas as lojas)
  const lojasAtualizadas = await comoSistema((c) => propagarPadrao(c, r.fid));
  const funil = await comContexto(ctx(req), async (c) => (await listarFunis(c, null))[0]);
  res.json({ funil, lojasAtualizadas });
}));

// =====================================================================
// ETIQUETAS (rede e loja)
// =====================================================================
function rotasEtiquetas(router, { escopo }) {
  const lojaDe = (req) => (escopo === 'loja' ? req.usuario.loja_id : null);
  const podeVer = escopo === 'loja' ? daEquipe : rede;
  const podeCriar = escopo === 'loja' ? daEquipe : rede;   // na loja, atendentes também criam etiquetas
  const podeAlterar = escopo === 'loja' ? dono : rede;

  router.get('/etiquetas', podeVer, rota(async (req, res) => {
    res.json((await comContexto(ctx(req), (c) => listarEtiquetas(c, lojaDe(req)))).map(etiquetaPublica));
  }));
  router.post('/etiquetas', podeCriar, rota(async (req, res) => {
    const d = validar(zEtiqueta, req.body);
    const e = await comContexto(ctx(req), async (c) => {
      if (escopo === 'loja' && (await c.query('SELECT 1 FROM etiquetas WHERE loja_id IS NULL AND lower(nome) = lower($1)', [d.nome])).rowCount) {
        throw erro(422, 'Já existe uma etiqueta da rede com este nome.', { nome: 'Já existe uma etiqueta da rede com este nome.' });
      }
      const n = (await c.query('SELECT count(*)::int AS n FROM etiquetas WHERE loja_id IS NOT DISTINCT FROM $1', [lojaDe(req)])).rows[0].n;
      if (n >= 60) throw erro(409, 'Limite de 60 etiquetas.');
      const descricao = escopo === 'loja' && req.usuario.perfil !== 'dono' ? null : (d.descricaoBot || null); // só o dono decide o que o assistente faz
      return (await c.query('INSERT INTO etiquetas (loja_id, nome, cor, descricao_bot) VALUES ($1, $2, $3, $4) RETURNING *', [lojaDe(req), d.nome, d.cor, descricao])).rows[0];
    }).catch(unico('Já existe uma etiqueta com este nome.'));
    res.status(201).json(etiquetaPublica(e));
  }));
  router.put('/etiquetas/:id', podeAlterar, rota(async (req, res) => {
    const eid = id(req.params.id, 'Etiqueta não encontrada.');
    const d = validar(zEtiqueta, req.body);
    const e = await comContexto(ctx(req), async (c) => {
      const r = (await c.query('UPDATE etiquetas SET nome = $3, cor = $4, descricao_bot = $5 WHERE id = $1 AND loja_id IS NOT DISTINCT FROM $2 RETURNING *',
        [eid, lojaDe(req), d.nome, d.cor, d.descricaoBot || null])).rows[0];
      if (!r) throw erro(404, escopo === 'loja' ? 'Etiqueta não encontrada. As etiquetas da rede só a administração altera.' : 'Etiqueta não encontrada.');
      await c.query('UPDATE conversas SET atualizada_em = now() WHERE contato_id IN (SELECT contato_id FROM contato_etiquetas WHERE etiqueta_id = $1)', [eid]);
      return r;
    }).catch(unico('Já existe uma etiqueta com este nome.'));
    res.json(etiquetaPublica(e));
  }));
  router.delete('/etiquetas/:id', podeAlterar, rota(async (req, res) => {
    const eid = id(req.params.id, 'Etiqueta não encontrada.');
    await comContexto(ctx(req), async (c) => {
      const r = await c.query('DELETE FROM etiquetas WHERE id = $1 AND loja_id IS NOT DISTINCT FROM $2', [eid, lojaDe(req)]);
      if (!r.rowCount) throw erro(404, 'Etiqueta não encontrada.');
      await registrar(c, req, 'excluiu_etiqueta', { alvo: eid });
    });
    res.status(204).end();
  }));
}

// =====================================================================
// CAMPOS PERSONALIZADOS (rede e loja)
// =====================================================================
function rotasCampos(router, { escopo }) {
  const lojaDe = (req) => (escopo === 'loja' ? req.usuario.loja_id : null);
  const podeVer = escopo === 'loja' ? daEquipe : rede;
  const podeAlterar = escopo === 'loja' ? dono : rede;

  router.get('/campos', podeVer, rota(async (req, res) => {
    res.json((await comContexto(ctx(req), (c) => listarCampos(c, lojaDe(req)))).map(campoPublico));
  }));
  router.post('/campos', podeAlterar, rota(async (req, res) => {
    const d = validar(zCampo, req.body);
    const campo = await comContexto(ctx(req), async (c) => {
      const n = (await c.query('SELECT count(*)::int AS n FROM campos_personalizados WHERE loja_id IS NOT DISTINCT FROM $1', [lojaDe(req)])).rows[0].n;
      if (n >= 30) throw erro(409, 'Limite de 30 campos.');
      // chave única entre os campos que a loja enxerga (rede + loja), para o assistente não confundir
      const usadas = new Set((await listarCampos(c, lojaDe(req))).map((x) => x.chave));
      const base = chaveDoNome(d.nome);
      let chave = base, i = 2;
      while (usadas.has(chave)) chave = `${base}_${i++}`;
      return (await c.query(
        `INSERT INTO campos_personalizados (loja_id, chave, nome, tipo, opcoes, instrucao_bot, ativo, ordem) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [lojaDe(req), chave, d.nome, d.tipo, d.tipo === 'lista' ? d.opcoes : [], d.instrucaoBot || null, d.ativo, n])).rows[0];
    });
    res.status(201).json(campoPublico(campo));
  }));
  router.put('/campos/:id', podeAlterar, rota(async (req, res) => {
    const cid = id(req.params.id, 'Campo não encontrado.');
    const d = validar(zCampo, req.body);
    const campo = await comContexto(ctx(req), async (c) => {
      const atual = (await c.query('SELECT * FROM campos_personalizados WHERE id = $1 AND loja_id IS NOT DISTINCT FROM $2', [cid, lojaDe(req)])).rows[0];
      if (!atual) throw erro(404, escopo === 'loja' ? 'Campo não encontrado. Os campos da rede só a administração altera.' : 'Campo não encontrado.');
      if (d.tipo !== atual.tipo) throw erro(422, 'O tipo de um campo não muda depois de criado. Crie outro campo.');
      return (await c.query('UPDATE campos_personalizados SET nome = $2, opcoes = $3, instrucao_bot = $4, ativo = $5 WHERE id = $1 RETURNING *',
        [cid, d.nome, atual.tipo === 'lista' ? d.opcoes : [], d.instrucaoBot || null, d.ativo])).rows[0];
    });
    res.json(campoPublico(campo));
  }));
  router.post('/campos/ordem', podeAlterar, rota(async (req, res) => {
    const { ids } = validar(z.object({ ids: z.array(zUuid).max(30) }), req.body);
    await comContexto(ctx(req), async (c) => {
      for (const [i, cid] of ids.entries()) await c.query('UPDATE campos_personalizados SET ordem = $3 WHERE id = $1 AND loja_id IS NOT DISTINCT FROM $2', [cid, lojaDe(req), i]);
    });
    res.json({ ok: true });
  }));
  router.delete('/campos/:id', podeAlterar, rota(async (req, res) => {
    const cid = id(req.params.id, 'Campo não encontrado.');
    await comContexto(ctx(req), async (c) => {
      const r = await c.query('DELETE FROM campos_personalizados WHERE id = $1 AND loja_id IS NOT DISTINCT FROM $2', [cid, lojaDe(req)]);
      if (!r.rowCount) throw erro(404, 'Campo não encontrado.');
      await registrar(c, req, 'excluiu_campo', { alvo: cid });
    });
    res.status(204).end();
  }));
}

rotasEtiquetas(personalizacaoLoja, { escopo: 'loja' });
rotasEtiquetas(personalizacaoRede, { escopo: 'rede' });
rotasCampos(personalizacaoLoja, { escopo: 'loja' });
rotasCampos(personalizacaoRede, { escopo: 'rede' });

// =====================================================================
// PAINEL DO CLIENTE (ao lado da conversa e na ficha)
// =====================================================================
async function contatoDaLoja(c, req) {
  const k = (await c.query('SELECT id, nome, telefone, email, cpf_final, observacoes, optout, criado_em FROM contatos WHERE id = $1 AND loja_id = $2', [id(req.params.id, 'Cliente não encontrado.'), req.usuario.loja_id])).rows[0];
  if (!k) throw erro(404, 'Cliente não encontrado.');
  return k;
}

personalizacaoLoja.get('/contatos/:id/painel', daEquipe, rota(async (req, res) => {
  const r = await comContexto(ctx(req), async (c) => {
    const k = await contatoDaLoja(c, req);
    await garantirFunil(c, req.usuario.loja_id);
    const funis = await listarFunis(c, req.usuario.loja_id);
    const ops = (await c.query(
      `SELECT o.id, o.funil_id, o.etapa_id, o.valor_previsto, o.atualizada_em FROM oportunidades o
        WHERE o.contato_id = $1 AND o.fechada_em IS NULL ORDER BY o.criada_em`, [k.id])).rows;
    const reservas = (await c.query(`SELECT id, codigo, status, retirada, devolucao, grupo, valor FROM reservas WHERE contato_id = $1 ORDER BY retirada DESC NULLS LAST LIMIT 3`, [k.id])).rows;
    return { k, funis, ops, reservas, ...(await dadosDoPainel(c, req.usuario.loja_id, k.id)) };
  });
  res.json({
    contato: { id: r.k.id, nome: r.k.nome, telefone: r.k.telefone, email: r.k.email, cpf: r.k.cpf_final ? `***.***.***-${r.k.cpf_final}` : null, optout: r.k.optout, criadoEm: r.k.criado_em },
    campos: r.campos, etiquetas: r.etiquetas, aplicadas: r.aplicadas,
    funis: r.funis.map((f) => ({ id: f.id, nome: f.nome, principal: f.principal, etapas: f.etapas.map(etapaPublica) })),
    oportunidades: r.ops.map((o) => ({ id: o.id, funilId: o.funil_id, etapaId: o.etapa_id, valor: o.valor_previsto != null ? Number(o.valor_previsto) : null, atualizadaEm: o.atualizada_em })),
    reservas: r.reservas.map((x) => ({ ...x, valor: x.valor != null ? Number(x.valor) : null })),
  });
}));

personalizacaoLoja.put('/contatos/:id/campos', daEquipe, rota(async (req, res) => {
  const { valores } = validar(z.object({ valores: z.record(zUuid, z.string().max(500).nullable()) }), req.body);
  if (Object.keys(valores).length > 30) throw erro(422, 'Campos demais.');
  const r = await comContexto(ctx(req), async (c) => {
    const k = await contatoDaLoja(c, req);
    await salvarValores(c, req.usuario.loja_id, k.id, valores);
    await c.query('UPDATE conversas SET atualizada_em = now() WHERE contato_id = $1', [k.id]);
    return dadosDoPainel(c, req.usuario.loja_id, k.id);
  });
  res.json(r);
}));

personalizacaoLoja.put('/contatos/:id/etiquetas', daEquipe, rota(async (req, res) => {
  const { etiquetas } = validar(z.object({ etiquetas: z.array(zUuid).max(20) }), req.body);
  const r = await comContexto(ctx(req), async (c) => {
    const k = await contatoDaLoja(c, req);
    await definirEtiquetas(c, req.usuario.loja_id, k.id, etiquetas, req.usuario.id);
    await c.query('UPDATE conversas SET atualizada_em = now() WHERE contato_id = $1', [k.id]);
    return dadosDoPainel(c, req.usuario.loja_id, k.id);
  });
  res.json(r);
}));

// =====================================================================
// ROLETA DE ATENDIMENTO
// =====================================================================
async function situacaoRoleta(c, lojaId) {
  const cfg = await configDaRoleta(c, lojaId);
  const equipe = (await c.query(
    `SELECT u.id, u.nome, u.perfil, u.disponivel, u.na_roleta, (u.visto_em > now() - interval '5 minutes') AS online,
            (SELECT count(*) FROM conversas cv WHERE cv.atendente_id = u.id AND cv.estado = 'humano')::int AS em_andamento
       FROM usuarios u WHERE u.loja_id = $1 AND u.status = 'ativo' ORDER BY u.criado_em, u.id`, [lojaId])).rows;
  const aguardando = (await c.query(`SELECT count(*)::int AS n FROM conversas WHERE loja_id = $1 AND estado = 'aguardando'`, [lojaId])).rows[0].n;
  return {
    modo: cfg.modo, limite: cfg.limite, aguardando,
    equipe: equipe.map((u) => ({ id: u.id, nome: u.nome, perfil: u.perfil, disponivel: u.disponivel && u.online, marcouDisponivel: u.disponivel, naRoleta: u.na_roleta, online: !!u.online, emAndamento: u.em_andamento, proximo: u.id === cfg.ultimoUsuarioId })),
  };
}

personalizacaoLoja.get('/roleta', daEquipe, rota(async (req, res) => {
  res.json(await comContexto(ctx(req), (c) => situacaoRoleta(c, req.usuario.loja_id)));
}));

personalizacaoLoja.put('/roleta', dono, rota(async (req, res) => {
  const d = validar(z.object({
    modo: z.enum(MODOS),
    limite: z.coerce.number().int().min(0).max(100).default(0),
    participantes: z.record(zUuid, z.boolean()).optional(),
  }), req.body);
  await comContexto(ctx(req), async (c) => {
    await c.query(`INSERT INTO distribuicao (loja_id, modo, limite) VALUES ($1, $2, $3)
                   ON CONFLICT (loja_id) DO UPDATE SET modo = EXCLUDED.modo, limite = EXCLUDED.limite, atualizada_em = now()`, [req.usuario.loja_id, d.modo, d.limite]);
    for (const [uid, sim] of Object.entries(d.participantes || {})) {
      await c.query(`UPDATE usuarios SET na_roleta = $3 WHERE id = $1 AND loja_id = $2 AND (perfil = 'atendente' OR id = $4)`, [uid, req.usuario.loja_id, sim, req.usuario.id]);
    }
    await registrar(c, req, 'configurou_roleta', { detalhes: { modo: d.modo, limite: d.limite } });
  });
  await comoSistema((c) => distribuirPendentes(c, req.usuario.loja_id));
  res.json(await comContexto(ctx(req), (c) => situacaoRoleta(c, req.usuario.loja_id)));
}));
