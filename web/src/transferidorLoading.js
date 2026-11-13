// Mantener el bloqueo visual hasta la primera propuesta de la consulta actual.
// Después, actualizar KPIs y filas sin volver a superponer el spinner.
const ACTIVE=new Set(["queued","inventory","calculating"]);
export const transferidorCalculating=status=>ACTIVE.has(status);
export function transferidorWaitingForFirstRows(data,error=""){
 if(error)return false;
 if(!data)return true;
 return transferidorCalculating(data.status)&&!(Array.isArray(data.rows)&&data.rows.length>0);
}
