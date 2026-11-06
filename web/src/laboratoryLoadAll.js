// Se mantiene una única tabla visible. La API conserva lotes de 100
// para no saturar PostgreSQL, pero se pueden leer 3 páginas en paralelo.
export const LAB_CATALOG_BATCH=250;
export const LAB_METRICS_BATCH=200;
export const LAB_CATALOG_CONCURRENCY=3;

export async function collectLaboratoryCatalog(fetchPage,{
 batchSize=LAB_CATALOG_BATCH,concurrency=LAB_CATALOG_CONCURRENCY,signal,onBatch
}={}){
 const aborted=()=>signal?.aborted;
 const cancelled=()=>Object.assign(new Error("Consulta cancelada"),{name:"AbortError"});
 const validate=(result,page,total)=>{
  if(!result||!Array.isArray(result.rows)||
   !Number.isSafeInteger(Number(result.total))||Number(result.total)<0||
   result.rows.length>batchSize)throw Error("Respuesta incompleta del catálogo de laboratorio");
  if(Number(result.total)!==total)
   throw Error("El catálogo cambió durante la lectura. Actualiza para cargarlo completo.");
  if(page>1&&!result.rows.length)
   throw Error("El catálogo ha devuelto una página vacía antes de terminar.");
 };
 if(aborted())throw cancelled();
 const first=await fetchPage(1,batchSize);
 const total=Number(first?.total);
 validate(first,1,total);
 const numberOfPages=Math.ceil(total/batchSize);
 if(numberOfPages>100000)throw Error("Demasiadas referencias para este laboratorio");
 const rows=[],seen=new Set();
 const add=result=>{
  for(const row of result.rows){
   if(!row?.referencia||seen.has(row.referencia))
    throw Error("El catálogo contiene referencias duplicadas o no válidas");
   seen.add(row.referencia);rows.push(row);
  }
  if(rows.length>total)throw Error("El catálogo ha cambiado durante la lectura");
 };
 add(first);
 onBatch?.({rows:[...rows],total,loaded:rows.length,page:1});
 if(numberOfPages<=1){
  if(rows.length!==total)throw Error("El catálogo no ha devuelto todas las referencias");
  return {rows,total};
 }
 const pages=new Map();
 let next=2,flush=2,failure=null;
 function publish(){
  while(pages.has(flush)&&!failure&&!aborted()){
   const result=pages.get(flush);pages.delete(flush);add(result);
   onBatch?.({rows:[...rows],total,loaded:rows.length,page:flush});
   flush++;
  }
 }
 async function worker(){
  while(next<=numberOfPages&&!failure&&!aborted()){
   const page=next++;
   try{
    const result=await fetchPage(page,batchSize);
    if(aborted()||failure)return;
    validate(result,page,total);
    pages.set(page,result);publish();
   }catch(e){failure=e;throw e}
  }
 }
 await Promise.all(Array.from({length:Math.min(Math.max(1,concurrency),numberOfPages-1)},()=>worker()));
 if(aborted())throw cancelled();
 if(failure)throw failure;
 if(rows.length!==total)throw Error("El catálogo no ha devuelto todas las referencias");
 return {rows,total};
}

export const LAB_METRICS_CONCURRENCY=3;
const MIN_METRICS_BATCH=25;
// Algunos laboratorios concentran muchas líneas históricas: si PostgreSQL no
// puede agregar 200 referencias, dividir solo ese lote, sin perder ni limitar
// los artículos restantes. Las peticiones hijas son secuenciales para no
// multiplicar la carga simultánea sobre la base de datos.
export async function fetchLaboratoryMetricsAdaptive(items,fetchBatch,{signal}={}){
 const cancelled=()=>Object.assign(new Error("Consulta cancelada"),{name:"AbortError"});
 if(signal?.aborted)throw cancelled();
 try{
  const result=await fetchBatch(items);
  if(result?.metricsUnavailable){
   const failure=new Error(result.warning||"Métricas de stock y ventas no disponibles");
   failure.code=result.metricsErrorCode||"QUERY_ERROR";
   throw failure;
  }
  if(!Array.isArray(result?.rows)||result.rows.length!==items.length)
   throw Error("Respuesta incompleta al calcular las ventas y el stock");
  return result;
 }catch(error){
  if(signal?.aborted)throw cancelled();
  // Errores de estructura/autorización no mejoran partiendo los lotes.
  const definitive=new Set(["42P01","42703","42883","42601","42501","22P02","23502"]);
  if(items.length<=MIN_METRICS_BATCH||definitive.has(error?.code))throw error;
  const middle=Math.ceil(items.length/2);
  const first=await fetchLaboratoryMetricsAdaptive(items.slice(0,middle),fetchBatch,{signal});
  const second=await fetchLaboratoryMetricsAdaptive(items.slice(middle),fetchBatch,{signal});
  return {rows:[...first.rows,...second.rows],
   frequencyDays:first.frequencyDays??second.frequencyDays};
 }
}
// Actualizar cada bloque por su referencia, no por la posición de llegada.
// El usuario puede editar cantidades mientras llegan otras métricas.
export async function collectLaboratoryMetrics(catalogRows,fetchBatch,{
 batchSize=LAB_METRICS_BATCH,concurrency=LAB_METRICS_CONCURRENCY,signal,onBatch
}={}){
 const rows=catalogRows.map(row=>({...row}));
 const count=Math.ceil(rows.length/batchSize);
 let next=0,done=0,frequencyDays=7,failure=null;
 const cancelled=()=>Object.assign(new Error("Consulta cancelada"),{name:"AbortError"});
 async function worker(){
  while(next<count&&!failure&&!signal?.aborted){
   const index=next++,start=index*batchSize;
   const originals=rows.slice(start,start+batchSize);
   try{
    const result=await fetchLaboratoryMetricsAdaptive(originals,items=>fetchBatch(items,index),{signal});
    if(signal?.aborted||failure)return;
    const byReference=new Map(result.rows.map(r=>[r.referencia,r]));
    for(let i=start;i<Math.min(start+batchSize,rows.length);i++){
     const details=byReference.get(rows[i].referencia);
     if(!details)throw Error("Faltan referencias del cálculo de stock y ventas");
     rows[i]={...rows[i],...details,metricsReady:true};
    }
    frequencyDays=result.frequencyDays??frequencyDays;
    done+=originals.length;
    onBatch?.({rows:[...rows],loaded:done,total:rows.length,frequencyDays});
   }catch(e){failure=e;throw e}
  }
 }
 if(signal?.aborted)throw cancelled();
 const outcomes=await Promise.allSettled(Array.from({length:Math.min(Math.max(1,concurrency),count)},
  ()=>worker()));
 if(signal?.aborted)throw cancelled();
 const error=outcomes.find(x=>x.status==="rejected");
 if(error)throw error.reason;
 if(failure)throw failure;
 return {rows,total:rows.length,frequencyDays};
}
