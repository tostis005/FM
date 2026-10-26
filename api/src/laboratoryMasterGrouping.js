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
function exactMasterAliases(source){
 const name=normalizeLabName(source.name);
 if(!name)return [];
 const raw=String(source.name||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
  .toUpperCase().replace(/[^A-Z0-9]+/g," ").trim();
 const target=keyOf(source.laboratoryKey)?.slice(2)||name;
 const variants=new Set([name,normalizeLabName(raw)]);
 // Farmatic puede registrar "RAZÓN SOCIAL S.A. NOMBRE LABORATORIO".
 // También aplicar la regla a ocultos/cooperativas SIN clave asignada.
 // Antes solo se aplicaba a nombres visibles con clave N:.
 for(const base of new Set([name,raw])){
  if(!base)continue;
  for(const legal of LEGAL){
   variants.add(normalizeLabName(base+legal+" "+target));
   variants.add(normalizeLabName(base+legal+" "+name));
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
