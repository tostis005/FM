// Propuesta para compras conjuntas, SIN partición por farmacia.
// Cada CN cuenta una sola vez entre todo el cliente.
export function suggestedFrequency(uniqueCN){
 const n=Number(uniqueCN);
 if(!Number.isSafeInteger(n)||n<0)throw Error("Recuento de CN inválido");
 if(n>=500)return 4;
 if(n>=250)return 7;
 if(n>=120)return 14;
 return null; // bajo demanda: no se almacena una frecuencia
}
export const excludedNonLaboratoryName=name=>
 /(?:AMPEDIA NUEVA|FARMAMODA|ORTOPEDIA|FARMACIAS?|COOPERATIV|MAYORISTA|DISTRIBUIDOR|COMERCIAL CARAI|LIMPIEZA|SERVICIOS INFORMATICOS)/i.test(String(name||""));
export function planGlobalFrequencies(rows){
 return rows.map(r=>({...r,cn:Number(r.cn),suggested:excludedNonLaboratoryName(r.name)?
  null:suggestedFrequency(Number(r.cn)),excluded:excludedNonLaboratoryName(r.name)}));
}
