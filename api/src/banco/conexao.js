// Conexão com o PostgreSQL.
// Regra do projeto: TODA consulta passa por comContexto(), que abre uma transação,
// troca para o papel sem privilégios (conecta_app) e informa quem está pedindo.
// Assim o próprio banco aplica o isolamento entre lojas (Row-Level Security).
// Consultas sempre com parâmetros ($1, $2…) — nunca montar SQL juntando texto (proteção contra SQL injection).

import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { config } from '../config.js';

export const pool = new pg.Pool({
  connectionString: config.bancoUrl,
  ssl: config.bancoSsl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 15_000,
});

pool.on('error', (e) => console.error('[banco] erro na conexão ociosa:', e.message));

/**
 * Executa fn(cliente) numa transação com o contexto de segurança.
 * @param {{perfil: string, lojaId?: string|null, usuarioId?: string|null}} ctx
 */
export async function comContexto(ctx, fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query('SET LOCAL ROLE conecta_app');
    await cliente.query(
      `SELECT set_config('app.perfil', $1, true), set_config('app.loja_id', $2, true), set_config('app.usuario_id', $3, true)`,
      [ctx.perfil, ctx.lojaId || '', ctx.usuarioId || ''],
    );
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    cliente.release();
  }
}

export const comoSistema = (fn) => comContexto({ perfil: 'sistema' }, fn);

export function contextoDoUsuario(u) {
  return { perfil: u.perfil, lojaId: u.loja_id, usuarioId: u.id };
}

export async function migrar() {
  const sql = await readFile(new URL('./esquema.sql', import.meta.url), 'utf8');
  const cliente = await pool.connect();
  try {
    // trava para duas instâncias não migrarem ao mesmo tempo
    await cliente.query('SELECT pg_advisory_lock(424242)');
    await cliente.query(sql);
  } finally {
    await cliente.query('SELECT pg_advisory_unlock(424242)').catch(() => {});
    cliente.release();
  }
}
