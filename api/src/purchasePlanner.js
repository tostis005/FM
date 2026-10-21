import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const VALID_DATE=/^\d{4}-\d{2}-\d{2}$/;
const DAY=86400000;
const normalize=x=>String(x??"").trim().toUpperCase();
const validDate=s=>VALID_DATE.test(s)&&!Number.isNaN(Date.parse(s+"T00:00:00Z"))&&new Date(s+"T00:00:00Z").toISOString().slice(0,10)===s;

export function proposePurchase({stock,units3=0,units12=0,ordered=0,interval=7,lead=2,safety=0}){
 if(stock===null||stock===undefined||!Number.isFinite(Number(stock))||Number(stock)<0)
  return {suggested:null,reason:"Existencias no disponibles"};
 if(![units3,units12,ordered,interval,lead,safety].every(x=>Number.isFinite(Number(x))&&Number(x)>=0))
  return {suggested:null,reason:"Datos insuficientes"};
 const daily=Math.max(Number(units3)/90,Number(units12)/365);
 const demand=daily*(Number(interval)+Number(lead));
 return {suggested:Math.max(0,Math.min(999999,Math.ceil(demand+Number(safety)-Number(stock)-Number(ordered)-1e-9))),
  daily:+daily.toFixed(4),demand:+demand.toFixed(2),ordered:Number(ordered),
  formula:"máx(ventas 3m/90, ventas 12m/365) × (intervalo + plazo) + seguridad − stock − pedidos ya preparados"};
}
// DCPF oficial solo para presentaciones EFG; otros artículos siguen por CN.
// Las necesidades se calculan por farmacia y conjunto, nunca sumando pronósticos
// independientes que podrían duplicar el pedido de equivalentes.
export function groupPurchaseRows(rows){
 const byIdentity=new Map();
 for(const p of rows){
  const cn=normalize(p.cn),dcpf=p.genericDcpf?String(p.genericDcpf).trim():"";
  const generic=Boolean(dcpf);
  const key=generic?"DCPF:"+dcpf:cn?"CN:"+cn:"ERP:"+p.pharmacyId+":"+p.articleId;
  if(!byIdentity.has(key))byIdentity.set(key,{
   key,kind:generic?"generico":"articulo",dcpf:generic?dcpf:null,
   cn:generic?null:cn||null,articleName:generic?(p.genericName||p.articleName):p.articleName||p.articleId,
   lines:[]});
  byIdentity.get(key).lines.push(p);
 }
 return [...byIdentity.values()].map(({lines,...group})=>{
  const byPharmacy=new Map();
  for(const p of lines){
   const id=String(p.pharmacyId);
   if(!byPharmacy.has(id))byPharmacy.set(id,[]);
   byPharmacy.get(id).push(p);
  }
  const pharmacies=[...byPharmacy.entries()].map(([pharmacyId,options])=>{
   const first=options[0];
   const total=k=>options.reduce((n,p)=>n+Number(p[k]||0),0);
   const stock=options.every(p=>p.stock!==null&&p.stock!==undefined)?
    total("stock"):null;
   const ordered=total("ordered"),unitsPeriod=total("unitsPeriod"),
    units3=total("units3"),units12=total("units12");
   const calculated=options.length===1?
    {suggested:first.suggested,daily:first.daily,demand:first.demand}:
    proposePurchase({stock,units3,units12,ordered,interval:first.interval,
     lead:first.lead,safety:first.safety});
   if(options.some(p=>p.commitmentsAvailable===false))
    calculated.suggested=null;
   return {...first,pharmacyId,groupKey:group.key,options:options.map(p=>({
    articleId:p.articleId,articleName:p.articleName,cn:p.cn,stock:p.stock,
    unitsPeriod:p.unitsPeriod,units3:p.units3,units12:p.units12
   })),stock,ordered,unitsPeriod,units3,units12,...calculated,
    stockAt:options.map(p=>p.stockAt).every(Boolean)?
     options.map(p=>p.stockAt).sort()[0]:null,
    confidence:stock===null?"sin_stock":
     options.some(p=>p.confidence==="stock_antiguo")?"stock_antiguo":
     options.some(p=>p.confidence!=="calculable")?"fecha_desconocida":"calculable",
    policyDefault:options.some(p=>p.policyDefault)};
  });
  const sum=k=>pharmacies.reduce((n,p)=>n+Number(p[k]||0),0);
  return {...group,pharmacies,productCount:lines.length,
   unitsPeriod:sum("unitsPeriod"),units3:sum("units3"),units12:sum("units12"),
   stock:pharmacies.every(p=>p.stock!==null)?sum("stock"):null,
   suggested:pharmacies.some(p=>p.suggested===null)?null:sum("suggested")};
 }).sort((a,b)=>(b.suggested||0)-(a.suggested||0)||
   String(a.articleName).localeCompare(b.articleName,"es"));
}
export function setupPurchasePlanner(app,pool,{requireTenant}){
 app.get("/api/analytics/pedidos/propuesta",...requireTenant(),async(req,res,next)=>{
  const ctx=req.context;
  if(ctx.role!=="superadministrador"&&ctx.modules?.compras!==true)
   return res.status(403).json({error:"Compras no habilitado"});
  const schema=ctx.client.schema,today=new Date().toISOString().slice(0,10);
  const from=String(req.query.desde||new Date(Date.now()-30*DAY).toISOString().slice(0,10));
  const to=String(req.query.hasta||today),search=normalize(req.query.buscar||"");
  const raw=String(req.query.farmacias||""),allowed=ctx.pharmacies.map(p=>Number(p.id));
  const ids=raw?raw.split(",").map(Number):allowed;
  if(!SCHEMA.test(schema)||!validDate(from)||!validDate(to)||from>to||
   Date.parse(to)-Date.parse(from)>730*DAY||raw.length>1500||search.length>100||
   ids.some(id=>!Number.isSafeInteger(id)||!allowed.includes(id)))
   return res.status(400).json({error:"Filtros no autorizados o inválidos"});
  const chosen=[...new Set(ids)],MAX=70000;
  if(!chosen.length)return res.json({available:true,groups:[],pharmacies:[],truncated:false});
  try{
   const {rows:fields}=await pool.query(
    "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name IN ('articulos','fm_ventas_analitica')",[schema]);
   const has=(t,c)=>fields.some(f=>f.table_name===t&&f.column_name===c);
   if(!["farmacia_codigo","origen_id","nombre","stock_actual"].every(c=>has("articulos",c))||
    !["farmacia_codigo","articulo_id","fecha","unidades"].every(c=>has("fm_ventas_analitica",c)))
    return res.json({available:false,groups:[],
     reason:"El sincronizador todavía no aporta ventas completas y existencias por artículo"});
   const q='"'+schema+'"';
   const code=has("articulos","codigo_nacional")?"nullif(btrim(a.codigo_nacional),'')":"NULL::text";
   const stamp=has("articulos","sincronizado_en")?"a.sincronizado_en":"NULL::timestamptz";
   const latest=has("articulos","sincronizado_en")?"ORDER BY a.sincronizado_en DESC NULLS LAST":"";
   const join=pharmacyDataCodeSQL("f");
   const sql=[
    "WITH sold AS MATERIALIZED (",
    " SELECT f.id AS fid,upper(btrim(v.farmacia_codigo)) AS source_code,v.articulo_id::text AS article,",
    " sum(v.unidades) FILTER(WHERE v.fecha >= $1::date AND v.fecha < $2::date+interval '1 day') AS period,",
    " sum(v.unidades) FILTER(WHERE v.fecha >= current_date-interval '90 days' AND v.fecha < current_date+interval '1 day') AS u3,",
    " sum(v.unidades) FILTER(WHERE v.fecha >= current_date-interval '365 days' AND v.fecha < current_date+interval '1 day') AS u12",
    " FROM "+q+".fm_ventas_analitica v JOIN farmetrica.farmacias f ON f.cliente_slug=$4",
    " AND upper(btrim(v.farmacia_codigo))="+join+" AND f.id=ANY($3::int[])",
    " WHERE v.fecha >= least($1::date,current_date-interval '365 days')",
    " AND v.fecha < greatest($2::date,current_date)+interval '1 day'",
    " AND nullif(btrim(v.articulo_id::text),'') IS NOT NULL GROUP BY f.id,upper(btrim(v.farmacia_codigo)),v.articulo_id",
    "), ranked AS (SELECT * FROM sold WHERE ($6::text='' OR article ILIKE '%'||$6||'%' OR EXISTS (",
    " SELECT 1 FROM "+q+".articulos a2",
    " WHERE a2.farmacia_codigo=sold.source_code",
    " AND a2.origen_id=sold.article",
    " AND (a2.nombre ILIKE '%'||$6||'%'"+(has("articulos","codigo_nacional")?" OR a2.codigo_nacional ILIKE '%'||$6||'%'":"")+")",
    " ))",
    " ORDER BY greatest(coalesce(u3,0),0) DESC,greatest(coalesce(u12,0),0) DESC,fid,article LIMIT $5::int)",
    " SELECT s.fid::text AS \"pharmacyId\",s.article AS \"articleId\",",
    " coalesce(nullif(btrim(a.name),''),s.article) AS \"articleName\",a.cn,",
    " a.stock::float8 AS stock,a.stamp AS \"stockAt\",",
    " coalesce(s.period,0)::float8 AS \"unitsPeriod\",coalesce(s.u3,0)::float8 AS \"units3\",",
    " coalesce(s.u12,0)::float8 AS \"units12\" FROM ranked s",
    " JOIN farmetrica.farmacias f ON f.id=s.fid AND f.cliente_slug=$4",
    " LEFT JOIN LATERAL (SELECT a.nombre AS name,"+code+" AS cn,",
    " a.stock_actual AS stock,"+stamp+" AS stamp FROM "+q+".articulos a",
    " WHERE a.farmacia_codigo=s.source_code",
    " AND a.origen_id=s.article",
    " "+latest+" LIMIT 1) a ON true ORDER BY s.fid,s.article"
   ].join(" ");
   const [sales,policies,orders,catalogSearch]=await Promise.all([
    pool.query({text:sql,values:[from,to,chosen,ctx.client.slug,MAX+1,search],query_timeout:30000}),
    pool.query("SELECT farmacia_id,intervalo_pedidos,plazo_entrega,stock_seguridad"+
     " FROM farmetrica.op_politicas_reposicion WHERE cliente_slug=$1 AND farmacia_id=ANY($2::int[])",
     [ctx.client.slug,chosen]).catch(e=>{
     if(e.code==="42P01"||e.code==="42703")return {rows:[],unavailable:true};
     throw e;
    }),
    pool.query("SELECT farmacia_id,lineas FROM farmetrica.op_pedidos"+
     " WHERE cliente_slug=$1 AND farmacia_id=ANY($2::int[]) AND estado IN ('borrador','pendiente_aprobacion','aprobado','exportado')"+
     " ORDER BY actualizado_en DESC LIMIT 1000",[ctx.client.slug,chosen]).catch(e=>{
     if(e.code==="42P01"||e.code==="42703")return {rows:[],unavailable:true};
     throw e;
    }),
    search?pool.query({text:[
     "SELECT DISTINCT ON (f.id,a.origen_id)",
     " f.id::text AS \"pharmacyId\",a.origen_id::text AS \"articleId\",",
     " a.nombre AS \"articleName\","+code+" AS cn,",
     " a.stock_actual::float8 AS stock,"+stamp+" AS \"stockAt\",",
     " 0::float8 AS \"unitsPeriod\",0::float8 AS \"units3\",0::float8 AS \"units12\"",
     " FROM "+q+".articulos a JOIN farmetrica.farmacias f ON f.cliente_slug=$2",
     " AND upper(btrim(a.farmacia_codigo))="+join+" AND f.id=ANY($1::int[])",
     " WHERE (a.origen_id ILIKE '%'||$3||'%' OR a.nombre ILIKE '%'||$3||'%'"+
       (has("articulos","codigo_nacional")?" OR a.codigo_nacional ILIKE '%'||$3||'%'":"")+")",
     " ORDER BY f.id,a.origen_id,"+(has("articulos","sincronizado_en")?"a.sincronizado_en DESC NULLS LAST":"a.nombre"),
     " LIMIT $4::int"
    ].join(" "),values:[chosen,ctx.client.slug,search,MAX+1],query_timeout:30000}):Promise.resolve({rows:[]})
   ]);
   const commitmentsAvailable=!orders.unavailable;
   const policyMap=new Map(policies.rows.map(p=>[Number(p.farmacia_id),p]));
   const ordered=new Map();
   for(const o of orders.rows)for(const line of Array.isArray(o.lineas)?o.lineas:[]){
    const key=o.farmacia_id+"|"+normalize(line.articulo);
    ordered.set(key,(ordered.get(key)||0)+(line.asignaciones||[]).reduce((n,a)=>n+Number(a.unidades||0),0));
   }
   const combined=[...sales.rows];
   const seen=new Set(combined.map(row=>row.pharmacyId+"|"+normalize(row.articleId)));
   for(const item of catalogSearch.rows){
    const id=item.pharmacyId+"|"+normalize(item.articleId);
    if(!seen.has(id)){combined.push(item);seen.add(id)}
   }
   const rows=combined.slice(0,MAX).map(s=>{
    const policy=policyMap.get(Number(s.pharmacyId));
    const stock=s.stock==null?null:Number(s.stock);
    const calculated=proposePurchase({stock,units3:Math.max(0,Number(s.units3||0)),
     units12:Math.max(0,Number(s.units12||0)),
     ordered:ordered.get(s.pharmacyId+"|"+normalize(s.articleId))||0,
     interval:policy?.intervalo_pedidos??7,lead:policy?.plazo_entrega??2,
     safety:policy?.stock_seguridad??0});
    return {...s,stock,...calculated,commitmentsAvailable,
     ...(!commitmentsAvailable?{suggested:null,reason:"Pedidos pendientes sin verificar"}:{}),policyDefault:!policy,
     interval:policy?.intervalo_pedidos??7,lead:policy?.plazo_entrega??2,
     safety:policy?.stock_seguridad??0,
     confidence:stock===null?"sin_stock":s.stockAt==null?"fecha_desconocida":
      Date.now()-new Date(s.stockAt).getTime()>48*3600000?"stock_antiguo":"calculable"};
   });
   // El nomenclátor enlaza CN reales con su conjunto DCPF. Si aún no está
   // cargado, mantenemos la identidad por CN: nunca unimos por código ERP.
   const cnList=[...new Set(rows.map(p=>normalize(p.cn)).filter(Boolean))];
   let genericByCn=new Map();
   if(cnList.length){
    try{
     const official=await pool.query(
      "SELECT DISTINCT ON (cn) cn,dcpf,coalesce(nullif(btrim(principio_activo),''),nombre) AS name"+
      " FROM farmetrica.nomenclator_presentaciones"+
      " WHERE generico=true AND cn=ANY($1::text[]) AND nullif(btrim(dcpf),'') IS NOT NULL"+
      " ORDER BY cn,dcpf",[cnList]);
     genericByCn=new Map(official.rows.map(n=>[normalize(n.cn),n]));
    }catch(e){
     if(!["42P01","42703"].includes(e.code))throw e;
    }
   }
   const enriched=rows.map(p=>{
    const official=genericByCn.get(normalize(p.cn));
    return {...p,genericDcpf:official?.dcpf||null,genericName:official?.name||null};
   });
   // Incluir también los EFG con stock y cero ventas. Si solo se agrupan los
   // artículos vendidos se infraestima el inventario y se piden unidades de más.
   const dcpfs=[...new Set([...genericByCn.values()].map(n=>String(n.dcpf)))];
   let siblingsTruncated=false;
   if(dcpfs.length&&has("articulos","codigo_nacional")){
    const catalog=await pool.query({text:[
     "SELECT DISTINCT ON (f.id,a.origen_id) f.id::text AS \"pharmacyId\",",
     "a.origen_id::text AS \"articleId\",a.nombre AS \"articleName\",",
     "nullif(btrim(a.codigo_nacional),'') AS cn,a.stock_actual::float8 AS stock,",
     stamp+" AS \"stockAt\",n.dcpf AS \"genericDcpf\",",
     "coalesce(nullif(btrim(n.principio_activo),''),n.nombre) AS \"genericName\",",
     "0::float8 AS \"unitsPeriod\",0::float8 AS \"units3\",0::float8 AS \"units12\"",
     "FROM "+q+".articulos a JOIN farmetrica.farmacias f ON f.cliente_slug=$2",
     "AND f.id=ANY($1::int[]) AND upper(btrim(a.farmacia_codigo))="+join,
     "JOIN farmetrica.nomenclator_presentaciones n ON n.cn=nullif(btrim(a.codigo_nacional),'')",
     "AND n.generico=true WHERE n.dcpf=ANY($3::text[])",
     "ORDER BY f.id,a.origen_id,"+
      (has("articulos","sincronizado_en")?"a.sincronizado_en DESC NULLS LAST":"a.nombre"),
     "LIMIT $4::int"
    ].join(" "),values:[chosen,ctx.client.slug,dcpfs,MAX*4+1],query_timeout:30000});
    siblingsTruncated=catalog.rows.length>MAX*4;
    const seen=new Set(enriched.map(p=>String(p.pharmacyId)+"|"+normalize(p.articleId)));
    for(const row of catalog.rows.slice(0,MAX*4)){
     const composite=String(row.pharmacyId)+"|"+normalize(row.articleId);
     if(seen.has(composite))continue;
     seen.add(composite);
     const policy=policyMap.get(Number(row.pharmacyId));
     const stock=row.stock==null?null:Number(row.stock);
     const interval=policy?.intervalo_pedidos??7,lead=policy?.plazo_entrega??2,
      safety=policy?.stock_seguridad??0;
     const prepared=ordered.get(composite)||0;
     enriched.push({...row,stock,ordered:prepared,interval,lead,safety,commitmentsAvailable,
      policyDefault:!policy,...proposePurchase({stock,ordered:prepared,interval,lead,safety}),
      ...(!commitmentsAvailable?{suggested:null,reason:"Pedidos pendientes sin verificar"}:{}),
      confidence:stock===null?"sin_stock":row.stockAt==null?"fecha_desconocida":
       Date.now()-new Date(row.stockAt).getTime()>48*3600000?"stock_antiguo":"calculable"});
    }
   }
   const groups=groupPurchaseRows(enriched).filter(g=>!search||
    normalize([g.cn,g.dcpf,g.articleName,...g.pharmacies.flatMap(p=>
     p.options.flatMap(o=>[o.articleId,o.articleName,o.cn]))].join(" ")).includes(search));
   res.json({available:true,from,to,groups,limit:MAX,commitmentsAvailable,
    policiesDefaulted:Boolean(policies.unavailable),truncated:combined.length>MAX||sales.rows.length>MAX||catalogSearch.rows.length>MAX||siblingsTruncated,
    pharmacies:ctx.pharmacies.filter(p=>chosen.includes(Number(p.id))).map(p=>({id:p.id,name:p.name})),
    note:(commitmentsAvailable?"":"No se han podido verificar los pedidos ya preparados. No se permite generar pedidos hasta recuperar su lectura. ")+(policies.unavailable?"Sin políticas cargadas se usan los valores estándar. ":"")+"Propuesta por medias de ventas de 90 y 365 días. Se descuentan stock y unidades ya preparadas en borradores o pedidos pendientes/aprobados/exportados para evitar duplicar compras. Las recepciones del ERP no están conciliadas con estos planes: revisa los pedidos antiguos. Sin política configurada se asumen 7 días entre pedidos, 2 de entrega y 0 unidades de seguridad."});
  }catch(e){next(e)}
 });
}
