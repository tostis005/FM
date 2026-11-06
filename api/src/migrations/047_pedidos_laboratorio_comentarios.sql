-- Comentarios generales por borrador de laboratorio, también exportados al Excel.
-- Aditiva: no modifica ni borra las líneas ni pedidos existentes.
ALTER TABLE farmetrica.pedidos_laboratorio_borradores
 ADD COLUMN IF NOT EXISTS comentario_global text NOT NULL DEFAULT '';
ALTER TABLE farmetrica.pedidos_laboratorio_borradores
 DROP CONSTRAINT IF EXISTS pedidos_laboratorio_comentario_global_len;
ALTER TABLE farmetrica.pedidos_laboratorio_borradores
 ADD CONSTRAINT pedidos_laboratorio_comentario_global_len
 CHECK (char_length(comentario_global)<=3000);
