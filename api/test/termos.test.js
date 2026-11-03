// v14.5 — termos de adesão/privacidade
import './ambiente.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIPOS, tiposDoPerfil, hashTexto, TEXTO_INICIAL, SQL_TERMOS_PENDENTES } from '../src/servicos/termos.js';
import { exigirTermosAceitos } from '../src/http.js';

test('termos: tipo por perfil, textos iniciais e assinatura do texto', () => {
  assert.deepEqual(tiposDoPerfil('dono'), ['adesao', 'uso', 'privacidade']);
  assert.deepEqual(tiposDoPerfil('atendente'), ['uso', 'privacidade']);
  assert.deepEqual(tiposDoPerfil('admin'), []); assert.deepEqual(tiposDoPerfil('matriz'), []);
  for (const tipo of Object.keys(TIPOS)) { assert.ok(TEXTO_INICIAL[tipo].texto.length > 500, tipo); assert.match(TEXTO_INICIAL[tipo].texto, /Li e concordo/); assert.match(TEXTO_INICIAL[tipo].texto, /endereço IP/); assert.doesNotMatch(TEXTO_INICIAL[tipo].texto, /\bdono\b/i); }
  assert.match(TEXTO_INICIAL.privacidade.texto, /13\.709\/2018/);
  assert.equal(hashTexto('abc'), hashTexto('abc')); assert.notEqual(hashTexto('abc'), hashTexto('abd')); assert.equal(hashTexto('x').length, 64);
  assert.match(SQL_TERMOS_PENDENTES, /NOT EXISTS \(SELECT 1 FROM aceites_termos/);
});

test('termos: com termo pendente a API só deixa passar /termos, /auth e /eu', () => {
  const chamar = (path, pend) => { let saida = 'next'; exigirTermosAceitos({ usuario: { termos_pendentes: pend }, path }, {}, (e) => { if (e) saida = e; }); return saida; };
  assert.equal(chamar('/conversas', 0), 'next');
  assert.equal(chamar('/termos/pendentes', 1), 'next');
  assert.equal(chamar('/termos/abc/aceitar', 1), 'next');
  assert.equal(chamar('/auth/sair', 1), 'next');
  assert.equal(chamar('/eu/lojas', 1), 'next');
  const bloqueado = chamar('/conversas', 1);
  assert.equal(bloqueado.status, 403); assert.equal(bloqueado.campos?.termosPendentes, true);
  assert.equal(chamar('/termosx', 1).status, 403);
});
