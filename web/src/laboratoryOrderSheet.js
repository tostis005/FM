export const qty=value=>Number.isSafeInteger(Number(value))&&Number(value)>=0&&Number(value)<=999999?Number(value):null;
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
  [p.name,"","","",""]), "Total vendido", "Propuesta total",isMedication?"Pedir total":"Pedir Pedia"];
 const headings=["CN","Artículo",...pharmacies.flatMap(()=>
  ["Ventas 3m","Ventas 12m","Stock","Vendido período",isMedication?"Pedir":"Propuesta"]),
  "Total vendido", "Propuesta total",isMedication?"Pedir total":"Pedir Pedia"];
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
