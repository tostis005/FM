// Catálogo autorizado del menú SPA. Cada ruta tiene un módulo de plan y
// una asignación individual opcional. NULL en BD hereda los permisos históricos.
export const USER_SECTIONS=[
 ["dashboard","Inicio","dashboard"],
 ["ventas","Ventas (resumen)","ventas"],
 ["ventas-tickets","Tickets","ventas"],
 ["ventas-devoluciones","Devoluciones y anulaciones","ventas"],
 ["compras","Compras (resumen)","compras"],
 ["compras-recepciones","Recepciones completas","compras"],
 ["compras-preparador","Preparador de pedidos","compras"],
 ["compras-pendientes","Pendientes de asignar","compras"],
 ["compras-pedidos","Pedidos preparados","compras"],
 ["compras-devoluciones","Devoluciones a proveedores","compras"],
 ["reposicion","Reposición","reposicion"],
 ["stock","Stock (resumen)","stock"],
 ["stock-historico","Histórico de stock","stock"],
 ["stock-sin-recepciones","Stock sin recepciones","stock"],
 ["stock-traspasos","Traspasos entre farmacias","stock"],
 ["productos","Productos","stock"],
 ["proveedores","Proveedores (resumen)","proveedores"],
 ["proveedores-condiciones","Análisis de proveedores","proveedores"],
 ["genericos","Genéricos","genericos"],
 ["rentabilidad","Rentabilidad (resumen)","rentabilidad"],
 ["rentabilidad-segmentos","Por familia","rentabilidad"],
 ["rentabilidad-retorno","Retorno económico","rentabilidad"],
 ["informes","Informes","informes"],
 ["promociones","Promociones","promociones"],
 ["seguimiento-global","Seguimiento de promociones","promociones"],
 ["acciones","Oportunidades","acciones"],
 ["oportunidades-seguimiento","Seguimiento de oportunidades","acciones"],
 ["alertas","Alertas","acciones"],
 ["mi-trabajo","Mi trabajo","acciones"]
].map(([id,name,module])=>({id,name,module}));
const byId=new Map(USER_SECTIONS.map(s=>[s.id,s]));
export function effectiveUserSections(modules,selected,superadmin=false){
 const grants=Array.isArray(selected)?new Set(selected):null;
 return Object.fromEntries(USER_SECTIONS.map(s=>[s.id,
  Boolean(modules?.[s.module])&&(superadmin||grants===null||grants.has(s.id))]));
}
export function validateSectionGrants(sections,modules){
 if(!Array.isArray(sections)||sections.length>USER_SECTIONS.length)return null;
 const result=new Set();
 for(const id of sections){
  const section=byId.get(id);
  if(!section||!modules?.[section.module]||result.has(id))return null;
  result.add(id);
 }
 return [...result];
}
export function requestSections(req){
 const path=String(req.path||req.originalUrl?.split("?")[0]||"");
 const screen=path.match(/^\/api\/analytics\/pantallas\/([^/]+)/)?.[1];
 if(screen&&byId.has(screen))return [screen];
 if(path.startsWith("/api/analytics/stock/sin-recepciones"))return ["stock-sin-recepciones"];
 if(path.startsWith("/api/analytics/stock/traspasos"))return ["stock-traspasos"];
 return [];
}
