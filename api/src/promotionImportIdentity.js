// Identidad semántica del RESUMEN: no depende del número de fila ni del
// nombre del archivo. Las campañas "hasta fin de existencias" pueden no
// tener fecha de fin; en ese caso se conserva el fin vacío en la identidad.
const normalize=value=>String(value??"").trim().normalize("NFD")
 .replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").toUpperCase();
export function promotionImportIdentity(p){
 if(!p||!p.start||!(p.laboratory||p.subtitle)||
   !p.range||p.originalOffer==null)return null;
 return [p.start,p.end||"",p.laboratory||p.subtitle,p.range,
  p.originalOffer,p.description||""].map(normalize).join("\u001F");
}
export function planPromotionImport(existing,incoming){
 const identities=new Set(existing.map(promotionImportIdentity).filter(Boolean));
 const usedIds=new Set(existing.map(p=>String(p.id)));
 const additions=[];
 let skipped=0;
 for(const incomingItem of incoming){
  const identity=promotionImportIdentity(incomingItem);
  if(!identity)throw Error("Faltan los datos de identificación de una promoción");
  if(identities.has(identity)){skipped++;continue}
  let id=String(incomingItem.id);
  let counter=1;
  while(usedIds.has(id)){id=String(incomingItem.id)+"-"+counter++;if(id.length>120)
    throw Error("Identificador de promoción demasiado largo")}
  usedIds.add(id);identities.add(identity);
  additions.push({...incomingItem,id});
 }
 return {additions,skipped};
}
