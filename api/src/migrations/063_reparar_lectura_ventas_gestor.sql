-- 063 · Corregir una incoherencia del editor de perfiles anteriores:
-- al marcar Ventas y Ventas (resumen) se podía guardar sin el permiso "ver".
-- Restaurar únicamente ese permiso cuando AMBAS selecciones eran explícitas.
-- No habilita módulos del cliente, no afecta a otras áreas ni a perfiles
-- sin acceso explícito al resumen de Ventas.
UPDATE farmetrica.perfiles
SET permisos=jsonb_set(permisos,'{ventas}',
  coalesce(permisos->'ventas','[]'::jsonb) || '["ver"]'::jsonb,true),
 actualizado_en=now()
WHERE rol_base='gestor'
 AND modulos @> ARRAY['ventas']::text[]
 AND secciones @> ARRAY['ventas']::text[]
 AND jsonb_typeof(coalesce(permisos->'ventas','[]'::jsonb))='array'
 AND NOT (coalesce(permisos->'ventas','[]'::jsonb) @> '["ver"]'::jsonb);
