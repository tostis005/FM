// Unificaciones revisadas individualmente sobre auditoría real 2026-10-29.
// Solo identidades del maestro que se refieren al MISMO laboratorio; no
// incorporamos marcas relacionadas con distribuidores ni otro tipo de empresas.
export const REVIEWED_LAB_PAIRS=[
 {from:"545",to:"326",fromName:"GEDEON RITCHER",toName:"GEDEON RICHTER"},
 {from:"308",to:"561",fromName:"HRA PHARMA",toName:"HRA PHARMA IBERIA"},
 {from:"433",to:"434",fromName:"B.G.P.PRODUCTS OPERATIONS, S.L.(UNI",toName:"BGP PRODUCTS OPERATIONS"},
 {from:"901",to:"900",fromName:"LAB VIRTUDES NAVAMUEL",toName:"LABORATORIO VIRTUDES GÓMEZ NAVAMUEL"}
];
const norm=x=>String(x).normalize("NFKC").trim().toUpperCase();
export function reviewedLaboratoryMerges(master,aliases,manual=new Set(),blocked=new Set()){
 const byId=new Map(master.map(p=>[String(p.id),p]));
 const bySupplier=new Map();
 for(const a of aliases){
  const key=String(a.supplier);
  if(!bySupplier.has(key))bySupplier.set(key,[]);
  bySupplier.get(key).push(a);
 }
 const operations=[];
 for(const p of REVIEWED_LAB_PAIRS){
  const source=byId.get(p.from),target=byId.get(p.to);
  if(!source||!target||norm(source.name)!==norm(p.fromName)||
   norm(target.name)!==norm(p.toName)||
   source.active===false||target.active===false||
   source.class!=="DIRECTO"||target.class!=="DIRECTO")
   throw Error("La identidad "+p.from+" o "+p.to+" cambió: abortar fusión revisada");
  if(manual.has(p.from)||manual.has(p.to)||blocked.has(p.from)||blocked.has(p.to))
   throw Error("Hay modificaciones manuales o pedidos planificados en "+p.from+" / "+p.to);
  const a=bySupplier.get(p.from)||[],b=bySupplier.get(p.to)||[];
  if(!a.length||!b.length)throw Error("Falta el código original de "+p.from+" / "+p.to);
  // Si ambas identidades tienen códigos distintos EN LA MISMA farmacia, el
  // operador puede querer mantenerlas separadas; no autounificar.
  const own=new Set(a.map(o=>String(o.pharmacyCode||"").trim().toUpperCase()));
  if(b.some(o=>own.has(String(o.pharmacyCode||"").trim().toUpperCase())))
   throw Error("Proveedores coexistentes en la misma farmacia: revisión manual "+p.from+" / "+p.to);
  operations.push({...p,key:"reviewed:"+p.to});
 }
 return {operations,review:[]};
}
