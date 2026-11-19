ALTER TABLE `numeros` ADD `webhook_verificado_em` integer;--> statement-breakpoint
ALTER TABLE `numeros` ADD `webhook_reconciliacao_pendente` integer DEFAULT false NOT NULL;
--> statement-breakpoint
DROP TRIGGER recibo_ao_inserir;
--> statement-breakpoint
DROP TRIGGER recibo_ao_associar;
--> statement-breakpoint
CREATE TRIGGER recibo_ao_inserir AFTER INSERT ON mensagens
WHEN NEW.identificador IS NOT NULL AND EXISTS (
  SELECT 1 FROM recibos_pendentes WHERE numero_id=NEW.numero_id AND identificador=NEW.identificador
)
BEGIN
  UPDATE mensagens SET estado=CASE
    WHEN estado='lida' OR (SELECT nivel FROM recibos_pendentes WHERE numero_id=NEW.numero_id AND identificador=NEW.identificador)=3 THEN 'lida'
    WHEN estado='entregue' OR (SELECT nivel FROM recibos_pendentes WHERE numero_id=NEW.numero_id AND identificador=NEW.identificador)=2 THEN 'entregue'
    WHEN estado='falha' OR (SELECT nivel FROM recibos_pendentes WHERE numero_id=NEW.numero_id AND identificador=NEW.identificador)=-1 THEN 'falha'
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
    WHEN estado='falha' OR (SELECT nivel FROM recibos_pendentes WHERE numero_id=NEW.numero_id AND identificador=NEW.identificador)=-1 THEN 'falha'
    ELSE 'enviada' END WHERE id=NEW.id AND direcao='enviada';
  DELETE FROM recibos_pendentes WHERE numero_id=NEW.numero_id AND identificador=NEW.identificador;
END;
