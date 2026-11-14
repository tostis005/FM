-- 065 · Ampliar vistas de demos existentes y crear Demo Individual, sin duplicar datos.
-- No modifica farmacias, movimientos ni importaciones del cliente real.
-- El SELECT de cada vista sigue consultando el esquema origen en tiempo real.
DO $migration$
DECLARE
 source_schema text;
 origin_exists boolean;
 item record;
 source_name text;
 target_name text;
 tab text;
 tables text[] := ARRAY[
  'ventas','compras','articulos','proveedores','productos','stock','sinonimos',
  'fm_ventas_cabeceras','fm_ventas_lineas','fm_ventas_analitica',
  'fm_recepciones_cabeceras','fm_recepciones_lineas','fm_recepciones_analitica',
  'fm_pedidos_cabeceras','fm_pedidos_lineas','fm_stock_fotografia',
  'fm_producto_correspondencias'
 ];
BEGIN
 SELECT esquema_datos INTO source_schema FROM farmetrica.clientes
 WHERE slug='ampedia' AND demo_origen_slug IS NULL AND activo=true;
 IF source_schema IS NULL THEN
  RAISE NOTICE 'No existe cliente real ampedia: no provisionar demo individual';
 ELSE
  IF NOT EXISTS(SELECT 1 FROM farmetrica.clientes WHERE slug='demo_individual') THEN
   IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='demo_individual') THEN
    RAISE EXCEPTION 'Esquema demo_individual preexistente no registrado; revisar manualmente';
   END IF;
   EXECUTE 'CREATE SCHEMA demo_individual';
   INSERT INTO farmetrica.clientes(slug,nombre,esquema_datos,demo_origen_slug,analisis_abcd_meses)
   SELECT 'demo_individual','Demo Individual','demo_individual',slug,analisis_abcd_meses
   FROM farmetrica.clientes WHERE slug='ampedia';
   WITH origen AS (
    SELECT f.*,row_number() OVER (ORDER BY f.id) AS n
    FROM farmetrica.farmacias f WHERE f.cliente_slug='ampedia' AND f.activo
     AND coalesce(f.tipo_establecimiento,'farmacia')='farmacia'
   )
   INSERT INTO farmetrica.farmacias
    (cliente_slug,nombre,ciudad,activo,codigo_origen,codigo_visible,
     host_origen,bd_origen,tipo_establecimiento)
   SELECT 'demo_individual','Farmacia Demo '||lpad(n::text,2,'0'),
    '',(n=1),
    CASE WHEN id=5 AND upper(btrim(codigo_origen)) IN ('POL','VAL') THEN 'VAL'
      ELSE upper(btrim(codigo_origen)) END,
    'D'||lpad(n::text,2,'0'),NULL,'Demo','farmacia'
   FROM origen;
   IF NOT EXISTS(SELECT 1 FROM farmetrica.farmacias WHERE cliente_slug='demo_individual' AND activo) THEN
    RAISE EXCEPTION 'No se encontró una farmacia activa para Demo Individual';
   END IF;
   -- Partir de los módulos de la demo de grupo si existe; no usar permisos del cliente real.
   SELECT c.slug INTO source_name FROM farmetrica.clientes c
   WHERE c.demo_origen_slug='ampedia' AND c.slug<>'demo_individual'
   ORDER BY c.creado_en,c.slug LIMIT 1;
   INSERT INTO farmetrica.cliente_modulos(cliente_slug,modulo_clave,habilitado)
   SELECT 'demo_individual',m.clave,
    CASE WHEN source_name IS NOT NULL THEN coalesce(
      (SELECT d.habilitado FROM farmetrica.cliente_modulos d
       WHERE d.cliente_slug=source_name AND d.modulo_clave=m.clave),false)
    ELSE m.clave=ANY(ARRAY['dashboard','ventas','compras','proveedores',
      'stock','reposicion','genericos','rentabilidad','acciones','informes']) END
   FROM farmetrica.modulos m
   ON CONFLICT(cliente_slug,modulo_clave) DO NOTHING;
   INSERT INTO farmetrica.cliente_apariencia
    (cliente_slug,nombre_marca,logo_url,color_primario,color_secundario,color_fondo,estilo_menu)
   VALUES('demo_individual','Farmétrica Demo Individual','',
    '#2764A5','#203B62','#F3F6FA','claro')
   ON CONFLICT(cliente_slug) DO NOTHING;
  END IF;
 END IF;

 -- Reparación aditiva de las demos creadas con versiones antiguas.
 -- No crear vistas de tablas de configuraciones/promociones ni tocar entidades propias.
 FOR item IN SELECT d.slug,d.esquema_datos AS demo_schema,s.esquema_datos AS data_schema
  FROM farmetrica.clientes d
  JOIN farmetrica.clientes s ON s.slug=d.demo_origen_slug
  WHERE d.demo_origen_slug IS NOT NULL AND d.activo=true
 LOOP
  IF item.demo_schema !~ '^[a-z][a-z0-9_]{1,62}$' OR
     item.data_schema !~ '^[a-z][a-z0-9_]{1,62}$' OR
     item.demo_schema=item.data_schema OR
     NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=item.demo_schema) THEN
   CONTINUE;
  END IF;
  FOREACH tab IN ARRAY tables LOOP
   IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=item.data_schema AND c.relname=tab AND c.relkind IN('r','p','v','m'))
    AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=item.demo_schema AND c.relname=tab) THEN
      EXECUTE format('CREATE VIEW %I.%I AS SELECT src.* FROM %I.%I src '||
        'CROSS JOIN (SELECT true AS solo_lectura) bloqueo',
        item.demo_schema,tab,item.data_schema,tab);
   END IF;
  END LOOP;
 END LOOP;
END
$migration$;
