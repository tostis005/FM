// Propuestas de revisión únicamente para LABORATORIOS. Los códigos locales
// nunca bastan para demostrar que dos empresas son una misma identidad.
export const LAB_CLASSES=new Set(["DIRECTO","VACUNAS","FÓRMULAS"]);
export const isLaboratory=p=>LAB_CLASSES.has(p?.class);
export function canonicalSupplierName(value){
 return String(value||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
  .toUpperCase().replace(/^(?:ZZZ[ _-]*NO[ _-]*USAR[ _-]*)/,"")
  .replace(/\b(?:LABORATORIOS|LABORATORIO|LABS|LAB)\s+/g,"")
  .replace(/\s+(?:S\.?\s?L\.?\s?U?\.?|S\.?\s?A\.?\s?U?\.?)$/g,"")
  .replace(/[^A-Z0-9]+/g," ").replace(/\s+/g," ").trim();
}
export function supplierMergeSuggestions(suppliers){
 const groups=new Map();
 for(const p of suppliers){
  if(!isLaboratory(p))continue;
  const name=canonicalSupplierName(p.name);
  if(name.length<4||!/[A-Z]{3}/.test(name)||
   /^(?:VARIOS|OTROS|SIN CLASIFICAR|PENDIENTE|PROVEEDOR|FARMACIAS?|DISTRIBUIDOR)/.test(name))continue;
  const key=p.class+"|"+name;
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(p);
 }
 const out=[];
 for(const list of groups.values()){
  if(list.length<2)continue;
  const sorted=[...list].sort((a,b)=>(b.origins?.length||0)-(a.origins?.length||0)||
   Number(a.id)-Number(b.id));
  const codes=new Map();
  for(const p of sorted)for(const o of p.origins||[]){
   const code=String(o.sourceCode||"").trim().toUpperCase().replace(/^0+(?=\d)/,"");
   if(!code)continue;
   if(!codes.has(code))codes.set(code,new Map());
   codes.get(code).get(p.id)?.add(o.pharmacyCode);
   if(!codes.get(code).has(p.id))codes.get(code).set(p.id,new Set([o.pharmacyCode]));
  }
  const matching=[...codes].filter(([,supplierMap])=>supplierMap.size>1).map(([code])=>code);
  out.push({name:sorted[0].name,class:sorted[0].class,
   destination:String(sorted[0].id),sourceIds:sorted.slice(1).map(p=>String(p.id)),
   count:sorted.length,matchingCodes:matching,verifiedByName:true});
 }
 return out.sort((a,b)=>b.matchingCodes.length-a.matchingCodes.length||b.count-a.count||a.name.localeCompare(b.name,"es"));
}
