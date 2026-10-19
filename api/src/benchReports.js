// Diagnóstico real, READ ONLY. Imprime únicamente tiempos y cantidades de filas,
// jamás códigos nacionales, nombres, precios ni importes.
import pg from "pg";
import {setupRealReports} from "./realReports.js";
if(process.env.FM_BENCHMARK_READONLY!=="1")throw Error("Se requiere modo read-only explícito");
const pool=new pg.Pool({
 connectionString:process.env.DATABASE_URL,max:6,connectionTimeoutMillis:5000,
 options:"-c statement_timeout=30000 -c lock_timeout=4000"
});
const routes=new Map();
setupRealReports({get:(path,...handlers)=>routes.set(path,handlers.at(-1))},pool,
 {requireTenant:()=>[]});
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
  ["Valdemarías",[5],["dashboard","compras","proveedores","stock","reposicion","rentabilidad"]],
  ["Cinco farmacias",[1,2,3,4,5],["dashboard","stock"]]
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
