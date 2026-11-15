// Las demos comparten vistas ERP de solo lectura. Algunos informes utilizan
// POST para enviar miles de CN, pero NO escriben en PostgreSQL.
// Lista blanca cerrada: las rutas de guardado/exportación/cambio de estado
// siguen vetadas y jamás se autoriza un prefijo o ruta genérica.
const DEMO_READONLY_POST_ROUTES=new Set([
 "/analytics/pedidos/matriz-conjunta",
 "/analytics/pedidos/matriz-referencias",
 "/analytics/pedidos/laboratorios"
]);
export function demoRequestIsReadOnly(method,path){
 if(["GET","HEAD","OPTIONS"].includes(method))return true;
 return method==="POST"&&DEMO_READONLY_POST_ROUTES.has(path);
}
