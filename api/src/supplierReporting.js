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
export function sourceSupplierRows(master,external){
 const map=new Map();
 for(const row of external||[]){
  const key=String(row.sourceCode||"").trim().toUpperCase();
  if(key)map.set(key,{id:null,sourceCode:key,name:String(row.name||key),
   type:"sin_clasificar",active:true,cooperative:false,ignoreReports:false,fromSync:true});
 }
 for(const row of master||[]){
  const key=String(row.sourceCode||"").trim().toUpperCase();
  if(key)map.set(key,{...map.get(key),...row,sourceCode:key,cooperative:Boolean(row.cooperative),
   ignoreReports:Boolean(row.ignoreReports)});
 }
 return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name,"es"));
}
