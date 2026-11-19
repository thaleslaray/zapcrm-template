---
name: tela
description: Cria ou ajusta telas do ZapCRM seguindo o mockup aprovado e os componentes do produto.
---

# Criar uma tela do ZapCRM

1. Leia o critério do ticket, o glossário, a seção da spec, `src/CLAUDE.md` e a captura do mockup para o mesmo destino. Use Conversas como molde para chat e painel, Funil para etapas, Contatos para listas e Configurações para formulários.
2. Procure a peça existente em `src/components/ui/`, `src/components/app/` e `src/components/crm/`. Para uma peça ausente, consulte o catálogo shadcn antes de desenhá-la. Ao incorporar uma primitiva, use `#/lib/utils`, tokens e transições nomeadas.
3. Página privada pertence a `src/routes/_app/app/` e herda o guard de `_app.tsx`. A leitura real usa uma query compartilhada entre loader e componente. No servidor confira a sessão e o acesso aos setores. Limite leituras e escritas por pessoa, valide entradas, aplique a mudança e invalide as queries afetadas.
4. Mostre o estado normal, carregamento, falta de dados, busca vazia, erro e falta de permissão de acordo com o ticket. Dê nome acessível e foco aos controles. O CTA principal tem verbo direto em português.
5. Confira a tela em claro e escuro com os breakpoints e a navegação de volta previstos na spec. Para o ticket de base, use 1440×900 e 390×844, com capturas em 2x. Observe a posição das ações, da barra de digitar e das abas.
6. Rode estilo, tipos, unidades e os testes de ponta a ponta da jornada. Use o estado autenticado do Playwright e as portas designadas à worktree.
