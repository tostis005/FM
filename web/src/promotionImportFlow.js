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
// Las campañas que el servidor considera existentes DEBEN ser recuperables
// en la respuesta; de lo contrario no anunciar «ya importadas» al usuario.
// Usar la identidad del fichero/fila y no los filtros visibles de la página.
const normalized=value=>String(value??"").trim().normalize("NFD")
 .replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").toUpperCase();
const rowIdentity=p=>[
 p.sourceRow,p.start||"",p.end||"",p.laboratory||p.subtitle||"",
 p.range||"",p.originalOffer||"",p.description||""
].map(normalized).join("|");

export function importedPromotionMatches(result,campaigns,source){
 const batchId=campaigns.find(p=>p.importBatchId)?.importBatchId;
 const rows=(result?.promotions||[]).filter(p=>p.source===source||
  (batchId&&p.importBatchId===batchId));
 const exact=new Map();
 for(const p of rows){
  const key=rowIdentity(p);
  if(!exact.has(key))exact.set(key,p);
 }
 // Dos subidas antiguas del mismo fichero pueden tener IDs diferentes.
 // Mostrar una única instancia por fila, sin perder las promociones guardadas.
 return campaigns.map(c=>exact.get(rowIdentity(c))).filter(Boolean);
}
export function importResultSummary(result,campaigns,source){
 if(!result||!Array.isArray(result.promotions)||
   !Number.isInteger(result.imported)||result.imported<0||
   !Number.isInteger(result.skipped)||result.skipped<0||
   result.imported+result.skipped!==campaigns.length)
  throw Error("El servidor no confirmó el resultado completo de la importación");
 const matches=importedPromotionMatches(result,campaigns,source);
 if(matches.length!==campaigns.length)
  throw Error("El servidor indica promociones importadas, pero no devuelve todas las filas del Excel. Comprueba tu acceso al cliente y recarga el catálogo.");
 return {
  imported:result.imported,skipped:result.skipped,visible:matches.length,
  drafts:matches.filter(p=>!Object.keys(p.targets||{}).length).length,
  source,visibleIds:matches.map(p=>p.id)
 };
}

export function promotionVisibleInPharmacyScope(p,pharmacyIds=[]){
 if(!pharmacyIds.length)return true;
 const assigned=Object.keys(p?.targets||{});
 // Los borradores aún sin asignación deben seguir siendo encontrables
 // desde el catálogo; de otro modo un filtro global los oculta por completo.
 return !assigned.length||assigned.some(id=>pharmacyIds.includes(String(id)));
}
