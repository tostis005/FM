// Los filtros de columna de los informes se ejecutan ANTES del LIMIT SQL.
// No filtrar 3.000 filas en el navegador ni aceptar SQL del navegador.
export const REPORT_FILTER_COLUMNS={
 compras:["cn","name","pharmacy","supplier","units","pvp","puc","value","lines"],
 proveedores:["name","pharmacy","products","units","value"],
 stock:["cn","name","pharmacy","family","pvp","units","unitCost","value"],
 reposicion:["cn","name","pharmacy","family","pvp","units","unitCost"],
 dashboard:["cn","name","pharmacy","family","pvp","units","value","saleUnitPrice"],
 rentabilidad:["cn","name","pharmacy","family","pvp","units","value","saleUnitPrice"],
 informes:["cn","name","pharmacy","family","pvp","units","value","saleUnitPrice"],
 asistente:["cn","name","pharmacy","family","pvp","units","value","saleUnitPrice"],
 acciones:[]
};
const CATEGORIES=new Set(["pharmacy","family"]);
export function parseReportColumnFilters(raw,module){
 if(raw==null||raw==="")return {};
 if(typeof raw!=="string"||raw.length>2400)throw Error("Filtros de tabla demasiado extensos");
 let value;try{value=JSON.parse(raw)}catch{throw Error("Filtros de tabla inválidos")}
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Filtros de tabla inválidos");
 const allowed=REPORT_FILTER_COLUMNS[module]||[];
 const parsed={};
 for(const [key,item] of Object.entries(value)){
  if(!allowed.includes(key))throw Error("La columna no admite filtro global: "+key);
  if(CATEGORIES.has(key)){
   if(!Array.isArray(item)||item.length>30||
      item.some(i=>typeof i!=="string"||i.length>80))throw Error("Categoría inválida");
   if(item.length)parsed[key]=[...new Set(item)];
  }else{
   if(typeof item!=="string"||item.length>100)throw Error("Texto de columna inválido");
   if(item.trim())parsed[key]=item.trim();
  }
 }
 return parsed;
}
const field=(name,source)=>{
 const cols={
  cn:'q.cn',name:'q.name',family:'q.family',pvp:'q.pvp',
  units:'q.units',value:'q.value',products:'q.products',lines:'q.lines',
  supplier:'q.supplier',saleUnitPrice:'(q.value/NULLIF(q.units,0))',
  puc:'(q.cost/NULLIF(q."pricedUnits",0))',
  unitCost:`(CASE WHEN q."unpricedItems"=0 AND q.units<>0
    THEN q."stockValue"/q.units WHEN q.pmc>0 THEN q.pmc ELSE NULL END)`
 };
 if(name==="value"&&["articulos","stock","instantanea"].includes(source))
  return `(CASE WHEN q."unpricedItems"=0 THEN q."stockValue" ELSE NULL END)`;
 if(name==="pharmacy")return `(SELECT fm.nombre FROM farmetrica.farmacias fm
   WHERE fm.id::text=q."pharmacyId")`;
 if(name==="pvp"&&source==="instantanea")return "NULL::float8";
 return cols[name];
};
export function wrapReportTableSQL(sql,filters,{module,source="",argPosition,sortKey="value",
 sortDir="desc"}){
 if(!Object.keys(filters).length)return sql;
 if(!["asc","desc"].includes(sortDir))throw Error("Orden no válido");
 const end=sql.lastIndexOf(" LIMIT ");
 const order=sql.lastIndexOf(" ORDER BY ");
 if(end<0||order<0||order>end)throw Error("SQL base sin ordenación y límite reconocibles");
 const limit=Number(sql.slice(end+7).trim());
 if(!Number.isSafeInteger(limit)||limit<1||limit>10000)throw Error("Límite SQL inválido");
 const base=sql.slice(0,order).trim();
 const arg="$"+argPosition+"::jsonb";
 const predicates=[];
 for(const [key,item] of Object.entries(filters)){
  const expression=field(key,source);
  if(!expression)throw Error("Campo SQL no válido: "+key);
  if(CATEGORIES.has(key))predicates.push(`${expression} IN
    (SELECT jsonb_array_elements_text(${arg}->'${key}'))`);
  else predicates.push(`${expression}::text ILIKE '%'||(${arg}->>'${key}')||'%'`);
 }
 const tie=module==="proveedores"?'q."providerId"':"q.cn";
 // El orden global debe aplicarse a las filas YA filtradas, no a las 3.000
 // primeras de la consulta original.
 const orderExpression=field(sortKey,source)||
   (["articulos","stock","instantanea"].includes(source)?"q.units":"q.value");
 const sort=orderExpression==="NULL::float8"?"q.units":orderExpression;
 return `SELECT q.*,count(*) OVER()::int AS "__totalFiltered"
  FROM (${base}) AS q
  WHERE ${predicates.join(" AND ")}
  ORDER BY ${sort} ${sortDir.toUpperCase()} NULLS LAST,
    q."pharmacyId",${tie}
  LIMIT ${limit}`;
}
