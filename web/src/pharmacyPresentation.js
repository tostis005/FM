// La simplificación visual depende del ámbito autorizado, nunca de las filas
// devueltas por la página o del filtro actual de una tabla paginada.
export function availablePharmacies(pharmacies=[]){
 return (Array.isArray(pharmacies)?pharmacies:[]).filter(p=>p&&p.active!==false
  &&p.establishmentType!=="almacen"&&p.tipo_establecimiento!=="almacen");
}
export function hasSinglePharmacy(pharmacies){
 return availablePharmacies(pharmacies).length===1;
}
// No ocultar columnas de origen/destino genéricas: los almacenes pueden
// distinguirse incluso cuando solamente existe una farmacia.
export function isPharmacyColumn(col){
 const label=String(typeof col==="string"?col:col?.label||"").trim().toLocaleLowerCase("es");
 const key=String(typeof col==="string"?"":col?.key||"").trim();
 return /^(farmacia|farmacias)$/.test(label)||
  ["pharmacy","pharmacyName","farmacia"].includes(key)&&!label;
}
