// Detección de riesgos y capital en stock, solo lectura y exclusiva del superadministrador.
// Las reglas se calculan al consultar: no modifican el ERP ni crean ahorros ficticios.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const MODES=new Set(["alertas","inmovilizado"]);
const DAY_OPTIONS=new Set([90,180]);
const todaySQL="(now() AT TIME ZONE 'Europe/Madrid')::date";

function invalid(message,status=400){
 return Object.assign(new Error(message),{status});
}
export function proactiveFilters(req,mode){
 if(!MODES.has(mode))throw invalid("Análisis desconocido");
 const ctx=req.context||{};
 const schema=ctx.client?.schema;
 if(!SCHEMA.test(schema||""))throw invalid("Esquema no válido");
 const allowed=(ctx.allowedPharmacyIds||[]).map(Number).filter(Number.isSafeInteger);
 const raw=String(req.query?.farmacias||"");
 if(raw.length>500||(raw&&!/^\d+(,\d+)*$/.test(raw)))throw invalid("Farmacias no válidas");
 const ids=raw?raw.split(",").map(Number):allowed;
 if(ids.some(id=>!allowed.includes(id)))throw invalid("Farmacia no autorizada",403);
 const days=Number(req.query?.dias||90);
 if(!DAY_OPTIONS.has(days))throw invalid("Selecciona 90 o 180 días");
 const search=String(req.query?.buscar||"").trim();
 if(search.length>90)throw invalid("Búsqueda demasiado larga");
 const page=Number(req.query?.pagina||1),size=Number(req.query?.tamano||50);
 if(!Number.isSafeInteger(page)||page<1||page>2000||![25,50,100].includes(size))
  throw invalid("Paginación incorrecta");
 return {schema,slug:ctx.client.slug,ids:[...new Set(ids)],days,search,page,size,mode};
}
export function buildProactiveStockSQL(schema,mode){
 if(!SCHEMA.test(schema||"")||!MODES.has(mode))throw Error("Consulta no válida");
 const q='"'+schema+'"';
 const selection=mode==="inmovilizado"?'WHERE "unitsPeriod"<=0':'WHERE "alertType" IS NOT NULL';
 const order=mode==="inmovilizado"?
  'ORDER BY "capital" DESC NULLS LAST,stock DESC,"pharmacyId","articleId"':
  'ORDER BY CASE "alertType" WHEN \'rotura\' THEN 0 WHEN \'sin_ventas\' THEN 1 ELSE 2 END,'+
  ' "capital" DESC NULLS LAST,stock DESC,"pharmacyId","articleId"';
 return [
  "WITH sites AS MATERIALIZED (",
  " SELECT f.id,f.nombre,"+pharmacyDataCodeSQL("f")+" AS code",
  " FROM farmetrica.farmacias f",
  " WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[]) AND f.activo=true",
  "), stock AS MATERIALIZED (",
  ' SELECT f.id::text AS "pharmacyId",f.nombre AS "pharmacyName",',
  '  a.origen_id::text AS "articleId",nullif(btrim(a.codigo_nacional),\'\') AS cn,',
  '  a.nombre AS name,a.stock_actual::float8 AS stock,',
  '  (CASE WHEN a.pmc>0 THEN a.pmc WHEN a.puc>0 THEN a.puc END)::float8 AS "unitCost",',
  '  a.sincronizado_en AS "stockAt",a.farmacia_codigo AS "sourceCode"',
  " FROM "+q+".articulos a JOIN sites f ON upper(btrim(a.farmacia_codigo))=f.code",
  " WHERE a.stock_actual>0 AND a.sincronizado_en>=now()-interval '7 days'",
  " AND ($4::text='' OR a.nombre ILIKE '%'||$4||'%'",
  "    OR a.codigo_nacional ILIKE '%'||$4||'%' OR a.origen_id ILIKE '%'||$4||'%')",
  "), sales AS MATERIALIZED (",
  " SELECT upper(btrim(v.farmacia_codigo)) AS code,v.articulo_id::text AS article,",
  "  coalesce(sum(v.unidades),0)::float8 AS period_units,",
  "  coalesce(sum(v.unidades) FILTER (WHERE v.fecha>="+todaySQL+"-interval '29 days'),0)::float8 AS units30",
  " FROM "+q+".fm_ventas_analitica v",
  " JOIN sites f ON upper(btrim(v.farmacia_codigo))=f.code",
  " WHERE v.fecha>="+todaySQL+"-($3::int-1)*interval '1 day'",
  " AND v.fecha<"+todaySQL+"+interval '1 day'",
  " AND nullif(btrim(v.articulo_id),'') IS NOT NULL",
  " GROUP BY upper(btrim(v.farmacia_codigo)),v.articulo_id",
  "), metrics AS (",
  ' SELECT st.*,greatest(coalesce(sa.period_units,0),0)::float8 AS "unitsPeriod",',
  ' greatest(coalesce(sa.units30,0),0)::float8 AS "units30",',
  ' CASE WHEN sa.period_units>0 THEN round((st.stock*$3/sa.period_units)::numeric,1)::float8 END AS "coverDays",',
  ' CASE WHEN st."unitCost" IS NOT NULL',
  '   THEN round((st.stock*st."unitCost")::numeric,2)::float8 END AS capital',
  ' FROM stock st LEFT JOIN sales sa ON sa.code=upper(btrim(st."sourceCode"))',
  '   AND sa.article=st."articleId"',
  "), signals AS (",
  ' SELECT m.*,CASE',
  ' WHEN "units30">0 AND stock*30/"units30"<=7 THEN \'rotura\'',
  ' WHEN "unitsPeriod"<=0 THEN \'sin_ventas\'',
  ' WHEN "unitsPeriod">0 AND stock*$3/"unitsPeriod">=120 THEN \'exceso\'',
  ' ELSE NULL END AS "alertType"',
  " FROM metrics m",
  "), selected AS (",
  ' SELECT *,count(*) OVER()::int AS "totalCount",',
  ' count(capital) OVER()::int AS "valuedCount",',
  ' sum(capital) OVER()::float8 AS "valuedSubtotal",',
  ' sum(stock) OVER()::float8 AS "stockUnits",',
  ' count(*) FILTER(WHERE "alertType"=\'rotura\') OVER()::int AS "riskCount"',
  " FROM signals "+selection,
  ") SELECT * FROM selected "+order+" LIMIT $5::int OFFSET $6::int"
 ].join("\n");
}
export function proactiveCoverageSQL(schema){
 if(!SCHEMA.test(schema||""))throw Error("Esquema inválido");
 const q='"'+schema+'"';
 return [
  "WITH sites AS (SELECT f.id,f.nombre,"+pharmacyDataCodeSQL("f")+" AS code",
  " FROM farmetrica.farmacias f WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[]) AND f.activo=true)",
  ' SELECT s.id,s.nombre,',
  " EXISTS (SELECT 1 FROM "+q+".articulos a WHERE upper(btrim(a.farmacia_codigo))=s.code",
  " AND a.sincronizado_en>=now()-interval '7 days' LIMIT 1) AS stock_ok,",
  " EXISTS (SELECT 1 FROM "+q+".fm_ventas_cabeceras h WHERE upper(btrim(h.farmacia_codigo))=s.code",
  " AND h.fecha>="+todaySQL+"-interval '13 days'",
  " AND h.lineas_completas AND NOT h.eliminado_logicamente",
  " AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')",
  " LIMIT 1) AS sales_ok",
  " FROM sites s ORDER BY s.id"
 ].join("\n");
}
export function setupProactiveStock(app,pool,{requireTenant}){
 const guard=[...requireTenant(),(req,res,next)=>{
  if(req.user?.role!=="superadministrador"||req.context?.role!=="superadministrador")
   return res.status(403).json({error:"Solo el superadministrador puede acceder a este análisis"});
  next();
 }];
 for(const mode of MODES){
  app.get("/api/analytics/gestion-proactiva/"+mode,...guard,async(req,res)=>{
   try{
    const f=proactiveFilters(req,mode);
    if(!f.ids.length)return res.json({available:true,rows:[],total:0,days:f.days,
     summary:{valuedSubtotal:0,valuedCount:0,stockUnits:0,riskCount:0},excluded:[]});
    const names=[f.schema+".articulos",f.schema+".fm_ventas_analitica",
     f.schema+".fm_ventas_cabeceras"];
    const tables=await pool.query("SELECT "+names.map((_,i)=>
     "to_regclass($"+(i+1)+") IS NOT NULL AS t"+i).join(","),names);
    if(!Object.values(tables.rows[0]||{}).every(Boolean))
     return res.json({available:false,rows:[],message:
      "Faltan el catálogo actualizado o los documentos de ventas necesarios para este análisis."});
    const check=await pool.query({text:proactiveCoverageSQL(f.schema),
     values:[f.slug,f.ids],query_timeout:18000});
    const valid=check.rows.filter(row=>row.stock_ok&&row.sales_ok).map(row=>Number(row.id));
    const excluded=check.rows.filter(row=>!row.stock_ok||!row.sales_ok).map(row=>({
     pharmacyId:String(row.id),name:row.nombre,
     reason:!row.stock_ok?"Stock sin actualizar en los últimos 7 días":
      "No se han verificado ventas documentales en los últimos 14 días"
    }));
    if(!valid.length)return res.json({available:false,rows:[],excluded,message:
     "No hay farmacias con stock reciente y ventas documentales verificadas. Revisa las sincronizaciones."});
    const found=await pool.query({text:buildProactiveStockSQL(f.schema,mode),
     values:[f.slug,valid,f.days,f.search,f.size,(f.page-1)*f.size],query_timeout:25000});
    const first=found.rows[0];
    res.json({available:true,mode,days:f.days,page:f.page,pageSize:f.size,
     total:Number(first?.totalCount||0),excluded,
     summary:{valuedSubtotal:first?.valuedSubtotal==null?null:Number(first.valuedSubtotal),
      valuedCount:Number(first?.valuedCount||0),stockUnits:Number(first?.stockUnits||0),
      riskCount:Number(first?.riskCount||0)},
     rows:found.rows.map(({totalCount,valuedSubtotal,valuedCount,stockUnits,riskCount,...row})=>row),
     message:excluded.length?"Se han omitido farmacias con datos insuficientes o desactualizados.":null});
   }catch(e){
    if(e.status)return res.status(e.status).json({error:e.message});
    console.error("Error en gestión proactiva",mode,e.code||e.name);
    if(["57014","55P03"].includes(e.code)||e.message==="Query read timeout")
     return res.status(503).json({error:
      "El análisis está tardando demasiado. Selecciona una farmacia o acota la búsqueda."});
    if(["42P01","42703"].includes(e.code))
     return res.status(503).json({error:"Faltan campos o tablas de la sincronización documental."});
    res.status(500).json({error:"No se ha podido completar el análisis proactivo."});
   }
  });
 }
}
