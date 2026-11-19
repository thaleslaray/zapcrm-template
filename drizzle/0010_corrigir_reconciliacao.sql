CREATE TABLE `mensagens_excluidas` (
	`marca` text PRIMARY KEY NOT NULL,
	`excluida_em` integer DEFAULT (unixepoch()*1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mensagens_excluidas_data` ON `mensagens_excluidas` (`excluida_em`);--> statement-breakpoint
ALTER TABLE `arquivos_em_exclusao` ADD `limpar_apos` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `mensagens` ADD `recebimento_ao_vivo` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `mensagens` ADD `marca_reentrega` text;--> statement-breakpoint
ALTER TABLE `mensagens` ADD `midia_recusada` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TRIGGER mensagens_marcar_exclusao AFTER DELETE ON mensagens
WHEN OLD.marca_reentrega IS NOT NULL
BEGIN
  INSERT OR REPLACE INTO mensagens_excluidas (marca) VALUES (OLD.marca_reentrega);
END;
--> statement-breakpoint
-- Recupera o atalho dos retornos antigos que já têm telefone de contato.
INSERT INTO conversas (id,contato_id,numero_id)
SELECT lower(hex(randomblob(16))),par.contato_id,par.numero_id FROM
  (SELECT DISTINCT r.contato_id,r.numero_id FROM retornos r JOIN contatos c ON c.id=r.contato_id
   WHERE c.telefone IS NOT NULL) par
WHERE NOT EXISTS (SELECT 1 FROM conversas cv WHERE cv.contato_id=par.contato_id AND cv.numero_id=par.numero_id);
--> statement-breakpoint
-- Fixa o endereço das conversas manuais anteriores, preservando o nono dígito.
-- Conversas identificadas pela uazapi conservam exatamente o JID ou LID recebido.
WITH RECURSIVE digitos(id,telefone,posicao,numero) AS (
  SELECT cv.id,c.telefone,1,'' FROM conversas cv JOIN contatos c ON c.id=cv.contato_id
  WHERE cv.jid IS NULL AND cv.lid IS NULL AND c.telefone IS NOT NULL
  UNION ALL
  SELECT id,telefone,posicao+1,numero || CASE WHEN substr(telefone,posicao,1) GLOB '[0-9]'
    THEN substr(telefone,posicao,1) ELSE '' END FROM digitos WHERE posicao<=length(telefone)
), destinos AS (
  SELECT id,CASE WHEN ltrim(telefone) LIKE '+%' OR
    (numero LIKE '55%' AND length(numero) IN (12,13)) THEN numero ELSE '55'||numero END AS numero
  FROM digitos WHERE posicao>length(telefone) AND length(numero) BETWEEN 7 AND 15
) UPDATE conversas SET jid=destinos.numero||'@s.whatsapp.net' FROM destinos WHERE conversas.id=destinos.id;
--> statement-breakpoint
-- A lista da instalação vem do Worker. A view recebe os e-mails elegíveis
-- só durante esta instrução; o gatilho verifica o estado no próprio lote.
CREATE VIEW conferir_substituto_gestor (pessoa, emails_liberados) AS
SELECT NULL, NULL WHERE 0;
--> statement-breakpoint
CREATE TRIGGER exigir_substituto_gestor INSTEAD OF INSERT ON conferir_substituto_gestor
WHEN EXISTS (SELECT 1 FROM pessoas WHERE usuario_id=NEW.pessoa AND papel='gestor')
AND NOT EXISTS (
  SELECT 1 FROM pessoas p JOIN user u ON u.id=p.usuario_id
  WHERE p.papel='gestor' AND p.usuario_id<>NEW.pessoa AND u.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM acessos_revogados r WHERE r.email=u.email)
    AND (u.email IN (SELECT value FROM json_each(NEW.emails_liberados))
      OR EXISTS (SELECT 1 FROM convites c WHERE c.email=u.email))
)
BEGIN SELECT RAISE(ABORT, 'ULTIMO_GESTOR'); END;
