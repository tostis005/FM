// Presentación unificada de importes, unidades y fechas en español.
// Mantener los valores numéricos originales para cálculo, filtrado y exportación.
const currencyFormatter=new Intl.NumberFormat("es-ES",{
 style:"currency",currency:"EUR",useGrouping:true,
 minimumFractionDigits:2,maximumFractionDigits:2
});
const quantityFormatter=new Intl.NumberFormat("es-ES",{
 useGrouping:true,minimumFractionDigits:0,maximumFractionDigits:0
});
const integerFormatter=new Intl.NumberFormat("es-ES",{
 useGrouping:true,minimumFractionDigits:0,maximumFractionDigits:0
});
const decimalFormatter=new Intl.NumberFormat("es-ES",{
 useGrouping:true,minimumFractionDigits:0,maximumFractionDigits:2
});
const percentageFormatter=new Intl.NumberFormat("es-ES",{
 useGrouping:true,minimumFractionDigits:2,maximumFractionDigits:2
});
const isNumber=x=>x!==null&&x!==undefined&&x!==""&&Number.isFinite(Number(x));
export const euro=x=>isNumber(x)?currencyFormatter.format(Number(x)):"—";
export const quantity=x=>isNumber(x)?quantityFormatter.format(Number(x)):"—";
export const integer=x=>isNumber(x)?integerFormatter.format(Number(x)):"—";
export const decimal=x=>isNumber(x)?decimalFormatter.format(Number(x)):"—";
export const percentage=x=>isNumber(x)?percentageFormatter.format(Number(x))+" %":"—";
// Fechas almacenadas como DATE (YYYY-MM-DD) se formatean sin convertir zonas
// horarias: no desplazar el día en América ni Sudáfrica.
export function dateES(input){
 if(input==null||input==="")return "—";
 const value=String(input);
 const m=/^(\d{4})-(\d{2})-(\d{2})(?:$|T| )/.exec(value);
 if(m)return m[3]+"/"+m[2]+"/"+m[1];
 const d=new Date(input);
 return Number.isNaN(d.getTime())?"—":new Intl.DateTimeFormat("es-ES").format(d);
}
export function dateTimeES(input,timeZone){
 if(input==null||input==="")return "—";
 const d=new Date(input);
 return Number.isNaN(d.getTime())?"—":new Intl.DateTimeFormat("es-ES",{
  day:"2-digit",month:"2-digit",year:"numeric",
  hour:"2-digit",minute:"2-digit",timeZone
 }).format(d);
}
