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
  const fake="DEMO"+String(ordinal||Number(pharmacy.id)).padStart(2,"0");
  return {...pharmacy,sourceCode:fake,displayCode:fake,
    databaseCode:master,sourceHost:"",sourceDatabase:"",
    name:pharmacy.name};
 }
 const isVal=slug==="ampedia"&&Number(pharmacy.id)===5&&["POL","VAL"].includes(master);
 return {
  ...pharmacy,
  sourceCode:isVal?"POL":master,
  databaseCode:isVal?"VAL":master,
  displayCode:isVal?"POL":master,
  name:isVal?"Valdemarías":pharmacy.name
 };
}
