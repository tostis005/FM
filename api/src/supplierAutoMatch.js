import {normalizeLabName} from "./laboratoryIdentity.js";

// Autovinculación conservadora: coincidencia exacta de nombre normalizado.
// Sin coincidencias por subcadenas, códigos, ni deducción desde movimientos.
export function buildAutomaticSupplierMatches(suppliers,sourceLabs){
 const labs=new Map();
 for(const name of sourceLabs||[]){
  const n=normalizeLabName(name);
  if(n&&n.length>=3&&/[A-Z]{2}/.test(n)&&!(/^[A-Z]{0,3}[0-9]{2,}$/.test(n)))
   labs.set(n,"N:"+n);
 }
 const matches=new Map();
 for(const s of suppliers||[]){
  const code=String(s?.sourceCode||"").trim().toUpperCase();
  const name=String(s?.name||"").trim();
  if(!/^[A-Z0-9_.-]{1,60}$/.test(code)||!name||name.length>200||
   s?.cooperative||s?.laboratoryKey||s?.ignoreReports||name.toUpperCase()===code||
   /^(?:PROVEEDOR|MAYORISTA|COOPERATIVA) [0-9]+$/i.test(name))continue;
  const key=labs.get(normalizeLabName(name));
  if(!key)continue;
  if(!matches.has(code))matches.set(code,{sourceCode:code,name,laboratoryKey:key});
  else if(matches.get(code)?.laboratoryKey!==key)matches.set(code,null);
 }
 return [...matches.values()].filter(Boolean);
}


// Proveedores de Farmatic sin equivalente oficial: una misma denominación
// normalizada en dos fichas locales puede constituir una identidad propia.
// Se PROPONE, no se vincula hasta que el administrador aprueba la vista previa.
export function buildLocalSupplierGroupSuggestions(suppliers){
 const groups=new Map();
 for(const row of suppliers||[]){
  const code=String(row?.sourceCode||"").trim().toUpperCase();
  const name=String(row?.name||"").trim();
  const normalized=normalizeLabName(name);
  if(!code||!name||name.length>200||row.cooperative||row.ignoreReports||
   row.laboratoryKey||row.inferredLaboratoryKey||
   normalized.length<3||!/[A-Z]{2}/.test(normalized)||
   normalizeLabName(code)===normalized||
   /^(?:PROVEEDOR|MAYORISTA|COOPERATIVA) [0-9]+$/i.test(name)||
   /^[A-Z]{0,4}[0-9]{2,}$/.test(normalized))continue;
  const id=String(row.pharmacyId)+"|"+code;
  if(!groups.has(normalized))groups.set(normalized,new Map());
  groups.get(normalized).set(id,{pharmacyId:String(row.pharmacyId),
   sourceCode:code,name,laboratoryKey:"N:"+normalized,
   customName:name,source:"farmatic"});
 }
 return [...groups.values()].filter(group=>group.size>=2)
  .flatMap(group=>[...group.values()]);
}
