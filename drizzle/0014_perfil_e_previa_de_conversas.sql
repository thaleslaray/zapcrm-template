ALTER TABLE `contatos` ADD `foto_url` text;--> statement-breakpoint
ALTER TABLE `contatos` ADD `foto_chave` text;--> statement-breakpoint
ALTER TABLE `contatos` ADD `foto_tentativa_em` integer;--> statement-breakpoint
ALTER TABLE `conversas` ADD `previa_texto` text;--> statement-breakpoint
ALTER TABLE `conversas` ADD `previa_tipo` text;--> statement-breakpoint
ALTER TABLE `conversas` ADD `previa_direcao` text;--> statement-breakpoint
ALTER TABLE `conversas` ADD `previa_em` integer;
--> statement-breakpoint
UPDATE mensagens
SET texto = substr(texto, instr(texto, char(10)) + 1)
WHERE substr(texto, 1, instr(texto, char(10)) - 1)
      IN ('Mensagem não suportada', 'Mensagem não suportada' || char(13))
  AND instr(texto, char(10)) > 0
  AND length(trim(substr(texto, instr(texto, char(10)) + 1), char(9,10,13,32))) > 0;
