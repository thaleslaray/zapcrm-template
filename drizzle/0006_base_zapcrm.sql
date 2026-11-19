CREATE TABLE `contatos` (
	`id` text PRIMARY KEY NOT NULL,
	`nome` text NOT NULL,
	`empresa` text,
	`telefone` text,
	`telefone_normalizado` text,
	`criado_em` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contatos_telefone_normalizado_unique` ON `contatos` (`telefone_normalizado`);--> statement-breakpoint
CREATE TABLE `contatos_etiquetas` (
	`contato_id` text NOT NULL,
	`etiqueta_id` text NOT NULL,
	PRIMARY KEY(`contato_id`, `etiqueta_id`),
	FOREIGN KEY (`contato_id`) REFERENCES `contatos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`etiqueta_id`) REFERENCES `etiquetas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `conversas` (
	`id` text PRIMARY KEY NOT NULL,
	`contato_id` text NOT NULL,
	`numero_id` text NOT NULL,
	`jid` text,
	`lid` text,
	`nao_lidas` integer DEFAULT 0 NOT NULL,
	`ultima_mensagem_em` integer,
	FOREIGN KEY (`contato_id`) REFERENCES `contatos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`numero_id`) REFERENCES `numeros`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversas_numero_contato` ON `conversas` (`numero_id`,`contato_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversas_numero_jid` ON `conversas` (`numero_id`,`jid`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversas_numero_lid` ON `conversas` (`numero_id`,`lid`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversas_numero_id` ON `conversas` (`numero_id`,`id`);--> statement-breakpoint
CREATE INDEX `conversas_atividade` ON `conversas` (`numero_id`,`ultima_mensagem_em`);--> statement-breakpoint
CREATE TABLE `convites` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`papel` text NOT NULL,
	`criado_em` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`aceito_em` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `convites_email_unique` ON `convites` (`email`);--> statement-breakpoint
CREATE TABLE `convites_setores` (
	`convite_id` text NOT NULL,
	`setor_id` text NOT NULL,
	PRIMARY KEY(`convite_id`, `setor_id`),
	FOREIGN KEY (`convite_id`) REFERENCES `convites`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`setor_id`) REFERENCES `setores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `etapas` (
	`id` text PRIMARY KEY NOT NULL,
	`funil_id` text NOT NULL,
	`nome` text NOT NULL,
	`cor` text NOT NULL,
	`posicao` integer NOT NULL,
	`fechamento` text,
	FOREIGN KEY (`funil_id`) REFERENCES `funis`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "etapas_fechamento_valido" CHECK("etapas"."fechamento" IN ('sucesso','perda'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `etapas_funil_fechamento` ON `etapas` (`funil_id`,`fechamento`);--> statement-breakpoint
CREATE UNIQUE INDEX `etapas_funil_id` ON `etapas` (`funil_id`,`id`);--> statement-breakpoint
CREATE INDEX `etapas_ordem` ON `etapas` (`funil_id`,`posicao`);--> statement-breakpoint
CREATE TABLE `etiquetas` (
	`id` text PRIMARY KEY NOT NULL,
	`nome` text NOT NULL,
	`cor` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `etiquetas_nome_unique` ON `etiquetas` (`nome`);--> statement-breakpoint
CREATE TABLE `funis` (
	`id` text PRIMARY KEY NOT NULL,
	`setor_id` text NOT NULL,
	`nome` text NOT NULL,
	`cor` text NOT NULL,
	FOREIGN KEY (`setor_id`) REFERENCES `setores`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `funis_setor_id` ON `funis` (`setor_id`,`id`);--> statement-breakpoint
CREATE TABLE `instalacao` (
	`id` integer PRIMARY KEY NOT NULL,
	`criado_em` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "instalacao_unica" CHECK("instalacao"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `mensagens` (
	`id` text PRIMARY KEY NOT NULL,
	`conversa_id` text NOT NULL,
	`numero_id` text NOT NULL,
	`identificador` text,
	`direcao` text NOT NULL,
	`tipo` text NOT NULL,
	`estado` text NOT NULL,
	`texto` text,
	`arquivo_chave` text,
	`arquivo_url` text,
	`arquivo_mime` text,
	`arquivo_nome` text,
	`arquivo_bytes` integer,
	`duracao_segundos` integer,
	`instante` integer NOT NULL,
	FOREIGN KEY (`numero_id`,`conversa_id`) REFERENCES `conversas`(`numero_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mensagens_numero_identificador` ON `mensagens` (`numero_id`,`identificador`);--> statement-breakpoint
CREATE INDEX `mensagens_conversa_instante` ON `mensagens` (`conversa_id`,`instante`);--> statement-breakpoint
CREATE TABLE `negocios` (
	`id` text PRIMARY KEY NOT NULL,
	`contato_id` text NOT NULL,
	`funil_id` text NOT NULL,
	`etapa_id` text NOT NULL,
	`numero_id` text,
	`responsavel_id` text,
	`origem_id` text,
	`valor_centavos` integer,
	`criado_em` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`fechado_em` integer,
	FOREIGN KEY (`contato_id`) REFERENCES `contatos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`funil_id`) REFERENCES `funis`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`numero_id`) REFERENCES `numeros`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`responsavel_id`) REFERENCES `pessoas`(`usuario_id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`origem_id`) REFERENCES `negocios`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`funil_id`,`etapa_id`) REFERENCES `etapas`(`funil_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `negocios_abertos_contato_funil` ON `negocios` (`contato_id`,`funil_id`) WHERE "negocios"."fechado_em" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `negocios_funil_origem` ON `negocios` (`funil_id`,`origem_id`);--> statement-breakpoint
CREATE INDEX `negocios_etapa` ON `negocios` (`etapa_id`);--> statement-breakpoint
CREATE TABLE `notas` (
	`id` text PRIMARY KEY NOT NULL,
	`contato_id` text NOT NULL,
	`conversa_id` text,
	`autor_id` text,
	`texto` text NOT NULL,
	`criado_em` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`contato_id`) REFERENCES `contatos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversa_id`) REFERENCES `conversas`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`autor_id`) REFERENCES `pessoas`(`usuario_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `notas_contato` ON `notas` (`contato_id`,`criado_em`);--> statement-breakpoint
CREATE TABLE `numeros` (
	`id` text PRIMARY KEY NOT NULL,
	`nome` text NOT NULL,
	`telefone` text,
	`cor` text NOT NULL,
	`setor_id` text NOT NULL,
	`funil_padrao_id` text NOT NULL,
	`estado` text DEFAULT 'desconectado' NOT NULL,
	`instancia_id` text,
	`token_cifrado` text,
	`segredo_webhook_hash` text,
	`dias_historico` integer DEFAULT 90 NOT NULL,
	`sincronizando_historico` integer DEFAULT false NOT NULL,
	`estado_em` integer,
	FOREIGN KEY (`setor_id`) REFERENCES `setores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`setor_id`,`funil_padrao_id`) REFERENCES `funis`(`setor_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `numeros_instancia_id_unique` ON `numeros` (`instancia_id`);--> statement-breakpoint
CREATE INDEX `numeros_setor` ON `numeros` (`setor_id`);--> statement-breakpoint
CREATE TABLE `pessoas` (
	`usuario_id` text PRIMARY KEY NOT NULL,
	`papel` text DEFAULT 'vendedor' NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "pessoas_papel_valido" CHECK("pessoas"."papel" IN ('gestor','vendedor'))
);
--> statement-breakpoint
CREATE TABLE `pessoas_setores` (
	`usuario_id` text NOT NULL,
	`setor_id` text NOT NULL,
	PRIMARY KEY(`usuario_id`, `setor_id`),
	FOREIGN KEY (`usuario_id`) REFERENCES `pessoas`(`usuario_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`setor_id`) REFERENCES `setores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `respostas_rapidas` (
	`id` text PRIMARY KEY NOT NULL,
	`atalho` text NOT NULL,
	`texto` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `respostas_rapidas_atalho_unique` ON `respostas_rapidas` (`atalho`);--> statement-breakpoint
CREATE TABLE `retornos` (
	`id` text PRIMARY KEY NOT NULL,
	`contato_id` text NOT NULL,
	`numero_id` text NOT NULL,
	`responsavel_id` text,
	`motivo` text NOT NULL,
	`marcado_para` integer NOT NULL,
	`feito_em` integer,
	FOREIGN KEY (`contato_id`) REFERENCES `contatos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`numero_id`) REFERENCES `numeros`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`responsavel_id`) REFERENCES `pessoas`(`usuario_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `retornos_agenda` ON `retornos` (`numero_id`,`marcado_para`);--> statement-breakpoint
CREATE TABLE `setores` (
	`id` text PRIMARY KEY NOT NULL,
	`nome` text NOT NULL
);
--> statement-breakpoint
DROP TABLE `clientes`;--> statement-breakpoint
DROP TABLE `todos`;