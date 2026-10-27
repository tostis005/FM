// Copia explícita de autorizaciones entre dos cuentas del mismo cliente.
// No se transfieren identidad, método de acceso, contraseña ni estado de activación.
export function copyUserPermissions(source,target,{
 modules=[],sections=[],grantableModules=[],grantableSections=[],
 pharmacies=[],allowedRoles=["administrador","gestor","farmacia","colaborador"]
}={}){
 if(!source||!target||!source.email||String(source.email).toLowerCase()===String(target.email||"").toLowerCase())
  throw Error("Selecciona otro usuario existente como origen de los permisos.");
 if(!allowedRoles.includes(source.role))
  throw Error("Tu perfil no puede asignar el rol del usuario de origen.");
 const existingModules=new Set(modules.map(m=>m.id));
 const sourceModules=Array.isArray(source.modules)?source.modules:modules.map(m=>m.id);
 const selectedModules=[...new Set(sourceModules.filter(id=>existingModules.has(id)))];
 const permittedModules=new Set(grantableModules);
 if(selectedModules.some(id=>!permittedModules.has(id)))
  throw Error("El usuario de origen tiene módulos que no puedes conceder.");
 const enabledSections=sections.filter(s=>selectedModules.includes(s.module));
 const validSections=new Set(enabledSections.map(s=>s.id));
 const sourceSections=Array.isArray(source.sections)?source.sections:enabledSections.map(s=>s.id);
 const selectedSections=[...new Set(sourceSections.filter(id=>validSections.has(id)))];
 const permittedSections=new Set(grantableSections);
 if(selectedSections.some(id=>!permittedSections.has(id)))
  throw Error("El usuario de origen tiene subsecciones que no puedes conceder.");
 const existingPharmacies=new Set(pharmacies.map(p=>String(p.id)));
 const selectedPharmacies=[...new Set((source.pharmacies||[]).map(String))];
 if(selectedPharmacies.some(id=>!existingPharmacies.has(id)))
  throw Error("No puedes copiar farmacias que estén fuera de tu ámbito.");
 return {...target,role:source.role,pharmacies:selectedPharmacies,
  modules:selectedModules,sections:selectedSections};
}
