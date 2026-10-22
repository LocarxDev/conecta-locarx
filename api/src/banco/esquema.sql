-- Conecta LocarX — estrutura do banco (roda sozinha a cada inicialização; só cria o que falta).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Papel sem privilégios usado em TODA consulta da aplicação.
-- Como não é dono das tabelas nem superusuário, as regras de Row-Level Security valem para ele.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'conecta_app') THEN
    CREATE ROLE conecta_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS lojas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text NOT NULL CHECK (length(nome) BETWEEN 2 AND 120),
  cidade        text NOT NULL CHECK (length(cidade) BETWEEN 2 AND 80),
  uf            char(2) NOT NULL,
  branch_id     integer NOT NULL UNIQUE CHECK (branch_id > 0),
  branch_code   text NOT NULL CHECK (branch_code ~ '^[A-Z0-9]{2,6}$'),
  tipo          text NOT NULL DEFAULT 'Cidade' CHECK (tipo IN ('Cidade', 'Aeroporto')),
  ativa         boolean NOT NULL DEFAULT true,
  whatsapp      text NOT NULL DEFAULT 'desconectado',
  assistente    text NOT NULL DEFAULT 'desligado',
  criada_em     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usuarios (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome               text NOT NULL CHECK (length(nome) BETWEEN 2 AND 120),
  email              text NOT NULL CHECK (email = lower(email) AND length(email) <= 254),
  senha_hash         text,
  perfil             text NOT NULL CHECK (perfil IN ('admin', 'matriz', 'dono', 'atendente')),
  loja_id            uuid REFERENCES lojas(id) ON DELETE RESTRICT,
  status             text NOT NULL DEFAULT 'convidado' CHECK (status IN ('convidado', 'ativo', 'inativo')),
  totp_cifrado       text,
  totp_pendente      text,
  totp_ativo         boolean NOT NULL DEFAULT false,
  falhas_login       integer NOT NULL DEFAULT 0,
  bloqueado_ate      timestamptz,
  ultimo_acesso      timestamptz,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  CHECK ((perfil IN ('admin', 'matriz') AND loja_id IS NULL) OR (perfil IN ('dono', 'atendente') AND loja_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_email_unico ON usuarios (email);
CREATE INDEX IF NOT EXISTS usuarios_loja ON usuarios (loja_id);

CREATE TABLE IF NOT EXISTS sessoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id    uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash    bytea NOT NULL UNIQUE,
  tipo          text NOT NULL CHECK (tipo IN ('sessao', 'verificacao')),
  csrf          text NOT NULL,
  tentativas    integer NOT NULL DEFAULT 0,
  criada_em     timestamptz NOT NULL DEFAULT now(),
  ultimo_uso    timestamptz NOT NULL DEFAULT now(),
  expira_em     timestamptz NOT NULL,
  ip            text,
  navegador     text
);
CREATE INDEX IF NOT EXISTS sessoes_usuario ON sessoes (usuario_id);

CREATE TABLE IF NOT EXISTS tokens_senha (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id    uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash    bytea NOT NULL UNIQUE,
  tipo          text NOT NULL CHECK (tipo IN ('convite', 'redefinicao')),
  expira_em     timestamptz NOT NULL,
  usado_em      timestamptz,
  criado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auditoria (
  id            bigserial PRIMARY KEY,
  usuario_id    uuid,
  loja_id       uuid,
  acao          text NOT NULL,
  alvo          text,
  detalhes      jsonb,
  ip            text,
  criado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auditoria_data ON auditoria (criado_em DESC);

-- Permissões do papel da aplicação (auditoria: só inserir e ler, nunca alterar ou apagar)
GRANT USAGE ON SCHEMA public TO conecta_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON lojas, usuarios, sessoes, tokens_senha TO conecta_app;
GRANT SELECT, INSERT ON auditoria TO conecta_app;
GRANT USAGE ON SEQUENCE auditoria_id_seq TO conecta_app;

-- ---------- Row-Level Security: cada loja só enxerga os próprios dados ----------
-- Contexto definido pela API em cada transação:
--   app.perfil  = admin | matriz | dono | atendente | sistema (login, convites)
--   app.loja_id = loja do usuário logado
--   app.usuario_id = usuário logado
CREATE OR REPLACE FUNCTION ctx_perfil() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.perfil', true), '') $$;
CREATE OR REPLACE FUNCTION ctx_loja() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.loja_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION ctx_usuario() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.usuario_id', true), '')::uuid $$;

ALTER TABLE lojas ENABLE ROW LEVEL SECURITY;
ALTER TABLE lojas FORCE ROW LEVEL SECURITY;
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lojas_ver ON lojas;
CREATE POLICY lojas_ver ON lojas FOR SELECT
  USING (ctx_perfil() IN ('admin', 'matriz', 'sistema') OR id = ctx_loja());
DROP POLICY IF EXISTS lojas_alterar ON lojas;
CREATE POLICY lojas_alterar ON lojas FOR ALL
  USING (ctx_perfil() IN ('admin', 'sistema'))
  WITH CHECK (ctx_perfil() IN ('admin', 'sistema'));

DROP POLICY IF EXISTS usuarios_ver ON usuarios;
CREATE POLICY usuarios_ver ON usuarios FOR SELECT
  USING (ctx_perfil() IN ('admin', 'matriz', 'sistema') OR loja_id = ctx_loja() OR id = ctx_usuario());
DROP POLICY IF EXISTS usuarios_alterar ON usuarios;
CREATE POLICY usuarios_alterar ON usuarios FOR ALL
  USING (ctx_perfil() IN ('admin', 'sistema') OR (ctx_perfil() = 'dono' AND loja_id = ctx_loja()) OR id = ctx_usuario())
  WITH CHECK (ctx_perfil() IN ('admin', 'sistema') OR (ctx_perfil() = 'dono' AND loja_id = ctx_loja() AND perfil = 'atendente') OR id = ctx_usuario());

-- Trava extra: só a administração (ou o próprio sistema) muda função e loja de alguém.
-- O dono só ativa/desativa atendentes da própria loja. Ninguém se promove sozinho.
CREATE OR REPLACE FUNCTION proteger_usuario() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ctx_perfil() IN ('admin', 'sistema') THEN RETURN NEW; END IF;
  IF NEW.perfil IS DISTINCT FROM OLD.perfil OR NEW.loja_id IS DISTINCT FROM OLD.loja_id THEN
    RAISE EXCEPTION 'alteracao_nao_permitida' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       ctx_perfil() = 'dono' AND OLD.loja_id = ctx_loja() AND OLD.perfil = 'atendente' AND OLD.id <> ctx_usuario()) THEN
    RAISE EXCEPTION 'alteracao_nao_permitida' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS usuarios_proteger ON usuarios;
CREATE TRIGGER usuarios_proteger BEFORE UPDATE ON usuarios FOR EACH ROW EXECUTE FUNCTION proteger_usuario();
