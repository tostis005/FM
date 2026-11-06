// Lote estable por contenido: repetir el mismo Excel tras una interrupción
// de red no debe generar otras 50 campañas. Funciona también en Safari móvil
// sin depender de crypto.subtle ni de metadatos del selector de ficheros.
export async function promotionExcelBatchId(file){
 if(!file||typeof file.arrayBuffer!=="function")throw Error("No se pudo leer el fichero seleccionado");
 const bytes=new Uint8Array(await file.arrayBuffer());
 let first=2166136261,second=2246822519;
 for(const byte of bytes){
  first=Math.imul(first^byte,16777619);
  second=Math.imul(second^byte,3266489917);
 }
 const hex=value=>(value>>>0).toString(16).padStart(8,"0").toUpperCase();
 return "XLSX-"+bytes.length.toString(16).toUpperCase()+"-"+hex(first)+hex(second);
}
export function importResultSummary(result,campaigns,source){
 if(!result||!Array.isArray(result.promotions)||
   !Number.isInteger(result.imported)||result.imported<0||
   !Number.isInteger(result.skipped)||result.skipped<0||
   result.imported+result.skipped!==campaigns.length)
   throw Error("El servidor no confirmó el resultado completo de la importación");
 const visible=result.promotions.filter(p=>p.source===source);
 const drafts=visible.filter(p=>!Object.keys(p.targets||{}).length).length;
 return {imported:result.imported,skipped:result.skipped,visible:visible.length,
  drafts,source};
}
