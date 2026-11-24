INSERT INTO farmetrica.modulos(clave,nombre,descripcion)
VALUES ('auditoria','Auditoría','Consulta de actividad del cliente; permiso sensible y explícito')
ON CONFLICT(clave) DO UPDATE SET nombre=EXCLUDED.nombre,descripcion=EXCLUDED.descripcion;
INSERT INTO farmetrica.cliente_modulos(cliente_slug,modulo_clave,habilitado)
SELECT slug,'auditoria',auditoria_habilitada AND demo_origen_slug IS NULL FROM farmetrica.clientes
ON CONFLICT(cliente_slug,modulo_clave) DO UPDATE SET habilitado=EXCLUDED.habilitado
WHERE farmetrica.cliente_modulos.habilitado IS DISTINCT FROM EXCLUDED.habilitado;
