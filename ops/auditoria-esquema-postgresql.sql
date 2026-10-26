-- Auditoría de metadatos, sin escrituras ni acceso a registros comerciales.
BEGIN READ ONLY;
SELECT current_setting('server_version') AS version;
SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname IN ('ampedia','farmetrica') ORDER BY 1,2,3;
COMMIT;
