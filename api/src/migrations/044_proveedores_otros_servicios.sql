-- Separar proveedores externos de servicios y suministros de movimientos internos
-- y de laboratorios. Idempotente; ninguna compra/recepción histórica se altera.
DO $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid='farmetrica.proveedores_unificados'::regclass
   AND conname='proveedores_unificados_clase_v2_check'
 ) THEN
  ALTER TABLE farmetrica.proveedores_unificados
   DROP CONSTRAINT IF EXISTS proveedores_unificados_clase_check;
  ALTER TABLE farmetrica.proveedores_unificados
   ADD CONSTRAINT proveedores_unificados_clase_v2_check
   CHECK (clase IN ('DIRECTO','MAYORISTA','INTERNO','OTROS','VACUNAS','FÓRMULAS','SIN_CLASIFICAR'));
 END IF;
END $$;

-- Lotes idempotentes, auditables y reversibles. Se conserva cada nombre,
-- categoría anterior y sello de actualización para rollback selectivo.
CREATE TABLE IF NOT EXISTS farmetrica.proveedores_reclasificacion_lotes (
 id uuid PRIMARY KEY,
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug),
 criterio text NOT NULL,
 creado_en timestamptz NOT NULL DEFAULT now(),
 revertido_en timestamptz,
 UNIQUE(cliente_slug,criterio)
);
CREATE TABLE IF NOT EXISTS farmetrica.proveedores_reclasificacion_cambios (
 lote uuid NOT NULL REFERENCES farmetrica.proveedores_reclasificacion_lotes(id),
 proveedor_id bigint NOT NULL,
 nombre text NOT NULL,
 clase_anterior text NOT NULL,
 clase_nueva text NOT NULL,
 razon text NOT NULL,
 actualizado_aplicacion timestamptz NOT NULL,
 PRIMARY KEY(lote,proveedor_id)
);
