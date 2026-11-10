-- Abreviatura editable de presentación, independiente del código origen ERP.
-- No reescribe ni migra codigo_origen ni identificadores de establecimientos.
ALTER TABLE farmetrica.farmacias
 ADD COLUMN IF NOT EXISTS codigo_visible varchar(8);
