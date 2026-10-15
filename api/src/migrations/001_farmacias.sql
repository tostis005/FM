-- Migración idempotente: no modifica tablas preexistentes ni elimina datos.
CREATE TABLE IF NOT EXISTS public.farmacias (
  id VARCHAR(16) PRIMARY KEY,
  nombre TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
  ciudad TEXT NOT NULL DEFAULT '',
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  codigo_origen VARCHAR(16) NOT NULL UNIQUE,
  host_origen VARCHAR(255),
  bd_origen VARCHAR(100) NOT NULL DEFAULT 'Farmatic',
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT farmacias_id_valido CHECK (id ~ '^[A-Z0-9_-]{2,16}$')
);

-- Correspondencias deducidas del SQL facilitado; EUR/Valdemarías es provisional.
-- El servidor local ABA no tiene IP en la consulta original.
INSERT INTO public.farmacias
 (id, nombre, ciudad, activo, codigo_origen, host_origen, bd_origen)
VALUES
 ('F001', 'Abadía', '', true, 'ABA', NULL, 'Farmatic'),
 ('F002', 'Valdemarías (confirmar)', '', true, 'EUR', '192.168.11.11', 'Farmatic'),
 ('F003', 'Buenavista', '', true, 'BUE', '192.168.13.11', 'Farmatic'),
 ('F004', 'Estación', '', true, 'EST', '192.168.12.11', 'Farmatic'),
 ('F005', 'Pendiente de nombre (POL)', '', true, 'POL', '192.168.14.11', 'Farmatic')
ON CONFLICT (id) DO NOTHING;

-- Tabla opcional para la primera prueba de importación de stock.
-- Para ventas se creará una tabla con esquema fiel al origen cuando dispongamos del DDL.
CREATE TABLE IF NOT EXISTS public.stock_farmacia (
  id_farmacia VARCHAR(16) NOT NULL REFERENCES public.farmacias(id),
  id_articu TEXT NOT NULL,
  descripcion TEXT,
  stock_actual NUMERIC(18, 3),
  importado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id_farmacia, id_articu)
);
CREATE INDEX IF NOT EXISTS ix_stock_farmacia_id ON public.stock_farmacia(id_farmacia);
