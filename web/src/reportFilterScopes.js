// Normaliza los filtros antiguos de farmacia guardados en sessionStorage.
// El frontend envía IDs internos autorizados, no códigos del ERP.
export function reconcilePharmacyIds(selected,pharmacies){
 const known=new Map();
 const conflict=new Set();
 for(const pharmacy of pharmacies||[]){
  const id=String(pharmacy.id??"").trim();
  if(!id)continue;
  for(const alias of [id,pharmacy.sourceCode,pharmacy.databaseCode,pharmacy.displayCode]){
   const key=String(alias??"").trim().toUpperCase();
   if(!key)continue;
   if(known.has(key)&&known.get(key)!==id)conflict.add(key);
   else known.set(key,id);
  }
 }
 for(const key of conflict)known.delete(key);
 const result=[];
 for(const raw of Array.isArray(selected)?selected:[]){
  const id=known.get(String(raw??"").trim().toUpperCase());
  if(id&&!result.includes(id))result.push(id);
 }
 return result;
}
