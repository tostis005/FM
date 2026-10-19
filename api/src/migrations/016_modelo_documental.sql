-- 016 · Entidades documentales normalizadas por cliente; aditiva y sin tocar
-- las tablas heredadas ventas/compras que actualmente utiliza la web.
-- La función solo acepta esquemas vinculados a clientes registrados.
CREATE OR REPLACE FUNCTION farmetrica.preparar_modelo_documental(p_esquema text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE q text;
BEGIN
 IF p_esquema IS NULL OR p_esquema !~ '^[a-z][a-z0-9_]{1,62}$'
   OR NOT EXISTS (SELECT 1 FROM farmetrica.clientes WHERE esquema_datos=p_esquema)
 THEN RAISE EXCEPTION 'Esquema de cliente no autorizado'; END IF;
 IF to_regnamespace(p_esquema) IS NULL
 THEN RAISE EXCEPTION 'El esquema de cliente % no existe', p_esquema; END IF;
 q := format('%I', p_esquema);

 -- Los identificadores de origen son locales a farmacia y ERP, no CN ni EAN.
 EXECUTE format('CREATE TABLE IF NOT EXISTS %s.fm_ventas_cabeceras (
   farmacia_codigo text NOT NULL, sistema_origen text NOT NULL, documento_id text NOT NULL,
   fecha timestamp without time zone NOT NULL, zona_horaria text,
   numero_documento text, empleado_id text, cliente_origen_id text,
   total_documento numeric(20,6), descuento_global numeric(20,6),
   descuento_global_tipo text, impuestos numeric(20,6),
   estado text NOT NULL DEFAULT ''desconocido'', eliminado_logicamente boolean NOT NULL DEFAULT false,
   modificado_origen timestamp without time zone, recibido_en timestamptz NOT NULL DEFAULT now(),
   lineas_completas boolean NOT NULL DEFAULT false,
   PRIMARY KEY (farmacia_codigo,sistema_origen,documento_id)
 )',q);
 EXECUTE format('CREATE TABLE IF NOT EXISTS %s.fm_ventas_lineas (
   farmacia_codigo text NOT NULL, sistema_origen text NOT NULL, documento_id text NOT NULL,
   linea_id text NOT NULL, articulo_origen_id text NOT NULL,
   cantidad numeric(20,6) NOT NULL, precio_unitario numeric(20,6),
   descuento_linea numeric(20,6), descuento_linea_tipo text,
   importe_neto numeric(20,6), impuestos numeric(20,6),
   coste_historico numeric(20,6), devuelta boolean, anulada boolean,
   eliminada_logicamente boolean NOT NULL DEFAULT false,
   modificado_origen timestamp without time zone, recibido_en timestamptz NOT NULL DEFAULT now(),
   PRIMARY KEY (farmacia_codigo,sistema_origen,documento_id,linea_id),
   FOREIGN KEY (farmacia_codigo,sistema_origen,documento_id)
     REFERENCES %s.fm_ventas_cabeceras(farmacia_codigo,sistema_origen,documento_id)
     DEFERRABLE INITIALLY IMMEDIATE
 )',q,q);

 EXECUTE format('CREATE TABLE IF NOT EXISTS %s.fm_recepciones_cabeceras (
   farmacia_codigo text NOT NULL, sistema_origen text NOT NULL, documento_id text NOT NULL,
   fecha timestamp without time zone NOT NULL, zona_horaria text,
   proveedor_origen_id text, numero_albaran text, numero_pedido text,
   total_documento numeric(20,6), descuento_global numeric(20,6),
   descuento_global_tipo text, impuestos numeric(20,6),
   estado text NOT NULL DEFAULT ''desconocido'', eliminada_logicamente boolean NOT NULL DEFAULT false,
   modificado_origen timestamp without time zone, recibido_en timestamptz NOT NULL DEFAULT now(),
   lineas_completas boolean NOT NULL DEFAULT false,
   PRIMARY KEY (farmacia_codigo,sistema_origen,documento_id)
 )',q);
 EXECUTE format('CREATE TABLE IF NOT EXISTS %s.fm_recepciones_lineas (
   farmacia_codigo text NOT NULL, sistema_origen text NOT NULL, documento_id text NOT NULL,
   linea_id text NOT NULL, articulo_origen_id text NOT NULL,
   cantidad numeric(20,6) NOT NULL, precio_unitario_bruto numeric(20,6),
   descuento_comercial numeric(20,6), descuento_tipo text,
   bonificacion_unidades numeric(20,6), coste_neto numeric(20,6),
   impuestos numeric(20,6), devuelta boolean, eliminada_logicamente boolean NOT NULL DEFAULT false,
   modificado_origen timestamp without time zone, recibido_en timestamptz NOT NULL DEFAULT now(),
   PRIMARY KEY (farmacia_codigo,sistema_origen,documento_id,linea_id),
   FOREIGN KEY (farmacia_codigo,sistema_origen,documento_id)
     REFERENCES %s.fm_recepciones_cabeceras(farmacia_codigo,sistema_origen,documento_id)
     DEFERRABLE INITIALLY IMMEDIATE
 )',q,q);

 -- Pedidos pendientes: tablas preparadas, sin fingir que Farmatic ya suministra SQL.
 EXECUTE format('CREATE TABLE IF NOT EXISTS %s.fm_pedidos_cabeceras (
   farmacia_codigo text NOT NULL, sistema_origen text NOT NULL, pedido_id text NOT NULL,
   proveedor_origen_id text, fecha_pedido timestamp without time zone,
   fecha_prevista timestamp without time zone, estado text NOT NULL DEFAULT ''desconocido'',
   modificado_origen timestamp without time zone, recibido_en timestamptz NOT NULL DEFAULT now(),
   PRIMARY KEY(farmacia_codigo,sistema_origen,pedido_id)
 )',q);
 EXECUTE format('CREATE TABLE IF NOT EXISTS %s.fm_pedidos_lineas (
   farmacia_codigo text NOT NULL, sistema_origen text NOT NULL, pedido_id text NOT NULL,
   linea_id text NOT NULL, articulo_origen_id text NOT NULL,
   unidades_pedidas numeric(20,6), unidades_recibidas numeric(20,6),
   unidades_pendientes numeric(20,6), precio_acordado numeric(20,6),
   estado text NOT NULL DEFAULT ''desconocido'', recibido_en timestamptz NOT NULL DEFAULT now(),
   PRIMARY KEY(farmacia_codigo,sistema_origen,pedido_id,linea_id),
   FOREIGN KEY (farmacia_codigo,sistema_origen,pedido_id)
     REFERENCES %s.fm_pedidos_cabeceras(farmacia_codigo,sistema_origen,pedido_id)
 )',q,q);

 -- Stock es una fotografía, no un movimiento de compra o de venta.
 EXECUTE format('CREATE TABLE IF NOT EXISTS %s.fm_stock_fotografia (
   farmacia_codigo text NOT NULL, sistema_origen text NOT NULL, articulo_origen_id text NOT NULL,
   unidades numeric(20,6) NOT NULL, capturado_en timestamptz NOT NULL,
   sincronizado_en timestamptz NOT NULL DEFAULT now(),
   PRIMARY KEY(farmacia_codigo,sistema_origen,articulo_origen_id)
 )',q);

 -- No alterar operaciones históricas al corregir las categorías o equivalencias.
 EXECUTE format('CREATE TABLE IF NOT EXISTS %s.fm_producto_correspondencias (
   farmacia_codigo text NOT NULL, sistema_origen text NOT NULL, articulo_origen_id text NOT NULL,
   producto_normalizado_id text, codigo_nacional_original text,
   codigo_nacional_normalizado text, ean_gtin text,
   segmento_comercial text NOT NULL DEFAULT ''sin_clasificar'', subcategoria text,
   clasificacion_origen text NOT NULL DEFAULT ''sin_clasificar'',
   clasificacion_confianza numeric(5,4), corregido_en timestamptz NOT NULL DEFAULT now(),
   PRIMARY KEY(farmacia_codigo,sistema_origen,articulo_origen_id),
   CHECK (clasificacion_confianza IS NULL OR clasificacion_confianza BETWEEN 0 AND 1)
 )',q);

 EXECUTE format('CREATE TABLE IF NOT EXISTS %s.fm_sync_ejecuciones (
   ejecucion_id uuid PRIMARY KEY, farmacia_codigo text NOT NULL,
   sistema_origen text NOT NULL, flujo text NOT NULL,
   iniciada_en timestamptz NOT NULL, finalizada_en timestamptz,
   estado text NOT NULL, leidas bigint NOT NULL DEFAULT 0,
   insertadas bigint NOT NULL DEFAULT 0, modificadas bigint NOT NULL DEFAULT 0,
   rechazadas bigint NOT NULL DEFAULT 0, error_resumen text
 )',q);
 EXECUTE format('CREATE TABLE IF NOT EXISTS %s.fm_sync_rechazos (
   ejecucion_id uuid NOT NULL REFERENCES %s.fm_sync_ejecuciones(ejecucion_id),
   fuente_clave text NOT NULL, motivo text NOT NULL,
   registrado_en timestamptz NOT NULL DEFAULT now(),
   PRIMARY KEY(ejecucion_id,fuente_clave)
 )',q,q);

 EXECUTE format('CREATE INDEX IF NOT EXISTS fm_ventas_cab_fecha_idx ON %s.fm_ventas_cabeceras
   (farmacia_codigo,fecha DESC)',q);
 EXECUTE format('CREATE INDEX IF NOT EXISTS fm_ventas_lin_producto_idx ON %s.fm_ventas_lineas
   (farmacia_codigo,articulo_origen_id)',q);
 EXECUTE format('CREATE INDEX IF NOT EXISTS fm_recep_cab_fecha_idx ON %s.fm_recepciones_cabeceras
   (farmacia_codigo,fecha DESC)',q);
 EXECUTE format('CREATE INDEX IF NOT EXISTS fm_recep_lin_producto_idx ON %s.fm_recepciones_lineas
   (farmacia_codigo,articulo_origen_id)',q);
 EXECUTE format('CREATE INDEX IF NOT EXISTS fm_pedidos_estado_idx ON %s.fm_pedidos_cabeceras
   (farmacia_codigo,estado,fecha_prevista)',q);
 EXECUTE format('CREATE INDEX IF NOT EXISTS fm_sync_ejecuciones_idx ON %s.fm_sync_ejecuciones
   (farmacia_codigo,flujo,iniciada_en DESC)',q);
END $$;
REVOKE ALL ON FUNCTION farmetrica.preparar_modelo_documental(text) FROM PUBLIC;

-- Aplicar a esquemas existentes sin leer/reescribir ventas o compras heredadas.
DO $$
DECLARE item record;
BEGIN
 FOR item IN SELECT DISTINCT esquema_datos FROM farmetrica.clientes LOOP
   PERFORM farmetrica.preparar_modelo_documental(item.esquema_datos);
 END LOOP;
END $$;
