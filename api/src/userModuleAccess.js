// Permisos efectivos: nunca supera lo contratado/habilitado para el cliente.
// null/undefined permite mantener los accesos históricos sin revocar usuarios
// hasta que el administrador configure sus permisos individuales.
export function effectiveUserModules(clientModules,selected,superadmin=false){
 const grants=Array.isArray(selected)?new Set(selected):null;
 return Object.fromEntries((clientModules||[]).map(row=>
  [row.id,Boolean(row.enabled)&&(superadmin||grants===null||grants.has(row.id))]));
}
export function validateModuleGrants(modules,available,limit=null){
 if(!Array.isArray(modules)||modules.length>100)return null;
 const permitted=new Set((available||[]).filter(m=>m.enabled).map(m=>m.id));
 const canDelegate=limit===null?permitted:new Set(limit);
 const result=new Set();
 for(const m of modules){
  if(typeof m!=="string"||!permitted.has(m)||!canDelegate.has(m)||result.has(m))return null;
  result.add(m);
 }
 return [...result];
}
// Algunos endpoints reutilizan requireTenant() sin guard de módulo propio;
// este mapa evita que el usuario pueda abrir su información por URL directa.
export function requestModules(req){
 const path=String(req.path||req.originalUrl?.split("?")[0]||"");
 const section=path.startsWith("/api/analytics/pantallas/")?
  path.split("/")[4]:null;
 if(section){
  const prefix=section.split("-")[0];
  return [{compras:"compras",ventas:"ventas",stock:"stock",proveedores:"proveedores",
   rentabilidad:"rentabilidad",productos:"stock"}[prefix]||"informes"];
 }
 if(path==="/api/analytics/reportes"||path==="/api/analytics/reportes/opciones")
  return [String(req.query?.modulo||"dashboard")];
 if(path.startsWith("/api/analytics/ventas/")||path==="/api/analytics/ventas")
  return ["ventas","dashboard"];
 if(path.startsWith("/api/analytics/compras/")||path.startsWith("/api/analytics/pedidos/"))
  return ["compras"];
 if(path.startsWith("/api/analytics/catalogos/proveedores"))
  return ["compras","proveedores"];
 if(path.startsWith("/api/asistente/"))return ["asistente"];
 if(path.startsWith("/api/genericos/"))return ["genericos"];
 if(path.startsWith("/api/ventas/sincronizacion"))return ["ventas","dashboard"];
 if(path.startsWith("/api/tenant/proveedores/"))return ["proveedores"];
 if(path.startsWith("/api/tenant/stock-objetivo"))return ["stock","reposicion","compras"];
 return [];
}
