-- Referencia del contrato inicial de Farmétrica Sync.
-- El sincronizador puede crear estas tablas automáticamente (si el usuario PostgreSQL tiene DDL).
-- Si utilizáis migraciones controladas, ejecutar este archivo previamente y dar permisos DML al sincronizador.
CREATE SCHEMA IF NOT EXISTS farmetrica;

CREATE TABLE IF NOT EXISTS farmetrica.ventas (
  farmacia_codigo text NOT NULL,
  farmacia text GENERATED ALWAYS AS (farmacia_codigo) STORED,
  origen_id text NOT NULL,
  fecha timestamp without time zone,
  articulo_id text,
  unidades numeric(18,4),
  precio_unitario numeric(18,4),
  importe numeric(18,4),
  numero_ticket text,
  descuento_linea numeric(18,4),
  descuento_operacion numeric(18,4),
  sincronizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (farmacia_codigo, origen_id)
);
CREATE INDEX IF NOT EXISTS ix_ventas_fecha ON farmetrica.ventas (fecha);
CREATE INDEX IF NOT EXISTS ix_ventas_articulo ON farmetrica.ventas (articulo_id);

CREATE TABLE IF NOT EXISTS farmetrica.compras (
  farmacia_codigo text NOT NULL,
  farmacia text GENERATED ALWAYS AS (farmacia_codigo) STORED,
  origen_id text NOT NULL,
  fecha timestamp without time zone,
  articulo_id text,
  proveedor_id text,
  unidades numeric(18,4),
  coste_unitario numeric(18,4),
  importe numeric(18,4),
  hora_recepcion text,
  fecha_hora_recepcion timestamp without time zone,
  numero_pedido text,
  albaran_id text,
  condicion_id text,
  vendedor_id text,
  recepcion_actualizada boolean,
  recepcion_demorada boolean,
  proveedor_nombre text,
  descripcion text,
  sincronizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (farmacia_codigo, origen_id)
);
CREATE INDEX IF NOT EXISTS ix_compras_fecha ON farmetrica.compras (fecha);

CREATE TABLE IF NOT EXISTS farmetrica.articulos (
  farmacia_codigo text NOT NULL,
  farmacia text GENERATED ALWAYS AS (farmacia_codigo) STORED,
  origen_id text NOT NULL,
  nombre text,
  codigo_nacional text,
  ean text,
  familia text,
  laboratorio text,
  pvp numeric(18,4),
  presentacion text,
  situacion text,
  puc numeric(18,4),
  pmc numeric(18,4),
  proveedor_habitual_id text,
  fecha_ultima_entrada timestamp without time zone,
  fecha_ultima_salida timestamp without time zone,
  stock_actual numeric(18,4),
  stock_minimo numeric(18,4),
  stock_maximo numeric(18,4),
  lote_optimo numeric(18,4),
  sincronizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (farmacia_codigo, origen_id)
);
CREATE INDEX IF NOT EXISTS ix_articulos_cn ON farmetrica.articulos (codigo_nacional);

-- Clave por farmacia: IdFamilia puede repetirse en instalaciones diferentes.
-- Artículos referencia a familia por (farmacia_codigo, familia) sin FK rígida
-- hasta verificar que todos los artículos tienen familia maestra cargada.
CREATE TABLE IF NOT EXISTS farmetrica.familias (
  farmacia_codigo text NOT NULL,
  farmacia text GENERATED ALWAYS AS (farmacia_codigo) STORED,
  origen_id text NOT NULL,
  nombre text,
  superfamilia_id text,
  superfamilia_nombre text,
  coeficiente_1 numeric(18,4),
  coeficiente_2 numeric(18,4),
  factor_descuento_credito numeric(18,4),
  desviacion numeric(18,4),
  grupo_iva_id text,
  deducible_hacienda boolean,
  grupo_formulacion text,
  empresa text,
  informacion_especial text,
  sincronizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (farmacia_codigo, origen_id)
);
CREATE INDEX IF NOT EXISTS ix_familias_superfamilia
    ON farmetrica.familias (farmacia_codigo, superfamilia_id);

CREATE TABLE IF NOT EXISTS farmetrica.proveedores (
  farmacia_codigo text NOT NULL,
  farmacia text GENERATED ALWAYS AS (farmacia_codigo) STORED,
  origen_id text NOT NULL,
  nombre text,
  nif text,
  telefono text,
  email text,
  direccion text,
  codigo_postal text,
  poblacion text,
  provincia text,
  web text,
  descuento numeric(18,4),
  sincronizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (farmacia_codigo, origen_id)
);

-- Los CREATE TABLE anteriores son referencias para instalaciones nuevas.
-- En tablas YA existentes, el sincronizador añade columnas con ALTER TABLE
-- ADD COLUMN IF NOT EXISTS al ejecutar la primera sincronización de la entidad.
-- Compras: vRecep solo dispone de CABECERAS (sin articulo_id, unidades, coste ni importe).
-- Existencias: Articu.StockActual, StockMinimo, StockMaximo, LoteOptimo,
-- integradas en farmetrica.articulos. No crear una tabla farmetrica.stock nueva.
-- Ni IdArticu implica CN/EAN ni se inventan tales códigos si no hay fuente específica.

-- Para instalaciones existentes, actualizar usando la acción de Farmétrica Sync
-- «Actualizar tabla compras en PostgreSQL» después de hacer copia de seguridad.
-- La acción añade columnas aditivamente y ejecuta DROP COLUMN IF EXISTS
-- descuento_recepcion sin CASCADE; no borra filas de compras.

-- Instalaciones anteriores: ejecutar una carga completa de articulos por farmacia
-- para popular las cuatro columnas de stock, y verificar antes de retirar la
-- tabla historica farmetrica.stock. Usar el boton de migracion del sincronizador;
-- valida filas y cantidades y elimina la tabla con DROP RESTRICT (sin CASCADE).
-- Relación lógica: a.familia = f.origen_id
--                  AND a.farmacia_codigo = f.farmacia_codigo.
-- No imponer FK hasta verificar que se han cargado familias para todas las farmacias.
-- PostgreSQL construye farmetrica.familias automáticamente al primer snapshot,
-- sin aplicar cambios destructivos sobre las otras entidades.

