// Diagnóstico real, READ ONLY. Imprime únicamente tiempos y cantidades de filas,
// jamás códigos nacionales, nombres, precios ni importes.
import pg from "pg";
import {setupRealReports} from "./realReports.js";
import {setupPurchaseTotals} from "./purchaseTotals.js";
if(process.env.FM_BENCHMARK_READONLY!=="1")throw Error("Se requiere modo read-only explícito");
const pool=new pg.Pool({
 connectionString:process.env.DATABASE_URL,max:6,connectionTimeoutMillis:5000,
 options:"-c statement_timeout=30000 -c lock_timeout=4000"
});
const routes=new Map();
setupRealReports({get:(path,...handlers)=>routes.set(path,handlers.at(-1))},pool,
 {requireTenant:()=>[]});
setupPurchaseTotals({get:(path,...handlers)=>routes.set(path,handlers.at(-1))},pool,{requireTenant:()=>[]});
try{
 // Diagnóstico específico del problema "Compras vacío": sin importes, CN ni
 // datos de clientes en logs. Cada farmacia se comprueba con índice y LIMIT 1.
 const today=new Date().toISOString().slice(0,10);
 const sixMonths=new Date();sixMonths.setUTCMonth(sixMonths.getUTCMonth()-6);
 const from=sixMonths.toISOString().slice(0,10);
 const context={allowedPharmacyIds:[1,2,3,4,5],
   client:{slug:"ampedia",schema:"ampedia"},role:"superadministrador",
   modules:{},pharmacies:[{id:"1",name:"Farmacia 1",sourceCode:"ABA"},
     {id:"2",name:"Farmacia 2",sourceCode:"EUR"},
     {id:"3",name:"Farmacia 3",sourceCode:"BUE"},
     {id:"4",name:"Farmacia 4",sourceCode:"EST"},
     {id:"5",name:"Farmacia 5",sourceCode:"POL",databaseCode:"VAL"}]};
 for(const pharmacy of context.pharmacies){
  const req={query:{desde:from,hasta:today,farmacias:pharmacy.id},
    context};
  let response,error;
  const res={status(){return res},json(value){response=value;return res}};
  const start=performance.now();
  await routes.get("/api/analytics/compras/estado")(req,res,e=>{error=e});
  console.log("Compras farmacia "+pharmacy.id+": "+
   (error?"ERROR "+(error.code||error.name):response?.source||"no disponible")+
   ", movimientos en 6 meses="+Boolean(response?.hasPurchases)+
   ", respuesta="+Math.round(performance.now()-start)+"ms");
 }
 // Verificar calidad del mapeo de compras, sin exponer ni un importe, CN,
 // nombre, proveedor ni movimiento individual en los logs.
 const {rows:buyHealth}=await pool.query(`
  SELECT upper(btrim(farmacia_codigo)) AS code,count(*)::int AS total,
   count(*) FILTER(WHERE articulo_id IS NULL OR btrim(articulo_id)='')::int AS sin_articulo,
   count(*) FILTER(WHERE proveedor_id IS NULL OR btrim(proveedor_id)='')::int AS sin_proveedor,
   count(*) FILTER(WHERE coste_unitario IS NULL OR coste_unitario<=0)::int AS sin_coste,
   count(*) FILTER(WHERE unidades IS NULL OR unidades=0)::int AS sin_unidades,
   count(*) FILTER(WHERE importe IS NULL)::int AS sin_importe,
   count(DISTINCT articulo_id)::int AS articulos_distintos,
   count(DISTINCT proveedor_id)::int AS proveedores_distintos
  FROM ampedia.compras
  WHERE fecha >= $1::date AND fecha < $2::date+interval '1 day'
  GROUP BY 1 ORDER BY 1`,[from,today]);
 for(const r of buyHealth)console.log("CALIDAD_COMPRAS "+r.code+
  ": movimientos="+r.total+", sin_articulo="+r.sin_articulo+
  ", sin_coste="+r.sin_coste+", sin_proveedor="+r.sin_proveedor+
  ", sin_unidades="+r.sin_unidades+", sin_importe="+r.sin_importe+
  ", articulos_distintos="+r.articulos_distintos+
  ", proveedores_distintos="+r.proveedores_distintos);
 const {rows:[match]}=await pool.query(`
  SELECT count(*)::int AS referencias,
    count(a.origen_id)::int AS vinculadas
  FROM (
   SELECT DISTINCT articulo_id FROM ampedia.compras
   WHERE upper(btrim(farmacia_codigo))='VAL'
    AND fecha >= $1::date AND fecha < $2::date+interval '1 day'
  ) b LEFT JOIN LATERAL (
   SELECT origen_id FROM ampedia.articulos a
   WHERE upper(btrim(a.farmacia_codigo))='VAL'
     AND a.origen_id=b.articulo_id
   LIMIT 1
  ) a ON true`,[from,today]);
 console.log("VINCULACION_COMPRAS_VAL: referencias="+match.referencias+
   ", encontradas_en_catalogo="+match.vinculadas);
 // Descubrir posibles tablas de detalle del ERP sin leer datos sensibles.
 const {rows:tableColumns}=await pool.query(`SELECT table_name,
   string_agg(column_name,',' ORDER BY ordinal_position) AS columns
   FROM information_schema.columns
   WHERE table_schema='ampedia' AND
     (table_name ILIKE '%compra%' OR table_name ILIKE '%recep%'
      OR table_name ILIKE '%pedido%' OR table_name ILIKE '%entrada%')
   GROUP BY table_name ORDER BY table_name`);
 for(const row of tableColumns)console.log("TABLA_ORIGEN_COMPRAS "+row.table_name+
   ": columnas="+row.columns);
 const cols=await pool.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='ampedia' AND table_name='articulos'
    AND (column_name ILIKE '%stock%' OR column_name ILIKE '%exist%'
      OR column_name ILIKE '%pvp%' OR column_name ILIKE '%cost%')
  ORDER BY column_name`);
 console.log("Artículos: columnas de inventario y precios = "+
  cols.rows.map(x=>x.column_name).join(", "));
 const snapshots=await pool.query(`
  SELECT to_regclass('public.stock_farmacia')::text AS rel`);
 console.log("Tabla de existencias sincronizada: "+Boolean(snapshots.rows[0]?.rel));
 const articleStatus=await pool.query(`SELECT upper(btrim(farmacia_codigo)) AS codigo,
   count(*)::int AS articulos,
   count(stock_actual)::int AS con_stock,
   max(sincronizado_en) AS ultima
  FROM ampedia.articulos
  GROUP BY 1 ORDER BY 1`);
 for(const row of articleStatus.rows)console.log("Catálogo ERP "+row.codigo+
    ": fichas="+row.articulos+", stock informado="+row.con_stock+
    ", última sincronización "+(row.ultima?String(row.ultima).slice(0,24):"ninguna"));

 if(snapshots.rows[0]?.rel){
  const rows=await pool.query(`SELECT id_farmacia,
     count(*)::int AS entries,max(importado_en) AS ultima
     FROM public.stock_farmacia WHERE id_farmacia=ANY($1::int[])
     GROUP BY id_farmacia ORDER BY id_farmacia`,[[1,2,3,4,5]]);
  for(const row of rows.rows)console.log("Farmacia "+row.id_farmacia+
    ": "+row.entries+" filas de inventario, última carga "+
    (row.ultima?new Date(row.ultima).toISOString().slice(0,10):"sin datos"));
 }
 for(const [name,ids,modules] of [
  ["Valdemarías",[5],["compras","proveedores"]],
  ["Cinco farmacias",[1,2,3,4,5],["compras"]]
 ])for(const modulo of modules){
  const req={query:{desde:"2026-07-18",hasta:"2026-10-18",modulo,
    farmacias:ids.join(",")},context:{
     allowedPharmacyIds:[1,2,3,4,5],
     client:{slug:"ampedia",schema:"ampedia"},
     role:"superadministrador",modules:{},
     pharmacies:[{id:"1",sourceCode:"ABA"},{id:"2",sourceCode:"EUR"},
       {id:"3",sourceCode:"BUE"},{id:"4",sourceCode:"EST"},
       {id:"5",sourceCode:"POL",databaseCode:"VAL"}] }};
  let response,error,status=200;
  const res={status(v){status=v;return res},json(v){response=v;return res}};
  const now=process.hrtime.bigint();
  await routes.get("/api/analytics/reportes")(req,res,e=>{error=e});
  if(error)throw error;
  if(status!==200)throw Error("HTTP "+status);
  if(modulo==="compras"){
   const isPresent=key=>response.kpis?.[key]!=null;
   const rows=response.buyRows||[];
   const missing=field=>rows.filter(r=>r[field]==null||r[field]==="").length;
   console.log("CONTROL_COMPRAS "+name+
    ": indicadores_compras="+isPresent("compras")+
    ", unidades="+isPresent("unidadesCompradas")+
    ", proveedores="+isPresent("proveedores")+
    ", lineas="+isPresent("lineasCompra")+
    ", filas="+rows.length+", sin_pvp="+missing("pvp")+
    ", sin_nombre="+missing("name")+", sin_puc="+missing("puc"));
   const start=performance.now();
   const reqTotals={...req,query:{desde:req.query.desde,hasta:req.query.hasta,farmacias:req.query.farmacias}};
   let totals,problem;
   const rr={status(){return rr},json(v){totals=v;return rr}};
   await routes.get("/api/analytics/compras/resumen")(reqTotals,rr,e=>{problem=e});
   if(problem)throw problem;
   console.log("CONTROL_COMPRAS_RESUMEN "+name+": "+
    Math.round(performance.now()-start)+"ms, total="+(totals?.kpis?.compras!=null)+
    ", unidades="+(totals?.kpis?.unidadesCompradas!=null)+
    ", proveedores="+(totals?.kpis?.proveedores!=null)+
    ", lineas="+(totals?.kpis?.lineasCompra!=null));
  }
  console.log("Informe "+name+" / "+modulo+": "+(Number(process.hrtime.bigint()-now)/1e6).toFixed(0)+
    " ms. Ventas productos="+response.salesRows?.length+
    ", Compras productos="+response.buyRows?.length+
    ", Proveedores="+response.supplierRows?.length+
    ", Stock="+response.stockRows?.length+
    ", Rentabilidad="+response.profitRows?.length+
    ", Acciones="+response.actions?.length+
    ", Meses="+response.monthly?.length+
    ", Inventario actualizado="+Boolean(response.availability?.stock)+
    ", Artículos stock="+(response.kpis?.stockArticulos??"n/d")+
    ", Unidades stock="+(response.kpis?.stockUnidades??"n/d")+
    ", Origen stock="+(response.availability?.stockSource||"no disponible"));
 }
}catch(e){console.log("Diagnóstico interrumpido, código "+(e.code||e.name)+"; "+String(e.stack||"").slice(0,1100));process.exitCode=1;
}finally{await pool.end()}
