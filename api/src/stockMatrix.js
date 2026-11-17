// Consulta transversal de existencias: una fila por producto y columnas por farmacia.
// No confundir ausencia de ficha de una farmacia con stock cero.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const SORT=new Set(["name","cn","stock"]);
export function stockMatrixFilters(req){
 const ctx=req.context||{},schema=ctx.client?.schema,slug=ctx.client?.slug;
 if(!SCHEMA.test(schema||"")||!SCHEMA.test(slug||""))
  throw Object.assign(Error("Cliente incorrecto"),{status:400});
 const raw=String(req.query?.farmacias||"");
 if(raw.length>2000||(raw&&!/^\d+(,\d+)*$/.test(raw)))
  throw Object.assign(Error("Farmacias incorrectas"),{status:400});
 const allowed=new Set((ctx.allowedPharmacyIds||[]).map(Number));
 const ids=raw?raw.split(",").map(Number):[...allowed];
 if(ids.some(id=>!Number.isSafeInteger(id)||!allowed.has(id)))
  throw Object.assign(Error("Farmacia no autorizada"),{status:403});
 const buscar=String(req.query?.buscar||"").trim();
 const familia=String(req.query?.familia||"").trim();
 if(buscar.length>100||familia.length>80)
  throw Object.assign(Error("Filtro demasiado largo"),{status:400});
 const pagina=Number(req.query?.pagina||1),tamano=Number(req.query?.tamano||50);
 const orden=String(req.query?.orden||"name");
 const direccion=String(req.query?.direccion||"asc");
 if(!Number.isSafeInteger(pagina)||pagina<1||pagina>10000||
   ![25,50,100].includes(tamano)||!SORT.has(orden)||
   !["asc","desc"].includes(direccion))
  throw Object.assign(Error("Orden o paginación incorrectos"),{status:400});
 const soloConStock=String(req.query?.soloConStock||"true")!=="false";
 return {schema,slug,ids:[...new Set(ids)],buscar,familia,
  pagina,tamano,orden,direccion,soloConStock};
}

export function buildStockMatrixSQL(schema,orden="name",direccion="asc"){
 if(!SCHEMA.test(schema)||!SORT.has(orden)||!["asc","desc"].includes(direccion))
  throw Error("Consulta de stock incorrecta");
 const table='"'+schema+'".articulos';
 const order={name:'p.name',cn:'p.cn',stock:'p."stockTotal"'}[orden];
 const direction=direccion.toUpperCase();
 return `
 WITH per_site AS MATERIALIZED (
  SELECT
    CASE WHEN nullif(btrim(a.codigo_nacional),'') IS NOT NULL
     THEN 'CN:'||btrim(a.codigo_nacional)
     ELSE 'ERP:'||f.id::text||':'||btrim(a.origen_id) END AS "productKey",
    f.id::text AS "pharmacyId",
    max(nullif(btrim(a.codigo_nacional),'')) AS cn,
    max(a.nombre) AS name,max(nullif(btrim(a.familia),'')) AS family,
    sum(a.stock_actual)::float8 AS stock,
    max(a.pvp)::float8 AS pvp,max(a.pmc)::float8 AS pmc,
    max(a.sincronizado_en) AS "updatedAt"
  FROM ${table} a
  JOIN farmetrica.farmacias f
   ON f.cliente_slug=$1
   AND upper(btrim(a.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
  WHERE f.id=ANY($2::int[])
   AND a.stock_actual IS NOT NULL
   AND nullif(btrim(a.origen_id),'') IS NOT NULL
   AND ($3::text='' OR a.codigo_nacional ILIKE '%'||$3||'%'
      OR a.nombre ILIKE '%'||$3||'%'
      OR a.origen_id ILIKE '%'||$3||'%')
   AND ($4::text='' OR a.familia ILIKE '%'||$4||'%')
  GROUP BY 1,2
 ),
 products AS MATERIALIZED (
  SELECT s."productKey",max(s.cn) AS cn,
    coalesce(max(nullif(btrim(s.name),'')),max(s.cn),s."productKey") AS name,
    max(s.family) AS family,
    sum(s.stock)::float8 AS "stockTotal",
    count(*) FILTER(WHERE s.stock>0)::int AS "pharmaciesWithStock",
    count(*)::int AS "pharmaciesWithCatalog",
    max(s."updatedAt") AS "lastUpdatedAt"
  FROM per_site s GROUP BY s."productKey"
  HAVING NOT $5::boolean OR bool_or(s.stock>0)
 ),
 page_rows AS (
  SELECT p.*,count(*) OVER()::int AS "totalCount"
  FROM products p
  ORDER BY ${order} ${direction} NULLS LAST,p."productKey"
  LIMIT $6::int OFFSET $7::int
 )
 SELECT p.*,
   (SELECT coalesce(jsonb_object_agg(s."pharmacyId",
      jsonb_build_object('stock',s.stock,'pvp',s.pvp,'pmc',s.pmc,
        'updatedAt',s."updatedAt")),'{}'::jsonb)
    FROM per_site s WHERE s."productKey"=p."productKey") AS stocks
 FROM page_rows p
 ORDER BY ${order} ${direction} NULLS LAST,p."productKey"
 `;
}
export function setupStockMatrix(app,pool,{requireTenantModule}){
 app.get("/api/analytics/stock/matriz",...requireTenantModule("stock"),
  async(req,res)=>{
   try{
    const f=stockMatrixFilters(req);
    const pharmacies=(req.context?.pharmacies||[])
      .filter(p=>f.ids.includes(Number(p.id)))
      .map(p=>({id:String(p.id),name:p.name||p.nombre||String(p.id)}));
    if(!f.ids.length)return res.json({available:true,rows:[],total:0,
     pharmacies,pagina:f.pagina,tamano:f.tamano});
    const {rows:presence}=await pool.query(
     "SELECT to_regclass($1)::text AS table_name",[f.schema+".articulos"]);
    if(!presence[0]?.table_name)return res.json({
     available:false,message:"El catálogo de artículos todavía no está sincronizado.",
     pharmacies,rows:[],total:0});
    const required=["farmacia_codigo","origen_id","codigo_nacional","nombre",
     "familia","stock_actual","pvp","pmc","sincronizado_en"];
    const {rows:columns}=await pool.query(
     "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='articulos'",
     [f.schema]);
    const existing=new Set(columns.map(r=>r.column_name));
    if(required.some(c=>!existing.has(c)))return res.json({
     available:false,message:"Faltan campos de inventario en la sincronización.",
     pharmacies,rows:[],total:0});
    const {rows}=await pool.query({
     text:buildStockMatrixSQL(f.schema,f.orden,f.direccion),
     values:[f.slug,f.ids,f.buscar,f.familia,f.soloConStock,f.tamano,
      (f.pagina-1)*f.tamano],query_timeout:24000});
    return res.json({available:true,rows,
     total:Number(rows[0]?.totalCount||0),pharmacies,
     pagina:f.pagina,tamano:f.tamano,source:"articulos"});
   }catch(e){
    if(e.status)return res.status(e.status).json({error:e.message});
    console.error("STOCK_MATRIZ",e.code||e.name);
    if(["57014","55P03"].includes(e.code)||e.message==="Query read timeout")
     return res.status(503).json({error:"La consulta tarda demasiado. Acota la búsqueda o selecciona menos farmacias."});
    if(["42P01","42703"].includes(e.code))
     return res.status(503).json({error:"Faltan datos de la sincronización para consultar el stock."});
    return res.status(500).json({error:"No se ha podido consultar el stock. Reinténtalo."});
   }
 });
}
