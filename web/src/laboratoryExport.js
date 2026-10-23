import {isValidCN} from "./cns.js";

export const LAB_EXPORT_PAGE_SIZE=500;
export const LAB_EXPORT_MAX_LINES=50000;
const validDate=value=>/^20\d\d-\d\d-\d\d$/.test(String(value||""));

export function validateLabPromotion(promo){
  if(!promo || !Array.isArray(promo.cns)||!promo.cns.length)
    throw new Error("La campaña "+(promo?.name||"seleccionada")+" no tiene CNs asociados.");
  if(promo.cns.some(cn=>!isValidCN(cn)))
    throw new Error("La campaña "+promo.name+" contiene CNs no válidos.");
  if(promo.cns.length>500)
    throw new Error("La campaña "+promo.name+" supera el máximo de 500 CNs por consulta.");
  if(!validDate(promo.start)||!validDate(promo.end)||promo.start>promo.end)
    throw new Error("Revisa las fechas de la campaña "+promo.name+" antes de exportarla.");
}
export async function readFullLabSales(promo,loadTicketLines,onProgress=()=>{},{pharmacyIds=null}={}){
  const selected=pharmacyIds===null?null:[...new Set(pharmacyIds.map(String))];
  if(selected!==null&&(!selected.length||selected.some(id=>!/^[1-9]\d{0,5}$/.test(id))))
    throw new Error("Selecciona farmacias válidas antes de exportar");
  validateLabPromotion(promo);
  const rows=[];
  const filters={cns:promo.cns,start:promo.start,end:promo.end,
    ...(selected===null?{}:{columnFilters:{pharmacy:selected}}),
    orderBy:"at",orderDir:"asc"};
  let expected=null;
  for(let offset=0;offset<LAB_EXPORT_MAX_LINES;offset+=LAB_EXPORT_PAGE_SIZE){
    const response=await loadTicketLines({...filters,offset,limit:LAB_EXPORT_PAGE_SIZE});
    const total=Number(response?.total);
    if(!Number.isSafeInteger(total)||total<0||!Array.isArray(response.rows))
      throw new Error("Respuesta de ventas no válida para "+promo.name);
    if(expected===null){
      expected=total;
      if(total>LAB_EXPORT_MAX_LINES)
        throw new Error("La promoción "+promo.name+" tiene "+total+
          " líneas (límite "+LAB_EXPORT_MAX_LINES+"). Reduce el periodo de la campaña antes de exportar.");
    }else if(expected!==total){
      throw new Error("Las ventas de "+promo.name+" han cambiado durante la exportación. Vuelve a intentarlo.");
    }
    if(selected!==null&&response.rows.some(row=>!selected.includes(String(row.pharmacyId))))
      throw new Error("El servidor ha devuelto datos de farmacias no seleccionadas");
    if(response.rows.length>LAB_EXPORT_PAGE_SIZE || rows.length+response.rows.length>expected)
      throw new Error("El servidor ha devuelto una página incorrecta para "+promo.name);
    rows.push(...response.rows);
    onProgress(promo,rows.length,expected);
    if(rows.length===expected)return rows;
    if(!response.rows.length)throw new Error("Faltan registros al exportar "+promo.name);
  }
  throw new Error("No se pudo descargar la totalidad de ventas de "+promo.name);
}
