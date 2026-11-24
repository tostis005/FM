-- 070 · Consolidación conservadora de identidades duplicadas del almacén Ampedia.
-- Idempotente: solo se procesan proveedores activos y exclusivamente de origen almacén.
-- No modifica tablas ERP, recepciones, stock ni movimientos de compra o venta.
-- El nombre por sí solo NO justifica unir clases distintas ni destinos ambiguos.

CREATE TABLE IF NOT EXISTS farmetrica.proveedores_fusiones_almacen (
 cliente_slug text NOT NULL,
 proveedor_origen_id bigint NOT NULL,
 proveedor_destino_id bigint NOT NULL,
 origen_nombre text NOT NULL,
 destino_nombre text NOT NULL,
 criterio text NOT NULL,
 codigos_traspasados integer NOT NULL DEFAULT 0,
 aplicado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cliente_slug,proveedor_origen_id)
);

-- Igualdad ortográfica controlada; elimina solo prefijos/sufijos de laboratorio
-- y formas societarias frecuentes. Se exigen además unicidad y misma clase.
CREATE OR REPLACE FUNCTION farmetrica.nombre_proveedor_comparable(input text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT btrim(regexp_replace(
   regexp_replace(
     regexp_replace(
       regexp_replace(
         regexp_replace(
           translate(upper(btrim(coalesce(input,''))),
             'ÁÉÍÓÚÜÑÇÀÈÌÒÙÄËÏÖ','AEIOUUNCAEIOUAEIO'),
           '[^A-Z0-9]+',' ','g'),
         '^[0-9]{1,4} ',''),
       '^(ZZZ NO USAR |LABORATORIOS? |LABS? )+','','g'),
     ' (LABORATORIOS?|S A U?|S L U?)$',''),
   '\s+',' ','g'));
$$;

-- La fusión es transaccional. El origen queda archivado con fusionado_a
-- y se conservan todos sus enlaces a ERP, documentación y pedidos.
CREATE OR REPLACE FUNCTION farmetrica.fusionar_proveedor_duplicado_almacen(
 source_id bigint,target_id bigint,merge_reason text
) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
 v_source record;
 v_target record;
 v_alias_count integer := 0;
BEGIN
 IF source_id=target_id OR merge_reason NOT IN
   ('mismo_codigo_erp_almacen','nombre_exacto_unico') THEN RETURN false; END IF;
 SELECT id,cliente_slug,nombre,clase,activo,fusionado_a INTO v_source
 FROM farmetrica.proveedores_unificados
 WHERE cliente_slug='ampedia' AND id=source_id FOR UPDATE;
 IF NOT FOUND OR v_source.activo IS NOT TRUE OR v_source.fusionado_a IS NOT NULL
  THEN RETURN false; END IF;
 SELECT id,cliente_slug,nombre,clase,activo,fusionado_a INTO v_target
 FROM farmetrica.proveedores_unificados
 WHERE cliente_slug='ampedia' AND id=target_id FOR UPDATE;
 IF NOT FOUND OR v_target.activo IS NOT TRUE OR v_target.fusionado_a IS NOT NULL
  THEN RETURN false; END IF;
 -- Solo absorber fichas que tienen EXCLUSIVAMENTE códigos de almacén.
 -- Ningún alias de otra farmacia pasa de un grupo a otro inadvertidamente.
 IF NOT EXISTS (
   SELECT 1 FROM farmetrica.proveedores_unificados_alias a
   WHERE a.cliente_slug='ampedia' AND a.proveedor_id=source_id
    AND upper(btrim(a.farmacia_codigo)) IN ('AMP','ALMACEN')
 ) OR EXISTS (
   SELECT 1 FROM farmetrica.proveedores_unificados_alias a
   WHERE a.cliente_slug='ampedia' AND a.proveedor_id=source_id
    AND upper(btrim(a.farmacia_codigo)) NOT IN ('AMP','ALMACEN')
 ) THEN RETURN false; END IF;
 -- Un proveedor de clase desconocida puede incorporarse a uno clasificado.
 -- Nunca cruzar MAYORISTA, INTERNO, DIRECTO, VACUNAS o FÓRMULAS distintos.
 IF v_source.clase<>v_target.clase AND
    v_source.clase<>'SIN_CLASIFICAR' THEN RETURN false; END IF;

 UPDATE farmetrica.proveedores_unificados_alias
  SET proveedor_id=target_id,actualizado_en=now()
  WHERE cliente_slug='ampedia' AND proveedor_id=source_id;
 GET DIAGNOSTICS v_alias_count = ROW_COUNT;

 -- La ficha de destino prevalece; los campos adicionales del origen se retienen.
 INSERT INTO farmetrica.proveedor_fichas(cliente_slug,proveedor_id,datos)
 SELECT cliente_slug,target_id,datos FROM farmetrica.proveedor_fichas
 WHERE cliente_slug='ampedia' AND proveedor_id=source_id
 ON CONFLICT(cliente_slug,proveedor_id) DO UPDATE
  SET datos=EXCLUDED.datos || farmetrica.proveedor_fichas.datos,
      actualizado_en=now();

 UPDATE farmetrica.proveedor_contactos SET principal=false
 WHERE cliente_slug='ampedia' AND proveedor_id=source_id AND principal;
 UPDATE farmetrica.proveedor_contactos SET proveedor_id=target_id
 WHERE cliente_slug='ampedia' AND proveedor_id=source_id;
 UPDATE farmetrica.proveedor_documentos SET proveedor_id=target_id
 WHERE cliente_slug='ampedia' AND proveedor_id=source_id;

 -- Preferir la frecuencia del destino, nunca cambiarla si ya estaba definida.
 INSERT INTO farmetrica.preparador_frecuencia_laboratorio
  (cliente_slug,laboratorio_clave,intervalo_dias)
 SELECT cliente_slug,'P:'||target_id::text,intervalo_dias
 FROM farmetrica.preparador_frecuencia_laboratorio
 WHERE cliente_slug='ampedia' AND laboratorio_clave='P:'||source_id::text
 ON CONFLICT(cliente_slug,laboratorio_clave) DO NOTHING;
 DELETE FROM farmetrica.preparador_frecuencia_laboratorio
 WHERE cliente_slug='ampedia' AND laboratorio_clave='P:'||source_id::text;

 INSERT INTO farmetrica.pedidos_laboratorio_borradores
  (cliente_slug,laboratorio_clave,tipo,farmacias_clave,desde,hasta,lineas,comentario_global)
 SELECT cliente_slug,'P:'||target_id::text,tipo,farmacias_clave,desde,hasta,
  lineas,comentario_global
 FROM farmetrica.pedidos_laboratorio_borradores
 WHERE cliente_slug='ampedia' AND laboratorio_clave='P:'||source_id::text
 ON CONFLICT(cliente_slug,laboratorio_clave,tipo,farmacias_clave) DO NOTHING;
 -- Los borradores antiguos permanecen archivados bajo el ID inactivo.

 UPDATE farmetrica.preparador_pedidos_realizados
 SET laboratorio_id=target_id
 WHERE cliente_slug='ampedia' AND laboratorio_id=source_id;
 UPDATE farmetrica.preparador_pedidos_globales
 SET laboratorio_id=target_id
 WHERE cliente_slug='ampedia' AND laboratorio_id=source_id;

 INSERT INTO farmetrica.preparador_frecuencia_propuesta
  (cliente_slug,laboratorio_id,criterio,cn_unicos,frecuencia_propuesta,
   frecuencia_anterior,aplicada,creado_en)
 SELECT cliente_slug,target_id,criterio,cn_unicos,frecuencia_propuesta,
  frecuencia_anterior,aplicada,creado_en
 FROM farmetrica.preparador_frecuencia_propuesta
 WHERE cliente_slug='ampedia' AND laboratorio_id=source_id
 ON CONFLICT(cliente_slug,laboratorio_id,criterio) DO NOTHING;
 -- Mantener además la propuesta antigua como evidencia histórica.

 UPDATE farmetrica.proveedores_unificados
 SET activo=false,fusionado_a=target_id,actualizado_en=now()
 WHERE cliente_slug='ampedia' AND id=source_id;

 INSERT INTO farmetrica.proveedores_fusiones_almacen
 (cliente_slug,proveedor_origen_id,proveedor_destino_id,
  origen_nombre,destino_nombre,criterio,codigos_traspasados)
 VALUES('ampedia',source_id,target_id,v_source.nombre,v_target.nombre,
  merge_reason,v_alias_count)
 ON CONFLICT(cliente_slug,proveedor_origen_id) DO NOTHING;
 RETURN true;
END;
$$;

DO $merge_almacen$
DECLARE
 match record;
 same_code_count integer:=0;
 same_name_count integer:=0;
BEGIN
 -- Evitar dos consolidaciones simultáneas del mismo tenant.
 PERFORM pg_advisory_xact_lock(hashtext('fm_proveedores_almacen'),
  hashtext('ampedia'));

 -- 1. Prioridad máxima: el mismo código físico del almacén existe tanto en
 -- ALMACEN actual como en AMP histórico, y conduce a UN SOLO proveedor.
 -- Se conserva como destino la identidad AMP que ya figura en el maestro.
 FOR match IN
  WITH matches AS (
   SELECT a.proveedor_id AS source_id,h.proveedor_id AS target_id
   FROM farmetrica.proveedores_unificados_alias a
   JOIN farmetrica.proveedores_unificados_alias h
    ON h.cliente_slug=a.cliente_slug
    AND upper(btrim(h.farmacia_codigo))='AMP'
    AND btrim(h.codigo_origen)=btrim(a.codigo_origen)
    AND h.proveedor_id<>a.proveedor_id
   JOIN farmetrica.proveedores_unificados src
    ON src.cliente_slug=a.cliente_slug AND src.id=a.proveedor_id AND src.activo
   JOIN farmetrica.proveedores_unificados dst
    ON dst.cliente_slug=h.cliente_slug AND dst.id=h.proveedor_id AND dst.activo
   WHERE a.cliente_slug='ampedia'
    AND upper(btrim(a.farmacia_codigo))='ALMACEN'
    AND (src.clase=dst.clase OR src.clase='SIN_CLASIFICAR')
    AND NOT EXISTS (
     SELECT 1 FROM farmetrica.proveedores_unificados_alias other
     WHERE other.cliente_slug='ampedia' AND other.proveedor_id=src.id
      AND upper(btrim(other.farmacia_codigo)) NOT IN ('AMP','ALMACEN')
    )
  )
  SELECT source_id,min(target_id) AS target_id
  FROM matches GROUP BY source_id
  HAVING count(DISTINCT target_id)=1
  ORDER BY source_id
 LOOP
  IF farmetrica.fusionar_proveedor_duplicado_almacen(
   match.source_id,match.target_id,'mismo_codigo_erp_almacen')
  THEN same_code_count:=same_code_count+1; END IF;
 END LOOP;

 -- 2. Los almacenes que aún tienen una ficha propia se integran en el
 -- proveedor de las farmacias si el nombre normalizado y la clasificación
 -- son compatibles y hay UN ÚNICO destino comercial con ese nombre.
 FOR match IN
  WITH source_pool AS (
   SELECT src.id,src.nombre,src.clase,
    farmetrica.nombre_proveedor_comparable(src.nombre) AS cmp
   FROM farmetrica.proveedores_unificados src
   WHERE src.cliente_slug='ampedia' AND src.activo
    AND EXISTS (
      SELECT 1 FROM farmetrica.proveedores_unificados_alias a
      WHERE a.cliente_slug='ampedia' AND a.proveedor_id=src.id
       AND upper(btrim(a.farmacia_codigo)) IN ('AMP','ALMACEN')
    )
    AND NOT EXISTS (
      SELECT 1 FROM farmetrica.proveedores_unificados_alias a
      WHERE a.cliente_slug='ampedia' AND a.proveedor_id=src.id
       AND upper(btrim(a.farmacia_codigo)) NOT IN ('AMP','ALMACEN')
    )
  ), destinations AS (
   SELECT dst.id,dst.nombre,dst.clase,
    farmetrica.nombre_proveedor_comparable(dst.nombre) AS cmp
   FROM farmetrica.proveedores_unificados dst
   WHERE dst.cliente_slug='ampedia' AND dst.activo
    AND EXISTS (
      SELECT 1 FROM farmetrica.proveedores_unificados_alias a
      WHERE a.cliente_slug='ampedia' AND a.proveedor_id=dst.id
       AND upper(btrim(a.farmacia_codigo)) NOT IN ('AMP','ALMACEN')
    )
  ), candidates AS (
   SELECT src.id AS source_id,dst.id AS target_id
   FROM source_pool src JOIN destinations dst
    ON src.cmp=dst.cmp AND (src.clase=dst.clase
     OR src.clase='SIN_CLASIFICAR')
   WHERE char_length(src.cmp)>=5
    AND src.cmp ~ '[A-Z]{3}'
    AND src.cmp !~ '^(VARIOS|OTROS|PENDIENTE|PROVEEDOR|SIN CLASIFICAR|NO USAR|ALMACEN|FARMACIA)$'
  )
  SELECT source_id,min(target_id) AS target_id
  FROM candidates GROUP BY source_id
  HAVING count(DISTINCT target_id)=1
  ORDER BY source_id
 LOOP
  IF farmetrica.fusionar_proveedor_duplicado_almacen(
    match.source_id,match.target_id,'nombre_exacto_unico')
  THEN same_name_count:=same_name_count+1; END IF;
 END LOOP;

 -- La fotografía del preparador puede contener IDs anteriores.
 -- Marcarla como obsoleta para que se regenere en cuanto se consulte.
 IF same_code_count+same_name_count>0 THEN
  UPDATE farmetrica.preparador_ultima_recepcion_estado
  SET actualizado_en=to_timestamp(0) WHERE cliente_slug='ampedia';
 END IF;
 RAISE NOTICE 'UNIFICACION_ALMACEN_AMPEDIA fusiones_mismo_codigo=% fusiones_nombre_unico=% total=%',
  same_code_count,same_name_count,same_code_count+same_name_count;
END;
$merge_almacen$;

-- Solo se necesita en la migración; el historial de fusiones permanece.
DROP FUNCTION farmetrica.fusionar_proveedor_duplicado_almacen(bigint,bigint,text);
