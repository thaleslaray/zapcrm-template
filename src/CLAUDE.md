# Direção visual do ZapCRM

Aprovada em 18/11/2026. A referência de composição, densidade, tipografia, estados e dados é o mockup em `.scratch/zapcrm/mockup/`. Compare a tela com a captura do mesmo destino, estado, largura e modo de cor.

## Superfícies, tipografia e controles

- Use os tokens do produto em `src/crm.css` e os equivalentes de Tailwind em `src/styles.css`. A classe `.dark` ativa o modo escuro.
- A marca verde-petróleo usa `--brand` (#0F766E no claro, #14B8A6 no escuro). Ela colore a ação principal, o foco, o destino ativo, o contador e a hora das conversas não lidas. `--read` identifica a leitura da mensagem, enquanto `--bubble-out` identifica o lado enviado. Os estados têm também texto, ícone ou número. **(teste)**
- A casca usa `--bg`, as colunas e cartões usam `--surface`, o plano recuado usa `--sunken`. Use `--text`, `--text-2` e `--text-3` para hierarquia. Reserve `--shadow-card` (anel de 1 px e duas sombras) para superfícies elevadas, `--shadow-pop` para a gaveta e os menus. Controles usam `--r-ctl` (8 px), cartões `--r-card` (12 px). **(teste)**
- Inter com fonte de sistema como alternativa, títulos com peso 600 e espaçamento levemente negativo. Valores, contadores e horários usam números tabulares. Evite peso maior nos títulos. **(teste)**
- Cores auxiliares têm função. Avatares usam as oito duplas `--av*b/f`, etapas usam `--st-*`, funis `--pp-*`, números `--num-*` e etiquetas `--tg-*`. Iniciais, nomes e símbolos acompanham a cor. Componentes consomem tokens; a marca oficial do Google conserva suas cores. **(teste)**
- Use a variante `brand` de Button para a ação principal. Controles só com ícone têm nome acessível em português e foco visível. Use transições nomeadas de cor e superfície. **(teste)**

## Composição e navegação

- Desde 1024 px, Conversas combina barra de destinos, lista, chat e painel do contato. A lista e o painel conservam a largura em telas grandes. Entre 768 e 1023 px, o painel abre sobre o chat.
- Abaixo de 768 px, use uma coluna por vez, abas inferiores com ícone e nome e áreas seguras. Voltar do painel conduz ao chat e voltar do chat conserva o estado da lista.
- O chat usa desenhos sutis, balões com cauda no início de cada sequência, hora e entrega no balão, pílulas de dia, aviso à equipe e nota interna centralizada. O selo de retorno atrasado inclui relógio e texto.
- No Funil compacto, a etapa é escolhida nas pílulas acima dos cartões. Contatos mostra linhas que cabem no celular. Configurações mantém um destino para cada seção, incluindo o fluxo de conexão por QR e telefone.

Para criar uma tela, siga `.claude/skills/tela/SKILL.md`. Confira primeiro as peças de `src/components/ui/`, o kit em `src/components/app/` e as telas de `src/components/crm/`.
