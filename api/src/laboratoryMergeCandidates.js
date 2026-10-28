// Reconciliación CONSERVADORA de identidades del maestro unificado.
// La coincidencia de códigos ERP (locales por farmacia) o CN no es prueba de
// identidad. Nunca unificamos por similitud de subcadenas automáticamente.
const EXCLUDED=/(?:^| )(?:COOPERATIVA|COOP|MAYORISTA|DISTRIBUIDOR|DISTRIBUIDORA|DISTRIBUIDORES|FARMACIA|VARIOS|SIN CLASIFICAR|NO USAR)(?: |$)/;
const CLASSES=new Set(["DIRECTO","VACUNAS","FÓRMULAS"]);
export function canonicalLabName(value){
 let name=String(value||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
  .toUpperCase().trim();
 name=name.replace(/^ZZZ[_\s-]*NO[_\s-]*USAR[_\s-]*/,"")
  .replace(/^\d{1,4}\s*[.\-/]+\s*/,"")
  .replace(/[&]/g," Y ").replace(/[^A-Z0-9]+/g," ").replace(/\s+/g," ").trim();
 name=name.replace(/^(LABORATORIOS|LABORATORIO|LABS|LAB) /,"");
 // La forma jurídica únicamente se suprime AL FINAL, nunca dentro del nombre.
 name=name.replace(/ (S A U|S L U|SAU|SLU|S A|S L|SA|SL)$/,"").trim();
 return name;
}
export const safeLaboratoryIdentity=row=>{
 const key=canonicalLabName(row.name);
 return Boolean(row.active!==false&&CLASSES.has(row.class)&&
  key.length>=4&&/[A-Z]{3}/.test(key)&&!EXCLUDED.test(key)&&
  !/^(PROVEEDOR|LABORATORIO|OTROS|DESCONOCIDO|PENDIENTE|NINGUNO)\b/.test(key)&&
  !/^([A-Z]{0,3}\d{2,}|\d+)$/.test(key));
};
export function proposeLaboratoryMerges(rows,aliasCounts=new Map(),manualIds=new Set()){
 const groups=new Map();
 for(const row of rows){
  if(!safeLaboratoryIdentity(row))continue;
  const k=row.class+"|"+canonicalLabName(row.name);
  if(!groups.has(k))groups.set(k,[]);
  groups.get(k).push(row);
 }
 const operations=[],review=[];
 for(const [group,entities] of groups){
  if(entities.length<2)continue;
  const all=entities.sort((a,b)=>
   (aliasCounts.get(String(b.id))||0)-(aliasCounts.get(String(a.id))||0)||
   String(a.id).localeCompare(String(b.id),"es", {numeric:true}));
  const manual=all.filter(x=>manualIds.has(String(x.id)));
  // Una relación manual puede ser deliberada, se presenta para revisión.
  if(manual.length){review.push({group,ids:all.map(x=>String(x.id)),reason:"manual"});continue}
  const canonical=all[0];
  for(const source of all.slice(1)){
   operations.push({from:String(source.id),to:String(canonical.id),
    fromName:source.name,toName:canonical.name,key:group});
  }
 }
 operations.sort((a,b)=>a.key.localeCompare(b.key,"es")||a.from.localeCompare(b.from));
 return {operations,review,groupCount:groups.size};
}
