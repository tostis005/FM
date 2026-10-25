import {normalizeLabName} from "./laboratoryIdentity.js";

const keyOf=value=>{
 const key=String(value||"").trim().toUpperCase();
 if(!key.startsWith("N:"))return null;
 const name=normalizeLabName(key.slice(2));
 return name?"N:"+name:null;
};
/** La equivalencia expresamente guardada en el maestro tiene prioridad
 * sobre las diferencias ortográficas de Farmatic. Nunca se infiere por
 * subcadenas ni se mezcla un código ERP de farmacias distintas. */
export function groupLaboratoriesByMaster(evidence,master){
 const byAlias=new Map();
 for(const source of master){
  const alias=normalizeLabName(source.name);
  if(!alias)continue;
  const item=byAlias.get(alias)||{targets:new Set(),visible:false,blocked:false};
  if(source.cooperative===true||source.ignoreReports===true){
   item.blocked=true;
  }else{
   item.visible=true;
   const key=keyOf(source.laboratoryKey);
   if(key)item.targets.add(key);
  }
  byAlias.set(alias,item);
 }
 const resolved=new Map();
 for(const entry of evidence){
  if(!entry?.key||!entry.name)continue;
  const alias=normalizeLabName(entry.name);
  const data=byAlias.get(alias);
  // Si solo tenemos registros de este nombre marcados como cooperativa/
  // ignorar en informes, no presentarlo por existir en AEMPS o Farmatic.
  if(data?.blocked&&!data.visible)continue;
  const canonical=data?.targets.size===1?[...data.targets][0]:keyOf(entry.key);
  if(!canonical)continue;
  const existing=resolved.get(canonical);
  const preferName=!existing||normalizeLabName(entry.name)===canonical.slice(2);
  resolved.set(canonical,{
   key:canonical,
   name:preferName?entry.name:existing.name,
   hasMedication:entry.hasMedication===true||existing?.hasMedication===true,
   hasParapharmacy:entry.hasParapharmacy===true||existing?.hasParapharmacy===true,
   fromVademecum:false
  });
 }
 return [...resolved.values()].sort((a,b)=>a.name.localeCompare(b.name,"es")).slice(0,5000);
}
export async function readMasterLaboratoryRules(pool,slug){
 const {rows}=await pool.query({text:`
  SELECT nombre AS name,laboratorio_clave AS "laboratoryKey",
   cooperativa AS cooperative,ignorar_informes AS "ignoreReports"
  FROM farmetrica.proveedores_maestro WHERE cliente_slug=$1`,
  values:[slug],query_timeout:5000});
 return rows;
}
