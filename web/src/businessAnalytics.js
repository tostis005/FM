import {monthAt,round,sum} from "./businessDemoData.js";
const group=(rows,key)=>{const m=new Map();for(const row of rows){const id=key(row);if(!m.has(id))m.set(id,[]);m.get(id).push(row)}return m};
const key=(...parts)=>parts.join("|");
export function buildAnalysis(tables,filters={},asOf=new Date()){
 const period=[3,6,12].includes(Number(filters.period))?Number(filters.period):6;
 const months=Array.from({length:period},(_,i)=>monthAt(asOf,1-period+i));
 const first=months[0],last=months.at(-1);
 const pharmacies=(filters.pharmacyIds||[]).map(String),families=(filters.families||[]).map(String);
 const allowedIds=new Set((filters.allowedPharmacyIds||[]).map(String));
 const hasPharmacy=id=>allowedIds.has(String(id))&&(!pharmacies.length||pharmacies.includes(String(id)));
 const query=String(filters.search||"").trim().toLocaleLowerCase("es");
 const selectedArticles=tables.articulos.filter(a=>(!families.length||families.includes(a.familia))&&
  (!query||(a.cn+" "+a.descripcion+" "+a.familia).toLocaleLowerCase("es").includes(query)));
 const articleMap=new Map(selectedArticles.map(a=>[a.cn,a]));
 const supplierMap=new Map(tables.proveedores.map(p=>[p.id,p]));
 const relevant=v=>hasPharmacy(v.farmaciaId)&&articleMap.has(v.cn);
 const sales=tables.ventas.filter(v=>relevant(v)&&v.fecha.slice(0,7)>=first&&v.fecha.slice(0,7)<=last);
 const purchases=tables.compras.filter(v=>relevant(v)&&v.fecha.slice(0,7)>=first&&v.fecha.slice(0,7)<=last);
 const stock=tables.stock.filter(relevant);
 const purchasesCN=group(purchases.filter(v=>v.puc>0&&v.unidades>0),p=>p.cn);
 const targets=new Map([...purchasesCN].map(([cn,items])=>{
  const prices=items.map(p=>p.puc).sort((a,b)=>a-b);
  return [cn,prices[Math.floor((prices.length-1)*.25)]];
 }));
 const purchaseFarmCN=group(purchases.filter(p=>p.puc>0&&p.unidades>0),p=>key(p.farmaciaId,p.cn));
 const costs=new Map([...purchaseFarmCN].map(([id,items])=>
  [id,sum(items,p=>p.unidades*p.puc)/sum(items,"unidades")]));
 const saleGroups=group(sales,v=>key(v.farmaciaId,v.cn));
 const salesRows=[...saleGroups].map(([id,items])=>{
  const [pharmacyId,cn]=id.split("|"),a=articleMap.get(cn),units=sum(items,"unidades"),revenue=round(sum(items,"importeNeto")),cost=costs.get(id);
  return {id,pharmacyId,cn,name:a.descripcion,family:a.familia,pvp:a.pvp,units,value:revenue,
   margin:cost==null?null:round(revenue-units*cost),marginPct:cost==null||!revenue?null:round((revenue-units*cost)/revenue*100),
   purchaseCost:cost==null?null:round(cost,4)};
 }).sort((a,b)=>b.value-a.value);
 const buyGroups=group(purchases,p=>key(p.farmaciaId,p.cn,p.proveedorId));
 const buyRows=[...buyGroups].map(([id,items])=>{
  const [pharmacyId,cn,providerId]=id.split("|"),a=articleMap.get(cn),units=sum(items,"unidades"),value=round(sum(items,"total"));
  const puc=units>0?sum(items,p=>p.puc*p.unidades)/units:0,target=targets.get(cn);
  return {id,pharmacyId,cn,providerId,supplier:supplierMap.get(providerId)?.nombre||providerId,
   name:a.descripcion,family:a.familia,generico:a.generico,grupoGenerico:a.grupoGenerico,
   units,value,puc:round(puc,4),target:target==null?null:round(target,4),
   potential:target==null?0:round(Math.max(0,puc-target)*Math.max(0,units))};
 }).sort((a,b)=>b.potential-a.potential);
 const supplierRows=[...group(buyRows,p=>p.providerId)].map(([providerId,items])=>({
  id:providerId,providerId,name:supplierMap.get(providerId)?.nombre||providerId,
  family:supplierMap.get(providerId)?.tipo||"",units:sum(items,"units"),
  value:round(sum(items,"value")),potential:round(sum(items,"potential")),
  products:new Set(items.map(x=>x.cn)).size
 })).sort((a,b)=>b.value-a.value);
 const stockRows=stock.map(st=>{
  const id=key(st.farmaciaId,st.cn),a=articleMap.get(st.cn),cost=costs.get(id);
  const sold=sum(saleGroups.get(id)||[],"unidades");
  const demandDay=Math.max(0,sold)/(period*30.44);
  const coverage=demandDay>0?st.unidades/demandDay:null;
  const excessUnits=demandDay>0?Math.max(0,st.unidades-Math.ceil(demandDay*60)):st.unidades;
  const need=Math.max(0,Math.ceil(demandDay*15-st.unidades));
  return {id,pharmacyId:st.farmaciaId,cn:st.cn,name:a.descripcion,family:a.familia,
   units:st.unidades,unitCost:cost==null?null:round(cost,4),
   value:cost==null?null:round(st.unidades*cost),
   excessValue:cost==null?null:round(excessUnits*cost),excessUnits,
   need,needValue:cost==null?null:round(need*cost),coverage:coverage==null?null:round(coverage),
   zero:st.unidades<=0&&sold>0,sold};
 }).sort((a,b)=>(b.value||0)-(a.value||0));
 const replenishmentRows=stockRows.filter(r=>r.need>0).sort((a,b)=>b.need-a.need);
 const genericRows=buyRows.filter(r=>r.generico);
 const profitRows=salesRows.filter(r=>r.margin!=null).sort((a,b)=>a.marginPct-b.marginPct);
 const actions=[
  ...buyRows.filter(r=>r.potential>0).map(r=>({...r,action:"Revisar PUC",targetModule:"compras",impact:r.potential})),
  ...stockRows.filter(r=>(r.excessValue||0)>0).map(r=>({...r,action:"Reducir sobrestock",targetModule:"stock",impact:r.excessValue})),
  ...replenishmentRows.map(r=>({...r,action:"Reponer",targetModule:"reposicion",impact:r.needValue||0}))
 ].sort((a,b)=>b.impact-a.impact);
 const monthly=months.map(month=>{
  const ms=sales.filter(v=>v.fecha.startsWith(month)),mp=purchases.filter(v=>v.fecha.startsWith(month));
  const estimatedMargin=sum(ms,v=>{
   const cost=costs.get(key(v.farmaciaId,v.cn));
   return cost==null?0:v.importeNeto-v.unidades*cost;
  });
  return {month,ventas:round(sum(ms,"importeNeto")),compras:round(sum(mp,"total")),
   margen:round(estimatedMargin),genericos:round(sum(mp.filter(v=>articleMap.get(v.cn)?.generico),"total")),
   unidades:sum(ms,"unidades")};
 });
 const coveredSales=salesRows.filter(r=>r.margin!=null);
 const kpis={
  ventas:round(sum(sales,"importeNeto")),unidades:sum(sales,"unidades"),
  compras:round(sum(purchases,"total")),proveedores:supplierRows.length,
  articulosVendidos:new Set(sales.filter(v=>v.unidades>0).map(v=>v.cn)).size,
  articulosComprados:new Set(purchases.filter(v=>v.unidades>0).map(v=>v.cn)).size,
  stock:round(sum(stockRows,"value")),sobrestock:round(sum(stockRows,"excessValue")),
  stockSinRotacion:stockRows.filter(r=>r.sold===0&&r.units>0).length,
  roturas:stockRows.filter(r=>r.zero).length,
  reposiciones:replenishmentRows.length,
  reposicionCoste:round(sum(replenishmentRows,"needValue")),
  potencialCompra:round(sum(buyRows,"potential")),
  margen:round(sum(coveredSales,"margin")),
  margenPct:sum(coveredSales,"value")>0?round(100*sum(coveredSales,"margin")/sum(coveredSales,"value")):null,
  coberturaCostes:salesRows.length?round(100*coveredSales.length/salesRows.length):0,
  compraGenericos:round(sum(genericRows,"value")),
  potencialGenericos:round(sum(genericRows,"potential")),
  acciones:actions.length
 };
 return {period,months,monthly,kpis,salesRows,buyRows,supplierRows,stockRows,
  replenishmentRows,genericRows,profitRows,actions,selectedArticles,articles:articleMap,
  suppliers:supplierMap,pharmacies:allowedIds};
}
