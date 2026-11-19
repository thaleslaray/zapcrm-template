CREATE TABLE `acessos_revogados` (
	`email` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `convites_encerrados` (
	`id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER proteger_gestor_ao_mudar_papel BEFORE UPDATE OF papel ON pessoas
WHEN OLD.papel='gestor' AND NEW.papel<>'gestor' AND NOT EXISTS (
  SELECT 1 FROM pessoas p JOIN user u ON u.id=p.usuario_id
  WHERE p.papel='gestor' AND u.deleted_at IS NULL AND p.usuario_id<>OLD.usuario_id
)
BEGIN SELECT RAISE(ABORT, 'ULTIMO_GESTOR'); END;
--> statement-breakpoint
CREATE TRIGGER proteger_gestor_ao_remover BEFORE DELETE ON pessoas
WHEN OLD.papel='gestor' AND NOT EXISTS (
  SELECT 1 FROM pessoas p JOIN user u ON u.id=p.usuario_id
  WHERE p.papel='gestor' AND u.deleted_at IS NULL AND p.usuario_id<>OLD.usuario_id
)
BEGIN SELECT RAISE(ABORT, 'ULTIMO_GESTOR'); END;
--> statement-breakpoint
CREATE TRIGGER proteger_gestor_ao_encerrar BEFORE UPDATE OF deleted_at ON user
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
AND EXISTS (SELECT 1 FROM pessoas WHERE usuario_id=OLD.id AND papel='gestor')
AND NOT EXISTS (
  SELECT 1 FROM pessoas p JOIN user u ON u.id=p.usuario_id
  WHERE p.papel='gestor' AND u.deleted_at IS NULL AND p.usuario_id<>OLD.id
)
BEGIN SELECT RAISE(ABORT, 'ULTIMO_GESTOR'); END;
--> statement-breakpoint
CREATE TRIGGER limpar_convite_ao_expurgar AFTER DELETE ON user
BEGIN DELETE FROM convites WHERE email=OLD.email AND aceito_em IS NOT NULL; END;
--> statement-breakpoint
CREATE TRIGGER lembrar_convite_encerrado AFTER DELETE ON convites
BEGIN INSERT OR IGNORE INTO convites_encerrados (id) VALUES (OLD.id); END;
