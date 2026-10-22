# Conecta LocarX

Plataforma de atendimento e CRM da rede LocarX: assistente virtual com IA no WhatsApp, CRM por loja e reservas direto no portal LocarX.

| Pasta | O que é | Onde roda |
| --- | --- | --- |
| `web/` | Front-end (HTML, CSS, JS, sem build) | Netlify |
| `api/` | Back-end (Node.js + Express) | Railway |
| `evolution/` | Variáveis da Evolution API (WhatsApp) | Railway |
| bancos | PostgreSQL do Conecta + PostgreSQL e Redis da Evolution | Railway |

**Todas as 6 etapas estão prontas:** base (lojas, acessos, 2 etapas), WhatsApp e caixa de conversas, assistente virtual com IA e base de conhecimento, reservas pela API LocarX (LocarX Tools / MCP), CRM (clientes, funil, tarefas, mensagens ativas e automações) e relatórios da loja e da rede.

---

## Como publicar (ordem: Railway primeiro, Netlify depois)

Tudo fica num projeto só do Railway, com 5 serviços: `Postgres`, `conecta-api`, `Postgres-Evolution`, `Redis` e `evolution-api`.

### 1. Banco do Conecta
**+ New → Database → PostgreSQL** (nome `Postgres`).

### 2. API do Conecta
1. **+ New → GitHub Repo → LocarxDev/conecta-locarx** e renomeie o serviço para `conecta-api`.
2. **Settings → Source → Root Directory:** `api`
3. **Variables:**

| Variável | Valor |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `PGSSL` | `disable` |
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `CHAVE_CRIPTOGRAFIA` | gere com `openssl rand -base64 32` — **guarde num lugar seguro**; sem ela, as chaves de IA e as 2 etapas precisam ser cadastradas de novo |
| `APP_URL` | `https://conecta.locarx.com.br` |
| `FRONTEND_ORIGINS` | `https://conecta.locarx.com.br,https://adminconecta.locarx.com.br` |
| `TRUST_PROXY` | `2` |
| `ADMIN_INICIAL_EMAIL` / `ADMIN_INICIAL_NOME` | seu e-mail e nome (cria o primeiro administrador) |
| `RESEND_API_KEY` | chave do Resend |
| `EMAIL_FROM` | `Conecta LocarX <nao-responder@send.locarx.com.br>` |
| `EVOLUTION_URL` | `http://${{evolution-api.RAILWAY_PRIVATE_DOMAIN}}:8080` |
| `EVOLUTION_API_KEY` | a mesma do `AUTHENTICATION_API_KEY` da Evolution |
| `WEBHOOK_BASE_URL` | `http://${{RAILWAY_PRIVATE_DOMAIN}}:3000` |
| `WEBHOOK_SEGREDO` | gere com `openssl rand -hex 32` |
| `LOCARX_API_URL` | `https://api.locarx.com.br/api` (homologação: `https://portalhml.locarx.com.br/api`) |
| `LOCARX_API_TOKEN` | token exclusivo do Conecta no portal LocarX |
| `MCP_TOKEN` | opcional: gere com `openssl rand -hex 32` para outros sistemas (Lívia I.A., chat do site) consultarem o LocarX Tools |

No PowerShell, sem openssl: `[Convert]::ToBase64String((1..32 | % {[byte](Get-Random -Max 256)}))`

4. **Settings → Networking → Generate Domain** e anote o endereço (ex.: `conecta-api-production.up.railway.app`).
5. Teste: `https://SEU-ENDERECO/api/saude` → `{"ok":true}`.
6. Nos **Logs** aparece *Administrador inicial criado*. Com Resend configurado, o convite chega no e-mail; senão, o link aparece no log (vale 72 h, uso único).

### 3. Evolution API (WhatsApp)
Sem endereço público: só a API do Conecta fala com ela, pela rede interna do Railway.
1. **+ New → Database → PostgreSQL**, renomeie para `Postgres-Evolution`.
2. **+ New → Database → Redis** (nome `Redis`).
3. **+ New → Docker Image** → `evoapicloud/evolution-api:v2.3.7`, renomeie para `evolution-api`.
4. **Variables → Raw Editor:** cole `evolution/variaveis-railway.env` e troque `<CHAVE-GERADA>` (`openssl rand -hex 32`).
5. **Settings → Volumes:** volume em `/evolution/instances`.
6. **Não** gere domínio para este serviço.

Se o QR code não aparecer e o log da API mostrar erro de conexão com a Evolution: gere um domínio público na Evolution (a chave protege o acesso), use `https://…` em `EVOLUTION_URL` e o domínio público da API em `WEBHOOK_BASE_URL`.

### 4. Ligar o front à API
Em `web/netlify.toml`, tire o `#` das 5 linhas do bloco `/api/*` e troque `SEU-BACKEND` pelo endereço do passo 2.4.

### 5. Front no Netlify
1. Arraste a **PASTA `web` inteira** (não os arquivos soltos) em **Add new site → Deploy manually**.
2. **Domain management:** `conecta.locarx.com.br` e `adminconecta.locarx.com.br`; na Cloudflare, CNAME para o `.netlify.app`.

### 6. Primeiro uso
1. Crie a senha pelo convite e ative as **2 etapas** em Meu perfil (obrigatório para administração, matriz e donos).
2. **Lojas → Cadastrar loja → Buscar filiais no portal LocarX** para escolher a filial; depois **Testar API LocarX** na página da loja.
3. Convide o dono. Ele conecta o **WhatsApp da loja**, cadastra a chave de IA em **Assistente virtual**, preenche a **Base de conhecimento** e testa o assistente antes de ligar.
4. Em **Acessos da rede**, convide a Matriz LocarX e, se quiser, crie a **loja de demonstração**.

---

## Antes de ligar as reservas em produção (importante)
`GET /locality` e `GET /reservations` já foram validados com a API LocarX. Os formatos de **`/availabilities/external`**, **`/prices/calculate`**, **`/reservations/new`** e **`/reservations/cancel`** foram montados pelo padrão dos campos conhecidos e **precisam ser conferidos com um token de homologação**. Tudo fica em um arquivo: `api/src/servicos/locarx/api-locarx.js`. Use **Testar API LocarX** (página da loja, administração) para ver as respostas cruas. Até lá, deixe `LOCARX_API_URL` apontando para a homologação.

## Segurança (resumo)
- Nenhum token ou chave no código: tudo em variáveis do Railway. Chaves de IA, segredo das 2 etapas e CPF de clientes ficam **criptografados** no banco (AES-256-GCM) e nunca voltam inteiros para a tela.
- Login por cookie `httpOnly` + `Secure` + `SameSite=Strict`, token CSRF, checagem de origem e CORS restrito; F5 mantém o login.
- Senhas argon2id; bloqueio de 15 min após 5 erros; limites de requisição; 2 etapas (TOTP).
- **Isolamento entre lojas no próprio banco** (Row-Level Security em todas as tabelas de loja) + trava que impede alguém de mudar a própria função. A administração e a matriz não leem conversas nem clientes das lojas, só números.
- Consultas parametrizadas (sem SQL injection), validação de todas as entradas, texto sempre escapado na tela (sem XSS), CSP rígida, exportação CSV protegida contra fórmulas.
- WhatsApp: Evolution sem endereço público, webhook com segredo de 64 caracteres, arquivos conferidos pelo conteúdo real, mídia recebida não fica guardada.
- Assistente: só fala com base na base de conhecimento e na API; reserva só com confirmação explícita do cliente e CPF válido; ignora pedidos para mudar de regra; limite diário de respostas.
- Auditoria de logins, convites, alterações e exportações (a aplicação não consegue apagar o registro).

## LocarX Tools (MCP)
`POST /api/mcp` (JSON-RPC 2.0) com `Authorization: Bearer <MCP_TOKEN>` e `X-Conecta-Filial: <branchId>`. Métodos `initialize`, `tools/list` e `tools/call`. Só ferramentas de consulta: `buscar_informacoes`, `dados_da_loja`, `consultar_disponibilidade`, `calcular_preco`, `consultar_reserva`.

## Rodar no computador (desenvolvimento)
```bash
cd api
cp .env.exemplo .env       # preencha; para http://localhost use COOKIE_INSEGURO_LOCAL=1
npm install
node --env-file=.env src/servidor.js
```
- `IA_SIMULADA=1` usa uma IA de mentira (só fora de produção), para testar sem gastar créditos.
- O front precisa estar no mesmo endereço da API (como no Netlify): sirva `web/` com um proxy que repasse `/api` para a porta 3000.
- Demonstração sem servidor: troque `USAR_EXEMPLO` para `true` em `web/js/api.js`.
