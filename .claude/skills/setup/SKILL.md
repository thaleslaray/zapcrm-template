---
name: setup
description: Prepara o ZapCRM local com D1, lista de acesso e login por código.
---

# Rodar o ZapCRM

1. Com Node 22 ou mais novo e npm, instale as versões do lock usando `npm ci`.
2. Em um clone novo, copie `.dev.vars.example` para `.dev.vars`. Preencha `BETTER_AUTH_SECRET` com a saída de `openssl rand -base64 32` e `ACCESS_ALLOWLIST` com os e-mails permitidos, separados por vírgula. Mantenha as credenciais locais fora do Git.
3. Execute `npm run db:migrate:local` e `npx vite dev --port 3211 --strictPort`. Com `BETTER_AUTH_URL` vazio, a origem vem do pedido.
4. Abra a raiz. O ZapCRM pede o e-mail e o código de seis dígitos. No dev local sem provedor, o código chega ao terminal. A primeira pessoa entra como gestora e vai para Conversas. Quem entra depois aguarda a liberação de um setor.
5. Para os testes, use `E2E_PORT=3212 E2E_PREVIEW_PORT=3213 npm run e2e`. O login de teste usa e-mail `qa-*@exemplo.test` no servidor local do Playwright.

O Worker serve a aplicação, o D1 guarda contas e dados compartilhados, e o R2 guarda as fotos de perfil. A interface da base usa exemplos fictícios da Lumen Solar. Os opcionais de e-mail, login social e senha estão descritos em `.dev.vars.example`.
