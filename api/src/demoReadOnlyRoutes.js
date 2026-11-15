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
