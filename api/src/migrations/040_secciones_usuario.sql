-- Permisos de pantallas individuales por usuario y cliente.
-- NULL mantiene el acceso heredado de los usuarios ya existentes.
-- [] deniega todas las pantallas; se intersecta con modulos habilitados.
ALTER TABLE farmetrica.usuario_clientes
  ADD COLUMN IF NOT EXISTS secciones text[] DEFAULT NULL;
