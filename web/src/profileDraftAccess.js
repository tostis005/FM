// Una selección explícita del módulo implica permiso de lectura: sin "ver" el
// backend lo desactiva aunque el módulo y su pantalla estén marcados.
export function withModuleView(permissions={},module){
 const actions=Array.isArray(permissions?.[module])?permissions[module]:[];
 return {...permissions,[module]:["ver",...actions.filter(action=>action!=="ver")]};
}

export function normalizeExplicitModuleViews(profile,editableModuleIds=null){
 if(!Array.isArray(profile?.modules))return profile;
 const editable=Array.isArray(editableModuleIds)?new Set(editableModuleIds):null;
 let permissions=profile.permissions||{};
 for(const module of profile.modules){
  // No alterar permisos históricos de módulos ocultos/desactivados del cliente.
  if((!editable||editable.has(module))&&!permissions[module]?.includes("ver"))
   permissions=withModuleView(permissions,module);
 }
 return {...profile,permissions};
}
