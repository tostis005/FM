// Diagnóstico exclusivamente de lectura para el ejemplo facilitado por
// farmacia. No imprime existencias, ventas, pedidos ni documentos.
import pg from "pg";
import {readLaboratoryOrderMatrix} from "./laboratoryOrderPlanner.js";

const cn="722077";
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,
 connectionTimeoutMillis:5000,query_timeout:30000,statement_timeout:30000});
try{
 const {rows:tenant}=await pool.query(
  "SELECT esquema_datos FROM farmetrica.clientes WHERE slug='ampedia'");
 const schema=tenant[0]?.esquema_datos;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema||""))throw Error("Esquema incorrecto");
 const {rows:sites}=await pool.query(
  `SELECT id FROM farmetrica.farmacias
   WHERE cliente_slug='ampedia' AND activo=true
     AND coalesce(tipo_establecimiento,'farmacia')<>'almacen'
   ORDER BY id`);
 const ids=sites.map(s=>Number(s.id));
 const now=new Date(),to=now.toISOString().slice(0,10);
 const from=new Date(now.getTime()-30*86400000).toISOString().slice(0,10);
 const matrix=await readLaboratoryOrderMatrix(pool,
  {client:{slug:"ampedia",schema}},{
   key:"N:STOCK_DIAGNOSTIC",pharmacies:ids,type:"medicacion",from,to,
   prefetchedRows:[{referencia:cn,cn,nombre:"Referencia de diagnóstico"}]
  });
 const item=matrix.rows[0];
 const statuses=sites.map(site=>{
  const s=item.byPharmacy?.[String(site.id)]||{};
  return {farmacia_id:Number(site.id),
   stock:s.stock===null||s.stock===undefined?"desconocido":
    s.stockInferredZero===true?"cero_sin_ficha":"stock_disponible",
   propuesta:s.suggested==null?"desconocida":"calculada"};
 });
 console.log("PREPARADOR_CN_722077",JSON.stringify({
  cn,type:"medicacion",metricsUnavailable:matrix.metricsUnavailable===true,
  totalSuggestedUnavailable:item.totalSuggested==null,pharmacies:statuses
 }));
 if(matrix.metricsUnavailable)process.exitCode=1;
}finally{await pool.end();}
