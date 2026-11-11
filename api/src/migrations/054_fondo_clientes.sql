-- 054 · Fondo de página por cliente; color opcional para preservar tema existente.
ALTER TABLE farmetrica.cliente_apariencia
 ADD COLUMN IF NOT EXISTS color_fondo text NOT NULL DEFAULT '';
-- Idempotente: la restricción evita valores inválidos y permite el fondo heredado.
DO $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conname='cliente_apariencia_color_fondo_ck'
    AND conrelid='farmetrica.cliente_apariencia'::regclass
 ) THEN
  ALTER TABLE farmetrica.cliente_apariencia
   ADD CONSTRAINT cliente_apariencia_color_fondo_ck
   CHECK(color_fondo='' OR color_fondo ~ '^#[0-9A-Fa-f]{6}$');
 END IF;
END $$;
-- Verde agua muy claro a partir del tema de Farmacia Abadía.
-- Un valor ya personalizado nunca se sobrescribe.
UPDATE farmetrica.cliente_apariencia
 SET color_fondo='#EFF8F6', actualizado_en=now()
WHERE cliente_slug='ampedia' AND color_fondo='';
