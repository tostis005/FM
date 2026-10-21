import {readFile} from "node:fs/promises";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
const TEMPLATE=await readFile(new URL("./purchasePlannerPaged.sql",import.meta.url),"utf8");
const FIELD={
 articleName:'g."articleName"',unitsPeriod:'g."unitsPeriod"',
 units3:'g."units3"',units12:'g."units12"',
 stock:'g.stock',suggested:'g.suggested'
};
export async function readPurchasePlannerPaged(pool,ctx,{
 from,to,chosen,search="",sort="suggested",direction="desc",
 page=1,pageSize=50,columnFilters={}
}){
 const schema=ctx.client.schema;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema))throw Error("Esquema de farmacia inválido");
 if(!Object.hasOwn(FIELD,sort))throw Error("Columna de orden desconocida");
 const desc=direction!=="asc";
 const order=sort==="suggested"?
  "g.prioridad DESC,g.suggested "+(desc?"DESC":"ASC")+" NULLS LAST,g.key":
  FIELD[sort]+" "+(desc?"DESC":"ASC")+" NULLS LAST,g.key";
 const sourceCode=pharmacyDataCodeSQL("f");
 const query=TEMPLATE.replaceAll("__SCHEMA__","\""+schema+"\"")
  .replaceAll("__FARMACIA_CODE__",sourceCode)
  .replaceAll("__ORDER__",order);
 const keys=["articleName","stock","unitsPeriod","units3","units12","suggested"];
 const params=[from,to,chosen,ctx.client.slug,String(search||"").trim().toUpperCase(),
  pageSize,(page-1)*pageSize,...keys.map(key=>String(columnFilters[key]||""))];
 const {rows}=await pool.query({text:query,values:params,query_timeout:30000});
 const data=rows[0]||{};
 const summary=data.summary||{};
 return {available:true,from,to,groups:data.groups||[],
  page,pageSize,totalGroups:Number(summary.products||0),summary,
  truncated:false,commitmentsAvailable:true,
  policiesDefaulted:false,
  pharmacies:ctx.pharmacies.filter(f=>chosen.includes(Number(f.id)))
   .map(f=>({id:f.id,name:f.name})),
  note:"El grupo usa el CN común, con genéricos equivalentes agrupados por DCPF verificado. La propuesta prioriza demanda repetida y no repone automáticamente ventas puntuales sin actividad reciente. El objetivo de stock se expresa en días de cobertura por farmacia."
 };
}
