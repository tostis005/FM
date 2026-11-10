// Catálogo global de operaciones. Las farmacias permanecen asignadas por usuario.
import {USER_SECTIONS} from "./userSectionAccess.js";
export const PROFILE_ACTIONS=["ver","crear","editar","eliminar","importar","exportar"];
export const PROFILE_ROLES=["administrador","gestor","farmacia","colaborador"];
const allowedActions=new Set(PROFILE_ACTIONS);
const sectionsById=new Map(USER_SECTIONS.map(section=>[section.id,section]));

export function profileAllows(permissions,module,operation){
 if(permissions==null)return true; // Cuentas anteriores sin perfil: acceso histórico.
 return Array.isArray(permissions?.[module])&&permissions[module].includes(operation);
}
export function effectiveProfileModules(modules,permissions,superadmin=false){
 if(superadmin||permissions==null)return modules;
 return Object.fromEntries(Object.entries(modules).map(([module,enabled])=>
  [module,enabled&&profileAllows(permissions,module,"ver")]));
}
export function validateProfileDefinition(body,availableModules){
 const name=String(body?.name||"").trim();
 const role=body?.baseRole;
 const allowedModules=new Set(availableModules);
 if(!name||name.length>120||!PROFILE_ROLES.includes(role))return null;
 const normalize=(value,valid,max)=>{
  if(value===null)return null; // Heredar todas las opciones actuales/futuras.
  if(!Array.isArray(value)||value.length>max||value.some(x=>
   typeof x!=="string"||!valid(x))||new Set(value).size!==value.length)return undefined;
  return value;
 };
 const modules=normalize(body?.modules,id=>allowedModules.has(id),100);
 const sections=normalize(body?.sections,id=>sectionsById.has(id),USER_SECTIONS.length);
 if(modules===undefined||sections===undefined)return null;
 if(sections&&modules&&sections.some(id=>!modules.includes(sectionsById.get(id).module)))return null;
 const source=body?.permissions;
 if(!source||typeof source!=="object"||Array.isArray(source))return null;
 const permissions=Object.create(null);
 const keys=Object.keys(source);
 if(keys.length>availableModules.length||keys.some(id=>!allowedModules.has(id)))return null;
 for(const module of keys){
  const operations=source[module];
  if(!Array.isArray(operations)||operations.length>PROFILE_ACTIONS.length||
   operations.some(action=>!allowedActions.has(action))||
   new Set(operations).size!==operations.length||
   (operations.length>0&&!operations.includes("ver")))return null;
  permissions[module]=[...operations];
 }
 // Las opciones invisibles no pueden conceder acciones: un perfil sólo
 // puede gestionar un módulo al que explícitamente da acceso de lectura.
 if(modules&&Object.keys(permissions).some(id=>!modules.includes(id)&&permissions[id].length))return null;
 return {name,baseRole:role,modules,sections,permissions};
}

// Solo las rutas con operaciones administrativas identificables utilizan
// comprobación por operación. El control previo por rol/cliente se conserva.
export function requestProfileOperation(req){
 const path=String(req.path||req.originalUrl?.split("?")[0]||"");
 const method=String(req.method||"GET").toUpperCase();
 if(path.startsWith("/api/tenant/promociones")){
  if(method==="GET")return null;
  if(path.endsWith("/importar")||path.endsWith("/reemplazar"))
   return {module:"promociones",operations:["importar"]};
  if(method==="DELETE"||path.endsWith("/eliminar-lote"))
   return {module:"promociones",operations:["eliminar"]};
  if(path.endsWith("/activar-lote"))
   return {module:"promociones",operations:["editar"]};
  if(method==="PUT")return {module:"promociones",operations:["crear","editar"]};
 }
 if(path.startsWith("/api/tenant/proveedor-documento-categorias")||
    path.startsWith("/api/tenant/proveedores-unificados")){
  if(method==="POST")return {module:"proveedores",operations:["crear"]};
  if(["PUT","PATCH"].includes(method))return {module:"proveedores",operations:["editar"]};
  if(method==="DELETE")return {module:"proveedores",operations:["eliminar"]};
 }
 if(path==="/api/analytics/pedidos/borrador-laboratorio"&&method==="PUT")
  return {module:"compras",operations:["crear","editar"]};
 return null;
}
