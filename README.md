# Conecta LocarX

Plataforma de atendimento e CRM da rede LocarX: assistente virtual com IA no WhatsApp, CRM por loja e reservas direto no portal LocarX.

| Pasta | O que é | Onde roda |
| --- | --- | --- |
| `web/` | Front-end (HTML, CSS, JS, sem build) | Netlify |
| `api/` | Back-end (Node.js + Express) | Railway |
| `evolution/` | Variáveis da Evolution API (WhatsApp) | Railway |
| bancos | PostgreSQL do Conecta + PostgreSQL e Redis da Evolution | Railway |

**Todas as 7 etapas estão prontas:** base (lojas, acessos, 2 etapas), WhatsApp e caixa de conversas, assistente virtual com IA e base de conhecimento, reservas pela API LocarX (LocarX Tools / MCP), CRM (clientes, funil, tarefas, mensagens ativas e automações), relatórios da loja e da rede e personalização do CRM (funis, etiquetas, campos e roleta de atendimento).

### Etapa 7 — personalização do CRM
- **Funis:** a rede monta o funil padrão em **Padrões do CRM** (administração/matriz). Cada loja recebe uma cópia na primeira vez que usa; o dono cria, renomeia, reordena e arquiva os próprios funis em **Funis, etiquetas e campos**. Lojas que ainda não personalizaram acompanham as mudanças do padrão. O funil **principal** é o que o assistente usa: conversa nova entra na 1ª etapa e o cliente anda sozinho nas etapas marcadas como automáticas (cotou preço, reserva criada, carro retirado); devolução conclui e cancelamento marca como perdido.
- **Etiquetas:** da rede (valem para todas as lojas) e da loja (dono e atendentes criam). Etiquetas com instrução o assistente aplica sozinho; a equipe coloca e tira no painel do cliente.
- **Informações do cliente (campos personalizados):** texto, número, data, lista ou sim/não. Com instrução, o assistente anota durante a conversa (ex.: período, carro desejado). Aparecem no **painel ao lado da conversa** e na ficha do cliente, editáveis.
- **Roleta de atendimento:** quando o assistente chama um atendente (ou a conversa chega sem assistente), ela vai para quem está **Disponível** (botão no topo), em rodízio ou para quem tem menos conversas, com limite opcional por pessoa. Configuração em **Atendentes**. Quem sai do sistema fica em pausa; quem fecha o Conecta deixa de receber depois de 5 minutos.
- **Janelas:** clicar fora não fecha mais; o Esc só fecha se nada foi digitado.

### Cotação e reserva pela equipe
- **Tela Cotação** (menu, dono e atendente): só data e hora; a filial é a da própria loja. Consulta a tabela vigente (`POST /api/loja/cotacao`), lista os grupos do mais barato ao mais caro e calcula Super X e opcionais (`POST /api/loja/cotacao/preco`).
- **Na conversa**, o botão **Cotação** (ao lado de "Dados do cliente") abre a mesma cotação numa janela. **Enviar ao cliente** coloca o texto já formatado no campo de mensagem, como o assistente faz, para o atendente revisar e mandar. **Reservar** cria a reserva pela API com os dados do cliente, com o mesmo resumo e confirmação do assistente (`POST /api/loja/reservas`, dois passos); fica no histórico da loja (origem "equipe"), na ficha do cliente, no funil e como evento na conversa.
- A regra de negócio fica em `api/src/servicos/locarx/cotacao.js`, compartilhada com as LocarX Tools do assistente.

### Status do WhatsApp (administração e matriz)
Menu **Status do WhatsApp**: servidor Evolution no ar (e versão), instância e número de cada loja, assistente ligado/desligado, equipe online, mensagens nas últimas 24 h e alertas (desconectada, assistente sem chave, conversas aguardando sem ninguém online). **Verificar agora** confere a situação real na Evolution e corrige o que estava gravado. A administração **reconecta** (QR code para o celular da loja) e **desconecta**; a matriz só consulta. `GET /api/admin/whatsapp`, `POST /api/admin/whatsapp/:lojaId/conectar|desconectar`, `GET …/qr`.

### Monitor do assistente (administração)
Menu **Monitor do assistente**: cada resposta da IA em tempo real (atualiza a cada 5 s) — loja, modelo, tempo, tokens, ferramentas chamadas com duração, erros da API LocarX (com a resposta crua) e da IA, e "promessas sem ação". Clique na linha para ver a linha do tempo. Nenhum conteúdo de conversa e nenhum dado pessoal é guardado: os argumentos das ferramentas entram sem CPF, nome, e-mail e telefone. Colunas novas em `uso_ia` (`erro`, `detalhes`, `duracao_ms`); `GET /api/admin/assistente/monitor`.

A seção **Reservas e cotações** lista cada tentativa (equipe e assistente) com o resultado: criada, ou **o motivo da falha** — mensagem amigável, HTTP e resposta crua da API LocarX, período, grupo e proteções (tabela `ocorrencias`, `GET /api/admin/ocorrencias`). O dono vê a mesma mensagem de motivo na hora, na janela de reserva.

Proteções do motor (`servicos/ia/provedores.js` e `assistente.js`):
- **Estado da reserva entre mensagens**: a IA só vê o texto do WhatsApp (não o resultado das ferramentas de rodadas anteriores). Por isso a conversa guarda as últimas opções (letra → `fleet_id`), a cotação atual e os dados do condutor (CPF cifrado) — `conversas.opcoes`, `cotacao`, `condutor` — e o bloco **RESERVA EM ANDAMENTO** entra no prompt em toda rodada. `calcular_preco` aceita letra ou nome do grupo; `criar_reserva` completa nome/CPF/e-mail com o que já foi informado e calcula o preço sozinha se faltar cotação.
- **Promessa sem ação**: se a IA responde "vou criar a reserva, um momento" sem chamar ferramenta, o sistema cobra uma vez na mesma rodada; se ela insistir sem agir, a conversa vai para a equipe com o motivo registrado.
- **Markdown → WhatsApp**: `**negrito**`, `### título` e `- item` viram `*negrito*` e `• item` antes do envio.
- **Reserva criada no portal nunca se perde**: se a gravação no Conecta falhar depois de o portal confirmar, o código ainda chega ao cliente/atendente com um aviso, em vez de erro.

### Políticas do portal na Base da rede
Em **Base da rede → Importar do portal LocarX**, as políticas oficiais que a API devolve na disponibilidade (clientes brasileiros/estrangeiros, cancelamento, validade da reserva, pagamento, taxa de entrega…), a franquia de km, as proteções com valor por diária e os serviços adicionais entram como itens **pendentes** da rede, sem duplicar títulos. A administração revisa, edita e aprova; só o aprovado chega ao assistente. `POST /api/admin/rede/importar-politicas`.

### Testes
```bash
cd api && npm test
```
`node --test` (sem dependência extra): regras de período e proteções, leitura do formato real da API LocarX, texto das opções e roteiro de reserva do prompt.

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
Em `web/netlify.toml`, o bloco `/api/*` aponta para o endereço do Railway (já configurado: `conecta-locarx-production.up.railway.app`).

### 5. Front no Netlify
1. Arraste a **PASTA `web` inteira** (não os arquivos soltos) em **Add new site → Deploy manually**.
2. **Domain management:** `conecta.locarx.com.br` e `adminconecta.locarx.com.br`; na Cloudflare, CNAME para o `.netlify.app`.

### 6. Primeiro uso
1. Crie a senha pelo convite e ative as **2 etapas** em Meu perfil (obrigatório para administração, matriz e donos).
2. **Lojas → Cadastrar loja → Buscar filiais no portal LocarX** para escolher a filial; depois **Testar API LocarX** na página da loja.
3. Convide o dono. Ele conecta o **WhatsApp da loja**, cadastra a chave de IA em **Assistente virtual**, preenche a **Base de conhecimento** e testa o assistente antes de ligar.
4. Em **Acessos da rede**, convide a Matriz LocarX e, se quiser, crie a **loja de demonstração**.

---

## API LocarX — o que o código segue (documentação para integradores, out/2026)
- `GET /availabilities/external?branchId&dateFrom&dateTo` (datas `YYYY-MM-DDTHH:mm:ss`, Brasília). Lista com `branch.fleets[]` e um bloco comum (serviços, proteções, políticas, km). Retirada < 24 h → `[]`. `400 OUTSIDE_BUSINESS_HOURS` / `BRANCH_HOLIDAY` / `INVALID_DATE_RANGE`.
- `POST /prices/calculate` `{ dateFrom, dateTo, priceFleetId, branchId, protections: [{id}], additionalServices: [{id, qtd}] }` → `summary.totalWithTax`. Não valida horário nem feriado.
- `POST /reservations/new` `{ priceFleetId, pickUpLocationBranchId, dropOffLocationBranchId, pickUpDate, pickUpTime, dropOffDate, dropOffTime, customer{name, cpf, phone "(71) 99999-0000", email?, cnh?}, protections: [{fleetProtectionId}], billingType: LOCAL_PAYMENT, observations, assistanceNumber }` → 201 com `id`, `reservationCode`, `value`, `status.reservation`. `400 ADVANCE_BOOKING_REQUIRED` / `BRANCH_HOLIDAY` / `NOT_AVAILABILITY_STCOK` (com `days`) / `PRICE_OUT_OF_VALIDITY`; `404 NOT_FOUND_PRICE` / `NOT_FOUND_BRANCH`; `403` token.
- `GET /reservations` — só reservas criadas pelo nosso token; filtros `search` (nome, código ou CPF), `customerCpf`, `reservationStatus`, `assistanceNumber`, `startDate/endDate`, `page/size/sort`. Status: CONFIRMED, PENDING, INPROGRESS (retirado), COMPLETED (devolvido), CANCELED; `payment` nasce PENDING.
- `POST /reservations/cancel/{id}` `{ reason ≤ 250 }` — `id` numérico (achado pelo código via `search`). Só reservas criadas pelo Conecta; o assistente não cancela depois da retirada (política comercial).
- Em 500 o adaptador repete a chamada uma vez (nunca em criação/cancelamento). Catálogo completo de erros em `CODIGOS_LOCARX`, inclusive os "sem code" reconhecidos pela mensagem.
- Todos os códigos documentados estão em `CODIGOS_LOCARX` (`api-locarx.js`) com a mensagem para a equipe e a orientação para o assistente; a mensagem do portal vai junto.
- `GET /locality?branchId=` para a filial da loja (horários por dia 1–7, `open`, janelas de atendimento especial com `amount`). A página da loja (administração) avisa quando a filial **não existe no ambiente atual** (homologação × produção).
- `GET /fleets/catalog` (cache de 1 h) alimenta a ferramenta `descrever_grupo` do assistente: modelos, lugares, malas, câmbio e itens — sem preço nem estoque.
- `assistanceNumber` leva `CONECTA-<8 primeiros caracteres da conversa>` para achar a reserva na listagem.

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
