\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
-- PostgreSQL system catalog only; no business records.
BEGIN READ ONLY;
SET LOCAL statement_timeout='25s';
SELECT 'META|'||row_to_json(x)::text FROM
(SELECT current_setting('server_version') AS version,
pg_database_size(current_database()) AS db_bytes,
(SELECT stats_reset FROM pg_stat_database WHERE datname=current_database()) AS stats_reset,
current_setting('shared_buffers') AS shared_buffers,
current_setting('work_mem') AS work_mem) x;
SELECT 'TABLE|'||row_to_json(x)::text FROM (
 SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind,
 c.reltuples::bigint AS estimated_rows,
 CASE WHEN c.relkind IN ('r','p','m') THEN pg_total_relation_size(c.oid) ELSE 0 END AS bytes,
 CASE WHEN c.relkind IN ('r','p','m') THEN pg_indexes_size(c.oid) ELSE 0 END AS index_bytes,
 (SELECT count(*)::int FROM pg_index i WHERE i.indrelid=c.oid) AS index_count,
 s.seq_scan,s.seq_tup_read,s.idx_scan,s.idx_tup_fetch,
 s.n_tup_ins,s.n_tup_upd,s.n_tup_del,s.n_live_tup,s.n_dead_tup,
 s.last_autoanalyze,s.last_analyze,s.last_autovacuum
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_stat_user_tables s ON s.relid=c.oid
 WHERE n.nspname IN ('ampedia','farmetrica','public')
 AND c.relkind IN ('r','p','m','v')
 ORDER BY n.nspname,c.relname
) x;
SELECT 'INDEX|'||row_to_json(x)::text FROM (
 SELECT n.nspname AS schema,t.relname AS table_name,i.relname AS name,
 pg_get_indexdef(i.oid) AS definition,
 pg_relation_size(i.oid) AS bytes,
 ix.indisprimary AS is_pk,ix.indisunique AS is_unique,
 ix.indisvalid AS valid,ix.indisready AS ready,
 s.idx_scan,s.idx_tup_read
 FROM pg_index ix JOIN pg_class i ON i.oid=ix.indexrelid
 JOIN pg_class t ON t.oid=ix.indrelid
 JOIN pg_namespace n ON n.oid=t.relnamespace
 LEFT JOIN pg_stat_user_indexes s ON s.indexrelid=ix.indexrelid
 WHERE n.nspname IN ('ampedia','farmetrica','public')
 ORDER BY n.nspname,t.relname,i.relname
) x;
COMMIT;
