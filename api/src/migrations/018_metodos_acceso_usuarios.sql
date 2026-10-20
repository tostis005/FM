-- Unificar métodos de acceso: Google y correo con contraseña local.
-- Compatibilidad con usuarios antiguos: "interno" era el nombre técnico
-- del acceso con contraseña, aunque la interfaz lo llamase "externo".
DO $fm_login_methods$
BEGIN
 IF EXISTS(
  SELECT 1 FROM information_schema.tables
  WHERE table_schema='farmetrica' AND table_name='usuario_clientes'
 ) THEN
  ALTER TABLE farmetrica.usuario_clientes
   DROP CONSTRAINT IF EXISTS usuario_clientes_metodo_acceso_check;
  UPDATE farmetrica.usuario_clientes
   SET metodo_acceso='local'
   WHERE metodo_acceso='interno';
  ALTER TABLE farmetrica.usuario_clientes
   ADD CONSTRAINT usuario_clientes_metodo_acceso_check
   CHECK (metodo_acceso IN ('google','local'));
 END IF;
END $fm_login_methods$;
