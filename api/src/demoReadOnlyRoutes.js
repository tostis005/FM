// Solo estas dos rutas POST calculan métricas con SELECT: la interfaz
// necesita un body JSON con las referencias. No son operaciones de escritura.
// Todas las demás peticiones no-GET de un tenant demo siguen prohibidas.
const DEMO_READ_POST_PATHS=new Set([
 "/analytics/pedidos/matriz-conjunta",
 "/analytics/pedidos/matriz-referencias"
]);

export function isDemoReadOnlyPost(method,path){
 return method==="POST" && typeof path==="string" &&
  DEMO_READ_POST_PATHS.has(path);
}

/**
 * Filtro de mutaciones de datos operativos: las demos pueden leer,
 * incluidas dos consultas POST de métricas con cuerpo JSON. Cualquier otra
 * mutación debe seguir pasando por el contexto autenticado y bloquearse.
 * requireTenant autentica el resto de rutas y se vuelve a aplicar en cada
 * endpoint del preparador, incluso en los dos POST exceptuados aquí.
 */
export function demoMutationGuard(requireTenant){
 return (req,res,next)=>{
  if(["GET","HEAD","OPTIONS"].includes(req.method)||
     req.path.startsWith("/public/")||
     isDemoReadOnlyPost(req.method,req.path))return next();
  const test=requireTenant();
  test[0](req,res,error=>{
   if(error)return next(error);
   if(res.headersSent)return;
   test[1](req,res,e=>{
    if(e)return next(e);
    if(res.headersSent)return;
    if(req.context.client.demo)return res.status(403).json({
     error:"Entorno demo de consulta: no se permiten cambios operativos"});
    next();
   });
  });
 };
}
