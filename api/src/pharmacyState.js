// Panel operacional de sincronizadores: datos visibles en PostgreSQL.
// Las recepciones comerciales NO prueban por sí solas que un servicio funcione.
import {decoratePharmacy} from "./pharmacyCodes.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const STALE_MS=48*60*60*1000;
const normalized=v=>String(v??"").trim().toUpperCase();
const iso=value=>value?new Date(value).toISOString():null;
const ms=value=>value?new Date(value).getTime():null;
const isFailed=(state,error,rejected=0)=>Number(rejected)>0||Boolean(String(error||"").trim())||
 /^(error|failed|fallido|fallida|fallo|rechazado|rechazada)$/i.test(String(state||"").trim());
const success=state=>/^(ok|success|completed|complete|completado|completada|finalizada|finalizado|exito|éxito)$/i.test(String(state||"").trim());
const finiteMs=value=>Number.isFinite(ms(value))?ms(value):null;

// Se evalúa cada trabajo (no la existencia de ventas):
// rojo por último error, pulso ausente > 2 intervalos o ejecución demasiado atrasada.
// verde solo con último éxito y pulso reciente; nunca se presume VPN conectada.
export function evaluateMonitor(m,now=new Date()){
 const interval=Math.max(1,Number(m.everyMinutes)||60)*60000;
 const active=Boolean(m.enabled);
 if(!active)return {...m,health:"paused",reason:"Trabajo desactivado"};
 const beat=finiteMs(m.heartbeatAt);
 const due=finiteMs(m.nextDueAt);
 const lastAttempt=finiteMs(m.lastAttemptAt);
 const lastFinish=finiteMs(m.lastFinishedAt);
 const registered=finiteMs(m.registeredAt);
 const running=/^(running|queued)$/i.test(m.currentState||"");
 const error=isFailed(m.lastState,m.error);
 const elapsed=beat===null?Infinity:now.getTime()-beat;
 const threshold=Math.max(20*60000,interval*2);
 if(error)return {...m,health:"error",reason:m.error||"La última ejecución terminó con error"};
 if(elapsed>threshold)return {...m,health:"error",
  reason:"Sin comunicación del servicio desde "+(m.heartbeatAt||"una fecha desconocida")};
 // Arrancó y sigue ejecutándose: no contar como fallo solo por no haber recibido filas.
 if(running){
  const age=now.getTime()-(lastAttempt??beat);
  return {...m,health:age>Math.max(threshold,3*3600000)?"error":"running",
   reason:age>Math.max(threshold,3*3600000)?"Ejecución excesivamente larga":"Sincronización en curso"};
 }
 // Al vencer el próximo horario se avisa, y después de un intervalo adicional es error.
 if(due!==null&&now.getTime()>due+interval)return {...m,health:"error",
  reason:"No se ha ejecutado en el horario previsto"};
 if(!lastAttempt){
  if(registered!==null&&now.getTime()-registered>threshold)
   return {...m,health:"error",reason:"Trabajo configurado sin ninguna ejecución"};
  return {...m,health:"warning",reason:"Pendiente de primera ejecución"};
 }
 if(due!==null&&now.getTime()>due)return {...m,health:"warning",
  reason:"Ejecución prevista pendiente"};
 if(elapsed>Math.max(5*60000,interval/4))return {...m,health:"warning",
  reason:"El servicio no ha comunicado su actividad recientemente"};
 if(success(m.lastState))return {...m,health:"ok",reason:"Última ejecución correcta"};
 if(lastFinish!==null)return {...m,health:"warning",reason:"Resultado sin confirmar"};
 return {...m,health:"warning",reason:"Pendiente de resultado"};
}

export function pharmacySyncSummary(pharmacy,runs,received,now=new Date(),monitors=[]){
 const lastSales=received.ventas?.lastReceivedAt||null;
 const lastPurchases=received.compras?.lastReceivedAt||null;
 const receivedAt=[lastSales,lastPurchases].filter(Boolean).sort().at(-1)||null;
 const lastRun=[...runs].sort((a,b)=>new Date(b.startedAt)-new Date(a.startedAt))[0]||null;
 const problems=runs.filter(r=>isFailed(r.state,r.error,r.rejected));
 const monitored=monitors.map(m=>evaluateMonitor(m,now));
 const enabled=monitored.filter(m=>m.enabled);
 const statuses=enabled.map(m=>m.health);
 const active=Boolean(pharmacy.active);
 const recent=receivedAt&&now.getTime()-new Date(receivedAt).getTime()<STALE_MS;
 let state=!active?"Inactiva":
  enabled.length?
   statuses.includes("error")?"Error":
   statuses.includes("warning")?"Revisar":
   statuses.includes("running")?"Sincronizando":"Correcto":
  monitored.length?"Inactiva":
  problems.length?"Revisar":lastRun&&!lastRun.finishedAt&&now.getTime()-new Date(lastRun.startedAt).getTime()<4*3600000?"Sincronizando":
  recent?"Actividad reciente":receivedAt||lastRun?"Sin actividad reciente":"Sin información";
 const incidents=monitored.length?enabled.filter(m=>m.health==="error"||m.health==="warning")
   .map(m=>({flow:m.flow,error:m.reason,state:m.health})):
  problems.map(r=>({flow:r.flow,state:r.state,
   error:r.error||(Number(r.rejected)>0?String(r.rejected)+" registros rechazados":"La última ejecución no finalizó correctamente")}));
 const heartbeatAt=monitored.map(m=>m.heartbeatAt).filter(Boolean).sort().at(-1)||null;
 return {
  id:String(pharmacy.id),name:pharmacy.name,
  code:pharmacy.displayCode||pharmacy.sourceCode||pharmacy.databaseCode,
  active,state,lastReceivedAt:receivedAt,
  sales:received.ventas||null,purchases:received.compras||null,
  lastRunAt:lastRun?.startedAt||null,heartbeatAt,
  monitored:monitored.length>0,monitors:monitored,
  flows:runs.map(r=>({flow:r.flow,state:r.state,startedAt:r.startedAt,
   finishedAt:r.finishedAt,read:r.read,inserted:r.inserted,rejected:r.rejected,
   error:r.error})),
  incidents
 };
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
    " AND table_name IN ('fm_sync_monitor','fm_sync_ejecuciones','fm_ventas_cabeceras','fm_recepciones_cabeceras','fm_ventas_analitica','fm_recepciones_analitica')",[schema]);
   const available=new Set(tables.map(r=>r.table_name));
   const sources=[],tasks=[];
   if(available.has("fm_sync_monitor")){
    sources.push("supervisión");
    tasks.push(["monitors",runQuery("SELECT farmacia_codigo AS code, trabajo_id AS \"jobId\","+
     " flujo AS flow,habilitado AS enabled,frecuencia_minutos AS \"everyMinutes\","+
     " hora_diaria_local AS \"dailyAtLocal\",zona_horaria AS \"timeZone\","+
     " proxima_ejecucion AS \"nextDueAt\",ultimo_intento AS \"lastAttemptAt\","+
     " ultimo_fin AS \"lastFinishedAt\",ultimo_exito AS \"lastSuccessAt\","+
     " ultimo_estado AS \"lastState\",ultimo_error AS error,estado_actual AS \"currentState\","+
     " servicio_visto_en AS \"heartbeatAt\",registrado_en AS \"registeredAt\","+
     " filas_leidas AS \"read\",filas_insertadas AS \"inserted\""+
     " FROM "+q+".fm_sync_monitor WHERE upper(btrim(farmacia_codigo))=ANY($1::text[])"+
     " AND lower(btrim(flujo)) NOT IN ('ventas','compras') ORDER BY flujo",[codes])]);
   }
   if(available.has("fm_sync_ejecuciones")){
    sources.push("ejecuciones");
    tasks.push(["runs",runQuery("SELECT DISTINCT ON (upper(btrim(farmacia_codigo)),flujo)"+
     " farmacia_codigo AS code,flujo AS flow,estado AS state,iniciada_en AS \"startedAt\","+
     " finalizada_en AS \"finishedAt\",leidas AS read,insertadas AS inserted,"+
     " rechazadas AS rejected,error_resumen AS error"+
     " FROM "+q+".fm_sync_ejecuciones"+
     " WHERE upper(btrim(farmacia_codigo))=ANY($1::text[])"+
     " AND lower(btrim(flujo)) NOT IN ('ventas','compras')"+
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
    tasks.push([kind,runQuery("SELECT upper(btrim(farmacia_codigo)) AS code,"+
     " max("+timestamp+") AS \"lastReceivedAt\",max(fecha) AS \"lastDocumentAt\""+
     " FROM "+q+".\""+table+"\" WHERE upper(btrim(farmacia_codigo))=ANY($1::text[])"+
     " GROUP BY upper(btrim(farmacia_codigo))",[codes])]);
   }
   const results=await Promise.allSettled(tasks.map(t=>t[1]));
   const maps={runs:new Map(),monitors:new Map(),ventas:new Map(),compras:new Map()},warnings=[];
   results.forEach((result,index)=>{
    const name=tasks[index][0];
    if(result.status!=="fulfilled"){
     warnings.push("No se pudieron consultar los datos de "+name+".");return;
    }
    for(const r of result.value){
     const code=normalized(r.code);
     if(name==="runs"||name==="monitors"){
      const current=maps[name].get(code)||[];
      current.push(name==="monitors"?{
       jobId:r.jobId,flow:r.flow,enabled:Boolean(r.enabled),
       everyMinutes:Number(r.everyMinutes||60),dailyAtLocal:r.dailyAtLocal,
       timeZone:r.timeZone,nextDueAt:iso(r.nextDueAt),
       lastAttemptAt:iso(r.lastAttemptAt),lastFinishedAt:iso(r.lastFinishedAt),
       lastSuccessAt:iso(r.lastSuccessAt),lastState:r.lastState,
       error:r.error?String(r.error).slice(0,500):null,currentState:r.currentState,
       heartbeatAt:iso(r.heartbeatAt),registeredAt:iso(r.registeredAt),
       read:Number(r.read||0),inserted:Number(r.inserted||0)
      }:{
       flow:r.flow,state:r.state,startedAt:iso(r.startedAt),
       finishedAt:iso(r.finishedAt),read:Number(r.read||0),
       inserted:Number(r.inserted||0),rejected:Number(r.rejected||0),
       error:r.error?String(r.error).slice(0,500):null
      });
      maps[name].set(code,current);
     }else maps[name].set(code,{lastReceivedAt:iso(r.lastReceivedAt),
       lastDocumentAt:iso(r.lastDocumentAt)});
    }
   });
   const checkedAt=new Date();
   res.json({checkedAt:checkedAt.toISOString(),sources,warnings,
    telemetryAvailable:available.has("fm_sync_monitor")&&!warnings.some(x=>x.includes("monitors")),
    pharmacies:pharmacies.map(p=>{
     const code=normalized(p.databaseCode||p.sourceCode);
     return pharmacySyncSummary(p,maps.runs.get(code)||[],{
      ventas:maps.ventas.get(code),compras:maps.compras.get(code)
     },checkedAt,maps.monitors.get(code)||[]);
    }),
    note:"Verde: último trabajo correcto y comunicación reciente. Rojo: error registrado, servicio sin comunicar durante más de dos intervalos o trabajo atrasado. La ausencia de nuevas ventas no implica una avería. Los sincronizadores anteriores a la versión 0.17 no comunican su pulso."});
  }catch(e){next(e)}
 });
}
