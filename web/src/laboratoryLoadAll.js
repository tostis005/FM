// Se mantiene una única tabla visible. La API conserva lotes de 100
// para no saturar PostgreSQL, pero se pueden leer 3 páginas en paralelo.
export const LAB_CATALOG_BATCH=100;
export const LAB_METRICS_BATCH=40;
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
