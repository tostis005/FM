// Resumen de compras independiente del listado: no espera LATERAL de catálogo,
// clasificación ABCD ni coste de cada artículo. Solo datos reales del período.
import {getFilters} from "./realReports.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
export function setupPurchaseTotals(app,pool,{requireTenant}){
 app.get("/api/analytics/compras/resumen",...requireTenant(),async(req,res,next)=>{
  const request={...req,query:{...req.query,modulo:"compras"}};
  const f=getFilters(request,res);
  if(!f)return;
  if(f.search||f.families.length)
   return res.status(400).json({error:"El resumen rápido no admite filtros de artículo"});
  try{
   const schema=req.context.client.schema;
   if(!SCHEMA.test(schema))return res.status(400).json({error:"Esquema no válido"});
   const {rows:columns}=await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='compras'",[schema]);
   const names=new Set(columns.map(r=>r.column_name));
   const supports=(...fields)=>fields.every(field=>names.has(field));
   const normalized=supports("farmacia_codigo","fecha","articulo_id","proveedor_id","unidades","importe","coste_unitario");
   const legacy=!normalized&&supports("farmacia_id","fecha","producto_id","proveedor_id","unidades","total","puc");
   if(!normalized&&!legacy)return res.json({available:false,kpis:{},monthly:[]});
   if(!f.ids.length)return res.json({available:true,
    kpis:{compras:0,unidadesCompradas:0,lineasCompra:0,proveedores:0},monthly:[]});
   const join=legacy?
    "JOIN farmetrica.farmacias f ON f.id=t.farmacia_id AND f.cliente_slug=$4":
    `JOIN farmetrica.farmacias f ON f.cliente_slug=$4
       AND upper(btrim(t.farmacia_codigo))=${pharmacyDataCodeSQL("f")}`;
   const amount=legacy?"t.total":"t.importe";
   const {rows}=await pool.query(`
    SELECT to_char(date_trunc('month',t.fecha),'YYYY-MM') AS month,
     f.id::text AS pharmacy,t.proveedor_id::text AS supplier,
     sum(${amount})::float8 AS amount,
     sum(t.unidades)::float8 AS units,count(*)::float8 AS lines
    FROM "${schema}".compras t ${join}
    WHERE t.fecha >= $1::date AND t.fecha < $2::date+interval '1 day'
     AND f.id=ANY($3::int[])
    GROUP BY 1,f.id,t.proveedor_id ORDER BY 1`,
    [f.from,f.to,f.ids,req.context.client.slug]);
   const months=new Map(),suppliers=new Set();
   let purchases=0,units=0,lines=0;
   for(const r of rows){
    const amount=Number(r.amount||0),qty=Number(r.units||0),count=Number(r.lines||0);
    purchases+=amount;units+=qty;lines+=count;
    if(r.supplier!=null&&r.supplier!=="")suppliers.add(r.pharmacy+"|"+r.supplier);
    const m=months.get(r.month)||{month:r.month,ventas:0,compras:0,unidades:0,margen:null};
    m.compras+=amount;months.set(r.month,m);
   }
   res.json({available:true,kpis:{
    compras:Math.round(purchases*100)/100,
    unidadesCompradas:units,lineasCompra:lines,proveedores:suppliers.size
   },monthly:[...months.values()]});
  }catch(e){next(e)}
 });
}
