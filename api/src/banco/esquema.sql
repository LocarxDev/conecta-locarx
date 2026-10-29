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

-- =====================================================================
-- ETAPA 2 — WhatsApp e caixa de conversas
-- =====================================================================

CREATE TABLE IF NOT EXISTS canais (
  loja_id        uuid PRIMARY KEY REFERENCES lojas(id) ON DELETE CASCADE,
  provedor       text NOT NULL DEFAULT 'evolution' CHECK (provedor IN ('evolution', 'oficial')),
  instancia      text NOT NULL UNIQUE,
  status         text NOT NULL DEFAULT 'desconectado' CHECK (status IN ('desconectado', 'conectando', 'conectado')),
  numero         text,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contatos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id     uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  telefone    text NOT NULL CHECK (telefone ~ '^[0-9]{8,15}$'),
  nome        text,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loja_id, telefone)
);

CREATE TABLE IF NOT EXISTS conversas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id             uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  contato_id          uuid NOT NULL REFERENCES contatos(id) ON DELETE CASCADE,
  estado              text NOT NULL DEFAULT 'aguardando' CHECK (estado IN ('assistente', 'aguardando', 'humano', 'encerrada')),
  atendente_id        uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  nao_lidas           integer NOT NULL DEFAULT 0,
  ultima_previa       text,
  ultima_mensagem_em  timestamptz NOT NULL DEFAULT now(),
  ultima_do_cliente   timestamptz,
  criada_em           timestamptz NOT NULL DEFAULT now(),
  atualizada_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loja_id, contato_id)
);
CREATE INDEX IF NOT EXISTS conversas_lista ON conversas (loja_id, ultima_mensagem_em DESC);
CREATE INDEX IF NOT EXISTS conversas_atualizadas ON conversas (loja_id, atualizada_em);

CREATE TABLE IF NOT EXISTS mensagens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id  uuid NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  loja_id      uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  direcao      text NOT NULL CHECK (direcao IN ('entrada', 'saida', 'interna')),
  autor        text NOT NULL CHECK (autor IN ('cliente', 'atendente', 'assistente', 'sistema')),
  autor_id     uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  tipo         text NOT NULL CHECK (tipo IN ('texto', 'imagem', 'audio', 'video', 'documento', 'localizacao', 'figurinha', 'nota', 'evento', 'outro')),
  texto        text CHECK (length(texto) <= 8000),
  midia        jsonb,
  externo_id   text,
  status       text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'enviando', 'erro')),
  criada_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mensagens_conversa ON mensagens (conversa_id, criada_em);
CREATE UNIQUE INDEX IF NOT EXISTS mensagens_externo ON mensagens (loja_id, externo_id) WHERE externo_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS respostas_rapidas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id    uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  atalho     text NOT NULL CHECK (atalho ~ '^[a-z0-9-]{2,30}$'),
  texto      text NOT NULL CHECK (length(texto) BETWEEN 1 AND 2000),
  criada_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loja_id, atalho)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON canais, contatos, conversas, mensagens, respostas_rapidas TO conecta_app;

-- RLS: tudo da etapa 2 é da loja. Matriz e administração só leem a situação do canal.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['canais', 'contatos', 'conversas', 'mensagens', 'respostas_rapidas'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_loja', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR ALL
      USING (ctx_perfil() = 'sistema' OR loja_id = ctx_loja())
      WITH CHECK (ctx_perfil() = 'sistema' OR loja_id = ctx_loja())$p$, t || '_loja', t);
  END LOOP;
END $$;
DROP POLICY IF EXISTS canais_rede ON canais;
CREATE POLICY canais_rede ON canais FOR SELECT USING (ctx_perfil() IN ('admin', 'matriz'));

-- =====================================================================
-- ETAPA 3 — Assistente virtual e base de conhecimento
-- =====================================================================

-- Configuração da rede (uma linha só): orientações gerais e modelo padrão do assistente
CREATE TABLE IF NOT EXISTS rede_config (
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id),
  orientacoes_rede   text NOT NULL DEFAULT '',
  modelo_assistente  jsonb NOT NULL DEFAULT '{}'::jsonb,
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO rede_config (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS assistentes (
  loja_id              uuid PRIMARY KEY REFERENCES lojas(id) ON DELETE CASCADE,
  ativo                boolean NOT NULL DEFAULT false,
  nome                 text NOT NULL DEFAULT 'Assistente LocarX' CHECK (length(nome) BETWEEN 2 AND 60),
  instrucoes           text NOT NULL DEFAULT '' CHECK (length(instrucoes) <= 8000),
  boas_vindas          text NOT NULL DEFAULT '' CHECK (length(boas_vindas) <= 1000),
  msg_ausencia         text NOT NULL DEFAULT '' CHECK (length(msg_ausencia) <= 1000),
  msg_repasse          text NOT NULL DEFAULT '' CHECK (length(msg_repasse) <= 1000),
  horario              jsonb NOT NULL DEFAULT '{}'::jsonb,
  fora_horario         text NOT NULL DEFAULT 'assistente' CHECK (fora_horario IN ('assistente', 'mensagem')),
  palavras_atendente   text[] NOT NULL DEFAULT ARRAY['atendente', 'humano', 'pessoa', 'reclamação', 'reclamacao'],
  retorno_horas        integer NOT NULL DEFAULT 2 CHECK (retorno_horas BETWEEN 0 AND 72),
  provedor             text NOT NULL DEFAULT 'anthropic' CHECK (provedor IN ('anthropic', 'openai')),
  modelo               text NOT NULL DEFAULT 'claude-haiku-5-5' CHECK (length(modelo) <= 80),
  chave_cifrada        text,
  chave_final          text,
  chave_audio_cifrada  text,
  limite_diario        integer NOT NULL DEFAULT 400 CHECK (limite_diario BETWEEN 0 AND 100000),
  atualizado_em        timestamptz NOT NULL DEFAULT now()
);

-- busca em português ignorando acentos (caução = caucao)
CREATE EXTENSION IF NOT EXISTS unaccent;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'pt_sem_acento') THEN
    CREATE TEXT SEARCH CONFIGURATION pt_sem_acento (COPY = portuguese);
    ALTER TEXT SEARCH CONFIGURATION pt_sem_acento ALTER MAPPING FOR hword, hword_part, word WITH unaccent, portuguese_stem;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS conhecimento (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escopo        text NOT NULL CHECK (escopo IN ('rede', 'loja')),
  loja_id       uuid REFERENCES lojas(id) ON DELETE CASCADE,
  titulo        text NOT NULL CHECK (length(titulo) BETWEEN 2 AND 200),
  conteudo      text NOT NULL CHECK (length(conteudo) BETWEEN 2 AND 6000),
  status        text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'arquivado')),
  criado_por    uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  aprovado_por  uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  busca         tsvector GENERATED ALWAYS AS (
                  setweight(to_tsvector('pt_sem_acento'::regconfig, coalesce(titulo, '')), 'A') ||
                  setweight(to_tsvector('pt_sem_acento'::regconfig, coalesce(conteudo, '')), 'B')) STORED,
  CHECK ((escopo = 'rede' AND loja_id IS NULL) OR (escopo = 'loja' AND loja_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS conhecimento_busca ON conhecimento USING gin (busca);
CREATE INDEX IF NOT EXISTS conhecimento_loja ON conhecimento (loja_id, status);

CREATE TABLE IF NOT EXISTS sinonimos (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  termos  text[] NOT NULL CHECK (array_length(termos, 1) BETWEEN 2 AND 20)
);
INSERT INTO sinonimos (termos)
SELECT t FROM (VALUES
  (ARRAY['caução', 'caucao', 'calção', 'depósito', 'deposito', 'garantia', 'pré-autorização']),
  (ARRAY['cnh', 'carteira', 'habilitação', 'habilitacao', 'carteira de motorista']),
  (ARRAY['condutor', 'motorista', 'quem vai dirigir']),
  (ARRAY['proteção', 'protecao', 'seguro', 'cobertura']),
  (ARRAY['retirada', 'retirar', 'pegar o carro', 'buscar o carro']),
  (ARRAY['devolução', 'devolucao', 'devolver', 'entregar o carro']),
  (ARRAY['diária', 'diaria', 'diárias', 'dia de aluguel']),
  (ARRAY['quilometragem', 'km', 'quilômetros', 'kilometragem'])
) AS v(t) WHERE NOT EXISTS (SELECT 1 FROM sinonimos);

-- Perguntas que o assistente não soube responder (viram conteúdo da base)
CREATE TABLE IF NOT EXISTS perguntas_sem_resposta (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id      uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  conversa_id  uuid REFERENCES conversas(id) ON DELETE SET NULL,
  pergunta     text NOT NULL CHECK (length(pergunta) <= 1000),
  resolvida    boolean NOT NULL DEFAULT false,
  criada_em    timestamptz NOT NULL DEFAULT now()
);

-- Uso da IA (custos e limite diário)
CREATE TABLE IF NOT EXISTS uso_ia (
  id           bigserial PRIMARY KEY,
  loja_id      uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  conversa_id  uuid REFERENCES conversas(id) ON DELETE SET NULL,
  provedor     text NOT NULL,
  modelo       text NOT NULL,
  tokens_in    integer NOT NULL DEFAULT 0,
  tokens_out   integer NOT NULL DEFAULT 0,
  ferramentas  text[],
  ok           boolean NOT NULL DEFAULT true,
  criado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uso_ia_loja ON uso_ia (loja_id, criado_em DESC);

ALTER TABLE conversas ADD COLUMN IF NOT EXISTS bot_respondeu_em timestamptz;
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS humano_respondeu_em timestamptz;
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS ausencia_enviada_em timestamptz;
ALTER TABLE mensagens ADD COLUMN IF NOT EXISTS transcricao text;

-- =====================================================================
-- ETAPA 4 — Reservas
-- =====================================================================
CREATE TABLE IF NOT EXISTS reservas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id       uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  contato_id    uuid REFERENCES contatos(id) ON DELETE SET NULL,
  conversa_id   uuid REFERENCES conversas(id) ON DELETE SET NULL,
  codigo        text,
  status        text NOT NULL DEFAULT 'confirmada',
  retirada      timestamptz,
  devolucao     timestamptz,
  grupo         text,
  valor         numeric(12, 2),
  origem        text NOT NULL DEFAULT 'assistente' CHECK (origem IN ('assistente', 'equipe', 'portal')),
  detalhes      jsonb,
  criada_em     timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS reservas_codigo ON reservas (loja_id, codigo) WHERE codigo IS NOT NULL;
CREATE INDEX IF NOT EXISTS reservas_retirada ON reservas (loja_id, retirada);

-- =====================================================================
-- ETAPA 5 — CRM
-- =====================================================================
ALTER TABLE contatos ADD COLUMN IF NOT EXISTS email text CHECK (email IS NULL OR length(email) <= 254);
ALTER TABLE contatos ADD COLUMN IF NOT EXISTS cpf_cifrado text;
ALTER TABLE contatos ADD COLUMN IF NOT EXISTS cpf_final text;
ALTER TABLE contatos ADD COLUMN IF NOT EXISTS observacoes text CHECK (observacoes IS NULL OR length(observacoes) <= 4000);
ALTER TABLE contatos ADD COLUMN IF NOT EXISTS optout boolean NOT NULL DEFAULT false;
ALTER TABLE contatos ADD COLUMN IF NOT EXISTS optin_em timestamptz;
ALTER TABLE contatos ADD COLUMN IF NOT EXISTS atualizado_em timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS oportunidades (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id        uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  contato_id     uuid NOT NULL REFERENCES contatos(id) ON DELETE CASCADE,
  conversa_id    uuid REFERENCES conversas(id) ON DELETE SET NULL,
  reserva_id     uuid REFERENCES reservas(id) ON DELETE SET NULL,
  valor_previsto numeric(12, 2),
  motivo_perda   text CHECK (motivo_perda IS NULL OR length(motivo_perda) <= 200),
  responsavel_id uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  criada_em      timestamptz NOT NULL DEFAULT now(),
  atualizada_em  timestamptz NOT NULL DEFAULT now(),
  fechada_em     timestamptz
);
-- funil, etapa e resultado: ver ETAPA 7 (funis personalizáveis)

CREATE TABLE IF NOT EXISTS tarefas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id        uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  contato_id     uuid REFERENCES contatos(id) ON DELETE CASCADE,
  conversa_id    uuid REFERENCES conversas(id) ON DELETE SET NULL,
  titulo         text NOT NULL CHECK (length(titulo) BETWEEN 2 AND 200),
  vence_em       timestamptz NOT NULL,
  responsavel_id uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  feita_em       timestamptz,
  automatica     boolean NOT NULL DEFAULT false,
  criada_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tarefas_loja ON tarefas (loja_id, feita_em, vence_em);

-- Modelos de mensagem (mensagens ativas e automações)
CREATE TABLE IF NOT EXISTS modelos_mensagem (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id     uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  chave       text NOT NULL CHECK (chave ~ '^[a-z0-9_]{2,40}$'),
  nome        text NOT NULL CHECK (length(nome) BETWEEN 2 AND 80),
  texto       text NOT NULL CHECK (length(texto) BETWEEN 2 AND 1000),
  automatico  boolean NOT NULL DEFAULT false,
  ativo       boolean NOT NULL DEFAULT true,
  UNIQUE (loja_id, chave)
);

CREATE TABLE IF NOT EXISTS automacoes_enviadas (
  reserva_id  uuid NOT NULL REFERENCES reservas(id) ON DELETE CASCADE,
  tipo        text NOT NULL,
  enviada_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reserva_id, tipo)
);

ALTER TABLE assistentes ADD COLUMN IF NOT EXISTS silencio_inicio smallint NOT NULL DEFAULT 21 CHECK (silencio_inicio BETWEEN 0 AND 23);
ALTER TABLE assistentes ADD COLUMN IF NOT EXISTS silencio_fim smallint NOT NULL DEFAULT 8 CHECK (silencio_fim BETWEEN 0 AND 23);

GRANT SELECT, INSERT, UPDATE, DELETE ON assistentes, conhecimento, perguntas_sem_resposta, reservas, oportunidades, tarefas, modelos_mensagem, automacoes_enviadas TO conecta_app;
GRANT SELECT, INSERT ON uso_ia TO conecta_app;
GRANT USAGE ON SEQUENCE uso_ia_id_seq TO conecta_app;
GRANT SELECT ON sinonimos, rede_config TO conecta_app;
GRANT INSERT, UPDATE, DELETE ON sinonimos, rede_config TO conecta_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assistentes', 'perguntas_sem_resposta', 'uso_ia', 'reservas', 'oportunidades', 'tarefas', 'modelos_mensagem'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_loja', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR ALL
      USING (ctx_perfil() = 'sistema' OR loja_id = ctx_loja())
      WITH CHECK (ctx_perfil() = 'sistema' OR loja_id = ctx_loja())$p$, t || '_loja', t);
  END LOOP;
END $$;
-- relatórios da rede: administração e matriz leem números (não o conteúdo das conversas)
DROP POLICY IF EXISTS assistentes_rede ON assistentes;
CREATE POLICY assistentes_rede ON assistentes FOR SELECT USING (ctx_perfil() IN ('admin', 'matriz'));
DROP POLICY IF EXISTS reservas_rede ON reservas;
CREATE POLICY reservas_rede ON reservas FOR SELECT USING (ctx_perfil() IN ('admin', 'matriz'));
DROP POLICY IF EXISTS oportunidades_rede ON oportunidades;
CREATE POLICY oportunidades_rede ON oportunidades FOR SELECT USING (ctx_perfil() IN ('admin', 'matriz'));
DROP POLICY IF EXISTS uso_ia_rede ON uso_ia;
CREATE POLICY uso_ia_rede ON uso_ia FOR SELECT USING (ctx_perfil() IN ('admin', 'matriz'));

-- base de conhecimento: a da rede todos leem; só administração e matriz alteram. A da loja é da loja.
ALTER TABLE conhecimento ENABLE ROW LEVEL SECURITY;
ALTER TABLE conhecimento FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conhecimento_ver ON conhecimento;
CREATE POLICY conhecimento_ver ON conhecimento FOR SELECT
  USING (ctx_perfil() = 'sistema' OR escopo = 'rede' OR loja_id = ctx_loja());
DROP POLICY IF EXISTS conhecimento_alterar ON conhecimento;
CREATE POLICY conhecimento_alterar ON conhecimento FOR ALL
  USING (ctx_perfil() = 'sistema' OR (escopo = 'rede' AND ctx_perfil() IN ('admin', 'matriz')) OR (escopo = 'loja' AND loja_id = ctx_loja() AND ctx_perfil() IN ('dono', 'atendente')))
  WITH CHECK (ctx_perfil() = 'sistema' OR (escopo = 'rede' AND ctx_perfil() IN ('admin', 'matriz')) OR (escopo = 'loja' AND loja_id = ctx_loja() AND ctx_perfil() IN ('dono', 'atendente')));

ALTER TABLE rede_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE rede_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rede_config_ver ON rede_config;
CREATE POLICY rede_config_ver ON rede_config FOR SELECT USING (true);
DROP POLICY IF EXISTS rede_config_alterar ON rede_config;
CREATE POLICY rede_config_alterar ON rede_config FOR UPDATE USING (ctx_perfil() IN ('admin', 'matriz', 'sistema')) WITH CHECK (ctx_perfil() IN ('admin', 'matriz', 'sistema'));

ALTER TABLE sinonimos ENABLE ROW LEVEL SECURITY;
ALTER TABLE sinonimos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sinonimos_ver ON sinonimos;
CREATE POLICY sinonimos_ver ON sinonimos FOR SELECT USING (true);
DROP POLICY IF EXISTS sinonimos_alterar ON sinonimos;
CREATE POLICY sinonimos_alterar ON sinonimos FOR ALL USING (ctx_perfil() IN ('admin', 'matriz', 'sistema')) WITH CHECK (ctx_perfil() IN ('admin', 'matriz', 'sistema'));

-- =====================================================================
-- ETAPA 7 — Funis personalizáveis, etiquetas, campos personalizados e roleta de atendimento
-- Regra geral: loja_id NULL = padrão da rede (só administração e matriz alteram);
--              loja_id preenchido = da loja (o dono personaliza).
-- =====================================================================
CREATE TABLE IF NOT EXISTS funis (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id    uuid REFERENCES lojas(id) ON DELETE CASCADE,
  nome       text NOT NULL CHECK (length(nome) BETWEEN 2 AND 60),
  principal  boolean NOT NULL DEFAULT false,      -- o assistente trabalha no funil principal
  arquivado  boolean NOT NULL DEFAULT false,
  ordem      smallint NOT NULL DEFAULT 0,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
-- origem_id: de qual funil/etapa da rede veio a cópia. personalizado: o dono já mexeu (aí o padrão da rede não sobrescreve mais).
ALTER TABLE funis ADD COLUMN IF NOT EXISTS origem_id uuid;
ALTER TABLE funis ADD COLUMN IF NOT EXISTS personalizado boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS funis_principal ON funis (coalesce(loja_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE principal;
CREATE INDEX IF NOT EXISTS funis_loja ON funis (loja_id);

CREATE TABLE IF NOT EXISTS etapas_funil (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funil_id  uuid NOT NULL REFERENCES funis(id) ON DELETE CASCADE,
  loja_id   uuid REFERENCES lojas(id) ON DELETE CASCADE,   -- copiado do funil (preenchido por gatilho)
  nome      text NOT NULL CHECK (length(nome) BETWEEN 2 AND 40),
  ordem     smallint NOT NULL DEFAULT 0,
  cor       text NOT NULL DEFAULT '#64748b' CHECK (cor ~ '^#[0-9a-f]{6}$'),
  tipo      text NOT NULL DEFAULT 'aberta' CHECK (tipo IN ('aberta', 'ganho', 'perdido')),
  -- o assistente e as automações movem o cliente para cá quando acontece:
  evento    text CHECK (evento IS NULL OR evento IN ('cotacao', 'reserva', 'retirada')),
  CHECK (evento IS NULL OR tipo = 'aberta')
);
ALTER TABLE etapas_funil ADD COLUMN IF NOT EXISTS origem_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS etapas_funil_evento ON etapas_funil (funil_id, evento) WHERE evento IS NOT NULL;
CREATE INDEX IF NOT EXISTS etapas_funil_funil ON etapas_funil (funil_id, ordem);

CREATE OR REPLACE FUNCTION etapa_loja_do_funil() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.loja_id := (SELECT loja_id FROM funis WHERE id = NEW.funil_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS etapas_funil_loja ON etapas_funil;
CREATE TRIGGER etapas_funil_loja BEFORE INSERT OR UPDATE ON etapas_funil FOR EACH ROW EXECUTE FUNCTION etapa_loja_do_funil();

-- funil padrão da rede (criado uma vez; depois a administração edita)
DO $$
DECLARE f uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM funis WHERE loja_id IS NULL) THEN
    INSERT INTO funis (loja_id, nome, principal) VALUES (NULL, 'Locação', true) RETURNING id INTO f;
    INSERT INTO etapas_funil (funil_id, nome, ordem, cor, tipo, evento) VALUES
      (f, 'Novo contato', 0, '#64748b', 'aberta', NULL),
      (f, 'Em cotação', 1, '#2563eb', 'aberta', 'cotacao'),
      (f, 'Reserva criada', 2, '#7c3aed', 'aberta', 'reserva'),
      (f, 'Carro retirado', 3, '#d97706', 'aberta', 'retirada'),
      (f, 'Concluído', 4, '#16a34a', 'ganho', NULL),
      (f, 'Perdido', 5, '#dc2626', 'perdido', NULL);
  END IF;
END $$;

-- Cópia do padrão da rede para a loja (na primeira vez que a loja usa o funil). Devolve o funil principal da loja.
CREATE OR REPLACE FUNCTION garantir_funil_loja(p_loja uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE principal_id uuid; rf record; novo uuid;
BEGIN
  SELECT id INTO principal_id FROM funis WHERE loja_id = p_loja AND principal;
  IF principal_id IS NOT NULL THEN RETURN principal_id; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('funil:' || p_loja::text));
  SELECT id INTO principal_id FROM funis WHERE loja_id = p_loja AND principal;
  IF principal_id IS NOT NULL THEN RETURN principal_id; END IF;
  FOR rf IN SELECT * FROM funis WHERE loja_id IS NULL AND NOT arquivado ORDER BY principal DESC, ordem, criado_em LOOP
    INSERT INTO funis (loja_id, nome, principal, ordem, origem_id) VALUES (p_loja, rf.nome, principal_id IS NULL, rf.ordem, rf.id) RETURNING id INTO novo;
    INSERT INTO etapas_funil (funil_id, nome, ordem, cor, tipo, evento, origem_id)
      SELECT novo, nome, ordem, cor, tipo, evento, id FROM etapas_funil WHERE funil_id = rf.id;
    IF principal_id IS NULL THEN principal_id := novo; END IF;
  END LOOP;
  RETURN principal_id;
END $$;

ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS funil_id uuid REFERENCES funis(id) ON DELETE RESTRICT;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS etapa_id uuid REFERENCES etapas_funil(id) ON DELETE RESTRICT;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS resultado text CHECK (resultado IS NULL OR resultado IN ('ganho', 'perdido'));
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS cotou_em timestamptz;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS reservou_em timestamptz;

-- migração de bancos antigos (etapas fixas → funil da loja)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'oportunidades' AND column_name = 'etapa') THEN
    PERFORM set_config('app.perfil', 'sistema', true);
    PERFORM garantir_funil_loja(l) FROM (SELECT DISTINCT loja_id AS l FROM oportunidades) x;
    UPDATE oportunidades o SET funil_id = f.id,
           etapa_id = (SELECT e.id FROM etapas_funil e WHERE e.funil_id = f.id AND CASE
                         WHEN o.etapa = 'concluido' THEN e.tipo = 'ganho'
                         WHEN o.etapa = 'perdido' THEN e.tipo = 'perdido'
                         WHEN o.etapa IN ('cotacao', 'reserva', 'retirada') THEN e.evento = o.etapa
                         ELSE e.tipo = 'aberta' END ORDER BY e.ordem LIMIT 1),
           resultado = CASE o.etapa WHEN 'concluido' THEN 'ganho' WHEN 'perdido' THEN 'perdido' END,
           fechada_em = CASE WHEN o.etapa IN ('concluido', 'perdido') THEN coalesce(o.fechada_em, o.atualizada_em) END,
           cotou_em = CASE WHEN o.etapa <> 'novo' THEN o.atualizada_em END,
           reservou_em = CASE WHEN o.etapa IN ('reserva', 'retirada', 'concluido') OR o.reserva_id IS NOT NULL THEN o.atualizada_em END
      FROM funis f WHERE f.loja_id = o.loja_id AND f.principal AND o.funil_id IS NULL;
    UPDATE oportunidades o SET etapa_id = (SELECT id FROM etapas_funil WHERE funil_id = o.funil_id AND tipo = 'aberta' ORDER BY ordem LIMIT 1) WHERE etapa_id IS NULL;
    ALTER TABLE oportunidades DROP COLUMN etapa;
  END IF;
END $$;
ALTER TABLE oportunidades ALTER COLUMN funil_id SET NOT NULL;
ALTER TABLE oportunidades ALTER COLUMN etapa_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS oportunidades_funil ON oportunidades (loja_id, funil_id, etapa_id);
CREATE UNIQUE INDEX IF NOT EXISTS oportunidades_aberta_funil ON oportunidades (contato_id, funil_id) WHERE fechada_em IS NULL;

-- ---------- etiquetas ----------
CREATE TABLE IF NOT EXISTS etiquetas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id       uuid REFERENCES lojas(id) ON DELETE CASCADE,
  nome          text NOT NULL CHECK (length(nome) BETWEEN 2 AND 30),
  cor           text NOT NULL DEFAULT '#64748b' CHECK (cor ~ '^#[0-9a-f]{6}$'),
  descricao_bot text CHECK (descricao_bot IS NULL OR length(descricao_bot) <= 300),  -- quando o assistente deve aplicar (vazio = só a equipe aplica)
  criada_em     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS etiquetas_nome ON etiquetas (coalesce(loja_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(nome));

CREATE TABLE IF NOT EXISTS contato_etiquetas (
  contato_id      uuid NOT NULL REFERENCES contatos(id) ON DELETE CASCADE,
  etiqueta_id     uuid NOT NULL REFERENCES etiquetas(id) ON DELETE CASCADE,
  loja_id         uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  pelo_assistente boolean NOT NULL DEFAULT false,
  aplicada_por    uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  aplicada_em     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contato_id, etiqueta_id)
);
CREATE INDEX IF NOT EXISTS contato_etiquetas_etiqueta ON contato_etiquetas (loja_id, etiqueta_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM etiquetas WHERE loja_id IS NULL) THEN
    INSERT INTO etiquetas (loja_id, nome, cor, descricao_bot) VALUES
      (NULL, 'Urgente', '#dc2626', 'O cliente precisa do carro hoje ou amanhã.'),
      (NULL, 'Mensal', '#7c3aed', 'Locação de 30 dias ou mais.'),
      (NULL, 'Empresa', '#2563eb', 'O cliente aluga em nome de uma empresa ou pede nota fiscal para CNPJ.'),
      (NULL, 'Aplicativo', '#d97706', 'O cliente vai usar o carro para trabalhar com Uber, 99 ou outro aplicativo.'),
      (NULL, 'Turismo', '#0891b2', 'O cliente está viajando a passeio ou de férias.');
  END IF;
  -- migração: etiquetas em texto (versão antiga) → etiquetas cadastradas
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contatos' AND column_name = 'etiquetas') THEN
    INSERT INTO etiquetas (loja_id, nome)
      SELECT DISTINCT k.loja_id, left(e, 30) FROM contatos k, unnest(k.etiquetas) e WHERE length(e) >= 2
      ON CONFLICT DO NOTHING;
    INSERT INTO contato_etiquetas (contato_id, etiqueta_id, loja_id)
      SELECT k.id, t.id, k.loja_id FROM contatos k CROSS JOIN LATERAL unnest(k.etiquetas) e JOIN etiquetas t ON t.loja_id = k.loja_id AND lower(t.nome) = lower(left(e, 30))
      ON CONFLICT DO NOTHING;
    ALTER TABLE contatos DROP COLUMN etiquetas;
  END IF;
END $$;

-- ---------- campos personalizados (informações que o assistente coleta) ----------
CREATE TABLE IF NOT EXISTS campos_personalizados (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id       uuid REFERENCES lojas(id) ON DELETE CASCADE,
  chave         text NOT NULL CHECK (chave ~ '^[a-z][a-z0-9_]{1,39}$'),
  nome          text NOT NULL CHECK (length(nome) BETWEEN 2 AND 60),
  tipo          text NOT NULL DEFAULT 'texto' CHECK (tipo IN ('texto', 'numero', 'data', 'lista', 'simnao')),
  opcoes        text[] NOT NULL DEFAULT '{}',
  instrucao_bot text CHECK (instrucao_bot IS NULL OR length(instrucao_bot) <= 300),  -- vazio = o assistente não coleta
  ordem         smallint NOT NULL DEFAULT 0,
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  CHECK (tipo <> 'lista' OR cardinality(opcoes) BETWEEN 2 AND 20)
);
CREATE UNIQUE INDEX IF NOT EXISTS campos_chave ON campos_personalizados (coalesce(loja_id, '00000000-0000-0000-0000-000000000000'::uuid), chave);

CREATE TABLE IF NOT EXISTS valores_campos (
  contato_id      uuid NOT NULL REFERENCES contatos(id) ON DELETE CASCADE,
  campo_id        uuid NOT NULL REFERENCES campos_personalizados(id) ON DELETE CASCADE,
  loja_id         uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  valor           text NOT NULL CHECK (length(valor) BETWEEN 1 AND 500),
  pelo_assistente boolean NOT NULL DEFAULT false,
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contato_id, campo_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM campos_personalizados WHERE loja_id IS NULL) THEN
    INSERT INTO campos_personalizados (loja_id, chave, nome, tipo, opcoes, instrucao_bot, ordem) VALUES
      (NULL, 'periodo', 'Período desejado', 'texto', '{}', 'Datas e horários de retirada e devolução que o cliente quer (ex.: 12/11 10h a 15/11 18h).', 0),
      (NULL, 'carro_desejado', 'Carro ou grupo desejado', 'texto', '{}', 'Modelo, categoria ou grupo de carro que o cliente pediu ou escolheu.', 1),
      (NULL, 'motivo', 'Motivo da locação', 'lista', '{Turismo,Trabalho,Aplicativo,Carro reserva,Outro}', 'Para que o cliente vai usar o carro, se ele disser.', 2),
      (NULL, 'como_conheceu', 'Como conheceu a LocarX', 'lista', '{Google,Instagram,Indicação,Já é cliente,Outro}', NULL, 3);
  END IF;
END $$;

-- ---------- roleta de atendimento ----------
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS disponivel boolean NOT NULL DEFAULT false;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS na_roleta boolean NOT NULL DEFAULT true;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS visto_em timestamptz;
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS atribuida_em timestamptz;

CREATE TABLE IF NOT EXISTS distribuicao (
  loja_id           uuid PRIMARY KEY REFERENCES lojas(id) ON DELETE CASCADE,
  modo              text NOT NULL DEFAULT 'rodizio' CHECK (modo IN ('rodizio', 'menos_ocupado', 'desligada')),
  limite            smallint NOT NULL DEFAULT 0 CHECK (limite BETWEEN 0 AND 100),   -- 0 = sem limite de conversas por pessoa
  ultimo_usuario_id uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizada_em     timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON funis, etapas_funil, etiquetas, contato_etiquetas, campos_personalizados, valores_campos, distribuicao TO conecta_app;

DO $$
DECLARE t text;
BEGIN
  -- catálogos: o padrão da rede todos leem; só administração/matriz alteram. O da loja é da loja.
  FOREACH t IN ARRAY ARRAY['funis', 'etapas_funil', 'etiquetas', 'campos_personalizados'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_ver', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR SELECT USING (ctx_perfil() = 'sistema' OR loja_id IS NULL OR loja_id = ctx_loja())$p$, t || '_ver', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_alterar', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR ALL
      USING (ctx_perfil() = 'sistema' OR (loja_id IS NULL AND ctx_perfil() IN ('admin', 'matriz')) OR (loja_id = ctx_loja() AND ctx_perfil() IN ('dono', 'atendente')))
      WITH CHECK (ctx_perfil() = 'sistema' OR (loja_id IS NULL AND ctx_perfil() IN ('admin', 'matriz')) OR (loja_id = ctx_loja() AND ctx_perfil() IN ('dono', 'atendente')))$p$, t || '_alterar', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['contato_etiquetas', 'valores_campos', 'distribuicao'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_loja', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR ALL
      USING (ctx_perfil() = 'sistema' OR loja_id = ctx_loja())
      WITH CHECK (ctx_perfil() = 'sistema' OR loja_id = ctx_loja())$p$, t || '_loja', t);
  END LOOP;
END $$;

-- etiqueta da rede aplicada automaticamente quando o cliente pede um período sem carro disponível
INSERT INTO etiquetas (loja_id, nome, cor, descricao_bot)
  SELECT NULL, 'Sem disponibilidade', '#64748b', NULL
   WHERE NOT EXISTS (SELECT 1 FROM etiquetas WHERE loja_id IS NULL AND lower(nome) = 'sem disponibilidade');

-- cotação em andamento na conversa (o que o cliente viu) e momento em que o resumo foi enviado.
-- A reserva usa a cotação gravada e só sai se o cliente respondeu DEPOIS do resumo.
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS cotacao jsonb;
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS resumo_enviado_em timestamptz;

-- monitor do assistente (administração): erro, eventos de cada resposta (ferramentas, nudges) e tempo gasto
ALTER TABLE uso_ia ADD COLUMN IF NOT EXISTS erro text;
ALTER TABLE uso_ia ADD COLUMN IF NOT EXISTS detalhes jsonb;
ALTER TABLE uso_ia ADD COLUMN IF NOT EXISTS duracao_ms integer;
CREATE INDEX IF NOT EXISTS uso_ia_recentes ON uso_ia (criado_em DESC);

-- ocorrências de reservas/cotações (equipe e assistente), com o motivo — alimentam o Monitor da administração
CREATE TABLE IF NOT EXISTS ocorrencias (
  id          bigserial PRIMARY KEY,
  loja_id     uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  usuario_id  uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  conversa_id uuid REFERENCES conversas(id) ON DELETE SET NULL,
  origem      text NOT NULL CHECK (origem IN ('equipe', 'assistente', 'sistema')),
  tipo        text NOT NULL CHECK (tipo IN ('reserva', 'cotacao', 'ia', 'whatsapp')),
  nivel       text NOT NULL CHECK (nivel IN ('erro', 'aviso', 'info')),
  mensagem    text NOT NULL,
  detalhes    jsonb,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ocorrencias_recentes ON ocorrencias (criado_em DESC);
CREATE INDEX IF NOT EXISTS ocorrencias_loja ON ocorrencias (loja_id, criado_em DESC);
GRANT SELECT, INSERT ON ocorrencias TO conecta_app;
GRANT USAGE ON SEQUENCE ocorrencias_id_seq TO conecta_app;
ALTER TABLE ocorrencias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ocorrencias_loja ON ocorrencias;
CREATE POLICY ocorrencias_loja ON ocorrencias FOR ALL USING (ctx_perfil() = 'sistema' OR loja_id = ctx_loja()) WITH CHECK (ctx_perfil() = 'sistema' OR loja_id = ctx_loja());
DROP POLICY IF EXISTS ocorrencias_rede ON ocorrencias;
CREATE POLICY ocorrencias_rede ON ocorrencias FOR SELECT USING (ctx_perfil() = 'admin');

-- estado da reserva em andamento (o que a IA precisa "lembrar" entre uma mensagem e outra):
-- últimas opções mostradas (letra → fleetId) e dados do condutor já informados (CPF cifrado)
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS opcoes jsonb;
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS condutor jsonb;

-- última cotação feita pela equipe na conversa (período, valores e cálculo com proteção), para reabrir sem consultar de novo.
-- Vale por 24 h e só enquanto a retirada não passou.
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS cotacao_equipe jsonb;

-- ===================== pagamento Pix pelo WhatsApp (AbacatePay) =====================
-- Uma cobrança por tentativa de pagamento. A reserva no portal só é criada depois do webhook confirmar (status paga).
CREATE TABLE IF NOT EXISTS cobrancas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id        uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  conversa_id    uuid REFERENCES conversas(id) ON DELETE SET NULL,
  contato_id     uuid REFERENCES contatos(id) ON DELETE SET NULL,
  reserva_id     uuid REFERENCES reservas(id) ON DELETE SET NULL,
  usuario_id     uuid REFERENCES usuarios(id) ON DELETE SET NULL,    -- quem gerou, quando foi a equipe
  origem         text NOT NULL CHECK (origem IN ('assistente', 'equipe')),
  provedor       text NOT NULL DEFAULT 'abacatepay',
  externo_id     text,                                               -- id da cobrança no provedor (pix_char_…)
  valor          numeric(12, 2) NOT NULL,
  status         text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'paga', 'expirada', 'cancelada', 'estornada', 'falhou')),
  br_code        text,                                               -- Pix copia e cola
  qr_base64      text,
  expira_em      timestamptz,
  paga_em        timestamptz,
  comprovante_url text,
  dev_mode       boolean NOT NULL DEFAULT false,
  detalhes       jsonb,                                              -- cotação, condutor (CPF cifrado), para criar a reserva depois do pagamento
  erro           text,
  criada_em      timestamptz NOT NULL DEFAULT now(),
  atualizada_em  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cobrancas_externo ON cobrancas (provedor, externo_id) WHERE externo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cobrancas_loja ON cobrancas (loja_id, criada_em DESC);
CREATE INDEX IF NOT EXISTS cobrancas_pendentes ON cobrancas (status, expira_em) WHERE status = 'pendente';
GRANT SELECT, INSERT, UPDATE ON cobrancas TO conecta_app;
ALTER TABLE cobrancas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cobrancas_loja ON cobrancas;
CREATE POLICY cobrancas_loja ON cobrancas FOR ALL USING (ctx_perfil() = 'sistema' OR loja_id = ctx_loja()) WITH CHECK (ctx_perfil() = 'sistema' OR loja_id = ctx_loja());
DROP POLICY IF EXISTS cobrancas_rede ON cobrancas;
CREATE POLICY cobrancas_rede ON cobrancas FOR SELECT USING (ctx_perfil() IN ('admin', 'matriz'));

-- eventos de webhook já processados (o AbacatePay reenvia o mesmo id até 7 vezes): idempotência
CREATE TABLE IF NOT EXISTS webhook_eventos (
  provedor     text NOT NULL,
  evento_id    text NOT NULL,
  evento       text,
  cobranca_id  uuid,
  recebido_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provedor, evento_id)
);
GRANT SELECT, INSERT ON webhook_eventos TO conecta_app;
ALTER TABLE webhook_eventos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_eventos_sistema ON webhook_eventos;
CREATE POLICY webhook_eventos_sistema ON webhook_eventos FOR ALL USING (ctx_perfil() = 'sistema') WITH CHECK (ctx_perfil() = 'sistema');

-- reserva: como foi paga (loja × pix) e referência da cobrança
ALTER TABLE reservas ADD COLUMN IF NOT EXISTS pagamento text NOT NULL DEFAULT 'loja' CHECK (pagamento IN ('loja', 'pix'));
ALTER TABLE reservas ADD COLUMN IF NOT EXISTS cobranca_id uuid;

-- taxa cobrada pelo provedor (platformFee) para a conciliação do repasse loja × franqueador
ALTER TABLE cobrancas ADD COLUMN IF NOT EXISTS taxa numeric(12, 2);

-- Código curto do pagamento (ex.: PG-7K3M9Q): vai nas observações da reserva no portal e no painel do AbacatePay (metadata),
-- no lugar do id longo do provedor. Quem vê o portal confere o pagamento no Conecta por esse código.
ALTER TABLE cobrancas ADD COLUMN IF NOT EXISTS codigo text;
CREATE UNIQUE INDEX IF NOT EXISTS cobrancas_codigo ON cobrancas (codigo) WHERE codigo IS NOT NULL;
UPDATE cobrancas SET codigo = 'PG-' || upper(substr(md5(random()::text || id::text), 1, 6)) WHERE codigo IS NULL;
ALTER TABLE cobrancas ADD COLUMN IF NOT EXISTS verificada_em timestamptz;

-- Regras automáticas do funil (por loja): quando marcar "perdido" e "concluído" sem ninguém mexer.
-- perdidoSemRespostaHoras: 0 desliga. perdidoPeloAssistente: o assistente marca perdido quando o cliente diz que não quer.
-- concluidoAoPagar: Pix confirmado → concluído. concluidoNaRetirada: data de retirada passou e a reserva não foi cancelada → concluído.
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS regras_funil jsonb NOT NULL DEFAULT '{"perdidoSemRespostaHoras":48,"perdidoPeloAssistente":true,"concluidoAoPagar":true,"concluidoNaRetirada":true}'::jsonb;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS fechada_por text;   -- 'equipe' | 'assistente' | 'automatico'

-- Conta AbacatePay própria da loja (ligada pela administração; a loja cadastra a chave, cifrada). Com conta própria,
-- o Pix cai direto na loja e ela sai do relatório de repasse. cobrancas.conta diz onde cada pagamento caiu.
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS pix_proprio boolean NOT NULL DEFAULT false;
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS abacatepay_chave_cifrada text;
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS abacatepay_chave_final text;
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS abacatepay_dev boolean;
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS abacatepay_testada_em timestamptz;
ALTER TABLE cobrancas ADD COLUMN IF NOT EXISTS conta text NOT NULL DEFAULT 'rede' CHECK (conta IN ('rede', 'loja'));

-- =====================================================================
-- FILIAIS: uma franquia (loja no Conecta: um WhatsApp, uma equipe, um funil) pode ter várias filiais no portal LocarX
-- (ex.: Salvador Aeroporto e Salvador Centro). lojas.branch_id continua sendo a filial principal (padrão).
-- =====================================================================
CREATE TABLE IF NOT EXISTS filiais (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id    uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  branch_id  integer NOT NULL UNIQUE CHECK (branch_id > 0),
  nome       text NOT NULL CHECK (length(nome) BETWEEN 2 AND 60),
  principal  boolean NOT NULL DEFAULT false,
  ativa      boolean NOT NULL DEFAULT true,
  criada_em  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS filiais_principal ON filiais (loja_id) WHERE principal;
GRANT SELECT, INSERT, UPDATE, DELETE ON filiais TO conecta_app;
ALTER TABLE filiais ENABLE ROW LEVEL SECURITY;
ALTER TABLE filiais FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS filiais_ver ON filiais;
CREATE POLICY filiais_ver ON filiais FOR SELECT USING (ctx_perfil() IN ('admin', 'matriz', 'sistema') OR loja_id = ctx_loja());
DROP POLICY IF EXISTS filiais_alterar ON filiais;
CREATE POLICY filiais_alterar ON filiais FOR ALL USING (ctx_perfil() IN ('admin', 'sistema')) WITH CHECK (ctx_perfil() IN ('admin', 'sistema'));
-- toda loja existente vira uma filial principal (migração idempotente)
INSERT INTO filiais (loja_id, branch_id, nome, principal)
  SELECT l.id, l.branch_id, left(l.nome, 60), true FROM lojas l
   WHERE l.branch_id IS NOT NULL   -- a Central de Reservas não tem filial própria
     AND NOT EXISTS (SELECT 1 FROM filiais f WHERE f.loja_id = l.id) AND NOT EXISTS (SELECT 1 FROM filiais f WHERE f.branch_id = l.branch_id);
-- reservas e cobranças guardam em qual filial foram feitas
ALTER TABLE reservas ADD COLUMN IF NOT EXISTS branch_id integer;
UPDATE reservas r SET branch_id = l.branch_id FROM lojas l WHERE l.id = r.loja_id AND r.branch_id IS NULL;

-- Módulos liberados por loja (plano): jsonb { assistente, cotacao, pix, funil, clientes, relatorios, automacoes, base, mcp } — ausente = ligado.
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS modulos jsonb NOT NULL DEFAULT '{}'::jsonb;

-- =====================================================================
-- MULTILOJA: dono com várias lojas (troca de loja na sessão) e transferência de atendimento entre lojas
-- =====================================================================
-- Lojas que um usuário pode acessar (hoje: donos com mais de uma loja). usuarios.loja_id continua sendo a principal.
CREATE TABLE IF NOT EXISTS usuario_lojas (
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  loja_id    uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  perfil     text NOT NULL DEFAULT 'dono' CHECK (perfil IN ('dono', 'atendente')),
  criado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, loja_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON usuario_lojas TO conecta_app;
ALTER TABLE usuario_lojas ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuario_lojas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS usuario_lojas_ver ON usuario_lojas;
CREATE POLICY usuario_lojas_ver ON usuario_lojas FOR SELECT USING (ctx_perfil() IN ('admin', 'matriz', 'sistema') OR loja_id = ctx_loja() OR usuario_id = nullif(current_setting('app.usuario_id', true), '')::uuid);
DROP POLICY IF EXISTS usuario_lojas_alterar ON usuario_lojas;
CREATE POLICY usuario_lojas_alterar ON usuario_lojas FOR ALL USING (ctx_perfil() IN ('admin', 'sistema')) WITH CHECK (ctx_perfil() IN ('admin', 'sistema'));
INSERT INTO usuario_lojas (usuario_id, loja_id, perfil) SELECT id, loja_id, perfil FROM usuarios WHERE loja_id IS NOT NULL AND perfil IN ('dono', 'atendente') ON CONFLICT DO NOTHING;
-- loja em uso na sessão (NULL = a principal do usuário)
ALTER TABLE sessoes ADD COLUMN IF NOT EXISTS loja_id uuid REFERENCES lojas(id) ON DELETE SET NULL;

-- Conversa transferida para outra loja: continua no WhatsApp da loja de origem (loja_id), mas quem atende é loja_atendimento_id.
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS loja_atendimento_id uuid REFERENCES lojas(id) ON DELETE SET NULL;
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS transferida_em timestamptz;
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS transferida_por uuid REFERENCES usuarios(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS conversas_atendimento ON conversas (loja_atendimento_id) WHERE loja_atendimento_id IS NOT NULL;
-- a loja que atende enxerga a conversa, as mensagens e o contato dela (e grava mensagens nela)
DROP POLICY IF EXISTS conversas_transferida ON conversas;
CREATE POLICY conversas_transferida ON conversas FOR ALL USING (loja_atendimento_id = ctx_loja()) WITH CHECK (loja_atendimento_id = ctx_loja());
DROP POLICY IF EXISTS mensagens_transferida ON mensagens;
CREATE POLICY mensagens_transferida ON mensagens FOR ALL
  USING (EXISTS (SELECT 1 FROM conversas cv WHERE cv.id = mensagens.conversa_id AND cv.loja_atendimento_id = ctx_loja()))
  WITH CHECK (EXISTS (SELECT 1 FROM conversas cv WHERE cv.id = mensagens.conversa_id AND cv.loja_atendimento_id = ctx_loja()));
DROP POLICY IF EXISTS contatos_transferida ON contatos;
CREATE POLICY contatos_transferida ON contatos FOR SELECT
  USING (EXISTS (SELECT 1 FROM conversas cv WHERE cv.contato_id = contatos.id AND cv.loja_atendimento_id = ctx_loja()));

-- =====================================================================
-- Mensagem automática ao entrar numa etapa do funil (ex.: pesquisa de satisfação em "Concluído")
-- modelo_chave: qual modelo de mensagem da loja é enviado quando o cliente chega na etapa.
-- mensagem_desde: só quem entrou na etapa depois disso recebe (ligar a mensagem não dispara para quem já estava lá).
-- etapa_em: quando a oportunidade entrou na etapa atual (atualizado por gatilho, qualquer que seja o caminho que moveu).
-- =====================================================================
ALTER TABLE etapas_funil ADD COLUMN IF NOT EXISTS modelo_chave text CHECK (modelo_chave IS NULL OR modelo_chave ~ '^[a-z0-9_]{2,40}$');
ALTER TABLE etapas_funil ADD COLUMN IF NOT EXISTS mensagem_desde timestamptz;
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS etapa_em timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION oportunidade_etapa_em() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.etapa_id IS DISTINCT FROM OLD.etapa_id THEN NEW.etapa_em := now(); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS oportunidades_etapa_em ON oportunidades;
CREATE TRIGGER oportunidades_etapa_em BEFORE INSERT OR UPDATE ON oportunidades FOR EACH ROW EXECUTE FUNCTION oportunidade_etapa_em();

CREATE TABLE IF NOT EXISTS mensagens_de_etapa (
  oportunidade_id uuid NOT NULL REFERENCES oportunidades(id) ON DELETE CASCADE,
  etapa_id        uuid NOT NULL REFERENCES etapas_funil(id) ON DELETE CASCADE,
  enviada_em      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (oportunidade_id, etapa_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON mensagens_de_etapa TO conecta_app;

-- =====================================================================
-- Chat do site (widget no site da LocarX): o visitante conversa sem cadastro; para reservar ou falar com
-- atendente confirma o WhatsApp com um código de 6 dígitos. Até confirmar, a conversa fica só em site_*
-- (nada entra no CRM); ao confirmar, vira contato + conversa (canal 'site') e segue o motor normal do assistente.
-- =====================================================================
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS site_chat boolean NOT NULL DEFAULT false;
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS canal text NOT NULL DEFAULT 'whatsapp' CHECK (canal IN ('whatsapp', 'site'));
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS site_sessao_id uuid;
ALTER TABLE mensagens ADD COLUMN IF NOT EXISTS ui jsonb;

CREATE TABLE IF NOT EXISTS site_sessoes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash          text NOT NULL UNIQUE,
  loja_id             uuid REFERENCES lojas(id) ON DELETE SET NULL,
  opcoes              jsonb,
  cotacao             jsonb,
  nome                text CHECK (length(nome) <= 120),
  telefone            text CHECK (telefone ~ '^[0-9]{10,15}$'),
  codigo_hash         text,
  codigo_expira       timestamptz,
  codigo_tentativas   integer NOT NULL DEFAULT 0,
  codigos_enviados    integer NOT NULL DEFAULT 0,
  codigo_enviado_em   timestamptz,
  verificada_em       timestamptz,
  confirmada_ate      timestamptz,
  contato_id          uuid REFERENCES contatos(id) ON DELETE SET NULL,
  conversa_id         uuid REFERENCES conversas(id) ON DELETE SET NULL,
  pendente_desde      timestamptz,
  respondida_em       timestamptz,
  ip                  text,
  origem              text,
  navegador           text,
  ultimo_poll         timestamptz,
  criada_em           timestamptz NOT NULL DEFAULT now(),
  ultimo_uso          timestamptz NOT NULL DEFAULT now(),
  expira_em           timestamptz NOT NULL DEFAULT now() + interval '30 days'
);
CREATE INDEX IF NOT EXISTS site_sessoes_expira ON site_sessoes (expira_em);
CREATE INDEX IF NOT EXISTS site_sessoes_conversa ON site_sessoes (conversa_id) WHERE conversa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_sessoes_ip ON site_sessoes (ip, criada_em);

CREATE TABLE IF NOT EXISTS site_mensagens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sessao_id   uuid NOT NULL REFERENCES site_sessoes(id) ON DELETE CASCADE,
  papel       text NOT NULL CHECK (papel IN ('cliente', 'assistente')),
  texto       text CHECK (length(texto) <= 4000),
  ui          jsonb,
  criada_em   timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS site_mensagens_sessao ON site_mensagens (sessao_id, criada_em);

-- contagem diária de respostas da IA e de códigos enviados pelo site (teto contra abuso/custo)
CREATE TABLE IF NOT EXISTS site_uso (
  dia      date NOT NULL,
  tipo     text NOT NULL CHECK (tipo IN ('ia', 'codigo')),
  total    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (dia, tipo)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON site_sessoes, site_mensagens, site_uso TO conecta_app;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['site_sessoes', 'site_mensagens', 'site_uso'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_sistema', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (ctx_perfil() = ''sistema'') WITH CHECK (ctx_perfil() = ''sistema'')', t || '_sistema', t);
  END LOOP;
END $$;

-- =====================================================================
-- CENTRAL DE RESERVAS: uma loja marcada como "central" atende pelo próprio WhatsApp/chat e reserva em QUALQUER filial do portal LocarX.
-- As filiais da central são as da rede inteira (lidas do portal sob demanda, nada copiado para `filiais`).
-- =====================================================================
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS central boolean NOT NULL DEFAULT false;
-- a Central não tem filial própria no portal (reserva em todas); as demais lojas continuam obrigadas a ter filial
ALTER TABLE lojas ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE lojas ALTER COLUMN branch_code DROP NOT NULL;
DO $$ BEGIN
  ALTER TABLE lojas ADD CONSTRAINT lojas_filial_ou_central CHECK (central OR (branch_id IS NOT NULL AND branch_code IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- reserva feita pela central: de qual loja do Conecta é a filial de retirada (para avisar a loja e para os relatórios)
ALTER TABLE reservas ADD COLUMN IF NOT EXISTS loja_destino_id uuid REFERENCES lojas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS reservas_destino ON reservas (loja_destino_id, retirada) WHERE loja_destino_id IS NOT NULL;
-- a loja de destino enxerga (só leitura) as reservas que a central fez para ela
DROP POLICY IF EXISTS reservas_destino_ver ON reservas;
CREATE POLICY reservas_destino_ver ON reservas FOR SELECT USING (loja_destino_id IS NOT NULL AND loja_destino_id = ctx_loja());
