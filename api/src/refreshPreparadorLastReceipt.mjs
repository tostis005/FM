// Precarga sin atender peticiones HTTP. Solo imprime recuentos y duración.
import pg from "pg";
import {setTimeout as sleep} from "node:timers/promises";
import {refreshLastReceiptSnapshot} from "./preparadorLastReceipt.js";
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,
 connectionTimeoutMillis:10000,query_timeout:370000,statement_timeout:370000});
try{
 const slug=process.env.FM_PREPARADOR_TENANT||"ampedia";
 const {rows}=await pool.query(
  "SELECT esquema_datos FROM farmetrica.clientes WHERE slug=$1",[slug]);
 const schema=rows[0]?.esquema_datos;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema||""))throw Error("Cliente sin esquema autorizado");
 // Las invalidaciones concurrentes pueden estar regenerando la misma caché.
 // Un bloqueo en un intento NO equivale a haberla reconstruido; reintentar sin
 // generar operaciones superpuestas. Límite: 7 esperas de 7 s, bajo el timeout
 // de 440 s del desplegador incluso si el último intento tarda hasta 360 s.
 let result;
 for(let attempt=1;attempt<=8;attempt++){
  result=await refreshLastReceiptSnapshot(pool,{client:{slug,schema}});
  if(!result.skipped)break;
  if(attempt===8)throw Error("Caché sin actualizar: otro proceso mantiene el bloqueo");
  console.log("PREPARADOR_SNAPSHOT_BACKFILL_RETRY",JSON.stringify({attempt,max:8}));
  await sleep(7000);
 }
 if(!result.updated)throw Error("No se confirmó la reconstrucción de la caché");
 console.log("PREPARADOR_SNAPSHOT_BACKFILL",JSON.stringify(result));
}catch(error){
 console.error("PREPARADOR_SNAPSHOT_BACKFILL_ERROR",error.code||error.name);
 process.exitCode=1;
}finally{await pool.end()}
