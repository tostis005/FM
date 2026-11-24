import {readSettingsSection,settingsSectionUrl} from "./settingsSections.js";

// Single route manifest for the sidebar and the upper navigation. Route IDs
// retain their existing authorization checks; groups never grant permissions.
export const SETTINGS_VIEWS=["general","compras","transferidor","genericos","picking-list"];
export const PROFIT_VIEWS={"rentabilidad":"resumen","rentabilidad-categorias":"productos","rentabilidad-detalle-ventas":"ventas"};
export const WORK_VIEWS={"acciones":"oportunidades-seguimiento","oportunidades-seguimiento":"oportunidades-seguimiento","mi-trabajo":"mi-trabajo","alertas":"alertas","rentabilidad-retorno":"rentabilidad-retorno","resumen-email":"resumen-email"};
export const NAVIGATION_GROUPS=[
 {id:"dashboard",label:"Inicio",tabs:[["dashboard","Inicio"]]},
 {id:"ventas",label:"Ventas",tabs:[["ventas","Resumen de ventas"],["ventas-tickets","Tickets"],["ventas-devoluciones","Devoluciones y anulaciones"],["ventas-laboratorios","Análisis por laboratorio"]]},
 {id:"compras",label:"Compras",tabs:[["compras","Resumen"],["compras-preparador","Preparador de pedidos"],["compras-historial","Historial de pedidos"],["compras-recepciones","Recepciones completas"],["compras-pendientes","Pendientes de asignar"],["compras-pedidos","Pedidos preparados"],["reposicion","Reposición"],["compras-devoluciones","Devoluciones a proveedores"]]},
 {id:"stock",label:"Stock",tabs:[["stock","Resumen"],["stock-consulta","Consulta de stocks"],["stock-historico","Histórico de stock"],["stock-sin-recepciones","Stock sin recepciones"],["stock-inmovilizado","Stock inmovilizado"],["stock-transferidor","Transferidor"],["stock-traspasos","Traspasos entre farmacias"],["picking-list","Picking List"],["productos","Productos"]]},
 {id:"proveedores",label:"Proveedores",tabs:[["proveedores","Proveedores"]]},
 {id:"genericos",label:"Genéricos",tabs:[["genericos","Genéricos"]]},
 {id:"rentabilidad",label:"Rentabilidad",tabs:[["rentabilidad","Resumen"],["rentabilidad-categorias","Productos y categorías"],["rentabilidad-detalle-ventas","Detalle de ventas"],["rentabilidad-segmentos","Por familia"],["informes","Informes"]]},
 {id:"promociones",label:"Promociones",tabs:[["promociones","Promociones"],["seguimiento-global","Seguimiento"],["promociones-objetivos","Nueva campaña"]]},
 {id:"acciones",label:"Trabajo y ahorro",tabs:[["acciones","Oportunidades"],["mi-trabajo","Mis tareas"],["alertas","Alertas"],["rentabilidad-retorno","Ahorro verificado"],["resumen-email","Correos"],["alertas-inteligentes","Alertas inteligentes"]]},
 {id:"configuracion",label:"Configuración",tabs:[["farmacias","Farmacias"],["usuarios","Usuarios"],["perfiles","Perfiles"],["familias-maestro","Maestro de familias"],["estado","Estado"],["ajustes","Ajustes"],["ajustes-general","General"],["ajustes-compras","Ajustes de compras"],["ajustes-transferidor","Ajustes del transferidor"],["ajustes-genericos","Política de precios"],["ajustes-picking-list","Ajustes Picking List"]]},
 {id:"administracion",label:"Administración",tabs:[["clientes","Clientes"],["fuentes","Fuentes de datos"],["solicitudes","Solicitudes"],["accesos","Accesos"],["auditoria","Auditoría"]]}
];
export const canonicalTab=page=>page==="oportunidades-seguimiento"?"acciones":page;
export const groupForPage=page=>NAVIGATION_GROUPS.find(g=>g.tabs.some(([id])=>id===canonicalTab(page)))||null;
export const availableTabs=(group,canAccess)=>group.tabs.filter(([id])=>canAccess(id));
export const availableGroups=canAccess=>NAVIGATION_GROUPS.map(group=>({...group,visibleTabs:availableTabs(group,canAccess)})).filter(g=>g.visibleTabs.length);
export const defaultGroupPage=(group,canAccess)=>group?availableTabs(group,canAccess)[0]?.[0]||null:null;
export function settingsViewForPage(page){const view=page.startsWith("ajustes-")?page.slice(8):null;return SETTINGS_VIEWS.includes(view)?view:null;}
export function settingsPageFromSearch(search){const section=readSettingsSection(search);return section?"ajustes-"+section:"ajustes";}
export function navigationUrl(page){
 const settings=settingsViewForPage(page);
 return settings?settingsSectionUrl(settings):page==="seguimiento-global"?"/promociones/seguimiento":page==="promociones-objetivos"?"/promociones/nueva":"/"+page;
}
