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
