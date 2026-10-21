// Estado de importación por farmacia, basado en evidencias de PostgreSQL.
// No determina conectividad VPN: ausencia de datos no equivale a fallo de conexión.
import {decoratePharmacy} from "./pharmacyCodes.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const STALE_MS=48*60*60*1000;
const normalized=v=>String(v??"").trim().toUpperCase();
const iso=value=>value?new Date(value).toISOString():null;
const isFailed=(state,error)=>Boolean(String(error||"").trim())||
 /^(error|failed|fallido|fallida|fallo|rechazado|rechazada)$/i.test(String(state||"").trim());
const success=state=>/^(ok|success|completed|complete|completado|completada|finalizada|finalizado|exito|éxito)$/i.test(String(state||"").trim());

export function pharmacySyncSummary(pharmacy,runs,received,now=new Date()){
 const lastSales=received.ventas?.lastReceivedAt||null;
 const lastPurchases=received.compras?.lastReceivedAt||null;
 const receivedAt=[lastSales,lastPurchases].filter(Boolean).sort().at(-1)||null;
 const lastRun=[...runs].sort((a,b)=>new Date(b.startedAt)-new Date(a.startedAt))[0]||null;
 const problems=runs.filter(r=>isFailed(r.state,r.error));
 const recent=receivedAt&&now.getTime()-new Date(receivedAt).getTime()<STALE_MS;
 let state=!pharmacy.active?"Inactiva":problems.length?"Revisar":
  lastRun&&!lastRun.finishedAt&&now.getTime()-new Date(lastRun.startedAt).getTime()<4*3600000?"Sincronizando":
  recent?"Actividad reciente":receivedAt||lastRun?"Sin actividad reciente":"Sin información";
 return {id:String(pharmacy.id),name:pharmacy.name,
  code:pharmacy.displayCode||pharmacy.sourceCode||pharmacy.databaseCode,
  active:Boolean(pharmacy.active),state,lastReceivedAt:receivedAt,
  sales:received.ventas||null,purchases:received.compras||null,
  lastRunAt:lastRun?.startedAt||null,
  flows:runs.map(r=>({flow:r.flow,state:r.state,startedAt:r.startedAt,
   finishedAt:r.finishedAt,read:r.read,inserted:r.inserted,rejected:r.rejected,
   error:r.error})),incidents:problems.map(r=>({flow:r.flow,
   state:r.state,error:r.error||"La última ejecución del flujo no finalizó correctamente"}))};
}
export function setupPharmacyState(app,pool,{requireTenant}){
 app.get("/api/tenant/estado",...requireTenant(),async(req,res,next)=>{
  if(!["gestor","administrador","superadministrador"].includes(req.context.role))
   return res.status(403).json({error:"Esta información requiere permisos de gestión"});
  const schema=req.context.client.schema;
  if(!SCHEMA.test(schema))return res.status(400).json({error:"Esquema no válido"});
  const pharmacies=(req.context.pharmacies||[]).map(p=>decoratePharmacy(req.context.client.slug,p));
  if(!pharmacies.length)return res.json({checkedAt:new Date().toISOString(),pharmacies:[],
   sources:[],note:"No hay farmacias asignadas."});
  const codes=[...new Set(pharmacies.map(p=>normalized(p.databaseCode||p.sourceCode)).filter(Boolean))];
  const q='"'+schema+'"';
  const runQuery=(text,values)=>pool.query({text,values,query_timeout:15000}).then(x=>x.rows);
  try{
   const {rows:tables}=await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema=$1"+
    " AND table_name IN ('fm_sync_ejecuciones','fm_ventas_cabeceras','fm_recepciones_cabeceras','fm_ventas_analitica','fm_recepciones_analitica')",[schema]);
   const available=new Set(tables.map(r=>r.table_name));
   const sources=[];
   const tasks=[];
   if(available.has("fm_sync_ejecuciones")){
    sources.push("ejecuciones");
    tasks.push(["runs",runQuery("SELECT DISTINCT ON (upper(btrim(farmacia_codigo)),flujo)"+
     " farmacia_codigo AS code,flujo AS flow,estado AS state,iniciada_en AS \"startedAt\","+
     " finalizada_en AS \"finishedAt\",leidas AS read,insertadas AS inserted,"+
     " rechazadas AS rejected,error_resumen AS error"+
     " FROM "+q+".fm_sync_ejecuciones"+
     " WHERE upper(btrim(farmacia_codigo))=ANY($1::text[])"+
     " ORDER BY upper(btrim(farmacia_codigo)),flujo,iniciada_en DESC",[codes])]);
   }
   for(const [kind,header,view] of [
    ["ventas","fm_ventas_cabeceras","fm_ventas_analitica"],
    ["compras","fm_recepciones_cabeceras","fm_recepciones_analitica"]
   ]){
    const table=available.has(header)?header:available.has(view)?view:null;
    if(!table)continue;
    sources.push(kind);
    const timestamp=table===header?"recibido_en":"sincronizado_en";
    const date="fecha";
    tasks.push([kind,runQuery("SELECT farmacia_codigo AS code,"+
     " max("+timestamp+") AS \"lastReceivedAt\",max("+date+") AS \"lastDocumentAt\""+
     " FROM "+q+".\""+table+"\" WHERE upper(btrim(farmacia_codigo))=ANY($1::text[])"+
     " GROUP BY farmacia_codigo",[codes])]);
   }
   const results=await Promise.allSettled(tasks.map(t=>t[1]));
   const maps={runs:new Map(),ventas:new Map(),compras:new Map()},warnings=[];
   results.forEach((result,index)=>{
    const name=tasks[index][0];
    if(result.status!=="fulfilled"){warnings.push("No se pudieron consultar los datos de "+name+".");return;}
    for(const r of result.value){
     const code=normalized(r.code);
     if(name==="runs"){
      const current=maps.runs.get(code)||[];
      current.push({flow:r.flow,state:r.state,startedAt:iso(r.startedAt),
       finishedAt:iso(r.finishedAt),read:Number(r.read||0),
       inserted:Number(r.inserted||0),rejected:Number(r.rejected||0),
       error:r.error?String(r.error).slice(0,250):null});
      maps.runs.set(code,current);
     }else{
      maps[name].set(code,{lastReceivedAt:iso(r.lastReceivedAt),
       lastDocumentAt:iso(r.lastDocumentAt)});
     }
    }
   });
   const checkedAt=new Date();
   res.json({checkedAt:checkedAt.toISOString(),sources,warnings,
    pharmacies:pharmacies.map(p=>{
     const code=normalized(p.databaseCode||p.sourceCode);
     return pharmacySyncSummary(p,maps.runs.get(code)||[],{
      ventas:maps.ventas.get(code),compras:maps.compras.get(code)
     },checkedAt);
    }),
    note:"Las fechas muestran la última recepción conocida. Un período sin nuevas ventas o compras no demuestra por sí solo un problema de VPN o del sincronizador. La frecuencia programada puede variar por farmacia."});
  }catch(e){next(e)}
 });
}
