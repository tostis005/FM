-- La auditoría era visible por rol en clientes reales. Conservar esa
-- situación al migrar; nuevos clientes deberán habilitarla expresamente.
ALTER TABLE farmetrica.clientes ADD COLUMN IF NOT EXISTS auditoria_habilitada boolean NOT NULL DEFAULT true;
ALTER TABLE farmetrica.clientes ALTER COLUMN auditoria_habilitada SET DEFAULT false;
UPDATE farmetrica.clientes SET auditoria_habilitada=false
 WHERE demo_origen_slug IS NOT NULL AND auditoria_habilitada;
