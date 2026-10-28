// La matriz puede tener miles de filas y más de 20 columnas. Cargar todas
// las referencias y métricas, pero dibujar inicialmente solo un tramo evita
// bloquear React al teclear o cambiar una cantidad. No limita guardados ni totales.
export const LAB_VISIBLE_INITIAL=150;
export const LAB_VISIBLE_STEP=150;
export function visibleLaboratoryRows(rows,count=LAB_VISIBLE_INITIAL){
 return rows.slice(0,Math.max(0,Math.floor(Number(count)||0)));
}
export function nextLaboratoryVisibleCount(current,total){
 return Math.min(total,Math.max(LAB_VISIBLE_INITIAL,Number(current)||0)+LAB_VISIBLE_STEP);
}

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
    const result=await fetchBatch(originals,index);
    if(signal?.aborted||failure)return;
    if(result?.metricsUnavailable||!Array.isArray(result?.rows))
     throw Error(result?.warning||"No se pueden calcular las ventas y el stock");
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
