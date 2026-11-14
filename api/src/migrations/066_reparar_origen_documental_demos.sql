-- 066 · Reparar demos antiguas que se enlazaron a tablas documentales VACÍAS.
-- Afecta exclusivamente a esquemas de DEMO. No ejecuta DDL ni DML sobre Ampedia.
-- Las tablas heredadas vacías se CONSERVAN con sufijo _demo_legacy para reversión.
-- Si alguna contiene movimientos, ABORTAR sin modificarla (nunca perder registros).
DO $repair$
DECLARE
 d record; tab text; kind "char"; has_data boolean; origin_oid oid;
 local_oid oid; points_origin boolean;
 old_name text; q text;
 document_tables text[] := ARRAY[
   'fm_ventas_lineas','fm_ventas_cabeceras',
   'fm_recepciones_lineas','fm_recepciones_cabeceras',
   'fm_pedidos_lineas','fm_pedidos_cabeceras',
   'fm_stock_fotografia','fm_producto_correspondencias'
 ];
 analytics_views text[] := ARRAY['fm_ventas_analitica','fm_recepciones_analitica'];
BEGIN
 FOR d IN
   SELECT demo.slug,demo.esquema_datos AS demo_schema,
     fuente.esquema_datos AS source_schema
   FROM farmetrica.clientes demo
   JOIN farmetrica.clientes fuente ON fuente.slug=demo.demo_origen_slug
   WHERE demo.demo_origen_slug='ampedia'
     AND demo.activo=true
   ORDER BY demo.slug
 LOOP
   IF d.demo_schema !~ '^[a-z][a-z0-9_]{1,62}$'
     OR d.source_schema !~ '^[a-z][a-z0-9_]{1,62}$'
     OR d.demo_schema=d.source_schema
     OR to_regnamespace(d.demo_schema) IS NULL
   THEN RAISE EXCEPTION 'Esquema demo inválido: %',d.slug; END IF;

   -- Preflight. Comprobar todas las tablas antiguas antes de renombrar ninguna.
   FOREACH tab IN ARRAY document_tables LOOP
     SELECT c.relkind INTO kind FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname=d.demo_schema AND c.relname=tab;
     IF kind IN ('r','p') THEN
       IF to_regclass(format('%I.%I',d.source_schema,tab)) IS NULL
       THEN RAISE EXCEPTION 'No existe tabla documental de origen %.%',d.source_schema,tab; END IF;
       EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I LIMIT 1)',d.demo_schema,tab)
         INTO has_data;
       IF has_data THEN
         RAISE EXCEPTION 'La tabla %.% tiene registros: no se sustituye',d.demo_schema,tab;
       END IF;
       old_name:=tab||'_demo_legacy';
       IF to_regclass(format('%I.%I',d.demo_schema,old_name)) IS NOT NULL
       THEN RAISE EXCEPTION 'Existe respaldo previo %.%',d.demo_schema,old_name; END IF;
     ELSIF kind IS NOT NULL AND kind<>'v' THEN
       RAISE EXCEPTION 'Relación no compatible: %.% (%)',d.demo_schema,tab,kind;
     END IF;
   END LOOP;

   -- El nombre anterior queda libre; las tablas vacías quedan preservadas.
   -- Los índices, restricciones y claves foráneas permanecen en el respaldo.
   FOREACH tab IN ARRAY document_tables LOOP
     SELECT c.relkind INTO kind FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname=d.demo_schema AND c.relname=tab;
     IF kind IN ('r','p') THEN
       EXECUTE format('ALTER TABLE %I.%I RENAME TO %I',
         d.demo_schema,tab,tab||'_demo_legacy');
       EXECUTE format(
         'CREATE VIEW %I.%I AS SELECT src.* FROM %I.%I src CROSS JOIN (SELECT true AS solo_lectura) bloqueo',
         d.demo_schema,tab,d.source_schema,tab);
       RAISE NOTICE 'Demo %: % enlazada a origen sin borrar tabla histórica',d.slug,tab;
     ELSIF kind IS NULL AND to_regclass(format('%I.%I',d.source_schema,tab)) IS NOT NULL THEN
       EXECUTE format(
         'CREATE VIEW %I.%I AS SELECT src.* FROM %I.%I src CROSS JOIN (SELECT true AS solo_lectura) bloqueo',
         d.demo_schema,tab,d.source_schema,tab);
     END IF;
   END LOOP;

   -- La vista analítica antigua dependía de las tablas documentales vacías.
   -- Reemplazarla por la vista de origen sin modificar su definición original.
   FOREACH tab IN ARRAY analytics_views LOOP
     SELECT c.oid,c.relkind INTO local_oid,kind
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname=d.demo_schema AND c.relname=tab;
     IF to_regclass(format('%I.%I',d.source_schema,tab)) IS NULL THEN CONTINUE; END IF;
     IF kind IS NOT NULL AND kind<>'v' THEN
       RAISE EXCEPTION 'La relación analítica %.% no es una vista',d.demo_schema,tab;
     END IF;
     points_origin:=false;
     IF kind='v' THEN
       SELECT EXISTS(
         SELECT 1 FROM pg_rewrite rw
         JOIN pg_depend dep ON dep.objid=rw.oid
           AND dep.classid='pg_rewrite'::regclass
           AND dep.refclassid='pg_class'::regclass
         JOIN pg_class source_rel ON source_rel.oid=dep.refobjid
         JOIN pg_namespace source_ns ON source_ns.oid=source_rel.relnamespace
         WHERE rw.ev_class=local_oid
           AND source_ns.nspname=d.source_schema
           AND source_rel.relname=tab
       ) INTO points_origin;
     END IF;
     IF NOT points_origin THEN
       q:=format(
         'CREATE OR REPLACE VIEW %I.%I AS SELECT src.* FROM %I.%I src CROSS JOIN (SELECT true AS solo_lectura) bloqueo',
         d.demo_schema,tab,d.source_schema,tab);
       EXECUTE q;
       RAISE NOTICE 'Demo %: vista % apunta al origen',d.slug,tab;
     END IF;
   END LOOP;
 END LOOP;
END $repair$;
