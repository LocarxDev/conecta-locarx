# Conecta LocarX

Plataforma de atendimento e CRM da rede LocarX: assistente virtual no WhatsApp, CRM por loja e reservas direto no portal LocarX.

| Pasta | O que é | Onde roda |
| --- | --- | --- |
| `web/` | Front-end (HTML, CSS, JS) | Netlify |
| `api/` | Back-end (Node.js + Express) | Railway |
| banco | PostgreSQL | Railway |

**Etapas prontas: 1 (base) e 2 (WhatsApp e caixa de conversas).** Lojas, acessos, login com verificação em 2 etapas, equipe, visual LocarX, conexão do WhatsApp pela Evolution API e atendimento das conversas.

---

## Como publicar (ordem obrigatória: Railway primeiro, Netlify depois)

### 1. Banco de dados no Railway
1. No Railway, crie um projeto novo: **+ New → Database → PostgreSQL**.

### 2. API no Railway
1. No mesmo projeto: **+ New → GitHub Repo → LocarxDev/conecta-locarx**.
2. Em **Settings → Source → Root Directory**, coloque: `api`
3. Em **Variables**, cadastre:

| Variável | Valor |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (selecione na lista do Railway) |
| `PGSSL` | `disable` |
| `CHAVE_CRIPTOGRAFIA` | gere uma chave nova (veja abaixo) — **guarde em lugar seguro; se perder, quem tem 2 etapas precisa reativar** |
| `APP_URL` | `https://conecta.locarx.com.br` |
| `FRONTEND_ORIGINS` | `https://conecta.locarx.com.br,https://adminconecta.locarx.com.br` |
| `TRUST_PROXY` | `2` |
| `NODE_ENV` | `production` |
| `ADMIN_INICIAL_EMAIL` | seu e-mail de acesso |
| `ADMIN_INICIAL_NOME` | seu nome |
| `RESEND_API_KEY` | chave do Resend (pode ser a mesma conta do CEO Digital) |
| `EMAIL_FROM` | `Conecta LocarX <nao-responder@send.locarx.com.br>` |
| `PORT` | `3000` |
| `EVOLUTION_URL` | `http://${{evolution-api.RAILWAY_PRIVATE_DOMAIN}}:8080` (só depois do passo 2B) |
| `EVOLUTION_API_KEY` | a mesma chave do `AUTHENTICATION_API_KEY` da Evolution |
| `WEBHOOK_BASE_URL` | `http://${{RAILWAY_PRIVATE_DOMAIN}}:3000` |
| `WEBHOOK_SEGREDO` | gere com `openssl rand -hex 32` (não precisa colar em nenhum outro lugar) |

Para gerar a `CHAVE_CRIPTOGRAFIA`, rode no terminal: `openssl rand -base64 32`
(ou no PowerShell: `[Convert]::ToBase64String((1..32 | % {[byte](Get-Random -Max 256)}))`)

4. Em **Settings → Networking → Generate Domain**. Anote o endereço (ex.: `conecta-locarx-production.up.railway.app`).
5. Abra `https://SEU-ENDERECO.up.railway.app/api/saude` — tem que aparecer `{"ok":true}`.
6. Nos **Logs** do Railway aparece a linha *Administrador inicial criado*. Se o Resend estiver configurado, o convite chega no seu e-mail; senão, o link aparece no próprio log (vale 72 h, uso único).

### 2B. Evolution API (WhatsApp) no Railway
A Evolution fica **sem endereço público**: só a API do Conecta fala com ela, pela rede interna do Railway.
1. No mesmo projeto: **+ New → Database → PostgreSQL** e renomeie o serviço para `Postgres-Evolution` (banco só da Evolution).
2. **+ New → Database → Redis** (deixe o nome `Redis`).
3. **+ New → Docker Image** → `evoapicloud/evolution-api:v2.3.7` e renomeie o serviço para `evolution-api`.
4. Em **Variables → Raw Editor**, cole o conteúdo de `evolution/variaveis-railway.env` e troque `<CHAVE-GERADA>` por uma chave nova (`openssl rand -hex 32`).
5. Em **Settings → Volumes**, adicione um volume em `/evolution/instances` (guarda a sessão do WhatsApp).
6. **Não** clique em Generate Domain neste serviço.
7. Volte na API do Conecta e preencha `EVOLUTION_URL`, `EVOLUTION_API_KEY`, `WEBHOOK_BASE_URL` e `WEBHOOK_SEGREDO` (tabela acima). A API reinicia sozinha.
8. Teste: entre como dono de uma loja → **WhatsApp da loja → Conectar WhatsApp** → leia o QR code com o celular da loja.

Se o QR code não aparecer e o log da API mostrar erro de conexão com a Evolution, a rede interna não está passando. Plano B: gere um domínio público na Evolution (a chave de 64 caracteres protege o acesso), use esse endereço `https://…` em `EVOLUTION_URL`, e em `WEBHOOK_BASE_URL` use o endereço público da API do Conecta.

### 3. Ligar o front à API
No arquivo `web/netlify.toml`, tire o `#` do bloco `[[redirects]]` do `/api/*` e troque `SEU-BACKEND` pelo endereço do passo 2.4.
Assim o navegador só enxerga `/api` — o endereço do Railway não aparece no código da página.

### 4. Front no Netlify
1. Arraste a **PASTA `web` inteira** (não os arquivos soltos) em **Netlify → Add new site → Deploy manually**.
2. Em **Domain management**, adicione `conecta.locarx.com.br` (e depois `adminconecta.locarx.com.br`).
3. Na Cloudflare, crie os CNAME apontando para o endereço `.netlify.app` do site.

### 5. Primeiro acesso
1. Abra o link do convite, crie a senha e entre.
2. Em **Meu perfil**, ative a verificação em 2 etapas (obrigatória para administração, matriz e donos).
3. Cadastre as lojas e convide o dono de cada uma.

---

## Segurança (resumo)
- Nenhum token ou chave no código: tudo em variáveis do Railway.
- Login por cookie `httpOnly` + `Secure` + `SameSite=Strict` (o JavaScript da página não lê a sessão), token CSRF em toda ação que altera dados e checagem de origem.
- Senhas com argon2id; bloqueio de 15 min após 5 senhas erradas; limite de requisições por IP.
- Verificação em 2 etapas (TOTP) com o segredo criptografado (AES-256-GCM).
- Isolamento entre lojas no próprio banco (Row-Level Security) e trava que impede alguém de mudar a própria função.
- Consultas sempre parametrizadas (sem SQL injection) e validação de todas as entradas.
- Todo texto exibido na tela é escapado (sem XSS); CSP rígida no Netlify.
- Auditoria de logins, convites e alterações (o registro não pode ser apagado pela aplicação).
- WhatsApp: a Evolution não fica exposta na internet; o webhook só aceita chamadas com o segredo de 64 caracteres; conversas isoladas por loja no banco (a administração não lê conversas); arquivos enviados conferidos pelo conteúdo real (só foto, PDF, Word e Excel, até 8 MB); arquivos recebidos não ficam guardados no Conecta (são buscados na hora).

## Rodar no computador (desenvolvimento)
```bash
cd api
cp .env.exemplo .env     # preencha; para http://localhost use COOKIE_INSEGURO_LOCAL=1
npm install
node --env-file=.env src/servidor.js
```
O front precisa estar no mesmo endereço da API (como no Netlify): use um proxy local que sirva `web/` e repasse `/api` para a porta 3000.

Para ver o front sem back-end (demonstração), troque `USAR_EXEMPLO` para `true` em `web/js/api.js`.
