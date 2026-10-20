// La pantalla mantiene "Todo el histórico" desde 1900 como rango lógico,
// pero la consulta real comienza en el primer movimiento sincronizado de
// cada origen y de las farmacias autorizadas. Ventas y compras se resuelven
// por separado; si falla la comprobación nunca se omiten datos del período.
const ISO=/^\d{4}-\d{2}-\d{2}$/;
export async function historyStartDate({from,to,source,pharmacyIds=[],clientSlug,
 signal,cancelledSignal,request=fetch}){
 if(!ISO.test(from)||!ISO.test(to)||from>to||!["ventas","compras"].includes(source))
  return from;
 const params=new URLSearchParams({fuente:source});
 if(pharmacyIds.length)params.set("farmacias",pharmacyIds.join(","));
 try{
  const response=await request("/api/analytics/historico/primera-fecha?"+params,{
   credentials:"same-origin",cache:"no-store",
   headers:{"X-Farmetrica-Cliente":clientSlug},signal
  });
  if(!response.ok)return from;
  const payload=await response.json();
  if(payload?.earliest===null)return to;
  if(!ISO.test(String(payload?.earliest||"")))return from;
  return payload.earliest>to?to:
   payload.earliest>from?payload.earliest:from;
 }catch(error){
  // Agotar el plazo de la comprobación de cobertura no debe impedir que el
  // histórico siga cargando. Solo un cambio de pantalla/filtro cancela todo.
  if((cancelledSignal||signal)?.aborted)throw error;
  return from; // Sin confirmación no se omiten tramos de datos.
 }
}
