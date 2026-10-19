// Recuentos exactos del período seleccionado y familias del ERP por farmacia.
// La selección de códigos ERP se resuelve desde req.context, nunca del navegador.
import {validSalesDateRange} from "./salesAnalysisPeriod.js";
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const ISO=/^20\d{2}-\d{2}-\d{2}$/;
export function buildRecentProductCountSQL(schema){
 if(!SCHEMA.test(schema))throw Error("Esquema no permitido");
 const t='"'+schema+'"';
 return `
 WITH sold AS MATERIALIZED (
   SELECT upper(btrim(v.farmacia_codigo)) AS source_code,v.articulo_id,
     sum(v.unidades)::float8 AS net_units
   FROM ${t}.ventas v
   WHERE upper(btrim(v.farmacia_codigo))=ANY($1::text[])
     AND v.fecha >= $2::date AND v.fecha < $3::date+interval '1 day'
     AND nullif(btrim(v.articulo_id),'') IS NOT NULL
   GROUP BY 1,2 HAVING sum(v.unidades)>0
 ),
 identified AS (
   SELECT s.source_code,s.net_units,
     coalesce(nullif(btrim(a.codigo_nacional),''),btrim(s.articulo_id)) AS cn
   FROM sold s LEFT JOIN LATERAL (
     SELECT a.codigo_nacional FROM ${t}.articulos a
     WHERE upper(btrim(a.farmacia_codigo))=s.source_code
       AND a.origen_id=s.articulo_id
     ORDER BY a.sincronizado_en DESC NULLS LAST LIMIT 1
   ) a ON true
 )
 SELECT count(*)::int AS "totalProducts",count(DISTINCT cn)::int AS "totalArticles"
 FROM (SELECT source_code,cn FROM identified
       GROUP BY source_code,cn HAVING sum(net_units)>0) x`;
}
export function buildPharmacyFamiliesSQL(schema){
 if(!SCHEMA.test(schema))throw Error("Esquema no permitido");
 return `SELECT DISTINCT btrim(familia) AS codigo
 FROM "${schema}".articulos
 WHERE upper(btrim(farmacia_codigo))=$1
   AND nullif(btrim(familia),'') IS NOT NULL
 ORDER BY 1 LIMIT 250`;
}
function scope(req,res){
 if(req.context.role!=="superadministrador"&&
   !req.context.modules?.ventas&&!req.context.modules?.dashboard){
  res.status(403).json({error:"Módulo de ventas no habilitado"});return null;
 }
 const raw=String(req.query.farmacias||"");
 if(raw.length>2000||(raw&&raw.split(",").some(id=>!/^[1-9]\d{0,8}$/.test(id)))){
  res.status(400).json({error:"Farmacias no válidas"});return null;
 }
 const allowed=req.context.allowedPharmacyIds.map(Number);
 const requested=raw?raw.split(",").map(Number):allowed;
 if(requested.some(id=>!allowed.includes(id))){
  res.status(403).json({error:"Farmacia no autorizada"});return null;
 }
 const ids=[...new Set(requested)];
 const codeById=new Map((req.context.pharmacies||[]).map(p=>[
   Number(p.id),String(p.databaseCode||p.sourceCode||"").trim().toUpperCase()]));
 if(ids.some(id=>!codeById.get(id))){
  res.status(503).json({error:"Sin correspondencia de farmacia con el ERP"});return null;
 }
 const schema=req.context.client.schema;
 if(!SCHEMA.test(schema))throw Error("Esquema no permitido");
 return {ids,codes:[...new Set(ids.map(id=>codeById.get(id)))],schema};
}
export function setupSalesInsights(app,pool,{requireTenant}){
 app.get("/api/analytics/ventas/recuento",...requireTenant(),async(req,res,next)=>{
  try{
   const s=scope(req,res);if(!s)return;
   const from=String(req.query.desde||""),to=String(req.query.hasta||"");
   if(!validSalesDateRange(from,to))
    return res.status(400).json({error:"El recuento debe usar un período de fechas válido"});
   if(!s.ids.length)return res.json({totalProducts:0,totalArticles:0,from,to});
   // Una consulta real para cada petición; no conservar recuentos en memoria.
   const {rows}=await pool.query(buildRecentProductCountSQL(s.schema),[s.codes,from,to]);
   res.json({totalProducts:Number(rows[0]?.totalProducts||0),
     totalArticles:Number(rows[0]?.totalArticles||0),from,to});
  }catch(e){next(e)}
 });
 app.get("/api/analytics/ventas/familias",...requireTenant(),async(req,res,next)=>{
  try{
   const s=scope(req,res);if(!s)return;
   // El identificador familia es local a UNA farmacia: no agrupar códigos
   // homónimos que podrían significar cosas distintas en cada ERP.
   if(s.ids.length!==1)return res.json({families:[],scope:"pharmacy-only"});
   const {rows}=await pool.query(buildPharmacyFamiliesSQL(s.schema),[s.codes[0]]);
   res.json({families:rows.map(row=>({code:row.codigo,
     label:"Familia "+row.codigo,pharmacyId:String(s.ids[0])})),scope:"pharmacy-only"});
  }catch(e){next(e)}
 });
}
