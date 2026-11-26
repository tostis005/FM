export function promotionWarehouses(role,warehouses=[]){
 return ["gestor","administrador","superadministrador"].includes(role)?warehouses.filter(w=>w.active!==false):[];
}

export function promotionExtractionScope(pharmacyIds,warehouses=[]){
 const selected=[...new Set(pharmacyIds.map(String))], byId=new Map();
 if(selected.length)for(const w of warehouses){
  const id=String(w.id);
  if(w.active!==false&&!selected.includes(id))byId.set(id,{...w,id,name:w.promotionExportName||w.name});
 }
 return {scopeIds:[...selected,...byId.keys()],warehouseNames:Object.fromEntries([...byId].map(([id,w])=>[id,w.name])),warehouses:[...byId.values()],includeWarehouses:byId.size>0};
}

export function nameExtractionRow(row,warehouseNames){
 const id=String(row.pharmacyId);
 return Object.hasOwn(warehouseNames,id)?{...row,pharmacyName:warehouseNames[id]}:row;
}
