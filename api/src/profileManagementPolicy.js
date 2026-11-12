import {profileAllows} from "./profilePolicy.js";
import {USER_SECTIONS} from "./userSectionAccess.js";

const sections=new Map(USER_SECTIONS.map(s=>[s.id,s.module]));

// La definición es global. Los gestores de un cliente nunca pueden cambiar
// un perfil que se use en otro cliente ni elevar sus propios privilegios.
export function canManageProfileRole(role,baseRole){
 if(role==="superadministrador")return true;
 if(role==="administrador")return baseRole!=="administrador";
 return role==="gestor"&&["farmacia","colaborador"].includes(baseRole);
}

export function canEditGlobalProfile(context,profile){
 if(!canManageProfileRole(context?.role,profile?.baseRole))return false;
 if(context?.role==="superadministrador")return true;
 return !profile?.usedOtherClient;
}

export function profileWithinManagerScope(context,value,previous=null){
 if(context?.role==="superadministrador")return true;
 if(!canManageProfileRole(context?.role,value?.baseRole))return false;
 // Sin herencia abierta: nunca conceder acceso futuro por encima del gestor.
 if(!Array.isArray(value?.modules)||!Array.isArray(value?.sections))return false;
 const previousModules=new Set(Array.isArray(previous?.modules)?previous.modules:[]);
 const previousSections=new Set(Array.isArray(previous?.sections)?previous.sections:[]);
 // Un módulo deshabilitado por el cliente puede seguir almacenado en un
 // perfil histórico; permitir conservarlo, nunca concederlo de nuevo.
 if(value.modules.some(id=>context?.modules?.[id]!==true&&!previousModules.has(id)))return false;
 if(value.sections.some(id=>!value.modules.includes(sections.get(id))||
  (context?.sections?.[id]!==true&&!previousSections.has(id))))return false;
 return Object.entries(value?.permissions||{}).every(([module,operations])=>
  !operations.length||(value.modules.includes(module)&&operations.every(op=>
   (context?.modules?.[module]===true&&
    profileAllows(context.profilePermissions,module,op))||
   (previousModules.has(module)&&
    Array.isArray(previous?.permissions?.[module])&&
    previous.permissions[module].includes(op)))));
}
