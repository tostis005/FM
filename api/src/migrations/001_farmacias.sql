-- Migración idempotente para instalación inicial en Contabo.
-- Identificadores de farmacia: enteros 1, 2, 3, 4, 5.
-- Sin DROP, TRUNCATE ni eliminación de datos. Fallará de forma explícita
-- si existe un esquema antiguo incompatible, para exigir una migración
-- supervisada que preserve relaciones y datos existentes.
CREATE TABLE IF NOT EXISTS public.farmacias (
  id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 999999),
  nombre TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
  ciudad TEXT NOT NULL DEFAULT '',
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  codigo_origen VARCHAR(16) NOT NULL UNIQUE,
  host_origen VARCHAR(255),
  bd_origen VARCHAR(100) NOT NULL DEFAULT 'Farmatic',
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
 IF EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='farmacias'
    AND column_name='id' AND data_type <> 'integer'
 ) THEN
  RAISE EXCEPTION 'Tabla farmacias existente con IDs no numéricos. Detener y migrar con copia de seguridad.';
 END IF;
END $$;

-- ABA en servidor local sin IP en SQL recibido. EUR=Europa, POL=Valdemarías.
INSERT INTO public.farmacias
 (id, nombre, ciudad, activo, codigo_origen, host_origen, bd_origen)
VALUES
 (1, 'Abadía', '', true, 'ABA', NULL, 'Farmatic'),
 (2, 'Europa', '', true, 'EUR', '192.168.11.11', 'Farmatic'),
 (3, 'Buenavista', '', true, 'BUE', '192.168.13.11', 'Farmatic'),
 (4, 'Estación', '', true, 'EST', '192.168.12.11', 'Farmatic'),
 (5, 'Valdemarías', '', true, 'POL', '192.168.14.11', 'Farmatic')
ON CONFLICT (id) DO NOTHING;

-- Solo actualiza antiguos nombres provisionales; respeta nombres personalizados.
UPDATE public.farmacias SET nombre='Europa', actualizado_en=now()
WHERE id=2 AND codigo_origen='EUR' AND nombre='Valdemarías (confirmar)';
UPDATE public.farmacias SET nombre='Valdemarías', actualizado_en=now()
WHERE id=5 AND codigo_origen='POL' AND nombre='Pendiente de nombre (POL)';

-- Tabla inicial de stock para ensayo de importación desde DBeaver.
CREATE TABLE IF NOT EXISTS public.stock_farmacia (
  id_farmacia INTEGER NOT NULL REFERENCES public.farmacias(id),
  id_articu TEXT NOT NULL,
  descripcion TEXT,
  stock_actual NUMERIC(18, 3),
  importado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id_farmacia, id_articu)
);
CREATE INDEX IF NOT EXISTS ix_stock_farmacia_id ON public.stock_farmacia(id_farmacia);
