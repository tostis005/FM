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

export function profileWithinManagerScope(context,value){
 if(context?.role==="superadministrador")return true;
 if(!canManageProfileRole(context?.role,value?.baseRole))return false;
 // Sin asignaciones abiertas: nunca permitir que un tenant asigne permisos
 // futuros aún no incluidos en el alcance de su administrador.
 if(!Array.isArray(value?.modules)||!Array.isArray(value?.sections))return false;
 if(value.modules.some(id=>context?.modules?.[id]!==true))return false;
 if(value.sections.some(id=>context?.sections?.[id]!==true||
  !value.modules.includes(sections.get(id))))return false;
 return Object.entries(value?.permissions||{}).every(([module,operations])=>
  !operations.length||(value.modules.includes(module)&&
   context?.modules?.[module]===true&&operations.every(op=>
    profileAllows(context.profilePermissions,module,op))));
}
