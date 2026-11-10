// Consulta acotada de catálogo y ventas para el preparador de objetivos.
// Sólo expone farmacias autorizadas, CN reales y agregados, nunca tickets.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {promotionCatalogSearchSQL,promotionSearchPatterns,mergePromotionCatalogRows} from "./promotionCatalogSearch.js";
import {isBarcodeSearch} from "./synonymSearch.js";
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const ISO=/^20\d{2}-\d{2}-\d{2}$/;
const CN=/^\d{6}$/;
const cleanCNs=values=>Array.isArray(values)?
  [...new Set(values.map(x=>String(x).trim()))].filter(x=>CN.test(x)):[];
const validPeriod=p=>{
 if(!p||typeof p.id!=="string"||p.id.length>24||!ISO.test(p.from||"")||!ISO.test(p.to||""))return false;
 const start=new Date(p.from+"T00:00:00Z"),end=new Date(p.to+"T00:00:00Z");
 return Number.isFinite(start.getTime())&&Number.isFinite(end.getTime())&&
  start.toISOString().slice(0,10)===p.from&&end.toISOString().slice(0,10)===p.to&&
  end>=start&&(end-start)<=5*366*86400000;
};

const metaCache=new WeakMap();
async function catalogColumns(pool,schema){
 let cache=metaCache.get(pool);
 if(!cache){cache=new Map();metaCache.set(pool,cache);}
 const current=cache.get(schema);
 if(current&&(current.promise||current.expires>Date.now()))
  return current.promise||current.value;
 const pending=pool.query({
  text:"SELECT table_name,column_name FROM information_schema.columns "+
   "WHERE table_schema=$1 AND table_name IN ('articulos','proveedores','sinonimos')",
  values:[schema],query_timeout:1800
 }).then(result=>{
  const value=result.rows||[];
  cache.set(schema,{value,expires:Date.now()+600000});
  return value;
 }).catch(error=>{cache.delete(schema);throw error;});
 cache.set(schema,{promise:pending});
 return pending;
}
const PAGE_SIZE=180;
const MAX_PAGE=50;
async function findPromotionArticles(pool,{schema,slug,ids,search,cns,page=0}){
 const metadata=await catalogColumns(pool,schema);
 const sql=promotionCatalogSearchSQL(schema,metadata);
 const patterns=promotionSearchPatterns(search);
 const pageSize=search?PAGE_SIZE:Math.min(1000,Math.max(1,cns.length));
 const pageLimit=pageSize+1,offset=search?page*PAGE_SIZE:0;
 // Índice GIN: escoger la palabra más larga para acotar rápidamente el maestro.
 const anchor=patterns.reduce((best,word)=>word.length>best.length?word:best,"").toLowerCase();
 const textQuery={text:sql.direct,values:[slug,ids,patterns,pageLimit,offset,anchor],query_timeout:5000};
 const eanQuery=search&&sql.byEAN&&isBarcodeSearch(search)?
  {text:sql.byEAN,values:[slug,ids,[search],pageLimit,offset],query_timeout:5000}:null;
 const directQuery=search?(eanQuery||textQuery):{
  text:sql.byCodes,values:[slug,ids,cns,pageLimit,0],query_timeout:5000
 };
 let directRows=[],directError=null;
 try{
  const result=await pool.query(directQuery);
  directRows=result.rows||[];
  // Si no hay equivalencia en Sinonimo, la búsqueda textual existente sigue funcionando.
  if(eanQuery&&!directRows.length)
   directRows=(await pool.query(textQuery)).rows||[];
 }catch(error){
  directError=error;
  if(eanQuery){
   try{directRows=(await pool.query(textQuery)).rows||[];directError=null;}catch{ /* mantener error original */ }
  }
 }
 let supplierRows=[],receiptRows=[],supplierError=null,supplierCount=0;
 // No consultar proveedores ni el histórico de recepciones cuando el artículo
 // ya aparece en el maestro. La antigua búsqueda hacía los cuatro recorridos
 // incluso al escribir un CN o un nombre que ya se había encontrado.
 if(search&&sql.suppliers&&directRows.length===0&&/[^\d\s]/u.test(search)){
  try{
   const {rows:suppliers}=await pool.query({
    text:sql.suppliers,values:[slug,ids,patterns,120],query_timeout:2000
   });
   supplierCount=suppliers.length;
   if(supplierCount){
    const values=[slug,ids,JSON.stringify(suppliers),pageLimit,offset,patterns];
    const lookup=[
     pool.query({text:sql.bySupplier,values,query_timeout:2800}),
     supplierCount<=40&&sql.byReceiptSupplier?
      pool.query({text:sql.byReceiptSupplier,values,query_timeout:2800}):
      Promise.resolve({rows:[]})
    ];
    const [usual,received]=await Promise.allSettled(lookup);
    if(usual.status==="fulfilled")supplierRows=usual.value.rows||[];
    else supplierError=usual.reason;
    if(received.status==="fulfilled")receiptRows=received.value.rows||[];
    else supplierError=received.reason;
   }
  }catch(error){supplierError=error;}
 }
 const partial=Boolean(directError||supplierError||supplierCount>=120);
 if(partial&&!directRows.length&&!supplierRows.length&&!receiptRows.length)
  throw Error("La búsqueda ha superado el tiempo disponible. Prueba con un término más específico.");
 const rows=[...directRows.slice(0,pageSize),...supplierRows.slice(0,pageSize),
  ...receiptRows.slice(0,pageSize)];
 const products=mergePromotionCatalogRows(rows);
 if(!search&&cns.length){
  const selected=new Set(cns);
  return {products:products.filter(item=>selected.has(item.cn)),
   partial,hasMore:false};
 }
 const hasMore=directRows.length>pageSize||supplierRows.length>pageSize||
  receiptRows.length>pageSize;
 return {products,partial,hasMore,pageSize};
}

export function setupPromotionObjectives(app,pool,{requireTenantModule}){
 const protectedRoute=requireTenantModule("promociones");
 app.post("/api/ventas/objetivos/buscar",...protectedRoute,async(req,res,next)=>{
  try{
   const schema=req.context.client.schema,slug=req.context.client.slug;
   if(!SCHEMA.test(schema)||!SCHEMA.test(slug))return res.status(400).json({error:"Cliente inválido"});
   const search=String(req.body?.search||"").trim().slice(0,90),cns=cleanCNs(req.body?.cns);
   if(promotionSearchPatterns(search).length>12)
    return res.status(400).json({error:"La búsqueda admite hasta 12 palabras"});
   const page=Number(req.body?.page??0);
   if(!Number.isInteger(page)||page<0||page>MAX_PAGE)
    return res.status(400).json({error:"Página de resultados inválida"});
   if(Array.isArray(req.body?.cns)&&cns.length!==new Set(req.body.cns).size||
      cns.length>1000)return res.status(400).json({error:"Introduce un máximo de 1.000 CN válidos"});
   if(search.length<2&&!cns.length)return res.json({products:[]});
   const ids=req.context.allowedPharmacyIds.filter(Number.isSafeInteger);
   if(!ids.length)return res.json({products:[]});
   const result=await findPromotionArticles(pool,{schema,slug,ids,search,cns,page});
   return res.json(result);
  }catch(e){next(e);}
 });
 app.post("/api/ventas/objetivos/historico",...protectedRoute,async(req,res,next)=>{
  try{
   const schema=req.context.client.schema,slug=req.context.client.slug;
   if(!SCHEMA.test(schema)||!SCHEMA.test(slug))return res.status(400).json({error:"Cliente inválido"});
   const cns=cleanCNs(req.body?.cns),periods=req.body?.periods,requested=req.body?.pharmacyIds;
   if(!cns.length||cns.length>1000||!Array.isArray(periods)||periods.length<1||
     periods.length>6||periods.some(p=>!validPeriod(p))||
     !Array.isArray(req.body?.cns)||cns.length!==new Set(req.body.cns).size)
    return res.status(400).json({error:"CNs o períodos inválidos"});
   const allowed=new Set(req.context.allowedPharmacyIds.map(Number));
   const ids=Array.isArray(requested)?[...new Set(requested.map(Number))]:
     [...allowed];
   if(ids.some(id=>!Number.isSafeInteger(id)||!allowed.has(id)))
     return res.status(403).json({error:"Farmacia fuera de tu ámbito"});
   if(!ids.length)return res.json({periods:Object.fromEntries(periods.map(p=>[p.id,{}])),amounts:Object.fromEntries(periods.map(p=>[p.id,{}]))});
   // Los tickets usan a veces el ID Farmatic y no el CN. Resolver el maestro
   // una sola vez y comparar siempre por farmacia para evitar cruces de IDs.
   const metadata=await catalogColumns(pool,schema);
   const have=(column)=>metadata.some(c=>c.table_name==="articulos"&&c.column_name===column);
   // Usar las expresiones de los índices del catálogo (migración 045):
   // en lotes de muchos CN, un OR con btrim sin índice forzaba barridos.
   const normalizedMatch=have("cn_normalizado")?
    " OR left(btrim(a.cn_normalizado::text),6)=ANY($3::text[])":"";
   const matchProducts="(a.origen_id::text=ANY($3::text[]) "+
    "OR left(btrim(a.codigo_nacional::text),6)=ANY($3::text[])"+normalizedMatch+")";
   const {rows:links}=await pool.query(`
    SELECT DISTINCT f.id::text AS pharmacy_id,btrim(a.origen_id::text) AS source_id
    FROM "${schema}".articulos a
    JOIN farmetrica.farmacias f ON f.cliente_slug=$1
      AND upper(btrim(a.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
    WHERE f.id=ANY($2::int[]) AND ${matchProducts}`,
    [slug,ids,cns]);
   const mappedKeys=links.filter(r=>r.source_id).map(r=>r.pharmacy_id+"|"+r.source_id);
   const articleIds=[...new Set([...cns,...links.map(r=>r.source_id).filter(Boolean)])];
   // Calcular todos los períodos en un único acceso a ventas. Antes se
   // ejecutaba un GROUP BY completo por cada período (hasta seis recorridos
   // para los mismos 1.000 CN). FILTER devuelve un par de agregados por período.
   const windows=periods.map((_,i)=>
    "(v.fecha >= $"+(6+i*2)+"::date AND v.fecha < ($"+(7+i*2)+"::date + interval '1 day'))");
   const columns=windows.flatMap((window,i)=>[
    "coalesce(sum(v.unidades) FILTER (WHERE "+window+"),0)::float8 AS units_"+i,
    "coalesce(sum(v.importe) FILTER (WHERE "+window+"),0)::float8 AS amount_"+i
   ]);
   const query=`SELECT f.id::text AS pharmacy_id, ${columns.join(", ")}
     FROM "${schema}".fm_ventas_analitica v JOIN farmetrica.farmacias f
      ON f.cliente_slug=$1
      AND upper(btrim(v.farmacia_codigo::text))=${pharmacyDataCodeSQL("f")}
     WHERE f.id=ANY($2::int[])
       AND (${windows.join(" OR ")})
       AND btrim(v.articulo_id::text)=ANY($4::text[])
       AND (btrim(v.articulo_id::text)=ANY($3::text[])
          OR f.id::text||'|'||btrim(v.articulo_id::text)=ANY($5::text[]))
     GROUP BY f.id`;
   const values=[slug,ids,cns,articleIds,mappedKeys,
    ...periods.flatMap(p=>[p.from,p.to])];
   const {rows:sold}=await pool.query({text:query,values,query_timeout:28000});
   const totals={},amounts={};
   for(let i=0;i<periods.length;i++){
    const p=periods[i];
    totals[p.id]=Object.fromEntries(sold.map(r=>[r.pharmacy_id,Number(r["units_"+i])]));
    amounts[p.id]=Object.fromEntries(sold.map(r=>[r.pharmacy_id,Number(r["amount_"+i])]));
   }
   // Stock de la ficha Farmatic más reciente por ID de artículo y farmacia.
   // No contar varias sincronizaciones o referencias seleccionadas dos veces.
   let stock={},stockUpdatedAt=null,stockUnavailable=false,stockMissingPharmacyIds=[];
   if(have("stock_actual")){
    const order=have("sincronizado_en")?
     "a.sincronizado_en DESC NULLS LAST":"a.origen_id";
    const stamp=have("sincronizado_en")?
     "a.sincronizado_en AS updated_at":"NULL::timestamp AS updated_at";
    try{
     const {rows}=await pool.query({text:`
      WITH latest AS (
       SELECT DISTINCT ON (f.id,a.origen_id)
        f.id::text AS pharmacy_id,a.stock_actual::float8 AS stock,
        ${stamp}
       FROM "${schema}".articulos a
       JOIN farmetrica.farmacias f ON f.cliente_slug=$1
        AND upper(btrim(a.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
       WHERE f.id=ANY($2::int[]) AND ${matchProducts}
       ORDER BY f.id,a.origen_id,${order}
      )
      SELECT pharmacy_id,sum(stock)::float8 AS units,
       count(stock)::int AS known_items,
       count(*)::int AS matched_items,
       max(updated_at) AS updated_at
      FROM latest GROUP BY pharmacy_id`,
      values:[slug,ids,cns],query_timeout:16000});
     // El stock de una selección es la suma de las unidades que Farmatic
     // registra para sus artículos. Un NULL aislado no anula la suma de
     // cientos de referencias y no debe transformar el objetivo en cero.
     // Si NINGÚN artículo de una farmacia aporta un valor numérico, la
     // respuesta carece de stock confirmado (nunca se inventa un cero).
     const known=row=>row.known_items==null?row.units!=null:Number(row.known_items)>0;
     stock=Object.fromEntries(rows.filter(known)
      .map(row=>[row.pharmacy_id,Number(row.units)]));
     stockMissingPharmacyIds=rows.filter(row=>!known(row))
      .map(row=>row.pharmacy_id);
     const dates=rows.map(row=>row.updated_at).filter(Boolean)
      .map(value=>new Date(value).getTime()).filter(Number.isFinite);
     if(dates.length)stockUpdatedAt=new Date(Math.min(...dates)).toISOString();
    }catch(error){
     console.warn("PROMOTION_STOCK_LOOKUP",error.code||error.name);
     stockUnavailable=true;
    }
   }else stockUnavailable=true;
   res.json({periods:totals,amounts,stock,stockUpdatedAt,stockUnavailable,stockMissingPharmacyIds});
  }catch(e){next(e);}
 });
}