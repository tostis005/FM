-- Permisos granulares por usuario y cliente. NULL = acceso heredado
-- para cuentas ya existentes antes del lanzamiento; [] = ningún módulo.
-- Toda autorización se intersecta siempre con cliente_modulos.habilitado.
ALTER TABLE farmetrica.usuario_clientes
  ADD COLUMN IF NOT EXISTS modulos text[] DEFAULT NULL;
CREATE INDEX IF NOT EXISTS usuario_clientes_modulos_gin
  ON farmetrica.usuario_clientes USING gin(modulos);
