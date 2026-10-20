-- Las recepciones ya filtran proveedores ignorados. Para salidas, el ERP
-- utiliza XClie_IdCliente, que NO es el mismo maestro que XProv_IdProveedor.
-- Solo excluir salidas asociadas manualmente y de forma explícita a la farmacia.
-- Sin mapeos, las ventas permanecen exactamente como antes.
CREATE TABLE IF NOT EXISTS farmetrica.traspasos_salida_mapeos (
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 farmacia_id integer NOT NULL REFERENCES farmetrica.farmacias(id) ON DELETE CASCADE,
 proveedor_codigo text NOT NULL,
 cliente_erp_id text NOT NULL,
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cliente_slug,farmacia_id,cliente_erp_id),
 FOREIGN KEY(cliente_slug,proveedor_codigo)
  REFERENCES farmetrica.proveedores_maestro(cliente_slug,codigo_origen)
  ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS traspasos_salida_proveedor_idx
 ON farmetrica.traspasos_salida_mapeos(cliente_slug,proveedor_codigo,farmacia_id);

CREATE OR REPLACE FUNCTION farmetrica.aplicar_exclusiones_ventas(p_esquema text)
 RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $func$
DECLARE q text;
BEGIN
 IF p_esquema IS NULL OR p_esquema !~ '^[a-z][a-z0-9_]{1,62}$'
  OR NOT EXISTS(SELECT 1 FROM farmetrica.clientes WHERE esquema_datos=p_esquema)
  OR to_regclass(format('%I.fm_ventas_cabeceras',p_esquema)) IS NULL
  OR to_regclass(format('%I.fm_ventas_lineas',p_esquema)) IS NULL
 THEN RAISE EXCEPTION 'Esquema de ventas no autorizado o incompleto'; END IF;
 q:=format('%I',p_esquema);
 -- Vistas, no tablas: nunca eliminar o modificar ventas de Farmatic.
 -- Exactamente la misma lista de columnas que la migración 018.
 EXECUTE format($view$
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
   AND NOT EXISTS (
     SELECT 1 FROM farmetrica.traspasos_salida_mapeos m
     JOIN farmetrica.proveedores_maestro pm
       ON pm.cliente_slug=m.cliente_slug
       AND pm.codigo_origen=m.proveedor_codigo AND pm.ignorar_informes=true
     JOIN farmetrica.farmacias f
       ON f.id=m.farmacia_id AND f.cliente_slug=m.cliente_slug
     JOIN farmetrica.clientes c
       ON c.slug=m.cliente_slug AND c.esquema_datos=%L
     WHERE upper(btrim(h.farmacia_codigo))=
       (CASE WHEN f.cliente_slug='ampedia' AND f.id=5
        AND upper(btrim(f.codigo_origen)) IN ('POL','VAL') THEN 'VAL'
        ELSE upper(btrim(f.codigo_origen)) END)
       AND nullif(btrim(h.cliente_origen_id),'') IS NOT NULL
       AND upper(btrim(h.cliente_origen_id))=upper(btrim(m.cliente_erp_id))
   )
 $view$,q,q,q,p_esquema);
END $func$;
REVOKE ALL ON FUNCTION farmetrica.aplicar_exclusiones_ventas(text) FROM PUBLIC;

DO $apply$
DECLARE schema_row record;
BEGIN
 FOR schema_row IN SELECT DISTINCT esquema_datos FROM farmetrica.clientes
  WHERE to_regnamespace(esquema_datos) IS NOT NULL LOOP
  PERFORM farmetrica.aplicar_exclusiones_ventas(schema_row.esquema_datos);
 END LOOP;
END $apply$;
