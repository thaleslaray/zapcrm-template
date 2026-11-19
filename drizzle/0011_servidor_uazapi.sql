CREATE TABLE `servidor_uazapi` (
	`id` integer PRIMARY KEY NOT NULL,
	`endereco` text NOT NULL,
	`token_cifrado` text NOT NULL,
	`salvo_por` text,
	`salvo_em` integer NOT NULL,
	FOREIGN KEY (`salvo_por`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "servidor_uazapi_unico" CHECK("servidor_uazapi"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE `numeros` ADD `servidor_origem` text;