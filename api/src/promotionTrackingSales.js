// Una misma lógica de consulta para el listado, seguimiento y auditorías
// de promociones. Las ventas TOTALES no dependen del estado ni de objetivos;
// las ventas atribuibles sí dependen de la mecánica de ticket.
import {promotionBundle} from "./promotionEligibility.js";
import {resolvePromotionArticleKeys,articleKeysForCNs} from "./promocionesArticulos.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;

export async function calculatePromotionTracking(pool,context,promotions){
 const schema=context?.client?.schema,slug=context?.client?.slug;
 if(!SCHEMA.test(schema||"")||!SCHEMA.test(slug||""))
  throw Error("Cliente de promociones no autorizado");
 const ids=(context?.allowedPharmacyIds||[]).filter(Number.isSafeInteger);
 const sales={},totalSales={};
 if(!ids.length)return {sales,totalSales};
 const join=`FROM "${schema}".fm_ventas_analitica v JOIN farmetrica.farmacias f
  ON upper(btrim(v.farmacia_codigo::text))=${pharmacyDataCodeSQL("f")}
  AND f.cliente_slug=$9 AND f.id=ANY($10::int[])`;
 const articleKeys=await resolvePromotionArticleKeys(pool,context,promotions.flatMap(p=>p.cns));
 let cursor=0;
 const worker=async()=>{
  while(cursor<promotions.length){
   const p=promotions[cursor++];
   if(!p.cns.length){sales[p.id]={};totalSales[p.id]={};continue;}
   const bundle=promotionBundle(p);
   const mappedKeys=articleKeysForCNs(articleKeys,p.cns);
   const query=`WITH ticket_units AS (
       SELECT f.id::text AS farmacia_id,
        NULLIF(btrim(v.numero_ticket::text),'') AS ticket,
        v.fecha::date AS dia,sum(v.unidades)::float8 AS units
       ${join}
       WHERE v.fecha >= $1::date AND v.fecha < ($2::date + interval '1 day')
       AND (btrim(v.articulo_id::text)=ANY($3::text[])
         OR f.id::text||'|'||btrim(v.articulo_id::text)=ANY($7::text[]))
       GROUP BY f.id,NULLIF(btrim(v.numero_ticket::text),''),v.fecha::date
     )
     SELECT farmacia_id,
      coalesce(sum(CASE
       WHEN $8::boolean THEN units
       WHEN ticket IS NULL OR units<=0 OR NOT $6::boolean THEN 0
       WHEN $5::boolean AND units >= $4::integer THEN units
       ELSE floor(greatest(units,0)/$4::integer)*$4::integer
      END),0)::float8 AS unidades,
      coalesce(sum(units),0)::float8 AS unidades_totales
     FROM ticket_units GROUP BY farmacia_id`;
   const {rows}=await pool.query(query,[
    p.start,p.end,p.cns,bundle||1,p.type==="escalonado",
    Boolean(bundle),mappedKeys,p.durationMode==="stock",slug,ids
   ]);
   sales[p.id]=Object.fromEntries(rows.map(row=>[row.farmacia_id,Number(row.unidades)]));
   totalSales[p.id]=Object.fromEntries(rows.map(row=>[row.farmacia_id,Number(row.unidades_totales)]));
  }
 };
 await Promise.all(Array.from({length:Math.min(2,promotions.length)},worker));
 return {sales,totalSales};
}
