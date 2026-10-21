// La clave física PostgreSQL permanece estable para proteger las cargas.
export const syncFlowLabel=flow=>{
 const name=String(flow||"").trim().toLowerCase();
 return {ventas_completas:"Ventas",recepciones_completas:"Compras"}[name] ||
   String(flow||"").replaceAll("_"," ");
};
