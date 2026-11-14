// Un cliente demo puede ocultar farmacias sin borrar ni alterar el origen.
// No cambia el comportamiento histórico de clientes operativos.
export function tenantScopedPharmacyIds(pharmacies,{demo=false,privileged=false,assignedIds=[]}={}){
 if(!Array.isArray(pharmacies))throw new TypeError('Catálogo de farmacias inválido');
 const available=demo?pharmacies.filter(p=>p.active!==false):pharmacies;
 const allowed=new Set(available.map(p=>Number(p.id)).filter(Number.isSafeInteger));
 const ids=privileged?[...allowed]:[...new Set((assignedIds||[]).map(Number))]
  .filter(id=>Number.isSafeInteger(id)&&allowed.has(id));
 return ids;
}
