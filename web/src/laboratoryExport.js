import {isValidCN} from "./cns.js";
import {eligiblePromotionLines} from "./promotionTicketRules.js";
import {ticketLineAmounts} from "./ticketLineAmounts.js";

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
export async function readFullLabSales(promo,loadTicketLines,onProgress=()=>{},{
 pharmacyIds=null,includeWarehouses=false
}={}){
  const selected=pharmacyIds===null?null:[...new Set(pharmacyIds.map(String))];
  if(selected!==null&&(!selected.length||selected.some(id=>!/^[1-9]\d{0,5}$/.test(id))))
    throw new Error("Selecciona farmacias válidas antes de exportar");
  validateLabPromotion(promo);
  const rows=[];
  const filters={cns:promo.cns,start:promo.start,end:promo.end,
    ...(selected===null?{}:{columnFilters:{pharmacy:selected}}),
    orderBy:"at",orderDir:"asc",...(includeWarehouses?{includeWarehouses:true}:{})};
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

// La exportación real conserva TODOS los CN vendidos, incluso si no alcanzaron
// el lote. Una línea con 4 unidades en un 3x2 se divide en 3 promocionadas
// y 1 sin promoción para no sombrear ni atribuir unidades de más.
const round2=value=>Math.round((value+Number.EPSILON)*100)/100;
export function classifyRealPromotionLines(promo,original){
 const indexed=original.map((line,index)=>({...line,__promotionSourceIndex:index}));
 const eligible=eligiblePromotionLines(promo,indexed,{simulate:false});
 const eligibleByIndex=new Map();
 for(const row of eligible){
  const index=row.__promotionSourceIndex;
  eligibleByIndex.set(index,(eligibleByIndex.get(index)||0)+(Number(row.quantity)||0));
 }
 return original.flatMap((line,index)=>{
  const quantity=Number(line.quantity);
  const included=Math.max(0,Math.min(quantity,eligibleByIndex.get(index)||0));
  if(!Number.isFinite(quantity)||quantity<=0||included===0)
   return [{...line,inPromotion:false}];
  if(included===quantity)return [{...line,inPromotion:true}];
  const amounts=ticketLineAmounts(line,{absolute:true});
  const scaled=(value,part)=>value===null?null:round2(value*part/quantity);
  const soldAmount={gross:scaled(amounts.gross,included),
   lineDiscount:scaled(amounts.lineDiscount,included),
   net:scaled(amounts.net,included)};
  const restAmount={gross:amounts.gross===null?null:round2(amounts.gross-soldAmount.gross),
   lineDiscount:amounts.lineDiscount===null?null:round2(amounts.lineDiscount-soldAmount.lineDiscount),
   net:amounts.net===null?null:round2(amounts.net-soldAmount.net)};
  return [
   {...line,...soldAmount,quantity:included,inPromotion:true},
   {...line,...restAmount,quantity:quantity-included,inPromotion:false}
  ];
 });
}

// Mismo ámbito de fechas y CN; en el modo real se añaden también las ventas
// que no forman promociones, pero la simulación sigue aplicándose solo a lotes.
export async function preparePromotionLabExport(promo,loadTicketLines,{
 pharmacyIds,warehouseIds=[],mode="real",onProgress=()=>{}
}={}){
 if(!["real","simulated"].includes(mode))throw new Error("Modo de exportación no válido");
 const selectedIds=[...new Set([...(pharmacyIds||[]),...warehouseIds].map(String))];
 const original=await readFullLabSales(promo,loadTicketLines,onProgress,{
  pharmacyIds:selectedIds,includeWarehouses:warehouseIds.length>0
 });
 return mode==="real"?classifyRealPromotionLines(promo,original):
  eligiblePromotionLines(promo,original,{simulate:true});
}
