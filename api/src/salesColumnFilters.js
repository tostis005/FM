// Contrato estricto para filtros de columnas enviados desde las tablas.
// Se ejecutan sobre TODO el conjunto antes de paginar, nunca sobre las 400 filas.
export const TEXT_SALES_COLUMNS=["cn","name","pvp","saleUnitPrice","purchaseCost",
 "unitMargin","units","value","margin","pharmacy","marginPct"];
export const MULTI_SALES_COLUMNS=["abcdClass","family"];
const allowed=new Set([...TEXT_SALES_COLUMNS,...MULTI_SALES_COLUMNS]);
export function parseSalesColumnFilters(raw){
 if(raw==null||raw==="")return {};
 if(typeof raw!=="string"||raw.length>2400)throw Error("Filtros de columna demasiado largos");
 let data;try{data=JSON.parse(raw)}catch{throw Error("Filtros de columna inválidos")}
 if(!data||Array.isArray(data)||typeof data!=="object")throw Error("Filtros de columna inválidos");
 const result={};
 for(const [field,value] of Object.entries(data)){
  if(!allowed.has(field))throw Error("Campo de filtro no autorizado");
  if(MULTI_SALES_COLUMNS.includes(field)){
   if(!Array.isArray(value)||value.length>30||value.some(x=>typeof x!=="string"||x.length>80))
    throw Error("Selección de filtro inválida");
   if(field==="abcdClass"&&value.some(x=>!["A","B","C","D"].includes(x)))
    throw Error("Clasificación ABCD inválida");
   if(value.length)result[field]=[...new Set(value)];
  }else{
   if(typeof value!=="string"||value.length>100)throw Error("Texto de filtro inválido");
   if(value.trim())result[field]=value.trim();
  }
 }
 return result;
}
export function salesColumnWhereSQL(alias="x",arg="$9",filters={}){
 const text=(key,expr)=>`(NOT (${arg}::jsonb ? '${key}') OR ${expr}::text ILIKE '%'||(${arg}::jsonb->>'${key}')||'%')`;
 const values=[
  text("cn",alias+".cn"),text("name",alias+".name"),
  text("pvp",alias+".pvp"),text("units",alias+".units"),
  text("value",alias+".value"),
  text("saleUnitPrice",`(CASE WHEN ${alias}.units>0 THEN ${alias}.value/${alias}.units ELSE NULL END)`),

  text("pharmacy",`(SELECT f.nombre FROM farmetrica.farmacias f WHERE f.id::text=${alias}."pharmacyId")`),
  `(NOT (${arg}::jsonb ? 'abcdClass') OR ${alias}."abcdClass" IN
    (SELECT jsonb_array_elements_text(${arg}::jsonb->'abcdClass'))`,
  `(NOT (${arg}::jsonb ? 'family') OR ${alias}.family IN
    (SELECT jsonb_array_elements_text(${arg}::jsonb->'family'))`
 ];
 for(const [field,expression] of Object.entries({
  purchaseCost:alias+'."globalPurchaseCost"',unitMargin:alias+'."globalUnitMargin"',
  margin:alias+'."globalMargin"',marginPct:alias+'."globalMarginPct"'
 })){if(filters[field])values.push(text(field,expression))}
 return values.join(" AND ");
}
export function salesCacheColumnWhereSQL(alias="i",arg="$8"){
 // Las columnas persistidas son las mismas que devuelve la consulta viva.
 const j=(key)=>`${alias}.detalle->>'${key}'`;
 const text=key=>`(NOT (${arg}::jsonb ? '${key}') OR ${j(key)} ILIKE '%'||(${arg}::jsonb->>'${key}')||'%')`;
 return [...TEXT_SALES_COLUMNS.map(key=>key==="pharmacy"?
  `(NOT (${arg}::jsonb ? 'pharmacy') OR f.nombre ILIKE '%'||(${arg}::jsonb->>'pharmacy')||'%')`:text(key)),
  `(NOT (${arg}::jsonb ? 'abcdClass') OR ${j("abcdClass")} IN
    (SELECT jsonb_array_elements_text(${arg}::jsonb->'abcdClass'))`,
  `(NOT (${arg}::jsonb ? 'family') OR ${j("family")} IN
    (SELECT jsonb_array_elements_text(${arg}::jsonb->'family'))`].join(" AND ");
}
