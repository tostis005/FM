// Período ABCD autorizado por administrador del cliente.
// No permitir que los filtros o las URLs cambien la ventana de análisis.
export const ANALYSIS_MONTHS=[3,6,12,24,36];
const ISO=/^20\d{2}-\d{2}-\d{2}$/;
export function approvedAnalysisMonths(value){
 const n=Number(value??12);
 return ANALYSIS_MONTHS.includes(n)?n:12;
}
export function approvedAnalysisRange(from,to,months){
 if(!ISO.test(String(from||""))||!ISO.test(String(to||""))||from>to)return false;
 const end=new Date(to+"T00:00:00Z");
 const start=new Date(from+"T00:00:00Z");
 if(!Number.isFinite(end.getTime())||!Number.isFinite(start.getTime())||
    end.toISOString().slice(0,10)!==to||start.toISOString().slice(0,10)!==from)return false;
 const expected=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()+1-approvedAnalysisMonths(months),1));
 return expected.toISOString().slice(0,10)===from;
}

// Período de lectura seleccionado por el usuario, independiente de la ventana
// programada de precálculo ABCD. La caché solo sirve si coincide exactamente;
// otros rangos (hoy, mes, personalizado, histórico) se consultan en PostgreSQL.
export function validSalesDateRange(from,to){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(from||""))||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(to||""))||
    from>to||from<"1900-01-01")return false;
 const start=new Date(from+"T00:00:00Z"),end=new Date(to+"T00:00:00Z");
 if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||
    start.toISOString().slice(0,10)!==from||end.toISOString().slice(0,10)!==to)return false;
 const days=(end-start)/86400000;
 // Todo el histórico usa por contrato 1900-01-01. Limitar personalizados
 // a 100 años como hace el selector del navegador.
 return days<=36525||from==="1900-01-01";
}
