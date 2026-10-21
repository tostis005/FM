import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

// Solo comparar PUC basados en recepciones de proveedores no cooperativos,
// respetando el percentil y período definidos para cada farmacia.
export function pickBestLaboratory(rows){
 return (rows||[]).filter(r=>r.supplierCode&&Number(r.puc)>0)
  .sort((a,b)=>Number(a.puc)-Number(b.puc)||
   Number(b.sampleLines||0)-Number(a.sampleLines||0)||
   String(a.supplierName||"").localeCompare(String(b.supplierName||""),"es"))[0]||null;
}
export function mapLaboratoryOffers(rows,items){
 const byRef=new Map(),byPh=new Map(),byGroup=new Map();
 for(const it of items){
  const key=String(it.pharmacyId)+"|"+String(it.articleId);
  if(!byRef.has(key))byRef.set(key,[]);
  byRef.get(key).push(it.groupKey);
 }
 for(const r of rows){
  for(const groupKey of byRef.get(String(r.pharmacyId)+"|"+String(r.articleId))||[]){
   const item={groupKey,pharmacyId:String(r.pharmacyId),articleId:String(r.articleId),
    cn:String(r.cn||r.articleId),supplierCode:String(r.supplierCode),
    supplierName:String(r.supplierName||r.supplierCode),
    puc:Number(r.puc),sampleLines:Number(r.sampleLines||0)};
   const pk=groupKey+"|"+item.pharmacyId;
   if(!byPh.has(pk))byPh.set(pk,[]);
   byPh.get(pk).push(item);
   if(!byGroup.has(groupKey))byGroup.set(groupKey,[]);
   byGroup.get(groupKey).push(item);
  }
 }
 return {byPharmacy:[...byPh.values()].map(options=>({
   groupKey:options[0].groupKey,pharmacyId:options[0].pharmacyId,
   recommended:pickBestLaboratory(options),
   options:options.sort((a,b)=>a.puc-b.puc)
  })),recommendations:[...byGroup].map(([groupKey,offers])=>({
   groupKey,recommended:pickBestLaboratory(offers)
  }))};
}
export async function readPlannerLaboratories(pool,ctx,chosen,items,dcpfs,reportTo){
 const ids=new Set(chosen.map(String));
 const selected=items.filter(r=>ids.has(String(r.pharmacyId)));
 const codes=[...new Set(selected.map(r=>String(r.articleId)))];
 let offers=[];
 const q='"'+ctx.client.schema+'"';
 if(codes.length){
  const sql=`
  WITH base AS MATERIALIZED (
   SELECT f.id::text AS pharmacy_id,c.articulo_id::text AS article_id,
    c.proveedor_id::text AS supplier_code,
    max(coalesce(nullif(btrim(pm.nombre),''),nullif(btrim(c.proveedor_nombre),''),c.proveedor_id)) AS supplier_name,
    c.coste_unitario::float8 AS price,sum(c.unidades)::float8 AS qty,
    count(*)::int AS lines,coalesce(pl.percentil,pg.percentil,20)::float8 AS pct
   FROM ${q}.fm_recepciones_analitica c
   JOIN farmetrica.farmacias f ON f.cliente_slug=$4 AND f.id=ANY($2::int[])
    AND upper(btrim(c.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
   LEFT JOIN farmetrica.proveedores_maestro pm
    ON pm.cliente_slug=$4 AND upper(btrim(pm.codigo_origen))=upper(btrim(c.proveedor_id))
   LEFT JOIN farmetrica.politica_precios pg
    ON pg.cliente_slug=$4 AND pg.farmacia_id=0
   LEFT JOIN farmetrica.politica_precios pl
    ON pl.cliente_slug=$4 AND pl.farmacia_id=f.id
   WHERE c.articulo_id=ANY($1::text[])
    AND c.fecha>=($3::date-make_interval(months=>coalesce(pl.meses,pg.meses,6)))
    AND c.fecha<$3::date+interval '1 day'
    AND c.unidades>0 AND c.coste_unitario>0
    AND nullif(btrim(c.proveedor_id),'') IS NOT NULL
    AND pm.cooperativa IS NOT TRUE AND pm.ignorar_informes IS NOT TRUE
   GROUP BY f.id,c.articulo_id,c.proveedor_id,c.coste_unitario,
    coalesce(pl.percentil,pg.percentil,20)
  ), ranked AS (
   SELECT *,sum(qty) OVER (PARTITION BY pharmacy_id,article_id,supplier_code) AS total_qty,
    sum(qty) OVER (PARTITION BY pharmacy_id,article_id,supplier_code ORDER BY price
     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running
   FROM base
  ), low AS (
   SELECT *,greatest(0,least(qty,total_qty*pct/100-(running-qty))) AS taken
   FROM ranked
  )
  SELECT pharmacy_id AS "pharmacyId",article_id AS "articleId",
   supplier_code AS "supplierCode",max(supplier_name) AS "supplierName",
   (sum(price*taken)/nullif(sum(taken),0))::float8 AS puc,
   sum(lines)::int AS "sampleLines"
  FROM low GROUP BY pharmacy_id,article_id,supplier_code
  HAVING sum(lines)>=3 AND sum(taken)>0`;
  const {rows}=await pool.query({text:sql,values:[codes,chosen,reportTo,ctx.client.slug],
   query_timeout:18000});
  offers=rows;
 }
 const result=mapLaboratoryOffers(offers,selected);
 const lookups=[...new Set(selected.map(r=>String(r.cn||r.articleId)))];
 let presentations=[];
 if(lookups.length||dcpfs.length){
  const {rows}=await pool.query(`SELECT DISTINCT ON (cn) cn,dcpf,nombre,
   laboratorio,laboratorio_codigo
   FROM farmetrica.nomenclator_presentaciones
   WHERE (generico=true AND dcpf=ANY($1::text[])) OR cn=ANY($2::text[])
   ORDER BY cn,dcpf LIMIT 6000`,[dcpfs,lookups]);
  presentations=rows.map(r=>({cn:String(r.cn),dcpf:r.dcpf,
   name:r.nombre,laboratory:r.laboratorio,laboratoryCode:r.laboratorio_codigo}));
 }
 return {...result,presentations,observedPrices:offers.length,policy:"percentil_puc"};
}
