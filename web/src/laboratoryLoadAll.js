// Una sola tabla visible. El servidor conserva páginas pequeñas para limitar
// memoria, latencia y bloqueos de PostgreSQL. Nunca descartamos las ya recibidas.
export const LAB_CATALOG_BATCH=100;
export const LAB_METRICS_BATCH=40;

export async function collectLaboratoryCatalog(fetchPage,{batchSize=LAB_CATALOG_BATCH,signal,onBatch}={}){
 const seen=new Set(),rows=[];
 let total=0;
 for(let page=1;page<=100000;page++){
  if(signal?.aborted)throw Object.assign(new Error("Consulta cancelada"),{name:"AbortError"});
  const result=await fetchPage(page,batchSize);
  if(!result||!Array.isArray(result.rows)||!Number.isSafeInteger(Number(result.total))||
   Number(result.total)<0)throw Error("Respuesta incompleta del catálogo de laboratorio");
  if(page===1)total=Number(result.total);
  else if(Number(result.total)!==total)
   throw Error("El catálogo cambió durante la lectura. Actualiza para cargarlo completo.");
  for(const row of result.rows){
   if(!row?.referencia)throw Error("Referencia de laboratorio inválida");
   if(!seen.has(row.referencia)){seen.add(row.referencia);rows.push(row)}
  }
  onBatch?.({rows:[...rows],total,loaded:rows.length,page});
  if(rows.length>=total)return {rows,total};
  if(result.rows.length===0)throw Error("El catálogo ha devuelto una página vacía antes de terminar.");
 }
 throw Error("El laboratorio supera el límite de páginas permitido.");
}
