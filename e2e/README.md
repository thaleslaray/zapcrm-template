# Testes do ZapCRM

Com o D1 local migrado e o segredo de desenvolvimento configurado, rode
`E2E_PORT=3231 E2E_PREVIEW_PORT=3232 npm run e2e`. O Playwright sobe e encerra
o servidor de desenvolvimento, a prévia do build e a uazapi falsa na porta 3233. Cada execução cria um banco descartável em `.wrangler/e2e-state/`. O primeiro acesso a esse banco é o da gestora de teste.

O projeto `setup` entra pelo código do e-mail e grava `e2e/.auth/gestora.json`.
O projeto `chromium` herda essa sessão. Novas jornadas podem usar a fixture
`page` diretamente. Os testes de guarda, saída e encerramento usam contextos
separados para provar o acesso anônimo e preservar a sessão da equipe.

As jornadas J3 e J8 usam `UAZAPI_URL=http://127.0.0.1:3233` no `.dev.vars`. Gere `UAZAPI_CHAVE` com `openssl rand -base64 32` e use um valor aleatório de teste em `UAZAPI_ADMIN_TOKEN`. Para guardar capturas dessas jornadas, informe a pasta de destino em `ZAPCRM_CAPTURAS_03`.
