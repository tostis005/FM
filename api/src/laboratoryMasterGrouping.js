import {normalizeLabName} from "./laboratoryIdentity.js";

const keyOf=value=>{
 const key=String(value||"").trim().toUpperCase();
 if(!key.startsWith("N:"))return null;
 const name=normalizeLabName(key.slice(2));
 return name?"N:"+name:null;
};
// Solo variaciones ESTRUCTURALES de una razón social; no se admiten
// coincidencias parciales ni por similitud que unan dos laboratorios distintos.
const LEGAL=[""," S A"," S L"," S A U"," S L U"," SA"," SL"," SAU"," SLU"];
// Farmatic antepone códigos de proveedor al nombre ("01 ALLIANCE", 
// "0.-AMPEDIA", "3-BIDAFARMA"). Esos números NO son parte del laboratorio.
const SUPPLIER_PREFIX=/^\s*\d{1,4}(?:(?:\s*[.\-/]+\s*)|\s+)/;
function supplierNameForms(source){
 const raw=String(source||"").trim();
 const clean=raw.replace(SUPPLIER_PREFIX,"").trim();
 const forms=new Set([raw,clean]);
 if(clean!==raw)forms.add(raw.replace(SUPPLIER_PREFIX,"").trim());
 // Quitar una nota entre paréntesis únicamente cuando está AL FINAL.
 for(const form of [...forms]){
  const noNote=form.replace(/\s*\([^)]{2,100}\)\s*$/,"").trim();
  if(noNote)forms.add(noNote);
 }
 // Denominaciones jurídicas de cooperativas, igual que S.A. y S.L.
 for(const form of [...forms]){
  const norm=normalizeLabName(form);
  const noCoop=norm.replace(/\s+S\s+COOP(?:ERATIVA)?(?:\s+AND)?$/,"").trim();
  if(noCoop&&noCoop!==norm)forms.add(noCoop);
 }
 return [...forms].filter(Boolean);
}
export function exactMasterAliases(source){
 const baseForms=supplierNameForms(source.name);
 const names=new Set(baseForms.map(normalizeLabName).filter(Boolean));
 if(!names.size)return [];
 const target=keyOf(source.laboratoryKey)?.slice(2)||
  normalizeLabName(baseForms.at(-1));
 const variants=new Set(names);
 const LAB_PREFIX=/^(?:LABORATORIOS?|LABS?)\s/;
 for(const form of baseForms){
  const name=normalizeLabName(form);
  const raw=String(form).normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
   .toUpperCase().replace(/[^A-Z0-9]+/g," ").trim();
  for(const base of new Set([name,raw])){
   if(!base)continue;
   for(const legal of LEGAL){
    variants.add(normalizeLabName(base+legal+" "+target));
    variants.add(normalizeLabName(base+legal+" "+name));
    if(LAB_PREFIX.test(raw)){
     variants.add(normalizeLabName(base+legal+" LABORATORIO "+target));
     variants.add(normalizeLabName(base+legal+" LABORATORIOS "+target));
    }
   }
  }
 }
 return [...variants].filter(Boolean);
}
const excluded=s=>s.cooperative===true||s.ignoreReports===true||
 String(s.type||"").toLowerCase()==="cooperativa";

/**
 * Solo laboratorios utilizables en el preparador.
 * La exclusión expresa del maestro prevalece sobre el Nomenclátor,
 * sobre un nombre local de Farmatic y sobre una coincidencia visible con
 * el mismo alias. Una asignación visible a otro alias del mismo laboratorio
 * continúa apareciendo para no ocultar laboratorios válidos.
 */
export function groupLaboratoriesByMaster(evidence,master){
 const aliases=new Map();
 const blockedTargets=new Set(),visibleTargets=new Set();
 for(const supplier of master){
  const target=keyOf(supplier.laboratoryKey);
  const blocked=excluded(supplier);
  if(target)(blocked?blockedTargets:visibleTargets).add(target);
  for(const alias of exactMasterAliases(supplier)){
   const data=aliases.get(alias)||{blocked:false,targets:new Set()};
   if(blocked)data.blocked=true;
   else if(target)data.targets.add(target);
   aliases.set(alias,data);
  }
 }
 const resolved=new Map();
 for(const entry of evidence){
  if(!entry?.key||!entry.name)continue;
  const alias=normalizeLabName(entry.name);
  const data=aliases.get(alias);
  // Prioridad estricta: no reintroducir este proveedor por AEMPS,
  // aunque exista otro maestro sin bloquear que tenga el mismo nombre.
  if(data?.blocked)continue;
  const canonical=data?.targets.size===1?[...data.targets][0]:keyOf(entry.key);
  if(!canonical)continue;
  if(blockedTargets.has(canonical)&&!visibleTargets.has(canonical))continue;
  const previous=resolved.get(canonical);
  const preferName=!previous||normalizeLabName(entry.name)===canonical.slice(2);
  resolved.set(canonical,{
   key:canonical,
   name:preferName?entry.name:previous.name,
   hasMedication:entry.hasMedication===true||previous?.hasMedication===true,
   hasParapharmacy:entry.hasParapharmacy===true||previous?.hasParapharmacy===true,
   fromVademecum:false
  });
 }
 return [...resolved.values()].sort((a,b)=>a.name.localeCompare(b.name,"es")).slice(0,5000);
}
export async function readMasterLaboratoryRules(pool,slug){
 const {rows}=await pool.query({text:`
  SELECT nombre AS name,tipo AS type,laboratorio_clave AS "laboratoryKey",
   cooperativa AS cooperative,ignorar_informes AS "ignoreReports"
  FROM farmetrica.proveedores_maestro WHERE cliente_slug=$1`,
  values:[slug],query_timeout:5000});
 return rows;
}
