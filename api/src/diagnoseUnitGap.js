// Auditoría de cobertura de unidades para un período. Sólo lectura.
// FM_BENCHMARK_READONLY=1 FM_AUDIT_SCHEMA=ampedia FM_AUDIT_FROM=2025-10-20 FM_AUDIT_TO=2026-10-19 node src/diagnoseUnitGap.js
import pg from "pg";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {includedPurchaseSupplier} from "./supplierReporting.js";

if(process.env.FM_BENCHMARK_READONLY!=="1")
 throw Error("Auditoría: es obligatorio FM_BENCHMARK_READONLY=1");
const schema=process.env.FM_AUDIT_SCHEMA||"ampedia";
const slug=process.env.FM_AUDIT_CLIENT||schema;
const from=process.env.FM_AUDIT_FROM;
const to=process.env.FM_AUDIT_TO;
const valid=value=>/^20\d{2}-\d{2}-\d{2}$/.test(value||"")&&
 !Number.isNaN(Date.parse(value+"T00:00:00Z"));
if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema)||!valid(from)||!valid(to)||from>to||
 Date.parse(to)-Date.parse(from)>366*2*86400000)
 throw Error("Indica FM_AUDIT_FROM y FM_AUDIT_TO válidos (máximo dos años)");
const q='"'+schema+'"';
const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
try{
 await client.connect();
 await client.query("BEGIN READ ONLY");
 await client.query("SET LOCAL statement_timeout='30000ms'");
 await client.query("SET LOCAL lock_timeout='3000ms'");
 const values=[from,to,slug];
 const join=(alias)=>`JOIN farmetrica.farmacias f ON f.cliente_slug=$3
  AND upper(btrim(${alias}.farmacia_codigo))=${pharmacyDataCodeSQL("f")}`;
 const range=(alias)=>`${alias}.fecha >= $1::date AND ${alias}.fecha < $2::date+interval '1 day'`;
 const {rows:monthly}=await client.query(`
  WITH movements AS (
   SELECT f.id AS pharmacy_id,f.nombre AS pharmacy,date_trunc('month',v.fecha)::date AS month,
     coalesce(sum(v.unidades) FILTER(WHERE nullif(btrim(v.articulo_id),'') IS NOT NULL),0)::numeric AS sold,
     0::numeric AS received,0::numeric AS received_all
   FROM ${q}.fm_ventas_analitica v ${join("v")} WHERE ${range("v")}
   GROUP BY 1,2,3
   UNION ALL
   SELECT f.id,f.nombre,date_trunc('month',v.fecha)::date,0::numeric,
     coalesce(sum(v.unidades) FILTER(WHERE ${includedPurchaseSupplier({tenant:"$3",code:"v.proveedor_id"})}),0)::numeric,
     coalesce(sum(v.unidades),0)::numeric
   FROM ${q}.fm_recepciones_analitica v ${join("v")} WHERE ${range("v")}
   GROUP BY 1,2,3
  )
  SELECT pharmacy_id,pharmacy,to_char(month,'YYYY-MM') AS month,
   coalesce(sum(sold),0)::float8 AS sold,
   coalesce(sum(received),0)::float8 AS received,
   coalesce(sum(received_all),0)::float8 AS received_all,
   (coalesce(sum(sold),0)-coalesce(sum(received),0))::float8 AS gap
  FROM movements GROUP BY 1,2,3 ORDER BY 2,3`,values);
 const {rows:coverage}=await client.query(`
  SELECT f.id AS pharmacy_id,f.nombre AS pharmacy,
   count(*)::int AS receipt_headers,
   count(*) FILTER(WHERE h.lineas_completas IS NOT TRUE)::int AS incomplete,
   count(*) FILTER(WHERE h.eliminada_logicamente IS TRUE)::int AS logically_deleted,
   min(h.fecha)::date AS first_receipt,
   max(h.fecha)::date AS last_receipt
  FROM ${q}.fm_recepciones_cabeceras h ${join("h")}
  WHERE ${range("h")}
  GROUP BY 1,2 ORDER BY 2`,values);
 const byPharmacy=new Map();
 for(const row of monthly){
  const a=byPharmacy.get(row.pharmacy_id)||{pharmacy:row.pharmacy,sold:0,received:0,receivedAll:0};
  a.sold+=row.sold;a.received+=row.received;a.receivedAll+=row.received_all;
  byPharmacy.set(row.pharmacy_id,a);
 }
 const totals=[...byPharmacy.values()].map(r=>({...r,
  gap:r.sold-r.received,excludedSupplierUnits:r.receivedAll-r.received}));
 console.log(JSON.stringify({period:{from,to},summary:totals,
  monthly,coverage,note:"Brecha documental = vendidas - recibidas incluidas. No es inventario inicial; revisar traspasos, ajustes, bonificaciones y alcance histórico. Los proveedores excluidos no son necesariamente errores."},null,2));
 await client.query("ROLLBACK");
}catch(error){
 console.error("AUDITORIA_UNIDADES_ERROR "+(error.code||error.message));
 process.exitCode=1;
 try{await client.query("ROLLBACK")}catch{}
}finally{await client.end()}
