// Comparativa de conjuntos DCPF: mismos principios activos, dosis, forma y envase.
// Los CN del nomenclátor son referencias oficiales; ventas/PUC solo del tenant autenticado.
const DATE=/^20\d{2}-\d{2}-\d{2}$/;
const CN=/^\d{6,7}$/;
function dateValid(s){return DATE.test(s)&&Number.isFinite(Date.parse(s))&&
  new Date(s+"T00:00:00Z").toISOString().slice(0,10)===s;}
function filters(req,res){
 const from=String(req.query.desde||"").trim(),to=String(req.query.hasta||"").trim();
 const search=String(req.query.buscar||"").trim(),raw=String(req.query.farmacias||"");
 if(!dateValid(from)||!dateValid(to)||
    Date.parse(to)<Date.parse(from)||Date.parse(to)-Date.parse(from)>366*86400000||
    search.length>100||raw.length>2000)
   {res.status(400).json({error:"Fechas o filtros no válidos"});return null;}
 const allowed=req.context.allowedPharmacyIds.map(Number);
 const wanted=raw?raw.split(",").map(Number):allowed;
 if(wanted.some(id=>!Number.isSafeInteger(id)||!allowed.includes(id)))
   {res.status(403).json({error:"Farmacias no autorizadas"});return null;}
 return {from,to,search,ids:[...new Set(wanted)]};
}
function tenantSchema(req){return '"'+req.context.client.schema+'"';}
async function tableColumns(pool,schema,table,fields){
 const {rows}=await pool.query(
  "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2",
  [schema,table]);
 const found=new Set(rows.map(r=>r.column_name));
 return fields.every(f=>found.has(f));
}
const noData = status=>({available:false,reason:status});
function catalogData(pool){
 return pool.query("SELECT sha256,fecha_fuente,importado_en,total_presentaciones,total_genericos FROM farmetrica.nomenclator_versiones WHERE activo=true LIMIT 1");
}
export function setupGenericAnalytics(app,pool,{requireTenantModule}){
 const guard=requireTenantModule("genericos");
 app.get("/api/genericos/estado",...guard,async(req,res,next)=>{
  try{
   const [v,sales,purchases]=await Promise.all([
    catalogData(pool),
    tableColumns(pool,req.context.client.schema,"ventas",["farmacia_codigo","articulo_id","fecha","unidades","importe"]),
    tableColumns(pool,req.context.client.schema,"compras",["farmacia_id","producto_id","fecha","unidades","puc"]),
   ]);
   res.json({version:v.rows[0]||null,sales:sales?{available:true}:noData("Ventas no sincronizadas"),
      purchases:purchases?{available:true}:noData("Compras no sincronizadas")});
  }catch(e){next(e);}
 });
 app.get("/api/genericos/conjuntos",...guard,async(req,res,next)=>{
  const q=filters(req,res);if(!q)return;
  try{
   const schema=tenantSchema(req),tenant=req.context.client.slug;
   const status=await catalogData(pool);
   if(!status.rows.length)return res.json({version:null,groups:[],totalGroups:0,
    sales:noData("Pendiente de importar Nomenclátor AEMPS"),
    purchases:noData("Pendiente de importar Nomenclátor AEMPS")});
   const [hasSales,hasPurchases,hasProducts,hasSuppliers]=await Promise.all([
    tableColumns(pool,req.context.client.schema,"ventas",["farmacia_codigo","articulo_id","fecha","unidades","importe"]),
    tableColumns(pool,req.context.client.schema,"compras",["farmacia_id","producto_id","fecha","unidades","puc"]),
    tableColumns(pool,req.context.client.schema,"productos",["id","cn"]),
    tableColumns(pool,req.context.client.schema,"proveedores",["id","nombre"]),
   ]);
   const params=[q.from,q.to,q.ids,tenant];
   // Se muestran TODOS los conjuntos que tienen al menos un CN oficialmente
   // clasificado como genérico; el grupo incluye otras presentaciones equivalentes
   // para analizar alternativas, pero NO mezcla dosis/envases.
   // Los filtros de texto seleccionan conjuntos COMPLETOS, nunca recortan
   // las ventas de CN hermanos en un mismo DCPF.
   const conditions="";
   let salesSql=`SELECT n.dcpf,
        sum(v.unidades)::float8 AS units,sum(v.importe)::float8 AS revenue
     FROM ${schema}.ventas v
     JOIN farmetrica.farmacias f ON f.cliente_slug=$4 AND
       upper(btrim(v.farmacia_codigo::text))=upper(btrim(f.codigo_origen))
     ${hasProducts?`LEFT JOIN ${schema}.productos pv ON pv.id=btrim(v.articulo_id::text)`:""}
     JOIN farmetrica.nomenclator_presentaciones n ON n.cn=
       ${hasProducts?"coalesce(nullif(btrim(pv.cn),''),btrim(v.articulo_id::text))":"btrim(v.articulo_id::text)"}
     WHERE v.fecha >= $1::date AND v.fecha < $2::date+interval '1 day'
       AND f.id=ANY($3::int[]) ${conditions}
     GROUP BY n.dcpf`;
   let purchasesSql=`SELECT n.dcpf,
     sum(c.unidades)::float8 AS units,
     sum(c.unidades*c.puc)::float8 AS spend,
     CASE WHEN sum(c.unidades) FILTER(WHERE c.puc>0)>0 THEN
       (sum(c.unidades*c.puc) FILTER(WHERE c.puc>0)/
        sum(c.unidades) FILTER(WHERE c.puc>0))::float8 ELSE NULL END AS avg_puc,
     min(c.puc) FILTER(WHERE c.puc>0)::float8 AS best_puc
     FROM ${schema}.compras c
     ${hasProducts?`LEFT JOIN ${schema}.productos p ON p.id=c.producto_id`:""}
     JOIN farmetrica.nomenclator_presentaciones n ON n.cn=
       ${hasProducts?"coalesce(nullif(btrim(p.cn),''),btrim(c.producto_id::text))":"btrim(c.producto_id::text)"}
     WHERE c.fecha >= $1::date AND c.fecha < $2::date+interval '1 day'
       AND c.farmacia_id=ANY($3::int[]) ${conditions}
     GROUP BY n.dcpf`;
   const [catalog,sales,purchases]=await Promise.all([
    pool.query(`SELECT dcpf,min(coalesce(nullif(principio_activo,''),nombre)) AS principle,
      min(nombre) AS name,count(*)::int AS "skuCount",
      count(DISTINCT nullif(laboratorio_codigo,''))::int AS "labCount",
      count(*) FILTER(WHERE generico)::int AS "genericCount"
      FROM farmetrica.nomenclator_presentaciones
      GROUP BY dcpf HAVING bool_or(generico)
      ORDER BY min(coalesce(nullif(principio_activo,''),nombre)),dcpf`),
    hasSales&&q.ids.length?pool.query(salesSql,params):{rows:[]},
    hasPurchases&&q.ids.length?pool.query(purchasesSql,params):{rows:[]},
   ]);
   const sm=new Map(sales.rows.map(x=>[x.dcpf,x]));
   const pm=new Map(purchases.rows.map(x=>[x.dcpf,x]));
   // Permite buscar también un CN individual sin limitar la suma del conjunto.
   const matched=q.search?await pool.query(`SELECT DISTINCT dcpf FROM farmetrica.nomenclator_presentaciones
     WHERE cn ILIKE '%'||$1||'%' OR nombre ILIKE '%'||$1||'%' OR
       coalesce(principio_activo,'') ILIKE '%'||$1||'%'`,[q.search]):{rows:[]};
   const matchedIds=new Set(matched.rows.map(x=>x.dcpf));
   let groups=catalog.rows.filter(g=>!q.search||matchedIds.has(g.dcpf)||
     (g.principle+" "+g.name).toLocaleLowerCase("es").includes(q.search.toLocaleLowerCase("es")));
   groups=groups.map(g=>{
    const s=sm.get(g.dcpf),p=pm.get(g.dcpf);
    const avg=p?.avg_puc??null,best=p?.best_puc??null,qty=p?.units??0;
    return {...g,salesUnits:s?Number(s.units):hasSales?0:null,
      revenue:s?Number(s.revenue):hasSales?0:null,
      purchaseUnits:p?Number(p.units):hasPurchases?0:null,
      spent:p?Number(p.spend):hasPurchases?0:null,
      averagePuc:avg,bestPuc:best,
      indicativeSavings:avg!=null&&best!=null?Math.max(0,(avg-best)*Math.max(0,qty)):null};
   }).sort((a,b)=>(b.revenue??-1)-(a.revenue??-1));
   const summary={
    totalGroups:groups.length,
    salesUnits:hasSales?groups.reduce((n,g)=>n+Number(g.salesUnits||0),0):null,
    revenue:hasSales?groups.reduce((n,g)=>n+Number(g.revenue||0),0):null,
    purchases:hasPurchases?groups.reduce((n,g)=>n+Number(g.spent||0),0):null,
   };
   res.json({version:status.rows[0],groups:groups.slice(0,500),totalGroups:groups.length,summary,
    sales:hasSales?{available:true}:noData("No existe la tabla canónica de ventas"),
    purchases:hasPurchases?{available:true}:noData("No existen compras canónicas con PUC"),
    note:"Comparación por DCPF (misma dosis, forma y envase). Ahorro orientativo: no descuenta condiciones comerciales y no equivale a oferta vigente."});
  }catch(e){next(e);}
 });
 app.get("/api/genericos/conjuntos/:dcpf",...guard,async(req,res,next)=>{
  const q=filters(req,res);if(!q)return;
  const dcpf=String(req.params.dcpf||"");
  if(!/^\d{1,30}$/.test(dcpf))return res.status(400).json({error:"Conjunto inválido"});
  try{
   const schema=tenantSchema(req),tenant=req.context.client.slug;
   const [v,hasSales,hasPurchases,hasProducts,hasSuppliers]=await Promise.all([
    pool.query("SELECT 1 FROM farmetrica.nomenclator_presentaciones WHERE dcpf=$1 AND generico LIMIT 1",[dcpf]),
    tableColumns(pool,req.context.client.schema,"ventas",["farmacia_codigo","articulo_id","fecha","unidades","importe"]),
    tableColumns(pool,req.context.client.schema,"compras",["farmacia_id","producto_id","fecha","unidades","puc"]),
    tableColumns(pool,req.context.client.schema,"productos",["id","cn"]),
    tableColumns(pool,req.context.client.schema,"proveedores",["id","nombre"]),
   ]);
   if(!v.rows.length)return res.status(404).json({error:"Conjunto no encontrado"});
   const products=await pool.query(
     'SELECT cn,nombre,laboratorio,laboratorio_codigo,principio_activo,generico,comercializado FROM farmetrica.nomenclator_presentaciones WHERE dcpf=$1 ORDER BY generico DESC,nombre,cn',
     [dcpf]);
   const params=[q.from,q.to,q.ids,dcpf,tenant];
   const sales=hasSales&&q.ids.length?await pool.query(`
     SELECT n.cn,sum(v.unidades)::float8 AS units,sum(v.importe)::float8 AS revenue
     FROM ${schema}.ventas v
     JOIN farmetrica.farmacias f ON f.cliente_slug=$5
       AND upper(btrim(v.farmacia_codigo::text))=upper(btrim(f.codigo_origen))
     ${hasProducts?`LEFT JOIN ${schema}.productos pv ON pv.id=btrim(v.articulo_id::text)`:""}
     JOIN farmetrica.nomenclator_presentaciones n ON n.cn=
       ${hasProducts?"coalesce(nullif(btrim(pv.cn),''),btrim(v.articulo_id::text))":"btrim(v.articulo_id::text)"}
     WHERE n.dcpf=$4 AND f.id=ANY($3::int[])
       AND v.fecha >= $1::date AND v.fecha < $2::date+interval '1 day'
     GROUP BY n.cn`,params):{rows:[]};
   const purchases=hasPurchases&&q.ids.length?await pool.query(`
     SELECT n.cn,c.proveedor_id::text AS "supplierCode",
       ${hasSuppliers?"max(sp.nombre)":"null::text"} AS supplier,
       sum(c.unidades)::float8 AS units,
       sum(c.unidades*c.puc)::float8 AS spend,
       (sum(c.unidades*c.puc) FILTER(WHERE c.puc>0)/
         nullif(sum(c.unidades) FILTER(WHERE c.puc>0),0))::float8 AS puc
     FROM ${schema}.compras c
     ${hasProducts?`LEFT JOIN ${schema}.productos p ON p.id=c.producto_id`:""}
     ${hasSuppliers?`LEFT JOIN ${schema}.proveedores sp ON sp.id=c.proveedor_id`:""}
     JOIN farmetrica.nomenclator_presentaciones n ON n.cn=
       ${hasProducts?"coalesce(nullif(btrim(p.cn),''),btrim(c.producto_id::text))":"btrim(c.producto_id::text)"}
     WHERE n.dcpf=$4 AND c.farmacia_id=ANY($3::int[])
       AND c.fecha >= $1::date AND c.fecha < $2::date+interval '1 day'
     GROUP BY n.cn,c.proveedor_id::text
     ORDER BY puc NULLS LAST,n.cn`,params.slice(0,4)):{rows:[]};
   res.json({products:products.rows,sales:sales.rows,purchases:purchases.rows,
      salesAvailable:hasSales,purchasesAvailable:hasPurchases});
  }catch(e){next(e);}
 });
}
