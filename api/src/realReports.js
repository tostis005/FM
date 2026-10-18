// Informes agregados sobre las tablas reales normalizadas del cliente.
// No mezcla cifras de demostración ni traslada compras/ventas brutas al navegador.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {classifyAbcd} from "./abcd.js";
const DAY=86400000;
const ISO=/^20\d{2}-\d{2}-\d{2}$/;
const validDate=s=>{if(!ISO.test(s))return false;const d=new Date(s+"T00:00:00Z");return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s;};
const round=(n,d=2)=>Math.round(Number(n)*10**d)/10**d;
const sum=(arr,key)=>arr.reduce((t,r)=>t+Number(typeof key==="function"?key(r):r[key]||0),0);
const key=(...parts)=>parts.map(String).join("|");
const nullable=v=>v==null?null:Number(v);
async function hasColumns(pool,schema,table,fields){
 const {rows}=await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2",[schema,table]);
 const got=new Set(rows.map(r=>r.column_name));
 return fields.every(c=>got.has(c));
}
function getFilters(req,res){
 const from=String(req.query.desde||""),to=String(req.query.hasta||""),
   raw=String(req.query.farmacias||""),search=String(req.query.buscar||"").trim(),
   module=String(req.query.modulo||"dashboard");
 const families=String(req.query.familias||"").split(",").filter(Boolean);
 if(!validDate(from)||!validDate(to)||Date.parse(to)<Date.parse(from)||
    Date.parse(to)-Date.parse(from)>366*DAY||raw.length>2000||search.length>100||
    families.length>30||families.some(f=>f.length>80)||![
     "dashboard","ventas","compras","proveedores","stock","reposicion",
     "rentabilidad","acciones","informes","asistente"].includes(module)){
  res.status(400).json({error:"Filtros de informes no válidos"});return null;
 }
 const allowed=req.context.allowedPharmacyIds.map(Number),
   ids=raw?raw.split(",").map(Number):allowed;
 if(ids.some(n=>!Number.isSafeInteger(n)||!allowed.includes(n))){
  res.status(403).json({error:"Farmacia no autorizada"});return null;
 }
 if(req.context.role!=="superadministrador"&&
    !req.context.modules[module]&&!(module==="dashboard"&&req.context.modules.dashboard)){
  res.status(403).json({error:"Módulo no habilitado"});return null;
 }
 return {from,to,ids:[...new Set(ids)],search,families,module};
}
export function setupRealReports(app,pool,{requireTenant}){
 app.get("/api/analytics/reportes",...requireTenant(),async(req,res,next)=>{
  const f=getFilters(req,res);if(!f)return;
  try{
   const schema=req.context.client.schema,quoted='"'+schema+'"',
     pharmacyIds=f.ids,
     [articles,sales,buyers,suppliers]=await Promise.all([
      hasColumns(pool,schema,"articulos",["farmacia_codigo","origen_id","nombre","codigo_nacional","familia","pvp","pmc"]),
      hasColumns(pool,schema,"ventas",["farmacia_codigo","articulo_id","fecha","unidades","importe"]),
      hasColumns(pool,schema,"compras",["farmacia_codigo","articulo_id","proveedor_id","unidades","coste_unitario","importe","fecha"]),
      hasColumns(pool,schema,"proveedores",["farmacia_codigo","origen_id","nombre"])
     ]);
   if(!articles)return res.json({available:false,reason:"La tabla real de artículos aún no está disponible para este cliente",kpis:{},monthly:[],
      salesRows:[],buyRows:[],supplierRows:[],stockRows:[],replenishmentRows:[],profitRows:[],actions:[],families:[]});
   // LATERAL + DISTINCT evita multiplicar movimientos por múltiples copias de un artículo.
   const article=`LEFT JOIN LATERAL (
     SELECT a.nombre,a.codigo_nacional,a.familia,a.pvp,a.pmc,a.puc,a.laboratorio,a.origen_id
     FROM ${quoted}.articulos a
     WHERE upper(btrim(a.farmacia_codigo))=upper(btrim(t.farmacia_codigo))
       AND a.origen_id=t.articulo_id
     ORDER BY a.sincronizado_en DESC NULLS LAST LIMIT 1
   ) art ON true`;
   const provider=suppliers?`LEFT JOIN LATERAL (
     SELECT p.nombre FROM ${quoted}.proveedores p
     WHERE upper(btrim(p.farmacia_codigo))=upper(btrim(t.farmacia_codigo))
       AND p.origen_id=t.proveedor_id
     ORDER BY p.sincronizado_en DESC NULLS LAST LIMIT 1
   ) prov ON true`:"";
   const cn="coalesce(nullif(btrim(art.codigo_nacional),''),btrim(t.articulo_id))";
   const pvp="art.pvp";
   const filter=` t.fecha >= $1::date AND t.fecha < $2::date+interval '1 day'
       AND f.id=ANY($3::int[])
       AND ($4::text='' OR ${cn} ILIKE '%'||$4||'%' OR
          coalesce(art.nombre,'') ILIKE '%'||$4||'%')
       AND (cardinality($5::text[])=0 OR coalesce(art.familia,'')=ANY($5::text[]))`;
   const args=[f.from,f.to,pharmacyIds,f.search,f.families];
   const baseTable=(name,alias="t")=>`FROM ${quoted}.${name} ${alias}
       JOIN farmetrica.farmacias f ON f.cliente_slug=$6
        AND upper(btrim(${alias}.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
       ${article}`;
   const pars=[...args,req.context.client.slug];
   const columns=`${cn} AS cn,max(coalesce(art.nombre,t.articulo_id)) AS name,
     max(coalesce(art.familia,'')) AS family,max(art.pvp)::float8 AS pvp,
     max(art.pmc)::float8 AS pmc, max(art.laboratorio) AS laboratory`;
   const empty=[];
   const rowLimit=3000;
   // Evitar un lookup de catálogo por CADA línea de venta. Primero agrupamos
   // movimientos por farmacia + ID local de ERP y resolvemos el artículo una vez
   // por referencia. Dos IDs ERP pueden compartir CN: el GROUP BY exterior mantiene
   // la agregación comercial original sin sumar dos veces.
   const salesByArticle=`FROM (
     SELECT f.id AS pharmacy_id,upper(btrim(t.farmacia_codigo)) AS farmacia_codigo,
       t.articulo_id,sum(t.unidades) AS unidades,sum(t.importe) AS importe
     FROM ${quoted}.ventas t
     JOIN farmetrica.farmacias f ON f.cliente_slug=$6
       AND upper(btrim(t.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
     WHERE t.fecha >= $1::date AND t.fecha < $2::date+interval '1 day'
       AND f.id=ANY($3::int[])
     GROUP BY f.id,upper(btrim(t.farmacia_codigo)),t.articulo_id
   ) t
   JOIN farmetrica.farmacias f ON f.id=t.pharmacy_id AND f.cliente_slug=$6
   ${article}`;
   const articleFilter=`($4::text='' OR ${cn} ILIKE '%'||$4||'%' OR
      coalesce(art.nombre,'') ILIKE '%'||$4||'%')
      AND (cardinality($5::text[])=0 OR coalesce(art.familia,'')=ANY($5::text[]))`;
   const sqlSales=`SELECT f.id::text AS "pharmacyId",${columns},
     sum(t.unidades)::float8 AS units,sum(t.importe)::float8 AS value
     ${salesByArticle} WHERE ${articleFilter}
     GROUP BY f.id,${cn} ORDER BY sum(t.importe) DESC LIMIT ${rowLimit}`;
   // La tabla de compras supera cientos de miles de movimientos. Unir el
   // catálogo y el proveedor una vez por artículo/proveedor, no por línea.
   const purchasesByArticle=`FROM (
     SELECT f.id AS pharmacy_id,upper(btrim(t.farmacia_codigo)) AS farmacia_codigo,
       t.articulo_id,t.proveedor_id,max(t.proveedor_nombre) AS proveedor_nombre,
       sum(t.unidades) AS unidades,sum(t.importe) AS importe,
       sum(t.unidades*t.coste_unitario) FILTER(
         WHERE t.unidades>0 AND t.coste_unitario>0) AS cost,
       sum(t.unidades) FILTER(
         WHERE t.unidades>0 AND t.coste_unitario>0) AS priced_units,
       count(*)::int AS lines
     FROM ${quoted}.compras t
     JOIN farmetrica.farmacias f ON f.cliente_slug=$6
       AND upper(btrim(t.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
     WHERE t.fecha >= $1::date AND t.fecha < $2::date+interval '1 day'
       AND f.id=ANY($3::int[])
     GROUP BY f.id,upper(btrim(t.farmacia_codigo)),t.articulo_id,t.proveedor_id
   ) t JOIN farmetrica.farmacias f ON f.id=t.pharmacy_id AND f.cliente_slug=$6
   ${article}`;
   const sqlBuy=`SELECT f.id::text AS "pharmacyId",${columns},
     t.proveedor_id AS "providerId",
     max(coalesce(nullif(t.proveedor_nombre,''),${suppliers?"prov.nombre,":""}t.proveedor_id)) AS supplier,
     sum(t.unidades)::float8 AS units,
     sum(t.importe)::float8 AS value,
     sum(t.cost)::float8 AS cost,
     sum(t.priced_units)::float8 AS "pricedUnits",
     sum(t.lines)::int AS lines
     ${purchasesByArticle} ${provider} WHERE ${articleFilter}
     GROUP BY f.id,${cn},t.proveedor_id ORDER BY sum(t.importe) DESC LIMIT ${rowLimit}`;
   // Los totales mensuales sin búsqueda/familia no necesitan consultar
   // millones de fichas de artículo. Sus parámetros también deben coincidir
   // exactamente con los placeholders SQL: PostgreSQL rechaza $4/$5 sin tipo.
   const periodWithArticleFilter=Boolean(f.search||f.families.length);
   const periodParams=periodWithArticleFilter?pars:[f.from,f.to,pharmacyIds,req.context.client.slug];
   const periodTenantParam=periodWithArticleFilter?"$6":"$4";
   const sqlPeriod=table=>`SELECT to_char(date_trunc('month',t.fecha),'YYYY-MM') AS month,
     sum(t.unidades)::float8 AS units,sum(t.importe)::float8 AS amount
     FROM ${quoted}.${table} t
     JOIN farmetrica.farmacias f ON f.cliente_slug=${periodTenantParam}
       AND upper(btrim(t.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
     ${periodWithArticleFilter?article:""}
     WHERE t.fecha >= $1::date AND t.fecha < $2::date+interval '1 day'
       AND f.id=ANY($3::int[])
       ${periodWithArticleFilter?`AND ${articleFilter}`:""}
     GROUP BY 1 ORDER BY 1`;
   const sqlProv=`SELECT f.id::text AS "pharmacyId",t.proveedor_id AS "providerId",
     max(coalesce(nullif(t.proveedor_nombre,''),${suppliers?"prov.nombre,":""}t.proveedor_id)) AS name,
     sum(t.importe)::float8 AS value,
     sum(t.unidades)::float8 AS units,
     count(DISTINCT ${cn})::int AS products
     ${purchasesByArticle} ${provider} WHERE ${articleFilter}
     GROUP BY f.id,t.proveedor_id ORDER BY sum(t.importe) DESC LIMIT 1000`;
   const queries=[
    sales&&pharmacyIds.length?pool.query(sqlSales,pars):{rows:[]},
    buyers&&pharmacyIds.length?pool.query(sqlBuy,pars):{rows:[]},
    sales&&pharmacyIds.length?pool.query(sqlPeriod("ventas"),periodParams):{rows:[]},
    buyers&&pharmacyIds.length?pool.query(sqlPeriod("compras"),periodParams):{rows:[]},
    buyers&&pharmacyIds.length?pool.query(sqlProv,pars):{rows:[]},
    pool.query(`SELECT DISTINCT familia FROM ${quoted}.articulos
      WHERE familia IS NOT NULL AND familia<>'' AND
       upper(btrim(farmacia_codigo))=ANY($1::text[]) ORDER BY familia LIMIT 250`,
      [req.context.pharmacies.filter(p=>pharmacyIds.includes(Number(p.id)))
       .map(p=>(p.databaseCode||p.sourceCode).toUpperCase())])
   ];
   const [sale,buys,saleM,buyM,providers,families]=await Promise.all(queries);
   const salesRows=sale.rows.map(r=>({...r,id:key(r.pharmacyId,r.cn),
      unitSalePrice:Number(r.units)>0?Number(r.value)/Number(r.units):null,
      units:Number(r.units),value:Number(r.value),margin:null,marginPct:null,purchaseCost:null,unitMargin:null}));
   const buyRows=buys.rows.map(r=>({...r,id:key(r.pharmacyId,r.cn,r.providerId),
      units:Number(r.units),value:Number(r.value),puc:Number(r.pricedUnits)>0?Number(r.cost)/Number(r.pricedUnits):null,
      target:null,potential:null}));
   const costs=new Map();
   for(const r of buyRows){
    if(r.puc==null)continue;
    const k=key(r.pharmacyId,r.cn),old=costs.get(k)||{units:0,total:0};
    old.units+=Number(r.pricedUnits);old.total+=Number(r.cost);costs.set(k,old);
   }
   let coveredRevenue=0,coveredMargin=0,coveredItems=0;
   for(const r of salesRows){
    const c=costs.get(key(r.pharmacyId,r.cn));
    const cost=c&&c.units>0?c.total/c.units:nullable(r.pmc);
    if(cost!=null && Number.isFinite(cost)){
     r.purchaseCost=cost;r.unitMargin=r.unitSalePrice!=null?round(r.unitSalePrice-cost):null;
     r.margin=round(r.value-r.units*cost);
     r.marginPct=r.value?round(r.margin/r.value*100):null;
     coveredMargin+=r.margin;coveredRevenue+=r.value;coveredItems++;
    }
    r.pvpMarginPct=r.pvp!=null&&cost!=null&&Number(r.pvp)>0?
       round(100*(Number(r.pvp)-cost)/Number(r.pvp)):null;
   }
   // Solo la instantánea existente de Ampedia; nunca declarar stock actual
   // cuando su última importación no es suficientemente reciente.
   let snapshotAvailable=false,stockAsOf=null,stockRows=[];
   if(req.context.client.slug==="ampedia"&&pharmacyIds.length){
    const {rows:stockTable}=await pool.query("SELECT to_regclass('public.stock_farmacia')::text AS tbl");
    if(stockTable[0]?.tbl){
     // Una actualización reciente en ABA NO hace que el stock viejo de EUR
     // parezca actual. Todas las farmacias seleccionadas deben disponer de
     // instantánea dentro de las 48 h.
     const {rows:stamps}=await pool.query(`SELECT id_farmacia::int AS id,
       max(importado_en) AS last
       FROM public.stock_farmacia WHERE id_farmacia=ANY($1::int[])
       GROUP BY id_farmacia`,[pharmacyIds]);
     const valid=stamps.filter(r=>r.last&&Number.isFinite(new Date(r.last).getTime()));
     stockAsOf=valid.length?new Date(Math.min(...valid.map(r=>new Date(r.last).getTime()))).toISOString():null;
     snapshotAvailable=valid.length===pharmacyIds.length &&
       valid.every(r=>Date.now()-new Date(r.last).getTime()<=48*3600000&&
         Date.now()-new Date(r.last).getTime()>=-3600000);
     if(snapshotAvailable){
      // public.stock_farmacia.id_articu es el ID DEL ERP, no el código
      // nacional. Convertir mediante la ficha de artículo de la misma farmacia
      // antes de cruzar demanda, PMC y coste de compras.
      const stockCn="coalesce(nullif(btrim(art.codigo_nacional),''),btrim(s.id_articu))";
      const {rows:sr}=await pool.query(`
       SELECT s.id_farmacia::text AS "pharmacyId",${stockCn} AS cn,
        max(coalesce(art.nombre,s.descripcion)) AS name,
        max(coalesce(art.familia,'')) AS family,
        max(art.pmc)::float8 AS pmc,
        sum(s.stock_actual)::float8 AS units,
        max(s.importado_en) AS "asOf"
       FROM public.stock_farmacia s
       JOIN farmetrica.farmacias f ON f.id=s.id_farmacia AND f.cliente_slug=$4
       LEFT JOIN LATERAL (
        SELECT a.codigo_nacional,a.nombre,a.familia,a.pmc
        FROM ${quoted}.articulos a
        WHERE upper(btrim(a.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
          AND a.origen_id=s.id_articu
        ORDER BY a.sincronizado_en DESC NULLS LAST LIMIT 1
       ) art ON true
       WHERE s.id_farmacia=ANY($1::int[]) AND
         ($2::text='' OR ${stockCn} ILIKE '%'||$2||'%' OR
           coalesce(art.nombre,s.descripcion,'') ILIKE '%'||$2||'%')
         AND (cardinality($3::text[])=0 OR coalesce(art.familia,'')=ANY($3::text[]))
       GROUP BY s.id_farmacia,${stockCn}
       ORDER BY sum(s.stock_actual) DESC LIMIT ${rowLimit}`,
       [pharmacyIds,f.search,f.families,req.context.client.slug]);
      stockRows=sr.map(r=>({...r,id:key(r.pharmacyId,r.cn),
       units:Number(r.units),value:null,coverage:null,excessValue:null,sold:0,need:null,needValue:null}));
     }
    }
   }
   // Muchos ERP entregan inventario directamente en la ficha de artículo.
   // Utilizarlo cuando la antigua tabla de instantáneas no está completa o
   // actualizada; comprobar frescura Y cobertura de cada farmacia.
   // No mezclar inventario antiguo de una farmacia con el reciente de otra.
   let stockSource=snapshotAvailable?"instantanea":"sin datos";
   if(!snapshotAvailable&&pharmacyIds.length&&await hasColumns(pool,schema,"articulos",
     ["farmacia_codigo","origen_id","stock_actual","sincronizado_en","codigo_nacional","nombre","pmc"])){
    const {rows:catalogStatus}=await pool.query(`
      SELECT f.id::int AS id,max(a.sincronizado_en) AS last,
        count(*)::int AS total,count(a.stock_actual)::int AS filled
      FROM ${quoted}.articulos a
      JOIN farmetrica.farmacias f ON f.cliente_slug=$1
        AND upper(btrim(a.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
      WHERE f.id=ANY($2::int[]) GROUP BY f.id`,
      [req.context.client.slug,pharmacyIds]);
    const validCatalog=catalogStatus.length===pharmacyIds.length&&
      catalogStatus.every(r=>r.last&&r.total>0&&r.filled/r.total>=.8&&
        Date.now()-new Date(r.last).getTime()<=48*3600000&&
        Date.now()-new Date(r.last).getTime()>=-3600000);
    if(validCatalog){
     // Elegir solo la última ficha por artículo ERP antes de sumar stock.
     // La identidad del CN siempre se resuelve dentro de la farmacia.
     const {rows:catalogStock}=await pool.query(`
       WITH latest AS MATERIALIZED (
        SELECT DISTINCT ON(f.id,a.origen_id)
          f.id::text AS "pharmacyId",a.origen_id,
          coalesce(nullif(btrim(a.codigo_nacional),''),a.origen_id) AS cn,
          coalesce(nullif(a.nombre,''),a.origen_id) AS name,
          coalesce(a.familia,'') AS family,
          a.pmc::float8 AS pmc,a.stock_actual,a.sincronizado_en
        FROM ${quoted}.articulos a
        JOIN farmetrica.farmacias f ON f.cliente_slug=$4
         AND upper(btrim(a.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
        WHERE f.id=ANY($1::int[]) AND a.origen_id IS NOT NULL
        ORDER BY f.id,a.origen_id,a.sincronizado_en DESC NULLS LAST
       )
       SELECT "pharmacyId",cn,max(name) AS name,max(family) AS family,
        max(pmc)::float8 AS pmc,sum(stock_actual)::float8 AS units,
        max(sincronizado_en) AS "asOf"
       FROM latest
       WHERE stock_actual IS NOT NULL
        AND ($2::text='' OR cn ILIKE '%'||$2||'%' OR name ILIKE '%'||$2||'%')
        AND (cardinality($3::text[])=0 OR family=ANY($3::text[]))
       GROUP BY "pharmacyId",cn
       ORDER BY sum(stock_actual) DESC NULLS LAST LIMIT ${rowLimit}`,
       [pharmacyIds,f.search,f.families,req.context.client.slug]);
     stockRows=catalogStock.map(r=>({...r,id:key(r.pharmacyId,r.cn),
       units:Number(r.units),value:null,coverage:null,excessValue:null,
       sold:0,need:null,needValue:null}));
     snapshotAvailable=true;
     stockSource="catalogo_erp";
     stockAsOf=new Date(Math.min(...catalogStatus.map(r=>new Date(r.last).getTime()))).toISOString();
    }
   }
   // ABCD se deriva de las ventas PostgreSQL en cada consulta, sin botón de recálculo.
   // Su universo es toda la farmacia en el período, independientemente de la
   // búsqueda o de la familia elegida para mostrar los resultados.
   // Evitamos una segunda consulta cuando sqlSales ya devuelve el universo completo.
   let abcdUniverse=sale.rows;
   if(sales&&pharmacyIds.length&&(f.search||f.families.length||sale.rows.length>=rowLimit)){
    const unfilteredSales=`SELECT f.id::text AS "pharmacyId",${cn} AS cn,
      sum(t.unidades)::float8 AS units,sum(t.importe)::float8 AS value
      ${salesByArticle}
      GROUP BY f.id,${cn}`;
    const universe=await pool.query(unfilteredSales,[f.from,f.to,pharmacyIds,"",[],req.context.client.slug]);
    abcdUniverse=universe.rows;
   }
   const abcd=classifyAbcd(abcdUniverse,{scope:r=>r.pharmacyId});
   for(const collection of [salesRows,buyRows,stockRows]){
    for(const row of collection){
     row.abcdClass=sales?(abcd.get(key(row.pharmacyId,row.cn))||"D"):null;
    }
   }
   const sold=new Map(salesRows.map(r=>[r.id,r]));
   for(const s of stockRows){
    const sale=sold.get(s.id);
    s.sold=sale?.units||0;
    const cost=costs.get(s.id),unitCost=cost&&cost.units>0?cost.total/cost.units:nullable(s.pmc);
    s.unitCost=unitCost;
    s.value=unitCost==null?null:round(s.units*unitCost);
    const days=(Date.parse(f.to)-Date.parse(f.from))/DAY+1;
    s.coverage=s.sold>0?round(s.units/(s.sold/days)):null;
    s.zero=s.units<=0&&s.sold>0;
    s.need=s.sold>0?Math.max(0,Math.ceil(s.sold/days*15-s.units)):null;
    s.needValue=s.need!=null&&unitCost!=null?round(s.need*unitCost):null;
    s.excessUnits=s.sold>0?Math.max(0,s.units-Math.ceil(s.sold/days*60)):null;
    s.excessValue=s.excessUnits!=null&&unitCost!=null?round(s.excessUnits*unitCost):null;
   }
   const monthly=[...new Set([...saleM.rows,...buyM.rows].map(x=>x.month))].sort().map(month=>({
    month,ventas:sum(saleM.rows.filter(r=>r.month===month),"amount"),
    compras:sum(buyM.rows.filter(r=>r.month===month),"amount"),
    unidades:sum(saleM.rows.filter(r=>r.month===month),"units"),
    margen:null
   }));
   const supplierRows=providers.rows.map(r=>({...r,id:key(r.pharmacyId,r.providerId),
    family:"",products:Number(r.products),units:Number(r.units),
    value:Number(r.value),potential:null}));
   const replenishmentRows=stockRows.filter(r=>r.need>0);
   const negativeMargins=salesRows.filter(r=>r.margin!=null&&r.margin<0).map(r=>({
    ...r,action:"Revisar margen negativo",impact:Math.abs(r.margin),targetModule:"rentabilidad"
   }));
   const actions=[
    ...negativeMargins,
    ...replenishmentRows.filter(r=>r.needValue!=null).map(r=>({
     ...r,action:"Reponer existencias",impact:r.needValue,targetModule:"reposicion"})),
    ...stockRows.filter(r=>r.excessValue>0).map(r=>({
     ...r,action:"Revisar exceso de stock",impact:r.excessValue,targetModule:"stock"}))
   ].sort((a,b)=>b.impact-a.impact);
   const complete=sale.rows.length<rowLimit&&buys.rows.length<rowLimit;
   const completeStock=snapshotAvailable&&stockRows.length<rowLimit;
   const pricedStock=stockRows.filter(r=>r.value!=null);
   const kpis={
    ventas:sales?round(sum(saleM.rows,"amount")):null,
    unidades:sales?sum(saleM.rows,"units"):null,
    compras:buyers?round(sum(buyM.rows,"amount")):null,
    articulosVendidos:complete?new Set(salesRows.map(r=>r.cn)).size:null,
    articulosComprados:complete?new Set(buyRows.map(r=>r.cn)).size:null,
    proveedores:buyers&&providers.rows.length<1000?supplierRows.length:null,
    stock:completeStock&&pricedStock.length===stockRows.length?round(sum(stockRows,"value")):null,
    margen:sales&&complete&&coveredItems===salesRows.length?round(coveredMargin):null,
    margenPct:sales&&complete&&coveredItems===salesRows.length&&coveredRevenue?round(100*coveredMargin/coveredRevenue):null,
    coberturaCostes:sales&&complete&&salesRows.length?round(100*coveredItems/salesRows.length):null,
    reposiciones:completeStock&&complete?replenishmentRows.length:null,
    reposicionCoste:completeStock&&complete&&replenishmentRows.every(r=>r.needValue!=null)?round(sum(replenishmentRows,"needValue")):null,
    sobrestock:completeStock&&complete&&stockRows.every(r=>r.excessUnits==null||r.excessValue!=null)?
       round(sum(stockRows,"excessValue")):null,
    stockSinRotacion:completeStock&&complete?stockRows.filter(r=>r.units>0&&r.sold<=0).length:null,
    roturas:completeStock&&complete?stockRows.filter(r=>r.zero).length:null,
    potencialCompra:null,compraGenericos:null,potencialGenericos:null,
    acciones:complete?actions.length:null
   };
   res.json({available:true,from:f.from,to:f.to,monthly,kpis,salesRows,buyRows,
    supplierRows,stockRows,replenishmentRows,profitRows:salesRows.filter(r=>r.margin!=null),
    actions,families:families.rows.map(r=>r.familia),
    availability:{sales, purchases:buyers,stock:snapshotAvailable,stockAsOf,stockSource,
     snapshotReason:!snapshotAvailable?"No hay inventario sincronizado en las últimas 48 horas":null,
     rowsTruncated:!complete,marginCoverage:coveredItems}});
  }catch(e){next(e)}
 });
}
