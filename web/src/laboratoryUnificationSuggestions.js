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
  if(p.active===false||!isLaboratory(p))continue;
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
  const matching=[...codes].filter(([,supplierMap])=>supplierMap.size>1&&new Set([...supplierMap.values()].flatMap(s=>[...s])).size>1).map(([code])=>code);
  out.push({key:"exact:"+sorted[0].id,name:sorted[0].name,names:sorted.map(p=>p.name),class:sorted[0].class,reason:"Nombre normalizado idéntico",
   destination:String(sorted[0].id),sourceIds:sorted.slice(1).map(p=>String(p.id)),
   count:sorted.length,matchingCodes:matching,verifiedByName:true});
 }
 const candidates=suppliers.filter(p=>p.active!==false&&isLaboratory(p)&&canonicalSupplierName(p.name).length>=4);
 const distanceOne=(a,b)=>{
  if(a===b||Math.abs(a.length-b.length)>1)return false;
  if(a.length>b.length)[a,b]=[b,a];
  let i=0,j=0,errors=0;
  while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue}if(++errors>1)return false;if(a.length===b.length)i++;j++}
  return errors+b.length-j===1;
 };
 const blocked=/\b(?:VARIOS|OTROS|PENDIENTE|PROVEEDOR|FARMACIA|COOPERATIVA|MAYORISTA|DISTRIBUIDOR|DISTRIBUCION|SERVICIOS|INTERNO|NO USAR)\b/;
 for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++){
  const a=candidates[i],b=candidates[j];if(a.class!==b.class)continue;
  const n1=canonicalSupplierName(a.name),n2=canonicalSupplierName(b.name);
  if(blocked.test(n1)||blocked.test(n2))continue;
  const x=n1.replace(/\s/g,""),y=n2.replace(/\s/g,"");
  if(n1===n2||Math.min(x.length,y.length)<6||!(x===y||distanceOne(x,y)))continue;
  const [target,source]=[a,b].sort((a,b)=>(b.origins?.length||0)-(a.origins?.length||0)||Number(a.id)-Number(b.id));
  const cross=[];
  for(const m of a.origins||[])for(const n of b.origins||[]){
   const code=z=>String(z||"").trim().toUpperCase().replace(/^0+(?=\d)/,"");
   if(m.pharmacyCode!==n.pharmacyCode&&code(m.sourceCode)&&code(m.sourceCode)===code(n.sourceCode))cross.push(code(m.sourceCode));
  }
  const coexist=(a.origins||[]).some(m=>(b.origins||[]).some(n=>m.pharmacyCode===n.pharmacyCode));
  out.push({key:"pair:"+a.id+":"+b.id,name:target.name,names:[source.name,target.name],class:target.class,destination:String(target.id),sourceIds:[String(source.id)],count:2,matchingCodes:[...new Set(cross)],verifiedByName:false,reason:x===y?"Espacios o puntuación":"Diferencia de una letra",coexist});
 }
 return out.sort((a,b)=>Number(b.verifiedByName)-Number(a.verifiedByName)||b.matchingCodes.length-a.matchingCodes.length||b.count-a.count||a.name.localeCompare(b.name,"es"));
}
