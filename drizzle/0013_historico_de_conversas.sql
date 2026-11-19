CREATE TABLE `pedidos_historico` (
	`conversa_id` text PRIMARY KEY NOT NULL,
	`pedido_id` text NOT NULL,
	`estado` text NOT NULL,
	`iniciado_em` integer NOT NULL,
	`motivo` text,
	`proximo` text,
	FOREIGN KEY (`conversa_id`) REFERENCES `conversas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pedidos_historico_pedido_id_unique` ON `pedidos_historico` (`pedido_id`);--> statement-breakpoint
ALTER TABLE `contatos` ADD `nome_editado` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `conversas` ADD `nao_lidas_em` integer;--> statement-breakpoint
ALTER TABLE `numeros` ADD `reconciliacao_cursor` text;--> statement-breakpoint
ALTER TABLE `numeros` ADD `reconciliacao_em` integer;
--> statement-breakpoint
CREATE TRIGGER numeros_reiniciar_historico_do_vinculo AFTER UPDATE OF token_cifrado ON numeros
WHEN NEW.token_cifrado IS NOT OLD.token_cifrado
BEGIN
  UPDATE numeros SET reconciliacao_cursor = NULL, reconciliacao_em = NULL WHERE id = NEW.id;
  DELETE FROM pedidos_historico WHERE conversa_id IN (SELECT id FROM conversas WHERE numero_id = NEW.id);
END;
