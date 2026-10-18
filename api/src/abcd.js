// Clasificación comercial ABCD calculada en cada consulta, sin snapshots ni tareas manuales.
// Ranking por facturación positiva acumulada: A ~80 %, B ~15 %, C resto; D sin venta.
// Mantener la clasificación por farmacia aislada de los filtros de búsqueda/familia.
export function classifyAbcd(rows, options={}){
 const scope=options.scope||(()=>"_all");
 const identity=options.identity||(row=>row.cn);
 const revenue=options.revenue||(row=>row.value);
 const units=options.units||(row=>row.units);
 const buckets=new Map();
 for(const row of rows){
  const id=String(identity(row)??"").trim(),pharmacy=String(scope(row)??"");
  if(!id)continue;
  if(!buckets.has(pharmacy))buckets.set(pharmacy,new Map());
  const map=buckets.get(pharmacy);
  const prev=map.get(id)||{id,revenue:0,units:0};
  const amount=Number(revenue(row)),qty=Number(units(row));
  if(Number.isFinite(amount))prev.revenue+=amount;
  if(Number.isFinite(qty))prev.units+=qty;
  map.set(id,prev);
 }
 const result=new Map();
 for(const [pharmacy,map] of buckets){
  const ranked=[...map.values()].sort((a,b)=>
   Math.max(0,b.revenue)-Math.max(0,a.revenue)||
   Math.max(0,b.units)-Math.max(0,a.units)||
   a.id.localeCompare(b.id));
  const total=ranked.reduce((n,row)=>n+Math.max(0,row.revenue),0);
  let accumulated=0;
  for(const row of ranked){
   const sold=row.revenue>0||row.units>0;
   const cls=!sold?"D":total<=0?"C":accumulated/total<0.8-1e-10?"A":
    accumulated/total<0.95-1e-10?"B":"C";
   result.set(pharmacy+"|"+row.id,cls);
   accumulated+=Math.max(0,row.revenue);
  }
 }
 return result;
}

export function applyAbcd(rows, classes,{available=true,scope=row=>row.pharmacyId,identity=row=>row.cn}={}){
 return rows.map(row=>({...row,
  abcdClass:available?(classes.get(String(scope(row)??"")+"|"+String(identity(row)??""))||"D"):null
 }));
}
