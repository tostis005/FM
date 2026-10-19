// Filtros comunes entre informes de un mismo cliente, dentro de la sesión del navegador.
// Las búsquedas, familias y filtros de columnas se mantienen independientes por pantalla.
import {SALES_PERIODS} from "./salesPeriods.js";

const PREFIX="fm_shared_report_filters_v1:";
const periodKeys=new Set(SALES_PERIODS.map(([key])=>key));
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const cleanIds=value=>Array.isArray(value)?[...new Set(value.filter(v=>typeof v==="string"||typeof v==="number").map(String).filter(Boolean))]:[];
const date=value=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:"";

export function readSharedReportFilters(clientSlug,allowedPeriods=periodKeys){
  try{
    const saved=JSON.parse(sessionStorage.getItem(PREFIX+encodeURIComponent(clientSlug))||"null");
    if(!saved||typeof saved!=="object"||Array.isArray(saved))return {};
    const allowed=allowedPeriods instanceof Set?allowedPeriods:new Set(allowedPeriods);
    return {
      ...(own(saved,"period")&&allowed.has(saved.period)&&periodKeys.has(saved.period)?{period:saved.period}:{}),
      ...(own(saved,"customFrom")?{customFrom:date(saved.customFrom)}:{}),
      ...(own(saved,"customTo")?{customTo:date(saved.customTo)}:{}),
      ...(own(saved,"pharmacyIds")?{pharmacyIds:cleanIds(saved.pharmacyIds)}:{})
    };
  }catch{return {};}
}

export function updateSharedReportFilters(clientSlug,patch){
  if(!clientSlug||!patch||typeof patch!=="object")return;
  // Recuperar todos los períodos, incluidos los que no estén visibles en esta página.
  const previous=readSharedReportFilters(clientSlug);
  const updated={...previous};
  if(own(patch,"period")&&periodKeys.has(patch.period))updated.period=patch.period;
  if(own(patch,"customFrom"))updated.customFrom=date(patch.customFrom);
  if(own(patch,"customTo"))updated.customTo=date(patch.customTo);
  if(own(patch,"pharmacyIds"))updated.pharmacyIds=cleanIds(patch.pharmacyIds);
  try{sessionStorage.setItem(PREFIX+encodeURIComponent(clientSlug),JSON.stringify(updated))}catch{}
}

export function initializeSharedReportFilters(clientSlug,defaults){
  if(!clientSlug||!defaults)return;
  // Sólo rellenar filtros todavía no elegidos; nunca pisar una selección anterior.
  const saved=readSharedReportFilters(clientSlug);
  const missing=Object.fromEntries(["period","customFrom","customTo","pharmacyIds"]
    .filter(key=>!own(saved,key)&&own(defaults,key)).map(key=>[key,defaults[key]]));
  if(Object.keys(missing).length)updateSharedReportFilters(clientSlug,missing);
}
