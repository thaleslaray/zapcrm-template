CREATE TABLE `arquivos_em_exclusao` (
	`chave` text PRIMARY KEY NOT NULL,
	`contato_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `arquivos_em_exclusao_contato` ON `arquivos_em_exclusao` (`contato_id`);