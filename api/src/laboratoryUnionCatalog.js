import {readDirectLaboratoryCatalog} from "./laboratoryFastCatalog.js";
import {readPurchasedLaboratoryCatalog} from "./laboratoryQuickCatalog.js";
import {readRetirementPatterns} from "./laboratoryRetirements.js";

const MAX_REFERENCES=5000;

/** UNION lógico por CN entre AEMPS y todos los proveedores ya vinculados
 * en el maestro. Una misma presentación se calcula una sola vez.
 * En las compras se conserva la identificación ERP: farmacia+origen_id.
 */
export function unionLaboratoryReferences(official,received,search="",type="medicacion"){
 const joined=new Map();
 for(const row of [...official,...received]){
  const reference=String(row?.referencia||"");
  if(!reference||row.tipo!==type)continue;
  const previous=joined.get(reference);
  if(!previous)joined.set(reference,{...row});
  else joined.set(reference,{
   ...previous,
   inMaster:Boolean(previous.inMaster||row.inMaster),
   inPurchases:Boolean(previous.inPurchases||row.inPurchases),
   inSales:Boolean(previous.inSales||row.inSales),
   inReceipts:Boolean(previous.inReceipts||row.inReceipts),
   pharmacyIds:[...new Set(
    [previous.pharmacyIds,row.pharmacyIds].filter(Boolean).flatMap(x=>String(x).split(","))
   )].sort().join(",")||null
  });
 }
 const term=String(search||"").trim().toLocaleLowerCase("es");
 return [...joined.values()].filter(r=>!term||
  String(r.nombre||"").toLocaleLowerCase("es").includes(term)||
  String(r.referencia).includes(term))
  .sort((a,b)=>String(a.nombre||"").localeCompare(String(b.nombre||""),"es")||
   a.referencia.localeCompare(b.referencia));
}
export async function readUnifiedLaboratoryCatalog(pool,ctx,{key,pharmacies,type,search=""}){
 if(!["medicacion","parafarmacia"].includes(type))throw Error("Tipo no válido");
 let nativeCN=false;
 try{
  const {rows}=await pool.query({text:`SELECT EXISTS(
   SELECT 1 FROM information_schema.columns WHERE table_schema=$1
    AND table_name='articulos' AND column_name='cn_normalizado') AS available`,
   values:[ctx.client.schema],query_timeout:1500});
  nativeCN=rows[0]?.available===true;
 }catch{}
 const patterns=await readRetirementPatterns(pool,ctx.client.slug);
 const args={key,pharmacies,type,search:"",page:1,size:MAX_REFERENCES,
  hasNativeCN:nativeCN,patterns,skipMovementCheck:true};
 const [official,bought]=await Promise.all([
  type==="medicacion"?readDirectLaboratoryCatalog(pool,ctx,args):
   Promise.resolve({rows:[],total:0}),
  readPurchasedLaboratoryCatalog(pool,ctx,args)
 ]);
 // No entregar un catálogo truncado bajo apariencia de resultado completo.
 if(official.total>MAX_REFERENCES||bought.total>MAX_REFERENCES)
  throw Object.assign(new Error("Demasiados artículos para carga conjunta"),{code:"TOO_MANY"});
 const rows=unionLaboratoryReferences(official.rows,bought.rows,search,type);
 if(rows.length>MAX_REFERENCES)
  throw Object.assign(new Error("Demasiados artículos para carga conjunta"),{code:"TOO_MANY"});
 return {rows,total:rows.length,metricsUnavailable:true};
}
