# Medição de carga do ZapCRM

O protótipo dispensa carga. Quando houver autorização para medir uma instalação, o roteiro lê os cenários de `rotas.json` e falha se alguma meta de
p95 estourar. Não precisa instalar nada: o `npm run load` usa o [k6](https://k6.io) que o
script `scripts/k6.mjs` baixa sozinho (Windows, Mac e Linux).

### Como o k6 chega na sua máquina

- Na primeira vez, o script baixa a versão fixa do k6 (2.4.0) do site oficial
  (github.com/grafana/k6/releases), confere a soma SHA-256 com o arquivo de
  somas da mesma versão e guarda em `node_modules/.cache/k6/`. Soma diferente:
  apaga e para, sem rodar nada. Nas próximas vezes não baixa de novo.
- Já tem o k6 instalado (`k6 version` funciona)? O script usa o seu.
- `K6_BIN=/caminho/do/k6 npm run load` usa outro programa.
- Outro comando do k6: `npm run k6 -- inspect load/p95.js` (igual a `k6 inspect ...`).
- Sem k6 avulso para o seu sistema (ex.: Windows em ARM)? O script diz e mostra
  o link das [formas oficiais de instalar](https://grafana.com/docs/k6/latest/set-up/install-k6/).

| Cenário          | O que faz                                                   | Meta                                |
| ---------------- | ----------------------------------------------------------- | ----------------------------------- |
| `estatico`       | GET `/termos` e `/privacidade` (páginas pré-renderizadas)   | p95 < 100 ms                        |
| `ssr_publico`    | GET `/login` (renderizada no Worker)                        | p95 < 300 ms                        |
| `ssr_logado`     | GET `/app/conversas` e `/app/contatos` com cookie de sessão | p95 < 500 ms                        |
| `escrita_logada` | cria e apaga um registro quando configurado                 | p95 < 600 ms (só o pedido de criar) |
| `rajada_login`   | 8 POSTs seguidos de "pedir código de login" do mesmo IP     | do 6º em diante recebe `429`        |

Além disso, `http_req_failed` tem de ficar abaixo de 1%. O `429` da rajada é um
status esperado e não conta como falha (cada pedido declara os status que
espera).

## Rotas e escrita

A base mede as leituras de `/termos`, `/privacidade`, `/login`, `/app/conversas` e `/app/contatos`. A primeira fatia usa exemplos em memória, por isso `escrita` vem desativada. Quando houver cadastro e exclusão de contatos persistidos, configure em `load/rotas.json` a página, o arquivo das server functions, os nomes das duas funções e campos válidos de criação. O marcador `{n}` gera texto único por rodada e `{num}` seis dígitos para telefones.

A preparação confere as rotas e, com escrita habilitada, cria um registro antes de medir. Uma resposta 404 ou uma recusa de validação interrompe o ensaio e identifica o ponto a corrigir.

## Perfis

Escolha com `PROFILE`. A taxa é o total de requisições por segundo, repartido
entre os cenários (35% estático, 20% login, 30% área logada, 15% escrita).

- `smoke` (padrão): cerca de 1 req/s por 15 s. Só prova que o script funciona;
  não use os números como meta.
- `escada`: 30 s de aquecimento a 2 req/s, depois 5, 20 e 50 req/s, 2 min em
  cada degrau.

### Contas de teste: o limite por usuário dá 500

Toda leitura de quem está logado passa por `limitarUsuario` (`USER_RATE_LIMIT`,
60 por minuto por conta, em `wrangler.jsonc`). Passou disso, a página
renderizada no servidor responde **HTTP 500** (o erro "Muitas requisições" vira
500 no loader; o log agora traz a linha `[rate-limit] usuário ... passou do
limite` e `[500] GET /app`). No degrau de 50 req/s, 30% dos pedidos são da área
logada: 15 por segundo repartidos entre as contas. Com 20 contas dá uns 45 por
minuto por conta, perto do teto de 60, e as rajadas passam dele (a causa mais provável do 1% de
500 sem log na medição de 17/11/2026; reproduzido local, não confirmado no ar). **Use pelo menos 40 contas no degrau de
50 req/s** (30 por minuto cada), ou conte que parte dos 500 é o limite, não o app.

### Orçamento de pedidos

Escada: 2 x 30 + 5 x 120 + 20 x 120 + 50 x 120 = 9.060 pedidos, mais a
limpeza da escrita (um DELETE por cliente criado, uns 15% do total, tag
`escrita_logada_limpeza`) e a rajada (8 pedidos a cada 10 s, uns 360). Conte
**cerca de 10 mil pedidos** por execução. Isso importa em staging: confira que
a cota do plano (Workers: pedidos por dia; D1: leituras e escritas) aguenta
antes de rodar. O smoke gasta umas 30 requisições.

## Rodar local

1. Suba o app e deixe a saída em um arquivo, para o script ler o código de login:

   ```bash
   npm run db:migrate:local
   npx vite dev --port 3000 > /tmp/dev.log 2>&1 &
   ```

2. Gere as sessões de teste (5 contas `load-<n>@exemplo.test`; com `accessMode: 'allowlist'`, coloque-as antes em `ACCESS_ALLOWLIST` do `.dev.vars`):

   ```bash
   LOG_FILE=/tmp/dev.log npm run load:sessoes
   ```

   O script pede o código de cada conta, lê a linha
   `[auth] código de login para <email>: <código>` do log (como o
   `e2e/helpers.ts`), confirma o código e grava os cookies em
   `load/.sessoes.json` (não versionado). `LOG_FILE` padrão: `e2e/.dev.log`.
   `CONTAS=10` muda o número de contas. Cada conta usa um `cf-connecting-ip`
   diferente, por causa do limite de 5 por minuto por IP e por e-mail no login.

3. Rode:

   ```bash
   npm run load                       # smoke
   PROFILE=escada npm run load        # escada
   BASE_URL=http://localhost:3005 npm run load
   ```

   O resultado completo também vai para `load/resultado-<perfil>.json`
   (`RESULTADO=arquivo.json` muda o nome; está no `.gitignore`).

O `vite dev` não pré-renderiza nem minifica: o p95 do `estatico` em dev fica
bem acima do de produção. Para números mais próximos do real, rode contra
`npm run preview` (ele faz o build, sobe na porta 4173) e use
`BASE_URL=http://localhost:4173`.

O `vite dev` escuta só em `::1`; por isso o script usa DNS `preferIPv6` quando
o alvo é localhost (senão o k6 tentaria `127.0.0.1` e receberia "connection
refused").

## Rodar contra staging

Em staging o código de login não sai em log local, então `load:sessoes` recusa
rodar. Dois caminhos:

- **Com provedor de e-mail** (`RESEND_API_KEY` ou o binding `EMAIL`): entre
  nas contas de teste à mão (ou com o Playwright), copie os cookies de sessão
  e monte o `load/.sessoes.json`.
- **Cookies prontos**: passe-os direto ao k6 em `SESSOES_JSON`, como texto JSON
  ou caminho de arquivo:

  ```bash
  SESSOES_JSON='[{"email":"a@exemplo.test","cookie":"better-auth.session_token=..."}]' \
  BASE_URL=https://staging.exemplo.com PROFILE=escada npm run load
  ```

  Formato: lista de `{ "email": "...", "cookie": "nome=valor; outro=valor" }`.
  Use pelo menos 3 ou 4 sessões (cada VU usa uma delas).

Só rode contra um ambiente seu e de teste, nunca contra produção com usuários
de verdade: o teste cria e apaga clientes e dispara tentativas de login.

## Medir um app publicado (passo final do deploy)

Contra o app de verdade, use a SUA sessão (cookie
`__Secure-better-auth.session_token`, copiado das ferramentas do navegador) e
tire a rajada no login com `SEM_RAJADA=1`, que senão manda e-mails reais:

```bash
SEM_RAJADA=1 PROFILE=escada BASE_URL=https://<seu-app> \
SESSOES_JSON='[{"email":"voce@seudominio.com","cookie":"__Secure-better-auth.session_token=<valor>"}]' \
npm run load
```

Use a escada, não o smoke: o smoke tem poucos pedidos e pega o Worker frio, e
o p95 dele oscila muito. O passo a passo completo está na skill `/deploy`
(seção 7).

## Como a escrita funciona

Com escrita configurada, o roteiro procura os identificadores das server functions no JavaScript servido pela página. Em build, calcula `sha256("<arquivo>--<função>_createServerFn_handler")` e confirma o resultado nos chunks. Os identificadores também podem vir de `CRIAR_FN_ID` e `APAGAR_FN_ID`. A medição só representa gravação quando a criação e a exclusão são confirmadas.

## A rajada de login e o IP

A rajada manda 8 POSTs com e-mails novos em `/api/auth/email-otp/send-verification-otp`
e confere que do 6º em diante vem `429` (o limite é 5 por minuto por IP). Em
localhost o script envia um `cf-connecting-ip` fixo por rodada, então o IP é
nosso e os 5 primeiros também são conferidos (têm de passar). **Fora de
localhost o cabeçalho não é enviado**: a borda da Cloudflare escreve o IP real
de quem roda o k6, e todas as rodadas saem do mesmo IP. Por isso, na borda só
se confere o `429` do 6º ao 8º pedido, e a primeira rodada pode já pegar o IP
bloqueado por outra. Sem provedor de e-mail em staging, o envio do código falha
(500) e a rajada acusa o check; configure o e-mail antes.

## CPU p99 não vem do k6

O k6 mede o tempo que o cliente espera, não o tempo de CPU gasto pelo Worker.
O p99 de CPU vem do **Workers Observability** (painel da Cloudflare, ou a API
de consulta de logs/métricas), no campo `cpuTime` dos eventos de invocação.
Rode a escada e, no mesmo intervalo de tempo, leia lá o `cpuTime` p99 do
Worker. O plano gratuito limita a CPU por requisição (10 ms), então esse número
é o que mais importa para quem está nele.

## Histórico de referência da infraestrutura anterior ao ZapCRM

### Rodada de 2026-11-11, staging, ANTES das correções

Worker no Rio, D1 primário em ENAM (costa leste dos EUA), perfil `escada`:
9.735 pedidos, 0% de erro.

| Cenário          | p95 medido | Meta     |
| ---------------- | ---------- | -------- |
| `estatico`       | 32 ms      | < 100 ms |
| `ssr_publico`    | 70 ms      | < 300 ms |
| `ssr_logado`     | 1.064 ms   | < 500 ms |
| `escrita_logada` | 915 ms     | < 600 ms |

Causa: várias consultas seguidas ao D1 por página, cada uma atravessando o
continente. Correções aplicadas depois: Smart Placement, cache da sessão em
cookie (60 s) e Sessions API do D1 por pedido (veja "Decisões registradas" no
`AGENTS.md`).

### Rodada DEPOIS das correções (2026-11-11)

Mesmo staging (conta Teste, Worker pedido no Rio, D1 em `ENAM`), mesma escada
(9.734 pedidos, 7 min 40 s, 0% de erro HTTP). Read replication DESLIGADA.
Cache da sessão (60 s) e Sessions API do D1 ligados.

O Smart Placement (`mode: "smart"`) ficou em `cf-placement: local-GIG` depois
de 15 min de aquecimento: todo o tráfego do teste sai do Rio, e o modo
automático só decide com tráfego de vários lugares. Para medir o ganho de rodar
perto do banco, esta rodada usou a dica explícita `placement.region:
"aws:us-east-1"` SÓ no staging (`cf-placement: remote-IAD`). Na época o template
usava `mode: "smart"`; desde 18/11 vem com a região fixa (rodada 4).

| Cenário          | p95 antes | p95 depois | Mediana depois | Meta     |
| ---------------- | --------- | ---------- | -------------- | -------- |
| `estatico`       | 32 ms     | 31 ms      | 17 ms          | < 100 ms |
| `ssr_publico`    | 70 ms     | 235 ms     | 161 ms         | < 300 ms |
| `ssr_logado`     | 1.064 ms  | 546 ms     | 294 ms         | < 500 ms |
| `escrita_logada` | 915 ms    | 448 ms     | 268 ms         | < 600 ms |

Leitura:

- Página logada e escrita caíram pela metade: as consultas ao D1 agora são
  locais, só a resposta viaja Rio-EUA uma vez.
- A página pública piorou (70 para 235 ms): com a dica de região, até a página
  que não consulta o banco vai aos EUA. A colocação automática (`smart`) não
  tem esse custo, porque o Worker fica no Rio. Mas a rodada 4 (abaixo) mostrou
  que, medida direito (18/11/2026), a região fixa ganha no logado e na gravação.
- `ssr_logado` ainda passa da meta no p95 (546 ms). Próximos passos: ligar a
  Read Replication (réplica perto do usuário) e conferir quantas consultas uma
  página logada faz em sequência.
- A rajada no login falha de propósito no staging: sem provedor de e-mail, o
  envio do código dá erro; o 429 continua aparecendo no 6º pedido.

### Rodada 3: réplica de leitura + menos consultas por página (2026-11-11)

Mesmo staging e mesma escada, com `placement.region: "aws:us-east-1"` (igual à
rodada 2, para comparar igual com igual), Read Replication LIGADA no D1
(`read_replication.mode: auto`) e as páginas logadas fazendo 2 idas em fila ao
banco em vez de 5 (sessão e usuário num JOIN, sessão lida uma vez por pedido).
0% de erro HTTP.

| Cenário          | Antes    | Rodada 2 | Rodada 3 | Mediana 3 | Meta     |
| ---------------- | -------- | -------- | -------- | --------- | -------- |
| `estatico`       | 32 ms    | 31 ms    | 33 ms    | 17 ms     | < 100 ms |
| `ssr_publico`    | 70 ms    | 235 ms   | 229 ms   | 161 ms    | < 300 ms |
| `ssr_logado`     | 1.064 ms | 546 ms   | 385 ms   | 221 ms    | < 500 ms |
| `escrita_logada` | 915 ms   | 448 ms   | 419 ms   | 247 ms    | < 600 ms |

Todas as metas de p95 passam. O `ssr_publico` maior que na primeira rodada é
efeito da região forçada no staging (até a página sem banco vai aos EUA); em
produção o template usava `mode: "smart"`; desde 18/11 usa a região fixa.

### Rodada 4: colocação automática contra região fixa (17 e 18/11/2026)

Worker de teste, D1 em `ENAM`, k6 vindo do Brasil (entrada pelo Rio, `GIG`),
escada com gravação. p95 em ms.

**A medição de 17/11 com região fixa está errada**: foi feita antes de a
colocação ficar ativa (o cabeçalho `cf-placement` não apareceu). Por isso deu
login 708 e logado 741 ms. Vale a de 18/11, com `cf-placement: remote-IAD`
confirmado (região fixa `aws:us-east-1`) e 40 contas. Na automática o Worker
ficou no Rio (`local-GIG`).

| Cenário          | Meta | auto 17/11 | auto 18/11 | região 17/11 (errada) | região 18/11 |
| ---------------- | ---- | ---------- | ---------- | --------------------- | ------------ |
| `estatico`       | 100  | 31         | 28         | 35                    | 22           |
| `ssr_publico`    | 300  | 122        | 103        | 708                   | 198          |
| `ssr_logado`     | 500  | 408        | 378        | 741                   | **248**      |
| `escrita_logada` | 600  | 594        | 507        | 444                   | **278**      |
| Falhas           | < 1% | 1,02%      | 0%         | 0,06%                 | 0%           |

Dentro do Worker (mediana), 18/11: GET /app 246 ms com a automática e 19 ms com
a região fixa. Cada ida ao D1 custa 130 a 190 ms com o Worker no Rio e uns
30 ms perto do banco.

Regra: a colocação automática só move o Worker se ele já rodou perto do banco;
com público só no Brasil ele fica no Rio. Fixar `placement.region` perto do D1
ganhou em tudo, menos na página pública renderizada no servidor (103 para
198 ms, as duas dentro da meta de 300). Por isso o template tem banco e vem com a região fixa perto dele (`aws:us-east-1`,
D1 em ENAM), com banco e Worker criados juntos. Sem banco, tire a região;
público fora das Américas, mude os dois juntos. Sempre confira `cf-placement`
antes de medir.

As falhas de 17/11 (1,02% na automática) eram o limite por usuário de 60
leituras por minuto estourado com 20 contas (reproduzido no `vite dev`; com 40
contas, em 18/11, sumiram) (veja "Contas de teste", acima). Cada número é uma
rodada só.
