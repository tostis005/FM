// Conjuntos DCPF de la AEMPS combinados con ventas/compras/artículos REALES de Ampedia.
// El percentil de referencia afecta solo a la estimación, nunca al coste observado.
import {readPricePolicy} from "./pricePolicy.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {includedPurchaseSupplier} from "./supplierReporting.js";
import {loadCommercialNames} from "./commercialNames.js";
import {classifyAbcd} from "./abcd.js";
import {GENERIC_GROUP_SORT_KEYS,sortGenericGroups} from "./genericGroupSort.js";
const ISO=/^20\d{2}-\d{2}-\d{2}$/;
function dayValid(v){if(!ISO.test(v))return false;const d=new Date(v+"T00:00:00Z");return !isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;}
function getFilter(req,res){
 const from=String(req.query.desde||""),to=String(req.query.hasta||""),
  raw=String(req.query.farmacias||""),search=String(req.query.buscar||"").trim(),
  abcd=String(req.query.abcd||"all").toUpperCase(),
  order=String(req.query.orden||"revenue"),direction=String(req.query.direccion||"desc").toLowerCase();
 if(!dayValid(from)||!dayValid(to)||from>to||
  (Date.parse(to)-Date.parse(from))/86400000>366||search.length>100||raw.length>2000||!["ALL","A","B","C","D"].includes(abcd)||
  !GENERIC_GROUP_SORT_KEYS.includes(order)||!["asc","desc"].includes(direction)){
  res.status(400).json({error:"Fechas o filtros inválidos"});return null;
 }
 const allowed=req.context.allowedPharmacyIds.map(Number);
 const ids=raw?raw.split(",").map(Number):allowed;
 if(ids.some(id=>!Number.isSafeInteger(id)||!allowed.includes(id))){
  res.status(403).json({error:"Farmacia no autorizada"});return null;
 }
 return {from,to,ids:[...new Set(ids)],search,abcd,order,direction};
}
const round=(v,dec=4)=>Math.round(Number(v)*10**dec)/10**dec;
const count=(rows,k)=>rows.reduce((n,r)=>n+Number(r[k]||0),0);
async function fields(pool,schema,table){
 const {rows}=await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2",
  [schema,table]);
 return new Set(rows.map(r=>r.column_name));
}
function mapCatalog(catalog){
 return new Map(catalog.map(g=>[g.dcpf,{...g,salesUnits:0,revenue:0,purchaseUnits:0,
  spent:0,averagePuc:null,bestPuc:null,referenceSupplier:null,
  referenceCn:null,referencePharmacyId:null,averagePvp:null,pvpMarginPct:null,estimatedMargin:null,
  indicativeSavings:null,paidCost:0,pricedUnits:0,pvpValue:0,pvpUnits:0,
  savings:0,referenceAvailable:false}]));
}
export function setupGenericosReales(app,pool,{requireTenantModule}){
 const guard=requireTenantModule("genericos");
 async function query(req,res,detail=false){
  const f=getFilter(req,res);if(!f)return;
  const selectedDcpf=detail?String(req.params.dcpf||""):"";
  if(detail&&!/^\d{1,30}$/.test(selectedDcpf))
   return res.status(400).json({error:"Conjunto inválido"});
  try{
   const schema='"'+req.context.client.schema+'"';
   const [version,catalog,policy]=await Promise.all([
    pool.query("SELECT sha256,fecha_fuente,importado_en,total_presentaciones,total_genericos FROM farmetrica.nomenclator_versiones WHERE activo LIMIT 1"),
    pool.query(`SELECT dcpf,min(coalesce(nullif(principio_activo,''),nombre)) AS principle,
      min(nombre) AS name,count(*)::int AS "skuCount",
      count(*) FILTER(WHERE generico)::int AS "genericCount",
      count(DISTINCT nullif(laboratorio_codigo,''))::int AS "labCount"
      FROM farmetrica.nomenclator_presentaciones
      ${detail?"WHERE dcpf=$1":""}
      GROUP BY dcpf HAVING bool_or(generico)`,detail?[selectedDcpf]:[]),
    readPricePolicy(pool,req.context.client.slug)
   ]);
   if(!version.rows.length)return res.json({version:null,groups:[],totalGroups:0,summary:{},
     sales:{available:false},purchases:{available:false},policy});
   // Los orígenes pueden sincronizarse por separado.
   const [artCols,saleCols,buyCols]=await Promise.all([
    fields(pool,req.context.client.schema,"articulos"),
    fields(pool,req.context.client.schema,"fm_ventas_analitica"),
    fields(pool,req.context.client.schema,"fm_recepciones_analitica")
   ]);
   const hasCols=(cols,...needed)=>needed.every(c=>cols.has(c));
   const hasArt=hasCols(artCols,"farmacia_codigo","origen_id","codigo_nacional","sincronizado_en","pvp","pmc","nombre");
   const hasSales=hasArt&&hasCols(saleCols,"farmacia_codigo","articulo_id","unidades","importe","fecha");
   const hasBuys=hasArt&&hasCols(buyCols,"farmacia_codigo","articulo_id","proveedor_id","proveedor_nombre","unidades","importe","coste_unitario","fecha");
   if(!hasArt||(!hasSales&&!hasBuys)){
    return res.status(422).json({error:"Este cliente todavía no dispone del contrato normalizado para genéricos"});
   }
   const args=[f.from,f.to,f.ids,req.context.client.slug];
   // No reagrupar todo el histórico para abrir un único DCPF.
   let detailArticles=[];
   if(detail&&f.ids.length){
    const codes=(req.context.pharmacies||[]).filter(p=>f.ids.includes(Number(p.id)))
      .map(p=>String(p.databaseCode||p.sourceCode||"").trim().toUpperCase());
    const [local,official]=await Promise.all([
     pool.query(`SELECT DISTINCT a.origen_id AS id
      FROM ${schema}.articulos a JOIN farmetrica.nomenclator_presentaciones n
        ON n.cn=nullif(btrim(a.codigo_nacional),'')
      WHERE n.dcpf=$1 AND upper(btrim(a.farmacia_codigo))=ANY($2::text[])`,
      [selectedDcpf,codes]),
     pool.query("SELECT cn FROM farmetrica.nomenclator_presentaciones WHERE dcpf=$1",[selectedDcpf])
    ]);
    detailArticles=[...new Set([...local.rows.map(x=>x.id),...official.rows.map(x=>x.cn)].filter(Boolean))];
   }
   const scopedArticles=detail?"AND v.articulo_id=ANY($5::text[])":"";
   const scopedArgs=detail?[...args,detailArticles,selectedDcpf]:args;
   const art=`LEFT JOIN LATERAL(
      SELECT codigo_nacional,pvp,pmc,nombre FROM ${schema}.articulos a
      WHERE upper(btrim(a.farmacia_codigo))=upper(btrim(c.farmacia_codigo))
        AND a.origen_id=c.articulo_id
      ORDER BY a.sincronizado_en DESC NULLS LAST LIMIT 1
     ) a ON true`;
   const nJoin=`JOIN farmetrica.nomenclator_presentaciones n ON
     n.cn=coalesce(nullif(btrim(a.codigo_nacional),''),btrim(c.articulo_id))`;
   const ph=`JOIN farmetrica.farmacias f ON f.cliente_slug=$4
      AND upper(btrim(c.farmacia_codigo))=${pharmacyDataCodeSQL("f")}`;
   const [sales,purchases]=await Promise.all([
    hasSales&&f.ids.length?pool.query(`
      WITH c AS MATERIALIZED (
        SELECT v.farmacia_codigo,v.articulo_id,
          sum(v.unidades) AS unidades,sum(v.importe) AS importe
        FROM ${schema}.fm_ventas_analitica v
        JOIN farmetrica.farmacias scope ON scope.cliente_slug=$4
          AND upper(btrim(v.farmacia_codigo))=${pharmacyDataCodeSQL("scope")}
        WHERE scope.id=ANY($3::int[])
          AND v.fecha>=$1::date AND v.fecha<$2::date+interval '1 day'
          ${scopedArticles}
        GROUP BY v.farmacia_codigo,v.articulo_id
      )
      SELECT n.dcpf,n.cn,f.id::int AS "pharmacyId",
        sum(c.unidades)::float8 AS units,sum(c.importe)::float8 AS revenue
      FROM c ${ph} ${art} ${nJoin}
      WHERE f.id=ANY($3::int[]) ${detail?"AND n.dcpf=$6":""} GROUP BY n.dcpf,n.cn,f.id`,scopedArgs):{rows:[]},
    hasBuys&&f.ids.length?pool.query(`
      WITH c AS MATERIALIZED (
        SELECT v.farmacia_codigo,v.articulo_id,v.proveedor_id,
          max(v.proveedor_nombre) AS proveedor_nombre,
          sum(v.unidades) AS unidades,sum(v.importe) AS importe,
          sum(v.coste_unitario*v.unidades) FILTER(
            WHERE v.unidades>0 AND v.coste_unitario>0) AS paid_cost,
          sum(v.unidades) FILTER(
            WHERE v.unidades>0 AND v.coste_unitario>0) AS paid_units,
          count(*)::int AS lines
        FROM ${schema}.fm_recepciones_analitica v
        JOIN farmetrica.farmacias scope ON scope.cliente_slug=$4
          AND upper(btrim(v.farmacia_codigo))=${pharmacyDataCodeSQL("scope")}
        WHERE scope.id=ANY($3::int[]) AND v.fecha>=$1::date
          AND v.fecha<$2::date+interval '1 day'
          AND ${includedPurchaseSupplier({tenant:"$4",code:"v.proveedor_id",name:"v.proveedor_nombre"})}
          ${scopedArticles}
        GROUP BY v.farmacia_codigo,v.articulo_id,v.proveedor_id
      )
      SELECT n.dcpf,n.cn,f.id::int AS "pharmacyId",
      c.proveedor_id AS "supplierCode",
      max(coalesce(nullif(c.proveedor_nombre,''),c.proveedor_id)) AS supplier,
      max(n.nombre) AS name,max(n.laboratorio) AS laboratory,
      sum(c.unidades) FILTER(WHERE c.unidades>0)::float8 AS units,
      sum(c.importe)::float8 AS spend,
      sum(c.paid_cost)::float8 AS cost,
      sum(c.paid_units)::float8 AS "pricedUnits",
      sum(a.pvp*c.unidades) FILTER(WHERE c.unidades>0 AND a.pvp>0)::float8 AS "pvpCost",
      sum(c.unidades) FILTER(WHERE c.unidades>0 AND a.pvp>0)::float8 AS "pvpUnits",
      sum(c.lines)::int AS "purchaseLines"
      FROM c ${ph} ${art} ${nJoin}
      WHERE f.id=ANY($3::int[]) ${detail?"AND n.dcpf=$6":""}
      GROUP BY n.dcpf,n.cn,f.id,c.proveedor_id`,scopedArgs):{rows:[]}
   ]);
   // No confundir período de visualización y ventana de referencia:
   // esta última termina el mismo día del informe y utiliza meses/pct por farmacia.
   // Agrupar compras por farmacia, artículo, proveedor y PUC ANTES de
   // consultar el catálogo. Para el percentil no importan fechas ni orden de
   // líneas al mismo precio: la ponderación por unidades es idéntica.
   // Conservar count(*) permite exigir el mismo mínimo de 3 compras reales.
   const refs=hasBuys&&f.ids.length?await pool.query(`
    WITH c AS MATERIALIZED (
      SELECT f.id::int AS pharmacy,c.farmacia_codigo,c.articulo_id,
        c.proveedor_id,c.coste_unitario::float8 AS price,
        coalesce(pl.percentil,pg.percentil,20)::float8 AS pct,
        sum(c.unidades)::float8 AS qty,count(*)::int AS lines
      FROM ${schema}.fm_recepciones_analitica c
      JOIN farmetrica.farmacias f ON f.cliente_slug=$3
        AND upper(btrim(c.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
      LEFT JOIN farmetrica.politica_precios pg
        ON pg.cliente_slug=$3 AND pg.farmacia_id=0
      LEFT JOIN farmetrica.politica_precios pl
        ON pl.cliente_slug=$3 AND pl.farmacia_id=f.id
      WHERE f.id=ANY($2::int[]) AND c.fecha <= $1::date+interval '1 day'
        AND c.fecha >= ($1::date-make_interval(months=>coalesce(pl.meses,pg.meses,6)))
        AND c.unidades>0 AND c.coste_unitario>0
        ${detail?"AND c.articulo_id=ANY($4::text[])":""}
        AND ${includedPurchaseSupplier({tenant:"$3",code:"c.proveedor_id",name:"c.proveedor_nombre"})}
      GROUP BY f.id,c.farmacia_codigo,c.articulo_id,c.proveedor_id,
        c.coste_unitario,coalesce(pl.percentil,pg.percentil,20)
    ), raw AS (
      SELECT c.pharmacy,n.dcpf,n.cn,c.proveedor_id AS supplier,
        c.qty,c.price,c.pct,c.lines
      FROM c
      ${art}
      ${nJoin}
      ${detail?"WHERE n.dcpf=$5":""}
    ), ranked AS (
      SELECT raw.*,
        sum(qty) OVER (PARTITION BY pharmacy,dcpf,cn,supplier) AS total_qty,
        sum(qty) OVER (PARTITION BY pharmacy,dcpf,cn,supplier
          ORDER BY price,cn
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumul
      FROM raw
    ), eligible AS (
      SELECT *,greatest(0,least(qty,total_qty*pct/100-(cumul-qty))) AS selected_qty
      FROM ranked
    )
    SELECT pharmacy AS "pharmacyId",dcpf,cn,supplier AS "supplierCode",
      (sum(price*selected_qty)/nullif(sum(selected_qty),0))::float8 AS "referencePuc",
      sum(lines)::int AS "sampleLines",sum(qty)::float8 AS "sampleUnits"
    FROM eligible
    GROUP BY pharmacy,dcpf,cn,supplier
    HAVING sum(lines)>=3 AND sum(selected_qty)>0
   `,detail?[f.to,f.ids,req.context.client.slug,detailArticles,selectedDcpf]:[f.to,f.ids,req.context.client.slug]):{rows:[]};
   const refByGroup=new Map();
   for(const r of refs.rows){
    const k=String(r.pharmacyId)+"|"+r.dcpf;
    const current=refByGroup.get(k);
    if(!current||Number(r.referencePuc)<Number(current.referencePuc))refByGroup.set(k,r);
   }
   const sums=mapCatalog(catalog.rows);
   const costPhDcpf=new Map();
   for(const p of purchases.rows){
    const g=sums.get(p.dcpf);if(!g)continue;
    g.purchaseUnits+=Number(p.units||0);g.spent+=Number(p.spend||0);
    g.paidCost+=Number(p.cost||0);g.pricedUnits+=Number(p.pricedUnits||0);
    g.pvpValue+=Number(p.pvpCost||0);g.pvpUnits+=Number(p.pvpUnits||0);
    const x=String(p.pharmacyId)+"|"+p.dcpf;
    const old=costPhDcpf.get(x)||{cost:0,units:0};
    old.cost+=Number(p.cost||0);old.units+=Number(p.pricedUnits||0);
    costPhDcpf.set(x,old);
    const ref=refByGroup.get(x);
    if(ref && Number(p.pricedUnits)>0){
     const own=Number(p.cost)/Number(p.pricedUnits),best=Number(ref.referencePuc);
     const potential=Math.max(0,own-best)*Number(p.pricedUnits);
     g.savings+=potential;
     if(g.bestPuc==null||best<g.bestPuc){
      g.bestPuc=best;g.referenceSupplier=ref.supplierCode;g.referenceCn=ref.cn;
      g.referencePharmacyId=p.pharmacyId;
     }
     g.referenceAvailable=true;
    }
   }
   const salesPh=new Map();
   for(const s of sales.rows){
    const g=sums.get(s.dcpf);if(!g)continue;
    g.salesUnits+=Number(s.units);g.revenue+=Number(s.revenue);
    const k=String(s.pharmacyId)+"|"+s.dcpf;
    const curr=salesPh.get(k)||{units:0,revenue:0};
    curr.units+=Number(s.units);curr.revenue+=Number(s.revenue);salesPh.set(k,curr);
   }
   for(const g of sums.values()){
    g.averagePuc=g.pricedUnits>0?round(g.paidCost/g.pricedUnits):null;
    g.averagePvp=g.pvpUnits>0?round(g.pvpValue/g.pvpUnits):null;
    g.pvpMarginPct=g.averagePvp!=null&&g.averagePuc!=null&&g.averagePvp>0?
     round(100*(g.averagePvp-g.averagePuc)/g.averagePvp,2):null;
    let margin=0,covered=0;
    for(const [scope,s]of salesPh){
     if(!scope.endsWith("|"+g.dcpf))continue;
     const p=costPhDcpf.get(scope);
     if(p?.units>0){margin+=s.revenue-s.units*(p.cost/p.units);covered+=s.units}
    }
    g.estimatedMargin=covered>0?round(margin,2):null;
    g.marginCoverageUnits=covered;
    g.indicativeSavings=g.referenceAvailable?round(g.savings,2):null;
    delete g.paidCost;delete g.pricedUnits;delete g.pvpValue;delete g.pvpUnits;delete g.savings;
   }
   // Priorización viva de conjuntos completos DCPF, antes de filtrar o paginar.
   // Los CN equivalentes se han agregado a nivel de conjunto en sums.
   const classes=classifyAbcd([...sums.values()],{
    identity:g=>g.dcpf,revenue:g=>g.revenue,units:g=>g.salesUnits
   });
   for(const g of sums.values())g.abcdClass=hasSales?(classes.get("_all|"+g.dcpf)||"D"):null;
   if(detail){
    const g=sums.get(selectedDcpf);
    if(!g)return res.status(404).json({error:"Conjunto desconocido"});
    const products=await pool.query(`SELECT cn,nombre,laboratorio,laboratorio_codigo,
      principio_activo,generico,comercializado FROM farmetrica.nomenclator_presentaciones
      WHERE dcpf=$1 ORDER BY generico DESC,nombre,cn`,[selectedDcpf]);
    const relevant=refs.rows.filter(r=>r.dcpf===selectedDcpf);
    const scopedPurchases=purchases.rows.filter(r=>r.dcpf===selectedDcpf);
    const commercial=await loadCommercialNames(pool,req.context,scopedPurchases.map(p=>({
     pharmacyId:p.pharmacyId,supplierCode:p.supplierCode
    })).concat(scopedPurchases.map(p=>({
     pharmacyId:p.pharmacyId,supplierCode:refByGroup.get(String(p.pharmacyId)+"|"+p.dcpf)?.supplierCode
    }))));
    return res.json({products:products.rows,
     sales:sales.rows.filter(r=>r.dcpf===selectedDcpf),
     purchases:scopedPurchases.map(p=>({
      ...p,
      supplier:commercial.supplier(p.pharmacyId,p.supplierCode),
      puc:Number(p.pricedUnits)>0?round(Number(p.cost)/Number(p.pricedUnits)):null,
      referencePuc:relevant.find(r=>String(r.pharmacyId)===String(p.pharmacyId)&&r.cn===p.cn&&r.supplierCode===p.supplierCode)?.referencePuc??null,
      targetPuc:refByGroup.get(String(p.pharmacyId)+"|"+p.dcpf)?.referencePuc??null,
      targetSupplier:refByGroup.get(String(p.pharmacyId)+"|"+p.dcpf)?.supplierCode??null,
      targetSupplierName:refByGroup.get(String(p.pharmacyId)+"|"+p.dcpf)?.supplierCode?
       commercial.supplier(p.pharmacyId,refByGroup.get(String(p.pharmacyId)+"|"+p.dcpf).supplierCode):null,
      targetCn:refByGroup.get(String(p.pharmacyId)+"|"+p.dcpf)?.cn??null,
      potential:Number(p.pricedUnits)>0&&refByGroup.has(String(p.pharmacyId)+"|"+p.dcpf)?
       round(Math.max(0,Number(p.cost)/Number(p.pricedUnits)-
         Number(refByGroup.get(String(p.pharmacyId)+"|"+p.dcpf).referencePuc))*Number(p.pricedUnits),2):null
     })),references:relevant,salesAvailable:hasSales,purchasesAvailable:hasBuys,policy});
   }
   const term=f.search.toLocaleLowerCase("es");
   let groups=[...sums.values()].filter(g=>!term||(g.principle+" "+g.name).toLocaleLowerCase("es").includes(term));
   if(term){
    const {rows:matched}=await pool.query(`SELECT DISTINCT dcpf FROM farmetrica.nomenclator_presentaciones
     WHERE cn ILIKE '%'||$1||'%' OR nombre ILIKE '%'||$1||'%'`,[term]);
    const ids=new Set(matched.map(x=>x.dcpf));
    groups=[...sums.values()].filter(g=>ids.has(g.dcpf)||(g.principle+" "+g.name).toLocaleLowerCase("es").includes(term));
   }
   if(f.abcd!=="ALL")groups=groups.filter(g=>g.abcdClass===f.abcd);
   const topGroups=sortGenericGroups(groups,"revenue","desc").slice(0,12);
   groups=sortGenericGroups(groups,f.order,f.direction);
   const summary={totalGroups:groups.length,salesUnits:count(groups,"salesUnits"),
    revenue:round(count(groups,"revenue"),2),purchases:round(count(groups,"spent"),2),
    savings:groups.some(g=>g.indicativeSavings!=null)?round(count(groups,"indicativeSavings"),2):null};
   res.json({version:version.rows[0],groups:groups.slice(0,500),topGroups,totalGroups:groups.length,
    summary,policy,sales:{available:hasSales},purchases:{available:hasBuys},
    note:"PUC observado: media ponderada por unidades con coste neto de recepciones. Objetivo: percentil bajo configurable por farmacia/CN/proveedor, con muestra mínima de 3 líneas. El menor objetivo entre farmacias se identifica con su farmacia de origen; el ahorro se calcula exclusivamente dentro de cada farmacia."});
  }catch(e){throw e}
 }
 app.get("/api/genericos/reales",...guard,async(req,res,next)=>{
  try{await query(req,res)}catch(e){next(e)}
 });
 app.get("/api/genericos/reales/:dcpf",...guard,async(req,res,next)=>{
  try{await query(req,res,true)}catch(e){next(e)}
 });
}
