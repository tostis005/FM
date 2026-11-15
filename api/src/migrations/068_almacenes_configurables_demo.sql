-- 068 · Ofrecer almacenes del cliente origen en cada demo, DESACTIVADOS
-- de forma predeterminada y con configuración totalmente independiente.
-- No copia ventas, compras, stock, pedidos, credenciales ni movimientos ERP.
-- No toca ni actualiza los establecimientos del cliente real.
WITH source_warehouses AS (
 SELECT demo.slug AS demo_slug,src.id AS source_id,
   src.codigo_origen,
   row_number() OVER (PARTITION BY demo.slug ORDER BY src.id) AS n
 FROM farmetrica.clientes demo
 JOIN farmetrica.farmacias src
   ON src.cliente_slug=demo.demo_origen_slug
 WHERE demo.demo_origen_slug IS NOT NULL
   AND demo.activo=true
   AND src.tipo_establecimiento='almacen'
)
INSERT INTO farmetrica.farmacias
 (cliente_slug,nombre,ciudad,activo,codigo_origen,codigo_visible,
  host_origen,bd_origen,tipo_establecimiento)
SELECT demo_slug,'Almacén Demo '||lpad(n::text,2,'0'),'',
  false,
  CASE WHEN codigo_origen IN ('POL','VAL')
        AND EXISTS(SELECT 1 FROM farmetrica.farmacias f
                   WHERE f.id=source_id AND f.cliente_slug='ampedia')
    THEN 'VAL' ELSE codigo_origen END,
  'A'||lpad(n::text,2,'0'),NULL,'Demo','almacen'
FROM source_warehouses
ON CONFLICT(cliente_slug,codigo_origen) DO NOTHING;
-- Respetar siempre el tipo y el estado configurados previamente en cada demo.
