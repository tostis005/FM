// Una selección explícita del módulo implica permiso de lectura: sin "ver" el
// backend lo desactiva aunque el módulo y su pantalla estén marcados.
export function withModuleView(permissions={},module){
 const actions=Array.isArray(permissions?.[module])?permissions[module]:[];
 return {...permissions,[module]:["ver",...actions.filter(action=>action!=="ver")]};
}

export function normalizeExplicitModuleViews(profile){
 if(!Array.isArray(profile?.modules))return profile;
 let permissions=profile.permissions||{};
 for(const module of profile.modules){
  if(!permissions[module]?.includes("ver"))permissions=withModuleView(permissions,module);
 }
 return {...profile,permissions};
}
