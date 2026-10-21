import {readPurchasePlannerPaged} from "./purchasePlannerPaged.js";
import {readPlannerLaboratories} from "./purchasePlannerSuppliers.js";
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
 if(typeof app.post==="function")app.post("/api/analytics/pedidos/laboratorios",...requireTenant(),async(req,res,next)=>{
  const ctx=req.context;
  if(ctx.role!=="superadministrador"&&ctx.modules?.compras!==true)
   return res.status(403).json({error:"Compras no habilitado"});
  const allowed=(ctx.pharmacies||[]).map(p=>Number(p.id));
  const items=req.body?.items,ids=req.body?.pharmacies;
  const dcpfs=req.body?.dcpfs;
  const to=String(req.body?.to||"");
  if(!SCHEMA.test(ctx.client.schema)||!validDate(to)||
   !Array.isArray(items)||items.length>4000||
   !Array.isArray(ids)||ids.length>100||ids.some(n=>!allowed.includes(Number(n)))||
   !Array.isArray(dcpfs)||dcpfs.length>100||dcpfs.some(d=>!/^[0-9]{1,30}$/.test(String(d)))||
   items.some(x=>!x||typeof x.groupKey!=="string"||x.groupKey.length>95||
    !/^(CN:|DCPF:|ERP:)/.test(x.groupKey)||
    !Number.isSafeInteger(Number(x.pharmacyId))||!allowed.includes(Number(x.pharmacyId))||
    typeof x.articleId!=="string"||x.articleId.length>90||
    (x.cn!=null&&(typeof x.cn!=="string"||x.cn.length>40))))
   return res.status(400).json({error:"Referencias para recomendar laboratorios inválidas"});
  try{
   res.json(await readPlannerLaboratories(pool,ctx,ids.map(Number),items,dcpfs.map(String),to));
  }catch(e){
   if(["57014","53300"].includes(e.code))return res.status(504)
    .json({error:"La consulta de PUC ha superado el tiempo; los pedidos siguen disponibles sin recomendación de precio."});
   next(e);
  }
 });

 app.get("/api/analytics/pedidos/propuesta",...requireTenant(),async(req,res,next)=>{
  const ctx=req.context;
  if(ctx.role!=="superadministrador"&&ctx.modules?.compras!==true)
   return res.status(403).json({error:"Compras no habilitado"});
  const schema=ctx.client.schema,now=new Date().toISOString().slice(0,10);
  const from=String(req.query.desde||now),to=String(req.query.hasta||now);
  const search=String(req.query.buscar||"").trim();
  const raw=String(req.query.farmacias||"");
  const allowed=ctx.pharmacies.map(p=>Number(p.id));
  const ids=raw?raw.split(",").map(Number):allowed;
  const chosen=[...new Set(ids)];
  const sort=String(req.query.orden||"suggested");
  const direction=String(req.query.direccion||"desc").toLowerCase();
  const page=Number(req.query.pagina||1),pageSize=Number(req.query.tamano||50);
  const allowedSort=new Set(["articleName","stock","unitsPeriod","units3","units12","suggested"]);
  let columnFilters;
  try{columnFilters=JSON.parse(String(req.query.filtros||"{}"))}catch{
   return res.status(400).json({error:"Filtros inválidos"});
  }
  if(!SCHEMA.test(schema)||!validDate(from)||!validDate(to)||from>to||
   Date.parse(to)-Date.parse(from)>150*365.25*DAY||search.length>100||
   raw.length>1600||ids.some(id=>!Number.isSafeInteger(id)||!allowed.includes(id))||
   !allowedSort.has(sort)||!["asc","desc"].includes(direction)||
   !Number.isSafeInteger(page)||page<1||page>100000||
   !Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100||
   typeof columnFilters!=="object"||columnFilters===null||Array.isArray(columnFilters)||
   Object.entries(columnFilters).some(([k,v])=>!allowedSort.has(k)||
    typeof v!=="string"||v.length>80))
   return res.status(400).json({error:"Filtros, período o paginación inválidos"});
  if(!chosen.length)return res.json({available:true,from,to,groups:[],totalGroups:0,
   page,pageSize,truncated:false,summary:{products:0,unitsPeriod:0}});
  try{
   const data=await readPurchasePlannerPaged(pool,ctx,{from,to,chosen,
    search,sort,direction,page,pageSize,columnFilters});
   res.json(data);
  }catch(e){
   if(["57014","53300"].includes(e.code))
    return res.status(504).json({error:"La consulta ha superado la capacidad disponible. Acota el período e inténtalo de nuevo.",code:"planner_query_timeout"});
   next(e);
  }
 });
}
