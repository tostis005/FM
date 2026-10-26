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

export function defaultLaboratoryLine(row,type,pharmacyIds){
 const common={reference:row.referencia,cn:row.cn||null,name:row.nombre,metrics:row.byPharmacy||{}};
 const pharmacies=pharmacyIds.map(String);
 if(type==="parafarmacia"){
  const values=pharmacies.map(id=>row.byPharmacy?.[id]?.suggested);
  return {...common,units:values.some(v=>v===null||v===undefined)?0:values.reduce((sum,v)=>sum+Number(v),0)};
 }
 return {...common,unitsByPharmacy:Object.fromEntries(pharmacies.map(id=>
  [id,row.byPharmacy?.[id]?.suggested??0]))};
}
export function orderLineFor(row,type,ids,drafts={}){
 return drafts[row.referencia]||defaultLaboratoryLine(row,type,ids);
}
export function mergeVisibleOrderLines(rows,type,ids,drafts={}){
 const result={...drafts};
 for(const row of rows){
  if(!result[row.referencia])result[row.referencia]=defaultLaboratoryLine(row,type,ids);
 }
 return result;
}
export function laboratoryExcelRows(lines,pharmacies,type){
 const isMedication=type==="medicacion";
 const ids=pharmacies.map(p=>String(p.id));
 const grouping=["CN","Artículo",...pharmacies.flatMap(p=>
  [p.name,"","","",""]), "Total vendido", "Propuesta total","Pedir total"];
 const headings=["CN","Artículo",...pharmacies.flatMap(()=>
  ["Ventas 3m","Ventas 12m","Stock","Vendido período",isMedication?"Pedir":"Propuesta"]),
  "Total vendido", "Propuesta total","Pedir total"];
 const rows=lines.map(({row,line})=>{
  const measures=ids.map(id=>row.byPharmacy?.[id]||{});
  const sold=measures.reduce((n,v)=>n+Number(v.unitsPeriod||0),0);
  const proposals=measures.some(v=>v.suggested===null||v.suggested===undefined)?null:
   measures.reduce((n,v)=>n+Number(v.suggested),0);
  return [row.cn||"",row.nombre,...measures.flatMap((m,i)=>[
   Number(m.units3||0),Number(m.units12||0),m.stock,
   Number(m.unitsPeriod||0),isMedication?line.unitsByPharmacy?.[ids[i]]??0:m.suggested
  ]),sold,proposals,isMedication?ids.reduce((sum,id)=>sum+Number(line.unitsByPharmacy?.[id]||0),0):line.units];
 });
 return [grouping,headings,...rows];
}
// Hoja real de pedido: un único cliente Pedia para parafarmacia y
// cantidades independientes por farmacia y total único para medicación.
export function laboratoryOrderListRows(lines,pharmacies,type){
 if(type==="parafarmacia")return [
  ["Cliente", "Código nacional / EAN", "Artículo", "Unidades"],
  ...lines.map(({row,line})=>["Pedia",row.cn||"",row.nombre,line.units])
 ];
 return [
  ["Código nacional / EAN","Artículo",...pharmacies.map(p=>"Pedir "+p.name),"Total pedir"],
  ...lines.map(({row,line})=>[
   row.cn||"",row.nombre,
   ...pharmacies.map(p=>line.unitsByPharmacy?.[String(p.id)]??0),
   pharmacies.reduce((sum,p)=>sum+Number(line.unitsByPharmacy?.[String(p.id)]||0),0)
  ])
 ];
}
export function laboratoryExportName(laboratory,type){
 const slug=String(laboratory||"laboratorio").normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"-").slice(0,48);
 return "pedido-"+slug+"-"+type+".xlsx";
}
