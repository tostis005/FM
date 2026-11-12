export const qty=value=>Number.isSafeInteger(Number(value))&&Number(value)>=0&&Number(value)<=999999?Number(value):null;
// Medicación conserva el desglose por farmacia incluso al editar el total.
export function medicationOrderTotal(line,pharmacyIds){
 return pharmacyIds.reduce((sum,id)=>sum+Number(line?.unitsByPharmacy?.[String(id)]||0),0);
}
export function distributeMedicationOrderTotal(row,line,pharmacyIds,value){
 const total=qty(value),ids=pharmacyIds.map(String);
 if(total===null||!ids.length)return null;
 let weights=ids.map(id=>qty(line?.unitsByPharmacy?.[id])??0);
 if(!weights.some(n=>n>0))
  weights=ids.map(id=>Math.max(0,Number(row?.byPharmacy?.[id]?.suggested)||0));
 if(!weights.some(n=>n>0))weights=ids.map(()=>1);
 const weightTotal=weights.reduce((sum,n)=>sum+n,0);
 const shares=weights.map(w=>total*w/weightTotal);
 const amounts=shares.map(v=>Math.floor(v));
 const missing=total-amounts.reduce((sum,n)=>sum+n,0);
 const remainders=shares.map((v,i)=>({i,fraction:v-amounts[i]}))
  .sort((a,b)=>b.fraction-a.fraction||a.i-b.i);
 for(let i=0;i<missing;i++)amounts[remainders[i].i]++;
 return {...line,unitsByPharmacy:{...line.unitsByPharmacy,
  ...Object.fromEntries(ids.map((id,i)=>[id,amounts[i]]))}};
}
export const isExcludedOrderRow=row=>row?.excluded===true;
export function totalStockFor(row,pharmacyIds){
 const values=pharmacyIds.map(id=>row?.byPharmacy?.[String(id)]?.stock);
 return values.some(v=>v===null||v===undefined||!Number.isFinite(Number(v)))?
  null:values.reduce((sum,v)=>sum+Number(v),0);
}
// Los KPI resumen el stock conocido del catálogo completo. Si faltan fichas
// o una importación, se indica "parcial" en lugar de ocultar todo el total
// o convertir una existencia desconocida en cero.
export function laboratoryStockTotals(rows,pharmacyIds,includeWarehouse=false){
 let pharmacyStock=0,warehouseStock=0,missingPharmacy=0,missingWarehouse=0;
 for(const row of rows){
  for(const id of pharmacyIds){
   const value=row?.metricsReady?row.byPharmacy?.[String(id)]?.stock:null;
   if(value===null||value===undefined||!Number.isFinite(Number(value)))
    missingPharmacy++;
   else pharmacyStock+=Number(value);
  }
  if(includeWarehouse){
   const value=row?.metricsReady&&row.warehouseReady===true?
    row.warehouse?.stock:null;
   if(value===null||value===undefined||!Number.isFinite(Number(value)))
    missingWarehouse++;
   else warehouseStock+=Number(value);
  }
 }
 return {pharmacyStock,globalStock:pharmacyStock+warehouseStock,
  missingPharmacy,missingWarehouse,
  pharmacyPartial:missingPharmacy>0,
  globalPartial:missingPharmacy>0||missingWarehouse>0};
}
// Mantener la ordenación numérica alineada con las cifras visibles de Totales y Pedir total.
export function laboratoryOrderSortValue(row,field,type,pharmacyIds,drafts={}){
 if(!row?.metricsReady)return null;
 if(field==="totalStock")return type==="parafarmacia"&&row.globalStock!=null?
  row.globalStock:totalStockFor(row,pharmacyIds);
 if(field==="totalUnits")return row.totalSold;
 if(field==="totalSuggested")return row.totalSuggested;
 if(field==="totalOrder"){
  const line=orderLineFor(row,type,pharmacyIds,drafts);
  return type==="medicacion"?medicationOrderTotal(line,pharmacyIds):line.units;
 }
 return null;
}
// Las familias R1/R2 y dúplos tienen varias referencias reales: el grupo se
// ordena por la SUMA de sus artículos, sin duplicar líneas ni mezclar sus CN.
export function laboratoryOrderGroupValue(group,field,type,pharmacyIds,drafts={}){
 const rows=group?.rows||[];
 if(!rows.length)return null;
 const values=rows.map(row=>laboratoryOrderSortValue(row,field,type,pharmacyIds,drafts));
 if(values.some(value=>value===null||value===undefined||!Number.isFinite(Number(value))))
  return null;
 return values.reduce((sum,value)=>sum+Number(value),0);
}
export function compareLaboratoryOrderGroups(a,b,sort,type,pharmacyIds,drafts={}){
 if(!sort||sort==="original")return 0;
 const [field,direction]=sort.split(":");
 if(["totalStock","totalUnits","totalSuggested","totalOrder"].includes(field)){
  const left=laboratoryOrderGroupValue(a,field,type,pharmacyIds,drafts);
  const right=laboratoryOrderGroupValue(b,field,type,pharmacyIds,drafts);
  if(left===null||right===null)return left===right?0:left===null?1:-1;
  const difference=left-right;
  return direction==="desc"?-difference:difference;
 }
 return compareLaboratoryOrderRows(a.representative,b.representative,sort,type,pharmacyIds,drafts);
}
const numericalSortFields=new Set(["totalStock","totalUnits","totalSuggested","totalOrder"]);
export function compareLaboratoryOrderRows(a,b,sort,type,pharmacyIds,drafts={}){
 if(!sort||sort==="original")return 0;
 const [field,direction]=sort.split(":");
 if(numericalSortFields.has(field)){
  const first=laboratoryOrderSortValue(a,field,type,pharmacyIds,drafts);
  const second=laboratoryOrderSortValue(b,field,type,pharmacyIds,drafts);
  const left=first==null?null:Number(first);
  const right=second==null?null:Number(second);
  const hasLeft=left!==null&&Number.isFinite(left);
  const hasRight=right!==null&&Number.isFinite(right);
  // Nunca presentar un stock desconocido como 0. Los guiones van al final.
  if(!hasLeft||!hasRight)return hasLeft===hasRight?0:hasLeft?-1:1;
  const difference=left-right;
  return direction==="desc"?-difference:difference;
 }
 const collator=new Intl.Collator("es",{numeric:true,sensitivity:"base"});
 const left=field==="cn"?String(a.cn||a.referencia||""):String(a.nombre||"");
 const right=field==="cn"?String(b.cn||b.referencia||""):String(b.nombre||"");
 const difference=collator.compare(left,right);
 return direction==="desc"?-difference:difference;
}
// Las referencias dadas de baja son editables: el color rojo solo advierte.
// No poner unidades a cero al leer borradores antiguos ni cambiar de pestaña.
export function sanitizeExcludedOrderLine(row,line,type,pharmacyIds){
 return line;
}
export function defaultLaboratoryLine(row,type,pharmacyIds){
 const common={reference:row.referencia,cn:row.cn||null,name:row.nombre,
  metrics:row.byPharmacy||{},excluded:isExcludedOrderRow(row),comment:""};
 const pharmacies=pharmacyIds.map(String);
 if(type==="parafarmacia"){
  const values=pharmacies.map(id=>row.byPharmacy?.[id]?.suggested);
  return {...common,units:row.totalSuggested===null||
   (row.totalSuggested===undefined&&values.some(v=>v===null||v===undefined))?
   0:row.totalSuggested!==undefined?
    Math.max(0,Number(row.totalSuggested)):values.reduce((sum,v)=>sum+Number(v),0)};
 }
 return {...common,unitsByPharmacy:Object.fromEntries(pharmacies.map(id=>
  [id,row.byPharmacy?.[id]?.suggested??0]))};
}
export function orderLineFor(row,type,ids,drafts={}){
 const previous=drafts[row.referencia]||defaultLaboratoryLine(row,type,ids);
 // La regla vigente del catálogo prevalece sobre el estado de un borrador antiguo.
 return sanitizeExcludedOrderLine(row,{...previous,excluded:isExcludedOrderRow(row),
  name:row.nombre,cn:row.cn||null,metrics:row.byPharmacy||previous.metrics||{}},type,ids);
}
export function mergeVisibleOrderLines(rows,type,ids,drafts={}){
 const result={...drafts};
 for(const row of rows)result[row.referencia]=orderLineFor(row,type,ids,result);
 return result;
}
export function appendOrderGlobalComment(rows,comment){
 const note=String(comment||"").trim();
 if(!note)return rows;
 const width=rows[0]?.length||2;
 return [...rows,Array(width).fill(""),["Comentarios generales del pedido",note,
  ...Array(Math.max(0,width-2)).fill("")]];
}
export function laboratoryExcelRows(lines,pharmacies,type,globalComment=""){
 const isMedication=type==="medicacion";
 const ids=pharmacies.map(p=>String(p.id));
 const grouping=["CN","Artículo",...pharmacies.flatMap(p=>
  [p.name,"","","",""]),"Almacén","","","","",
  "Total farm.","Total + ALM","Propuesta","Pedir total","Comentarios"];
 const headings=["CN","Artículo",...pharmacies.flatMap(()=>
  ["Stock","Ventas 12m","Ventas 3m","Vendido período",isMedication?"Pedir":"Propuesta"]),
  "Stock","Ventas 12m","Ventas 3m","Vendido período",isMedication?"Pedir":"Propuesta",
  "Total farm.","Total + ALM","Propuesta","Pedir total","Comentarios"];
 const rows=lines.map(({row,line})=>{
  const measures=ids.map(id=>row.byPharmacy?.[id]||{});
  const proposals=row.totalSuggested!==undefined?row.totalSuggested:
   measures.some(v=>v.suggested===null||v.suggested===undefined)?null:
    measures.reduce((n,v)=>n+Number(v.suggested),0);
  const warehouse=!isMedication?row.warehouse||null:null;
  return [row.cn||"",row.nombre,...measures.flatMap((m,i)=>[
   m.stock,Number(m.units12||0),Number(m.units3||0),
   Number(m.unitsPeriod||0),isMedication?line.unitsByPharmacy?.[ids[i]]??0:m.suggested
  ]),warehouse?.stock??null,warehouse?.units12??null,
   warehouse?.units3??null,warehouse?.unitsPeriod??null,null,
   totalStockFor(row,ids),isMedication?null:row.globalStock??null,proposals,
   isMedication?ids.reduce((sum,id)=>sum+Number(line.unitsByPharmacy?.[id]||0),0):line.units,
   line.comment||""];

 });
 return appendOrderGlobalComment([grouping,headings,...rows],globalComment);
}
// Hoja real de pedido: un único cliente Pedia para parafarmacia y
// cantidades independientes por farmacia y total único para medicación.
export function laboratoryOrderListRows(lines,pharmacies,type,globalComment=""){
 if(type==="parafarmacia")return appendOrderGlobalComment([
  ["Cliente","Código nacional / EAN","Artículo","Unidades","Comentarios"],
  ...lines.map(({row,line})=>["Pedia",row.cn||"",row.nombre,line.units,line.comment||""])
 ],globalComment);
 return appendOrderGlobalComment([
  ["Código nacional / EAN","Artículo",...pharmacies.map(p=>"Pedir "+p.name),"Total pedir","Comentarios"],
  ...lines.map(({row,line})=>[
   row.cn||"",row.nombre,
   ...pharmacies.map(p=>line.unitsByPharmacy?.[String(p.id)]??0),
   pharmacies.reduce((sum,p)=>sum+Number(line.unitsByPharmacy?.[String(p.id)]||0),0),
   line.comment||""
  ])
 ],globalComment);
}
export function laboratoryExportName(laboratory,type){
 const slug=String(laboratory||"laboratorio").normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"-").slice(0,48);
 return "pedido-"+slug+"-"+type+".xlsx";
}
