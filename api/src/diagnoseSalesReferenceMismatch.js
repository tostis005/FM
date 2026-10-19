// Auditoría explícita read-only: caso Europa / Hoy, sin imprimir nombres,
// códigos nacionales, importes ni movimientos individuales.
import pg from "pg";
if(process.env.FM_BENCHMARK_READONLY!=="1")throw Error("Es obligatorio el modo solo lectura");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,
 max:1,connectionTimeoutMillis:5000,options:"-c statement_timeout=15000 -c lock_timeout=3000"});
try{
 const {rows:[r]}=await pool.query(`
  WITH grouped AS (
   SELECT btrim(articulo_id) AS article,
     sum(unidades) AS qty,sum(importe) AS amount,
     count(*) AS lines,
     count(*) FILTER (WHERE unidades IS NULL OR unidades=0) AS zero_lines,
     count(*) FILTER (WHERE unidades<0) AS refund_lines
   FROM ampedia.ventas
   WHERE upper(btrim(farmacia_codigo))='EUR'
     AND fecha >= (now() AT TIME ZONE 'Europe/Madrid')::date
     AND fecha < (now() AT TIME ZONE 'Europe/Madrid')::date+interval '1 day'
     AND nullif(btrim(articulo_id),'') IS NOT NULL
   GROUP BY 1
  )
  SELECT to_char((now() AT TIME ZONE 'Europe/Madrid')::date,'DD/MM/YYYY') AS fecha,
   count(*)::int AS referencias_con_movimientos,
   count(*) FILTER(WHERE qty>0)::int AS referencias_vendidas_netas,
   count(*) FILTER(WHERE qty=0)::int AS referencias_saldo_cero,
   count(*) FILTER(WHERE qty<0)::int AS referencias_devolucion_neta,
   count(*) FILTER(WHERE qty IS NULL)::int AS referencias_sin_cantidad,
   coalesce(sum(qty),0)::float8 AS unidades_netas,
   coalesce(sum(zero_lines),0)::int AS lineas_con_cantidad_cero,
   coalesce(sum(refund_lines),0)::int AS lineas_devolucion,
   count(*) FILTER(WHERE qty<=0 AND amount<>0)::int AS referencias_ajuste_sin_venta
  FROM grouped`);
 console.log("AUDITORIA_EUROPA_HOY "+JSON.stringify(r));
}catch(e){
 console.error("Auditoría Europa: consulta de solo lectura falló "+(e.code||e.name));
 process.exitCode=1;
}finally{await pool.end()}
