-- 018 · Lectura de ventas completas y recepciones completas para la aplicación.
-- NO transforma ni reescribe histórico ERP: dos vistas por cliente unen cabecera
-- y línea con el sistema de origen, farmacia, documento y línea.
-- Ningún importe de cabecera se replica en cada línea.
CREATE OR REPLACE FUNCTION farmetrica.preparar_vistas_documentales(p_esquema text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $sql$
DECLARE q text;
BEGIN
 IF p_esquema IS NULL OR p_esquema !~ '^[a-z][a-z0-9_]{1,62}$'
    OR NOT EXISTS (SELECT 1 FROM farmetrica.clientes WHERE esquema_datos=p_esquema)
 THEN RAISE EXCEPTION 'Esquema documental no autorizado'; END IF;
 IF to_regnamespace(p_esquema) IS NULL
 THEN RAISE EXCEPTION 'Esquema documental inexistente: %',p_esquema; END IF;
 IF to_regclass(format('%I.fm_ventas_lineas',p_esquema)) IS NULL
    OR to_regclass(format('%I.fm_recepciones_lineas',p_esquema)) IS NULL
 THEN RAISE EXCEPTION 'Modelo documental 016 no aplicado para %',p_esquema; END IF;
 q:=format('%I',p_esquema);
 EXECUTE format($sales$
 CREATE OR REPLACE VIEW %s.fm_ventas_analitica AS
 SELECT h.farmacia_codigo,
   concat_ws(chr(31),h.sistema_origen,h.documento_id,l.linea_id) AS origen_id,
   h.sistema_origen,h.documento_id,l.linea_id,
   h.fecha,l.articulo_origen_id AS articulo_id,
   CASE WHEN l.devuelta IS TRUE THEN -abs(l.cantidad) ELSE l.cantidad END AS unidades,
   l.precio_unitario,
   CASE WHEN l.devuelta IS TRUE THEN -abs(l.importe_neto) ELSE l.importe_neto END AS importe,
   h.numero_documento AS numero_ticket,h.empleado_id AS vendedor_id,
   l.descuento_linea,
   h.descuento_global AS descuento_operacion_documento,
   l.coste_historico,h.estado,
   h.total_documento,
   greatest(h.recibido_en,l.recibido_en) AS sincronizado_en
 FROM %s.fm_ventas_cabeceras h
 JOIN %s.fm_ventas_lineas l ON l.farmacia_codigo=h.farmacia_codigo
  AND l.sistema_origen=h.sistema_origen AND l.documento_id=h.documento_id
 WHERE h.lineas_completas AND NOT h.eliminado_logicamente
  AND NOT l.eliminada_logicamente AND coalesce(l.anulada,false)=false
  AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')
 $sales$,q,q,q);
 EXECUTE format($buys$
 CREATE OR REPLACE VIEW %s.fm_recepciones_analitica AS
 SELECT h.farmacia_codigo,
   concat_ws(chr(31),h.sistema_origen,h.documento_id,l.linea_id) AS origen_id,
   h.sistema_origen,h.documento_id,l.linea_id,
   h.fecha,l.articulo_origen_id AS articulo_id,
   h.proveedor_origen_id AS proveedor_id,
   NULL::text AS proveedor_nombre,
   CASE WHEN l.devuelta IS TRUE THEN -abs(l.cantidad) ELSE l.cantidad END AS unidades,
   CASE WHEN l.coste_neto IS NOT NULL AND l.cantidad<>0
     THEN abs(l.coste_neto/l.cantidad) ELSE NULL::numeric END AS coste_unitario,
   CASE WHEN l.devuelta IS TRUE THEN -abs(l.coste_neto) ELSE l.coste_neto END AS importe,
   h.numero_albaran AS albaran_id,h.numero_pedido,
   h.numero_albaran,
   h.documento_id AS recepcion_id,
   l.precio_unitario_bruto,h.estado,
   h.total_documento,
   greatest(h.recibido_en,l.recibido_en) AS sincronizado_en
 FROM %s.fm_recepciones_cabeceras h
 JOIN %s.fm_recepciones_lineas l ON l.farmacia_codigo=h.farmacia_codigo
  AND l.sistema_origen=h.sistema_origen AND l.documento_id=h.documento_id
 WHERE h.lineas_completas AND NOT h.eliminada_logicamente
  AND NOT l.eliminada_logicamente
  AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')
 $buys$,q,q,q);
END $sql$;
REVOKE ALL ON FUNCTION farmetrica.preparar_vistas_documentales(text) FROM PUBLIC;

DO $apply$
DECLARE schema_item record;
BEGIN
 FOR schema_item IN SELECT DISTINCT esquema_datos FROM farmetrica.clientes
  WHERE to_regnamespace(esquema_datos) IS NOT NULL LOOP
  PERFORM farmetrica.preparar_modelo_documental(schema_item.esquema_datos);
  PERFORM farmetrica.preparar_vistas_documentales(schema_item.esquema_datos);
 END LOOP;
END $apply$;

-- El precálculo heredado no se debe servir después del cambio de fuentes.
-- Solo se invalidan metadatos de la caché; el recálculo usa las vistas nuevas.
UPDATE farmetrica.ventas_analitica_estado SET calculado_en=to_timestamp(0);
