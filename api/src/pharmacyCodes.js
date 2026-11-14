// Correspondencia de códigos de farmacia sin alterar maestros ni movimientos.
// sourceCode (maestro/UI) = POL; databaseCode (sincronizador ERP) = VAL.
// Diseñada por cliente y farmacia: otro tenant con id 5 NO hereda el alias.
export function pharmacyDataCodeSQL(alias="f"){
 if(!/^[a-z][a-z0-9_]*$/.test(alias))throw Error("Alias SQL inválido");
 return `(CASE WHEN ${alias}.cliente_slug='ampedia' AND ${alias}.id=5
   AND upper(btrim(${alias}.codigo_origen)) IN ('POL','VAL') THEN 'VAL'
   ELSE upper(btrim(${alias}.codigo_origen)) END)`;
}
export function decoratePharmacy(slug,pharmacy,{demo=false,ordinal=0}={}){
 const master=String(pharmacy.sourceCode||"").trim().toUpperCase();
 if(demo){
  const fallback="DEM"+String(ordinal||Number(pharmacy.id)).padStart(2,"0");
  const configured=String(pharmacy.displayCode||"").trim().toUpperCase();
  const visible=/^[A-Z0-9_-]{2,8}$/.test(configured)?configured:fallback;
  return {...pharmacy,sourceCode:visible,displayCode:visible,
    databaseCode:master,sourceHost:"",sourceDatabase:"",
    name:pharmacy.name};
 }
 const visible=String(pharmacy.displayCode||"").trim().toUpperCase();
 const isVal=slug==="ampedia"&&Number(pharmacy.id)===5&&["POL","VAL"].includes(master);
 return {
  ...pharmacy,
  sourceCode:isVal?"POL":master,
  databaseCode:isVal?"VAL":master,
  displayCode:visible||(master==="ALMACEN"?"ALM":isVal?"POL":master),
  name:pharmacy.name
 };
}
