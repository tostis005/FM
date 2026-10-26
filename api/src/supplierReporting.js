// Un único contrato SQL para omitir de los reportes compras/recepciones
// de proveedores marcados por el administrador del cliente.
// Las expresiones de columna solo las pasa código servidor, nunca el navegador.
export function includedPurchaseSupplier({tenant,code,name=null}){
 if(!/^\$[1-9]\d*$/.test(tenant))throw Error("Parámetro tenant inválido");
 if(!/^[a-z][\w.]*\.[a-z][\w]*$/.test(code))throw Error("Columna de proveedor inválida");
 if(name!==null&&!/^[a-z][\w.]*\.[a-z][\w]*$/.test(name))throw Error("Nombre de proveedor inválido");
 const normalized=col=>`upper(btrim(coalesce(${col}::text,'')))`;
 return `NOT EXISTS (SELECT 1 FROM farmetrica.proveedores_maestro pm
  WHERE pm.cliente_slug=${tenant} AND pm.ignorar_informes=true
   AND ((nullif(${normalized(code)},'') IS NOT NULL
        AND upper(btrim(pm.codigo_origen))=${normalized(code)})${name?
   ` OR (nullif(${normalized(name)},'') IS NOT NULL
        AND upper(btrim(pm.nombre))=${normalized(name)})`:""}))`;
}
// La clasificación de compras depende exclusivamente del check cooperativa.
 // Los proveedores no marcados, incluidos los sin ficha, son laboratorios.
export function purchaseSupplierChannelSQL(alias="pm"){
 if(!/^[a-z][a-z0-9_]*$/.test(alias))throw Error("Alias SQL de proveedor inválido");
 return `CASE WHEN ${alias}.cooperativa IS TRUE THEN 'cooperativa' ELSE 'laboratorio' END`;
}
// El catálogo de administración conserva TODAS las identidades observadas.
// Un mismo código puede existir en varias farmacias con razones sociales
// distintas: se muestra la colisión y no se atribuyen flags a otra farmacia.
export function sourceSupplierRows(master,external){
 const map=new Map();
 const upper=value=>String(value??"").trim().toUpperCase();
 for(const row of external||[]){
  const code=upper(row.sourceCode),name=String(row.name||"").trim();
  if(!code)continue;
  if(!map.has(code))map.set(code,{
   id:null,sourceCode:code,name:name||code,type:"sin_clasificar",active:true,
   cooperative:false,ignoreReports:false,fromSync:false,fromReceipts:false,
   origins:[]
  });
  const current=map.get(code);
  const source=row.source==="recepciones"?"recepciones":"farmatic";
  current.fromSync ||= source==="farmatic";
  current.fromReceipts ||= source==="recepciones";
  if(current.name===code&&name)current.name=name;
  const pharmacyId=row.pharmacyId==null?null:String(row.pharmacyId);
  if(!current.origins.some(o=>o.pharmacyId===pharmacyId&&o.name===(name||code)&&o.source===source))
   current.origins.push({pharmacyId,name:name||code,source});
 }
 for(const row of master||[]){
  const code=upper(row.sourceCode);
  if(!code)continue;
  const previous=map.get(code)||{origins:[],fromSync:false,fromReceipts:false};
  map.set(code,{...previous,...row,sourceCode:code,
   cooperative:Boolean(row.cooperative),ignoreReports:Boolean(row.ignoreReports)});
 }
 const normalized=value=>upper(value).normalize("NFKD")
  .replace(/[\u0300-\u036f]/g,"").replace(/[^A-Z0-9]+/g," ").trim();
 return [...map.values()].map(row=>{
  const perPharmacy=new Map();
  for(const origin of row.origins||[]){
   if(!origin.pharmacyId||origin.name===row.sourceCode)continue;
   const existing=perPharmacy.get(origin.pharmacyId);
   // El nombre del maestro ERP tiene prioridad sobre la lectura del albarán.
   if(!existing||origin.source==="farmatic")
    perPharmacy.set(origin.pharmacyId,origin);
  }
  const names=new Set([...perPharmacy.values()].map(o=>normalized(o.name)).filter(Boolean));
  return {...row,nameConflict:names.size>1,
   pharmacies:[...new Set((row.origins||[]).map(o=>o.pharmacyId).filter(Boolean))]};
 }).sort((a,b)=>a.name.localeCompare(b.name,"es"));
}
