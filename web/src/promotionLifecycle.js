// Vigencia civil de campañas. No se asignan revisiones ni caducidades
// artificiales a las campañas hasta agotar stock o sin fecha de fin heredadas.
const DAY=/^\d{4}-\d{2}-\d{2}$/;
export function civilToday(now=new Date(),timeZone="Europe/Madrid"){
 const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{
  timeZone,year:"numeric",month:"2-digit",day:"2-digit"
 }).formatToParts(now).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
 return [parts.year,parts.month,parts.day].join("-");
}
export function promotionDurationMode(p){
 if(p?.durationMode==="stock"||p?.durationMode==="dates")return p.durationMode;
 // Compatibilidad con Excel histórico: no reinterpretar una fecha ausente
 // como stock salvo que el propio texto importado indique agotamiento.
 return /agot(?:ar|amiento|ad[ao]s?)|existencias|stock/i.test(String(p?.endRaw||""))?
  "stock":"dates";
}
// El estado es una decisión de PUBLICACIÓN, no un cálculo de vigencia.
// - Borrador: privado de gestores y administradores autorizados.
// - Activa: publicada y visible para las farmacias participantes incluso
//   antes de su fecha de inicio y después de su fecha fin (hasta archivarla).
// - Finalizada: archivada de forma explícita.
// Las fechas solo delimitan las ventas consultadas y las reglas comerciales.
export function effectivePromotionStatus(p,_now=new Date(),_timeZone="Europe/Madrid"){
 if(p?.closedAt||p?.closedOn)return "Finalizada";
 if(p?.status==="Activa"||p?.status==="Finalizada")return p.status;
 return "Borrador";
}
// Límite de lectura SQL para campañas abiertas: hoy, nunca una fecha inventada.
export function promotionReportingEnd(p,now=new Date(),timeZone="Europe/Madrid"){
 if(!DAY.test(p.start||""))return "";
 const today=civilToday(now,timeZone);
 if(DAY.test(p.closedOn||""))return p.closedOn<today?p.closedOn:today;
 if(DAY.test(p.end||""))return p.end;
 return today;
}

/** Los cambios de publicación siempre los decide una persona.
 * Conservar el origen anterior si solo se editan campos descriptivos. */
export function promotionStatusSourceOnSave(original,form){
 if(!original||form.status!==effectivePromotionStatus(original))return "manual";
 return original.statusSource||"manual";
}
