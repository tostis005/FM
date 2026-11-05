// Consulta acotada de catálogo y ventas para el preparador de objetivos.
// Sólo expone farmacias autorizadas, CN reales y agregados, nunca tickets.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {promotionCatalogSearchSQL} from "./promotionCatalogSearch.js";
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const ISO=/^20\d{2}-\d{2}-\d{2}$/;
const CN=/^\d{6}$/;
const cleanCNs=values=>Array.isArray(values)?
  [...new Set(values.map(x=>String(x).trim()))].filter(x=>CN.test(x)):[];
const validPeriod=p=>{
 if(!p||typeof p.id!=="string"||p.id.length>24||!ISO.test(p.from||"")||!ISO.test(p.to||""))return false;
 const start=new Date(p.from+"T00:00:00Z"),end=new Date(p.to+"T00:00:00Z");
 return Number.isFinite(start.getTime())&&Number.isFinite(end.getTime())&&
  start.toISOString().slice(0,10)===p.from&&end.toISOString().slice(0,10)===p.to&&
  end>=start&&(end-start)<=5*366*86400000;
};
export function setupPromotionObjectives(app,pool,{requireTenantModule}){
 const protectedRoute=requireTenantModule("promociones");
 app.post("/api/ventas/objetivos/buscar",...protectedRoute,async(req,res,next)=>{
  try{
   const schema=req.context.client.schema,slug=req.context.client.slug;
   if(!SCHEMA.test(schema)||!SCHEMA.test(slug))return res.status(400).json({error:"Cliente inválido"});
   const search=String(req.body?.search||"").trim().slice(0,90),cns=cleanCNs(req.body?.cns);
   if(Array.isArray(req.body?.cns)&&cns.length!==new Set(req.body.cns).size||
      cns.length>500)return res.status(400).json({error:"Introduce un máximo de 500 CN válidos"});
   if(search.length<2&&!cns.length)return res.json({products:[]});
   const ids=req.context.allowedPharmacyIds.filter(Number.isSafeInteger);
   if(!ids.length)return res.json({products:[]});
   const {rows:metadata}=await pool.query(
    "SELECT table_name,column_name FROM information_schema.columns "+
    "WHERE table_schema=$1 AND table_name IN ('articulos','proveedores')",[schema]);
   let sql;
   try{sql=promotionCatalogSearchSQL(schema,metadata);}
   catch(error){return res.status(503).json({error:error.message});}
   const {rows}=await pool.query(sql,[slug,ids,search,cns]);
   return res.json({products:rows.map(r=>({
    cn:r.cn||null,description:r.description||"Artículo sin nombre",
    supplier:r.supplier||null,sourceId:r.sourceId||null
   }))});
  }catch(e){next(e);}
 });
 app.post("/api/ventas/objetivos/historico",...protectedRoute,async(req,res,next)=>{
  try{
   const schema=req.context.client.schema,slug=req.context.client.slug;
   if(!SCHEMA.test(schema)||!SCHEMA.test(slug))return res.status(400).json({error:"Cliente inválido"});
   const cns=cleanCNs(req.body?.cns),periods=req.body?.periods,requested=req.body?.pharmacyIds;
   if(!cns.length||cns.length>500||!Array.isArray(periods)||periods.length<1||
     periods.length>6||periods.some(p=>!validPeriod(p))||
     !Array.isArray(req.body?.cns)||cns.length!==new Set(req.body.cns).size)
    return res.status(400).json({error:"CNs o períodos inválidos"});
   const allowed=new Set(req.context.allowedPharmacyIds.map(Number));
   const ids=Array.isArray(requested)?[...new Set(requested.map(Number))]:
     [...allowed];
   if(ids.some(id=>!Number.isSafeInteger(id)||!allowed.has(id)))
     return res.status(403).json({error:"Farmacia fuera de tu ámbito"});
   if(!ids.length)return res.json({periods:Object.fromEntries(periods.map(p=>[p.id,{}])),amounts:Object.fromEntries(periods.map(p=>[p.id,{}]))});
   // Los tickets usan a veces el ID Farmatic y no el CN. Resolver el maestro
   // una sola vez y comparar siempre por farmacia para evitar cruces de IDs.
   const {rows:links}=await pool.query(`
    SELECT DISTINCT f.id::text AS pharmacy_id,btrim(a.origen_id::text) AS source_id
    FROM "${schema}".articulos a
    JOIN farmetrica.farmacias f ON f.cliente_slug=$1
      AND upper(btrim(a.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
    WHERE f.id=ANY($2::int[]) AND btrim(a.codigo_nacional::text)=ANY($3::text[])`,
    [slug,ids,cns]);
   const mappedKeys=links.map(r=>r.pharmacy_id+"|"+r.source_id);
   const query=`SELECT f.id::text AS pharmacy_id,
      coalesce(sum(v.unidades),0)::float8 AS units,
      coalesce(sum(v.importe),0)::float8 AS amount
     FROM "${schema}".fm_ventas_analitica v JOIN farmetrica.farmacias f
      ON f.cliente_slug=$1
      AND upper(btrim(v.farmacia_codigo::text))=${pharmacyDataCodeSQL("f")}
     WHERE f.id=ANY($2::int[]) AND v.fecha >= $3::date
       AND v.fecha < ($4::date+interval '1 day')
       AND (btrim(v.articulo_id::text)=ANY($5::text[])
          OR f.id::text||'|'||btrim(v.articulo_id::text)=ANY($6::text[]))
     GROUP BY f.id`;
   const totals={},amounts={};
   for(const p of periods){
    const {rows}=await pool.query(query,[slug,ids,p.from,p.to,cns,mappedKeys]);
    totals[p.id]=Object.fromEntries(rows.map(r=>[r.pharmacy_id,Number(r.units)]));
    amounts[p.id]=Object.fromEntries(rows.map(r=>[r.pharmacy_id,Number(r.amount)]));
   }
   res.json({periods:totals,amounts});
  }catch(e){next(e);}
 });
}