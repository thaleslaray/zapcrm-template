# ZapCRM

CRM para equipes que atendem clientes por WhatsApp.

- **Conversas:** a fila, o chat e a ficha do contato na mesma tela, com notas internas e respostas rápidas.
- **Funil:** cada negócio anda por etapa, com um responsável.
- **Retornos:** o compromisso de voltar a falar com o contato, com data e hora, e aviso de atraso.
- **Contatos:** uma ficha por telefone, com etiquetas e notas.
- **Configurações:** números de WhatsApp, setores, equipe, funis, etiquetas e respostas rápidas.

Cada setor (Comercial, Pós-venda) tem os seus números, o seu funil e as suas pessoas. O gestor vê e configura tudo; o vendedor vê os setores a que pertence. Os termos do produto estão em `GLOSSARY.md`.

## O que você precisa

- Node 22 ou mais novo.
- Uma conta na Cloudflare, para publicar. Para rodar no seu computador não precisa.
- Um servidor [uazapi](https://uazapi.com), para conectar o WhatsApp. É um serviço pago de terceiros e **não é a API oficial da Meta**: o número conectado segue as regras e os riscos de uma conexão não oficial. Sem ele, o resto do sistema funciona, mas nenhuma conversa chega.

## Rodar no seu computador

1. Instale as dependências:

   ```bash
   npm ci
   ```

2. Crie o arquivo de segredos locais:

   ```bash
   cp .dev.vars.example .dev.vars
   ```

   Abra o `.dev.vars` e preencha três linhas:

   | Variável | O que pôr |
   |---|---|
   | `BETTER_AUTH_SECRET` | A saída de `openssl rand -base64 32` |
   | `UAZAPI_CHAVE` | Outra saída de `openssl rand -base64 32`. Protege os tokens dos números no banco. Sem ela, conectar um número falha com "Configure a chave dos números do WhatsApp." |
   | `ACCESS_ALLOWLIST` | Os e-mails que podem entrar, separados por vírgula. Vazio, ninguém entra |

   As outras variáveis são opcionais e estão explicadas no próprio arquivo.

3. Crie o banco local e suba o sistema:

   ```bash
   npm run db:migrate:local
   npm run dev
   ```

4. Abra <http://localhost:3000>. Digite um e-mail da lista de acesso. Sem provedor de e-mail configurado, o código de seis dígitos aparece no terminal.

A primeira pessoa que entra vira gestora. Quem entra depois aguarda a gestão atribuir um setor.

## Conectar o WhatsApp

Em **Configurações**, a gestão cadastra o servidor uazapi (endereço e token administrativo) e depois adiciona um número, lendo o QR Code com o celular. Cada número pertence a um setor e tem um funil padrão.

Grupos ficam de fora: o ZapCRM trata só conversas individuais.

## Publicar na Cloudflare

O sistema roda em um Cloudflare Worker, com banco D1 e arquivos no R2. O `wrangler.jsonc` vem sem identificação de banco e sem domínio: no primeiro `wrangler deploy`, a Cloudflare cria o banco e o armazenamento na **sua** conta.

O passo a passo completo, com login, migrações e segredos, está em `.claude/skills/deploy/SKILL.md`. Com o Claude Code aberto na pasta, basta pedir "publica o sistema".

Em produção:

- Os mesmos três segredos do passo 2 precisam subir como segredos do Worker. Use valores novos, não os do seu computador.
- O login por código exige um provedor de e-mail (`RESEND_API_KEY` e `EMAIL_FROM`, ou o Cloudflare Email Service). Fora do `localhost`, sem provedor, o envio falha de propósito.
- A identidade do sistema (nome, endereço e e-mail de suporte) fica em `src/config/app.ts`. Troque os endereços `.example` pelos seus.
- As páginas de Termos e Privacidade são um **modelo**. Revise com um advogado e preencha a empresa responsável antes de abrir para clientes.

## Como é feito

TanStack Start, Router e Query; autenticação por código com Better Auth; Drizzle sobre D1; fotos de perfil no R2; um Durable Object para o tempo real; um cron diário para retenção e ciclo de vida das contas.

- As regras para quem programa (pessoa ou agente) estão em `AGENTS.md`; a direção visual, em `src/CLAUDE.md`.
- Para criar uma tela nova, siga `.claude/skills/tela/SKILL.md`.

## Conferir antes de entregar

```bash
npm run check:fix
npm run typecheck
npm run test
npm run build
E2E_PORT=3212 E2E_PREVIEW_PORT=3213 npm run e2e
```

Os testes de navegador usam o banco local e um servidor uazapi falso que vem em `e2e/uazapi/`; não tocam em nenhum WhatsApp de verdade.
