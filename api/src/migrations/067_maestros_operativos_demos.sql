-- 067 · Configuración operativa de las demos, independiente y derivada del cliente origen.
-- Se importan únicamente MAESTROS, equivalencias y parámetros; jamás movimientos ERP,
-- ni usuarios, credenciales, URLs de terceros, pedidos ya realizados o promociones.
-- Conserva cualquier edición local de la demo (ON CONFLICT DO NOTHING).
CREATE TABLE IF NOT EXISTS farmetrica.demo_maestros_inicializados (
 demo_slug text PRIMARY KEY REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 origen_slug text NOT NULL REFERENCES farmetrica.clientes(slug),
 iniciado_en timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE FUNCTION farmetrica.inicializar_maestros_demo(p_demo_slug text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE v_source text; v_demo_schema text; v_source_schema text;
BEGIN
 -- SERIALIZACIÓN: un cliente no puede bootstrapearse dos veces simultáneamente.
 SELECT demo_origen_slug,esquema_datos INTO v_source,v_demo_schema
 FROM farmetrica.clientes WHERE slug=p_demo_slug AND activo=true FOR UPDATE;
 IF NOT FOUND OR v_source IS NULL OR v_source=p_demo_slug THEN
  RAISE EXCEPTION 'El cliente % no es una demo activa',p_demo_slug;
 END IF;
 SELECT esquema_datos INTO v_source_schema FROM farmetrica.clientes
 WHERE slug=v_source AND demo_origen_slug IS NULL AND activo=true;
 IF NOT FOUND OR v_source_schema IS NULL OR
    v_demo_schema !~ '^[a-z][a-z0-9_]{1,62}$' OR
    v_source_schema !~ '^[a-z][a-z0-9_]{1,62}$' OR
    v_demo_schema=v_source_schema THEN
  RAISE EXCEPTION 'La demo % tiene un origen de datos inválido',p_demo_slug;
 END IF;
 IF EXISTS(SELECT 1 FROM farmetrica.demo_maestros_inicializados
    WHERE demo_slug=p_demo_slug) THEN RETURN; END IF;

 -- Identidades P: distintas de las del origen; la clave unificada es estable.
 INSERT INTO farmetrica.proveedores_unificados
  (cliente_slug,clave_unificada,nombre,clase,activo)
 SELECT p_demo_slug,p.clave_unificada,p.nombre,p.clase,p.activo
 FROM farmetrica.proveedores_unificados p WHERE p.cliente_slug=v_source
 ON CONFLICT(cliente_slug,clave_unificada) DO NOTHING;
 -- Remapear el ID de origen al del cliente demo, incluso proveedores fusionados.
 UPDATE farmetrica.proveedores_unificados d SET fusionado_a=destino.id
 FROM farmetrica.proveedores_unificados s
 JOIN farmetrica.proveedores_unificados src_dest
  ON src_dest.cliente_slug=s.cliente_slug AND src_dest.id=s.fusionado_a
 JOIN farmetrica.proveedores_unificados destino
  ON destino.cliente_slug=p_demo_slug AND destino.clave_unificada=src_dest.clave_unificada
 WHERE s.cliente_slug=v_source AND d.cliente_slug=p_demo_slug
  AND d.clave_unificada=s.clave_unificada AND d.fusionado_a IS NULL
  AND d.id<>destino.id;
 INSERT INTO farmetrica.proveedores_unificados_alias
  (cliente_slug,proveedor_id,farmacia_codigo,codigo_origen,nombre_origen,procedencia,vigencia)
 SELECT p_demo_slug,d.id,a.farmacia_codigo,a.codigo_origen,
   a.nombre_origen,a.procedencia,a.vigencia
 FROM farmetrica.proveedores_unificados_alias a
 JOIN farmetrica.proveedores_unificados s
   ON s.cliente_slug=v_source AND s.id=a.proveedor_id
 JOIN farmetrica.proveedores_unificados d
   ON d.cliente_slug=p_demo_slug AND d.clave_unificada=s.clave_unificada
 WHERE a.cliente_slug=v_source
 ON CONFLICT(cliente_slug,farmacia_codigo,codigo_origen) DO NOTHING;
 INSERT INTO farmetrica.proveedores_maestro
  (cliente_slug,codigo_origen,nombre,tipo,activo,cooperativa,ignorar_informes,laboratorio_clave)
 SELECT p_demo_slug,codigo_origen,nombre,tipo,activo,cooperativa,
    ignorar_informes,laboratorio_clave
 FROM farmetrica.proveedores_maestro WHERE cliente_slug=v_source
 ON CONFLICT(cliente_slug,codigo_origen) DO NOTHING;
 INSERT INTO farmetrica.preparador_frecuencia_laboratorio
  (cliente_slug,laboratorio_clave,intervalo_dias)
 SELECT p_demo_slug,
   CASE WHEN left(f.laboratorio_clave,2)='P:'
    THEN 'P:'||d.id::text ELSE f.laboratorio_clave END,
   f.intervalo_dias
 FROM farmetrica.preparador_frecuencia_laboratorio f
 LEFT JOIN farmetrica.proveedores_unificados s
  ON s.cliente_slug=v_source AND f.laboratorio_clave='P:'||s.id::text
 LEFT JOIN farmetrica.proveedores_unificados d
  ON d.cliente_slug=p_demo_slug AND d.clave_unificada=s.clave_unificada
 WHERE f.cliente_slug=v_source
  AND (left(f.laboratorio_clave,2)<>'P:' OR d.id IS NOT NULL)
 ON CONFLICT(cliente_slug,laboratorio_clave) DO NOTHING;
 INSERT INTO farmetrica.preparador_configuracion_cliente
  (cliente_slug,cobertura_dias)
 SELECT p_demo_slug,cobertura_dias
 FROM farmetrica.preparador_configuracion_cliente WHERE cliente_slug=v_source
 ON CONFLICT(cliente_slug) DO NOTHING;
 INSERT INTO farmetrica.preparador_exclusiones(cliente_slug,cadena)
 SELECT p_demo_slug,cadena FROM farmetrica.preparador_exclusiones
 WHERE cliente_slug=v_source
 ON CONFLICT(cliente_slug,cadena) DO NOTHING;

 -- Familias: copiar SOLO relaciones/maestros de clasificación, no artículos
 -- ni históricos de compras/ventas; los artículos vivos se siguen leyendo por vista.
 INSERT INTO farmetrica.familias_globales
  (cliente_slug,clave,nombre,segmento,referencia_farmacia,referencia_codigo,
    nombre_manual,activo)
 SELECT p_demo_slug,clave,nombre,segmento,referencia_farmacia,referencia_codigo,
   nombre_manual,activo
 FROM farmetrica.familias_globales WHERE cliente_slug=v_source
 ON CONFLICT(cliente_slug,clave) DO NOTHING;
 UPDATE farmetrica.familias_globales d SET fusionado_a=dest.id
 FROM farmetrica.familias_globales s
 JOIN farmetrica.familias_globales src_target
  ON src_target.cliente_slug=s.cliente_slug AND src_target.id=s.fusionado_a
 JOIN farmetrica.familias_globales dest
  ON dest.cliente_slug=p_demo_slug AND dest.clave=src_target.clave
 WHERE s.cliente_slug=v_source AND d.cliente_slug=p_demo_slug
  AND d.clave=s.clave AND d.fusionado_a IS NULL AND d.id<>dest.id;
 INSERT INTO farmetrica.familias_globales_alias
  (cliente_slug,farmacia_codigo,codigo_origen,familia_id,
   nombre_origen,metodo,coincidencias,confianza)
 SELECT p_demo_slug,a.farmacia_codigo,a.codigo_origen,d.id,
   a.nombre_origen,a.metodo,a.coincidencias,a.confianza
 FROM farmetrica.familias_globales_alias a
 JOIN farmetrica.familias_globales s
  ON s.cliente_slug=v_source AND s.id=a.familia_id
 JOIN farmetrica.familias_globales d
  ON d.cliente_slug=p_demo_slug AND d.clave=s.clave
 WHERE a.cliente_slug=v_source
 ON CONFLICT(cliente_slug,farmacia_codigo,codigo_origen) DO NOTHING;
 INSERT INTO farmetrica.familias_globales_articulos
  (cliente_slug,farmacia_codigo,articulo_origen_id,familia_id,metodo,reconciliacion_id)
 SELECT p_demo_slug,a.farmacia_codigo,a.articulo_origen_id,d.id,
   a.metodo,a.reconciliacion_id
 FROM farmetrica.familias_globales_articulos a
 JOIN farmetrica.familias_globales s
  ON s.cliente_slug=v_source AND s.id=a.familia_id
 JOIN farmetrica.familias_globales d
  ON d.cliente_slug=p_demo_slug AND d.clave=s.clave
 WHERE a.cliente_slug=v_source
 ON CONFLICT(cliente_slug,farmacia_codigo,articulo_origen_id) DO NOTHING;

 -- Preferencias independientes por cliente y establecimiento (IDs nuevos).
 INSERT INTO farmetrica.politica_precios(cliente_slug,farmacia_id,percentil,meses)
 SELECT p_demo_slug,CASE WHEN s.farmacia_id=0 THEN 0 ELSE m.demo_id END,
   s.percentil,s.meses
 FROM farmetrica.politica_precios s
 LEFT JOIN LATERAL (
  SELECT d.id AS demo_id
  FROM farmetrica.farmacias f
  JOIN farmetrica.farmacias d ON d.cliente_slug=p_demo_slug
   AND upper(btrim(d.codigo_origen))=(
    CASE WHEN f.cliente_slug='ampedia' AND f.id=5
       AND upper(btrim(f.codigo_origen)) IN ('POL','VAL') THEN 'VAL'
      ELSE upper(btrim(f.codigo_origen)) END)
  WHERE f.cliente_slug=v_source AND f.id=s.farmacia_id
 ) m ON true
 WHERE s.cliente_slug=v_source AND (s.farmacia_id=0 OR m.demo_id IS NOT NULL)
 ON CONFLICT(cliente_slug,farmacia_id) DO NOTHING;
 INSERT INTO farmetrica.transferidor_configuracion_cliente
   (cliente_slug,minimo_dias,objetivo_dias)
 SELECT p_demo_slug,minimo_dias,objetivo_dias
 FROM farmetrica.transferidor_configuracion_cliente
 WHERE cliente_slug=v_source
 ON CONFLICT(cliente_slug) DO NOTHING;

 INSERT INTO farmetrica.transferidor_exposicion_familias
  (cliente_slug,farmacia_id,familia_id,exposicion_dias)
 SELECT p_demo_slug,d.id,gd.id,e.exposicion_dias
 FROM farmetrica.transferidor_exposicion_familias e
 JOIN farmetrica.farmacias f ON f.cliente_slug=v_source AND f.id=e.farmacia_id
 JOIN farmetrica.farmacias d ON d.cliente_slug=p_demo_slug
   AND upper(btrim(d.codigo_origen))=(
    CASE WHEN f.cliente_slug='ampedia' AND f.id=5
       AND upper(btrim(f.codigo_origen)) IN ('POL','VAL') THEN 'VAL'
      ELSE upper(btrim(f.codigo_origen)) END)
 JOIN farmetrica.familias_globales gs
  ON gs.cliente_slug=v_source AND gs.id=e.familia_id
 JOIN farmetrica.familias_globales gd
  ON gd.cliente_slug=p_demo_slug AND gd.clave=gs.clave
 WHERE e.cliente_slug=v_source
 ON CONFLICT(cliente_slug,farmacia_id,familia_id) DO NOTHING;
 INSERT INTO farmetrica.transferidor_exposicion_articulos
  (cliente_slug,farmacia_id,codigo_nacional,exposicion_unidades)
 SELECT p_demo_slug,d.id,e.codigo_nacional,e.exposicion_unidades
 FROM farmetrica.transferidor_exposicion_articulos e
 JOIN farmetrica.farmacias f ON f.cliente_slug=v_source AND f.id=e.farmacia_id
 JOIN farmetrica.farmacias d ON d.cliente_slug=p_demo_slug
   AND upper(btrim(d.codigo_origen))=(
    CASE WHEN f.cliente_slug='ampedia' AND f.id=5
       AND upper(btrim(f.codigo_origen)) IN ('POL','VAL') THEN 'VAL'
      ELSE upper(btrim(f.codigo_origen)) END)
 WHERE e.cliente_slug=v_source
 ON CONFLICT(cliente_slug,farmacia_id,codigo_nacional) DO NOTHING;

 INSERT INTO farmetrica.demo_maestros_inicializados(demo_slug,origen_slug)
 VALUES(p_demo_slug,v_source);
END $fn$;
REVOKE ALL ON FUNCTION farmetrica.inicializar_maestros_demo(text) FROM PUBLIC;
DO $apply$
DECLARE item record;
BEGIN
 FOR item IN SELECT slug FROM farmetrica.clientes
  WHERE demo_origen_slug IS NOT NULL AND activo=true ORDER BY slug LOOP
  PERFORM farmetrica.inicializar_maestros_demo(item.slug);
 END LOOP;
END $apply$;
