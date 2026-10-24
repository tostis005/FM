export const qty=value=>Number.isSafeInteger(Number(value))&&Number(value)>=0&&Number(value)<=999999?Number(value):null;
export function defaultLaboratoryLine(row,type,pharmacyIds){
 const common={reference:row.referencia,cn:row.cn||null,name:row.nombre};
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
 const grouping=["CN / ERP","Artículo",...pharmacies.flatMap(p=>
  [p.name,"","","",""]), "Total vendido", "Propuesta total",...(isMedication?[]:["Pedir total"])];
 const headings=["CN / ERP","Artículo",...pharmacies.flatMap(()=>
  ["Ventas 3m","Ventas 12m","Stock","Vendido período",isMedication?"Pedir":"Propuesta"]),
  "Total vendido", "Propuesta total",...(isMedication?[]:["Pedir total"])];
 const rows=lines.map(({row,line})=>{
  const measures=ids.map(id=>row.byPharmacy?.[id]||{});
  const sold=measures.reduce((n,v)=>n+Number(v.unitsPeriod||0),0);
  const proposals=measures.some(v=>v.suggested===null||v.suggested===undefined)?null:
   measures.reduce((n,v)=>n+Number(v.suggested),0);
  return [row.cn||row.referencia,row.nombre,...measures.flatMap((m,i)=>[
   Number(m.units3||0),Number(m.units12||0),m.stock,
   Number(m.unitsPeriod||0),isMedication?line.unitsByPharmacy?.[ids[i]]??0:m.suggested
  ]),sold,proposals,...(isMedication?[]:[line.units])];
 });
 return [grouping,headings,...rows];
}
export function laboratoryExportName(laboratory,type){
 const slug=String(laboratory||"laboratorio").normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"-").slice(0,48);
 return "pedido-"+slug+"-"+type+".xlsx";
}
