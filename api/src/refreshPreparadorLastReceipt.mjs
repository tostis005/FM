// Precarga sin atender peticiones HTTP. Solo imprime recuentos y duración.
import pg from "pg";
import {refreshLastReceiptSnapshot} from "./preparadorLastReceipt.js";
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,
 connectionTimeoutMillis:10000,query_timeout:370000,statement_timeout:370000});
try{
 const slug=process.env.FM_PREPARADOR_TENANT||"ampedia";
 const {rows}=await pool.query(
  "SELECT esquema_datos FROM farmetrica.clientes WHERE slug=$1",[slug]);
 const schema=rows[0]?.esquema_datos;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema||""))throw Error("Cliente sin esquema autorizado");
 const result=await refreshLastReceiptSnapshot(pool,{client:{slug,schema}});
 if(result.skipped)console.log("PREPARADOR_SNAPSHOT_BACKFILL skipped: lock held by another worker");
 else console.log("PREPARADOR_SNAPSHOT_BACKFILL",JSON.stringify(result));
}catch(error){
 console.error("PREPARADOR_SNAPSHOT_BACKFILL_ERROR",error.code||error.name);
 process.exitCode=1;
}finally{await pool.end()}
