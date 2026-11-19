CREATE TABLE `avisos_pendentes` (
	`id` text PRIMARY KEY NOT NULL,
	`numero_id` text NOT NULL,
	`conteudo` text NOT NULL,
	`criado_em` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`numero_id`) REFERENCES `numeros`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `avisos_pendentes_ordem` ON `avisos_pendentes` (`criado_em`);--> statement-breakpoint
CREATE TABLE `recibos_pendentes` (
	`numero_id` text NOT NULL,
	`identificador` text NOT NULL,
	`nivel` integer NOT NULL,
	`criado_em` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`numero_id`, `identificador`),
	FOREIGN KEY (`numero_id`) REFERENCES `numeros`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `mensagens` ADD `identificador_provedor` text;--> statement-breakpoint
ALTER TABLE `mensagens` ADD `tentativa_em` integer;--> statement-breakpoint
ALTER TABLE `numeros` ADD `historico_pedido` text;--> statement-breakpoint
ALTER TABLE `numeros` ADD `historico_ordem` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TRIGGER recibo_ao_inserir AFTER INSERT ON mensagens
WHEN NEW.identificador IS NOT NULL AND EXISTS (
  SELECT 1 FROM recibos_pendentes WHERE numero_id=NEW.numero_id AND identificador=NEW.identificador
)
BEGIN
  UPDATE mensagens SET estado=CASE
    WHEN estado='lida' OR (SELECT nivel FROM recibos_pendentes WHERE numero_id=NEW.numero_id AND identificador=NEW.identificador)=3 THEN 'lida'
    WHEN estado='entregue' OR (SELECT nivel FROM recibos_pendentes WHERE numero_id=NEW.numero_id AND identificador=NEW.identificador)=2 THEN 'entregue'
    ELSE 'enviada' END WHERE id=NEW.id AND direcao='enviada';
  DELETE FROM recibos_pendentes WHERE numero_id=NEW.numero_id AND identificador=NEW.identificador;
END;

--> statement-breakpoint
CREATE TRIGGER recibo_ao_associar AFTER UPDATE OF identificador ON mensagens
WHEN NEW.identificador IS NOT NULL AND EXISTS (
  SELECT 1 FROM recibos_pendentes WHERE numero_id=NEW.numero_id AND identificador=NEW.identificador
)
BEGIN
  UPDATE mensagens SET estado=CASE
    WHEN estado='lida' OR (SELECT nivel FROM recibos_pendentes WHERE numero_id=NEW.numero_id AND identificador=NEW.identificador)=3 THEN 'lida'
    WHEN estado='entregue' OR (SELECT nivel FROM recibos_pendentes WHERE numero_id=NEW.numero_id AND identificador=NEW.identificador)=2 THEN 'entregue'
    ELSE 'enviada' END WHERE id=NEW.id AND direcao='enviada';
  DELETE FROM recibos_pendentes WHERE numero_id=NEW.numero_id AND identificador=NEW.identificador;
END;
