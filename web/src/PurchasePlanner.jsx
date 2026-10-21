import React,{useEffect,useMemo,useState} from "react";
import {ShoppingCart,Download,Save,ChevronDown,AlertTriangle} from "lucide-react";
import ListTable from "./ListTable.jsx";
import "./purchasePlanner.css";

const toISO=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
const today=()=>toISO(new Date());
function periodDates(period){
 const now=new Date(),start=new Date(now);
 if(period==="week")start.setDate(now.getDate()-(now.getDay()+6)%7);
 if(period==="month")start.setDate(1);
 if(period==="year"){start.setMonth(0);start.setDate(1)}
 return [toISO(start),toISO(now)];
}
const whole=n=>new Intl.NumberFormat("es-ES",{maximumFractionDigits:1}).format(Number(n||0));
const exportSafe=x=>{const str=String(x??"");return '"'+(/^[\s]*[=+@-]/.test(str)?"'"+str:str).replaceAll('"','""')+'"'};
const key=p=>String(p.pharmacyId)+"|"+String(p.groupKey||p.articleId);
export const STAGING_PREFIX="fm_preparador_enlace:";
export function putPurchaseLink(slug,link){
 sessionStorage.setItem(STAGING_PREFIX+slug,JSON.stringify(link));
}
function makeCSV(lines){
 return "\ufeff"+[["Proveedor","Código proveedor","Farmacia","CN","Código ERP","Artículo","Unidades"],
  ...lines.map(x=>[x.supplierName||"Nombre no disponible",x.supplier,x.pharmacyName,x.cn||"",x.articleId,x.articleName,x.units])]
  .map(line=>line.map(exportSafe).join(";")).join("\r\n");
}
function downloadCSV(filename,lines){
 const url=URL.createObjectURL(new Blob([makeCSV(lines)],{type:"text/csv;charset=utf-8"}));
 const link=document.createElement("a");link.href=url;link.download=filename+".csv";
 document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
// En cada farmacia el ERP tiene sus códigos propios. Los borradores se guardan
// bajo farmacia y proveedor; la exportación puede consolidar varias farmacias.
export default function PurchasePlanner({clientSlug,pharmacies=[],canEdit=false,onCreated=()=>{}}){
 const [period,setPeriod]=useState("month");
 const [from,setFrom]=useState(()=>periodDates("month")[0]);
 const [to,setTo]=useState(today);
 const [search,setSearch]=useState("");
 const [result,setResult]=useState(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [overrides,setOverrides]=useState({});
 const [suppliers,setSuppliers]=useState({});
 const [open,setOpen]=useState({});
 const [reload,setReload]=useState(0);
 const [pendingLink,setPendingLink]=useState(null);
 useEffect(()=>{
  try{
   const saved=JSON.parse(sessionStorage.getItem(STAGING_PREFIX+clientSlug)||"null");
   if(saved?.cn||saved?.articleId){
    setSearch(String(saved.cn||saved.articleId));
    if(/^\d{4}-\d{2}-\d{2}$/.test(saved.from||"")&&
       /^\d{4}-\d{2}-\d{2}$/.test(saved.to||"")&&saved.from<=saved.to){
      setFrom(saved.from);setTo(saved.to);setPeriod("custom");
    }
    setPendingLink(saved);
    sessionStorage.removeItem(STAGING_PREFIX+clientSlug);
   }
  }catch{}
 },[clientSlug]);
 const codes=pharmacies.map(p=>String(p.id)).join(",");
 useEffect(()=>{
  if(!codes||!from||!to||from>to){setResult({groups:[],pharmacies:[],available:true});return}
  const ac=new AbortController();
  const delay=setTimeout(()=>{
   setBusy(true);setError("");
   const qs=new URLSearchParams({desde:from,hasta:to,farmacias:codes,buscar:search});
   fetch("/api/analytics/pedidos/propuesta?"+qs,{
    credentials:"same-origin",cache:"no-store",headers:{"X-Farmetrica-Cliente":clientSlug},signal:ac.signal
   }).then(async r=>{const data=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(data.error||"No se puede preparar el pedido");return data})
    .then(data=>{if(!ac.signal.aborted){setResult(data);setOverrides({});
      if(pendingLink?.supplier){
       const newAssignments={};
       for(const g of data.groups||[])for(const p of g.pharmacies)
        if(String(p.pharmacyId)===String(pendingLink.pharmacyId)&&
         (String(g.cn)===String(pendingLink.cn)||String(p.articleId)===String(pendingLink.articleId)||
          p.options?.some(o=>String(o.articleId)===String(pendingLink.articleId)||String(o.cn)===String(pendingLink.cn))))
         newAssignments[key(p)]={supplier:String(pendingLink.supplier),units:Math.max(0,p.suggested||0),articleId:String(pendingLink.articleId||p.options?.[0]?.articleId||"")};
       setOverrides(newAssignments);
      }
    }})
    .catch(e=>{if(!ac.signal.aborted)setError(e.message)})
    .finally(()=>{if(!ac.signal.aborted)setBusy(false)});
  },300);
  return()=>{clearTimeout(delay);ac.abort()};
 },[clientSlug,codes,from,to,search,reload,pendingLink]);
 useEffect(()=>{
  const ac=new AbortController();
  Promise.allSettled(pharmacies.map(async p=>{
   const id=String(p.id);
   const params=new URLSearchParams({farmacia:id});
   const res=await fetch("/api/analytics/catalogos/proveedores?"+params,{
    credentials:"same-origin",headers:{"X-Farmetrica-Cliente":clientSlug},signal:ac.signal});
   if(!res.ok)return {id,items:[]};
   const json=await res.json();return {id,items:json.items||[]};
  })).then(data=>{if(!ac.signal.aborted)setSuppliers(Object.fromEntries(data.filter(x=>x.status==="fulfilled").map(x=>[x.value.id,x.value.items])))});
  return()=>ac.abort();
 },[clientSlug,codes]);
 const groups=result?.groups||[];
 // Una necesidad DCPF no es una referencia facturable: antes de guardar
 // o exportar se debe escoger el CN real que suministrará el proveedor.
 const chosenArticle=(p,edit)=>String(edit.articleId||
  (Array.isArray(p.options)?(p.options.length===1?p.options[0].articleId:""):p.articleId||""));
 const allLines=useMemo(()=>{
  const lines=[];
  for(const g of groups)for(const p of g.pharmacies){
   const edit=overrides[key(p)]||{},units=Number(edit.units??0);
   const supplier=String(edit.supplier||"").trim();
   const articleId=chosenArticle(p,edit),article=p.options?.find(x=>String(x.articleId)===articleId)||(!p.options?p:null);
   if(units>0&&Number.isSafeInteger(units)&&supplier&&article){
    const provider=(suppliers[String(p.pharmacyId)]||[]).find(s=>String(s.code).trim().toUpperCase()===supplier.toUpperCase());
    const supplierName=String(provider?.name||"").trim();
    lines.push({...p,articleId,cn:article.cn||g.cn,articleName:article.articleName||g.articleName,
     pharmacyName:pharmacies.find(f=>String(f.id)===String(p.pharmacyId))?.name||p.pharmacyId,
     units,supplier,supplierName,
     supplierKey:supplierName?"NAME:"+supplierName.toUpperCase():"LOCAL:"+p.pharmacyId+":"+supplier.toUpperCase()});
   }
  }
  return lines;
 },[groups,overrides,pharmacies,suppliers]);
 const missingSupplier=groups.reduce((n,g)=>n+g.pharmacies.filter(p=>
  Number(overrides[key(p)]?.units??0)>0&&
  !String(overrides[key(p)]?.supplier||"").trim()).length,0);
 const missingArticle=groups.reduce((n,g)=>n+g.pharmacies.filter(p=>
  Number(overrides[key(p)]?.units??0)>0&&
  !chosenArticle(p,overrides[key(p)]||{})).length,0);
 const invalidQuantities=groups.reduce((n,g)=>n+g.pharmacies.filter(p=>{
  const qty=Number(overrides[key(p)]?.units??0);
  return !Number.isSafeInteger(qty)||qty<0||qty>999999;
 }).length,0);
 const total=field=>groups.reduce((n,g)=>n+Number(g[field]||0),0);
 const totalStock=groups.some(g=>g.stock===null)?null:total("stock");
 const totalSuggestion=groups.some(g=>g.suggested===null)?null:total("suggested");
 const bySupplier=Object.values(allLines.reduce((acc,line)=>{
  const k=line.supplierKey;
  if(!acc[k])acc[k]={key:k,name:line.supplierName||"Proveedor "+line.supplier,
   pharmacies:new Set(),products:0,units:0};
  acc[k].pharmacies.add(String(line.pharmacyId));acc[k].products++;acc[k].units+=line.units;
  return acc;
 },{}));
 const selectedTotal=allLines.reduce((n,l)=>n+l.units,0);
 const setValue=(p,field,value)=>setOverrides(previous=>({...previous,
  [key(p)]:{units:0,supplier:"",...previous[key(p)],[field]:value}}));
 function exportGrouped(){
  if(result?.truncated)return setError("La consulta está incompleta. Acota la búsqueda antes de exportar.");
  if(invalidQuantities)return setError("Revisa las cantidades: solo se admiten unidades enteras no negativas.");
  if(missingArticle)return setError("Selecciona una presentación real para cada necesidad genérica antes de exportar.");
  if(missingSupplier)return setError("Asigna un proveedor o pon 0 en Pedir antes de exportar.");
  if(!allLines.length)return setError("Asigna un proveedor y unidades antes de exportar");
  // Un CSV por proveedor; conserva farmacia y ERP para que pueda prepararse
  // el formato propio de cada laboratorio sin perder trazabilidad.
  const bySupplier=new Map();
  for(const line of allLines){
   if(!bySupplier.has(line.supplierKey))bySupplier.set(line.supplierKey,[]);
   bySupplier.get(line.supplierKey).push(line);
  }
  for(const [,lines] of bySupplier){
   const name=lines[0].supplierName||lines[0].supplier+"-"+lines[0].pharmacyId;
   downloadCSV("farmetrica-pedido-"+name.replace(/[^a-z0-9_-]/gi,"_").slice(0,60),lines);
  }
  setNotice("CSV preparado por proveedor. La descarga no envía ni aprueba pedidos.");
 }
 async function saveDrafts(){
  if(!canEdit)return;
  if(result?.truncated)return setError("La consulta está incompleta. Acota la búsqueda antes de guardar.");
  if(invalidQuantities)return setError("Hay cantidades inválidas. Introduce únicamente unidades enteras.");
  if(missingArticle)return setError("Selecciona una presentación real para "+missingArticle+" necesidades genéricas.");
  if(!allLines.length)return setError("No hay líneas asignadas a proveedores");
  if(missingSupplier)return setError("Hay "+missingSupplier+" necesidades sin proveedor; asígnalas o pon 0 en Pedir.");
  setBusy(true);setError("");setNotice("");
  const batches=new Map();
  for(const line of allLines){
   const group=line.pharmacyId+"|"+line.supplier;
   if(!batches.has(group))batches.set(group,[]);
   batches.get(group).push(line);
  }
  let saved=0;
  try{
   for(const [,lines] of batches){
    for(let i=0;i<lines.length;i+=150){
     const part=lines.slice(i,i+150),supplier=part[0].supplier,pharmacy=part[0].pharmacyId;
     const payload={recurso:"pedidos",farmacia:pharmacy,
      nombre:"Propuesta · "+supplier+" · "+today(),
      lineas:part.map(p=>({id:crypto.randomUUID(),articulo:p.articleId,
       nombre:p.articleName,necesidad:p.units,
       asignaciones:[{proveedor:supplier,unidades:p.units,coste:null}]}))};
     const response=await fetch("/api/operativa",{method:"POST",credentials:"same-origin",
      headers:{"content-type":"application/json","X-Farmetrica-Cliente":clientSlug},body:JSON.stringify(payload)});
     const data=await response.json().catch(()=>({}));
     if(!response.ok)throw Error(data.error||"Error al guardar el pedido");
     saved++;
    }
   }
   setNotice(saved+" borradores guardados. Revísalos y apruébalos en «Planes de compra» antes de marcar su exportación.");
   // Borrar confirmaciones inmediatamente y recalcular pendientes para no permitir
   // guardar una segunda vez las mismas unidades si se pulsa de nuevo.
   setOverrides({});setReload(n=>n+1);
   onCreated();
  }catch(e){setError(e.message+(saved?" ("+saved+" borradores ya guardados; revisa antes de repetir).":""))}
  finally{setBusy(false)}
 }
 const columns=[
  {key:"articleName",label:"Artículo / conjunto genérico",value:g=>g.articleName,
   render:g=><div className="fm-planner-article"><button type="button" className="fm-planner-toggle"
    onClick={()=>setOpen(o=>({...o,[g.key]:!o[g.key]}))} aria-expanded={Boolean(open[g.key])}>
    <ChevronDown size={15}/><span><strong>{g.articleName}</strong><small>{g.kind==="generico"?"Genérico · DCPF "+g.dcpf+" · "+g.productCount+" referencias":g.cn||"ERP (sin CN común)"}</small></span></button>
    {open[g.key]&&<div className="fm-planner-details">{g.pharmacies.map(p=>{
     const edit=overrides[key(p)]||{},options=suppliers[String(p.pharmacyId)]||[];
     const confidence=p.confidence;
     return <div className="fm-planner-pharmacy" key={key(p)}>
      <strong>{pharmacies.find(f=>String(f.id)===String(p.pharmacyId))?.name||p.pharmacyId}</strong>
      {g.kind!=="generico"&&<small>Referencia ERP {p.articleId} · CN {g.cn||p.cn||"No disponible"}</small>}
      <div className="fm-planner-detail-metrics">
       <span>Vendidas período <b>{whole(p.unitsPeriod)}</b></span>
       <span>Ventas 3 meses <b>{whole(p.units3)}</b></span>
       <span>Ventas 12 meses <b>{whole(p.units12)}</b></span>
       <span>Stock disponible <b>{p.stock===null?"Sin dato":whole(p.stock)}</b></span>
       <span>Pedido recomendado <b>{p.suggested===null?"Sin cálculo":whole(p.suggested)}</b></span>
      </div>
      {g.kind==="generico"&&<div className="fm-planner-variants">
       <small>Referencias equivalentes en esta farmacia:</small>
       {p.options.map(o=><small key={o.articleId}>{o.cn||"Sin CN"} · {o.articleName} · ERP {o.articleId} · Stock {o.stock??"?"}</small>)}
      </div>}
      <small>Media {whole(p.daily)} uds./día × ({p.interval}+{p.lead} días) + seguridad {p.safety} − stock {whole(p.stock)} − preparados {p.ordered??0} = <b>{p.suggested??"Sin cálculo"} uds.</b></small>
      <small>Última actualización conocida del inventario: {p.stockAt?new Date(p.stockAt).toLocaleString("es-ES"):"Sin fecha disponible"}</small>
      {confidence!=="calculable"&&<small className="fm-planner-caution">{confidence==="stock_antiguo"?"Stock posiblemente desactualizado":confidence==="sin_stock"?"Sin stock: no se propone compra":"Sin fecha verificable de stock"}</small>}
      {p.policyDefault&&<small className="fm-planner-caution">Política estándar; configura intervalos y plazos por farmacia.</small>}
      <div className="fm-planner-edit">
       <label>Pedir <input type="number" min="0" max="999999" step="1" disabled={!canEdit||p.suggested===null}
        value={edit.units??0} onChange={e=>setValue(p,"units",e.target.value)}/></label>
       <button className="fm-planner-use-suggestion" type="button" disabled={!canEdit||p.suggested===null}
        onClick={()=>setValue(p,"units",p.suggested)}>Usar recomendado ({whole(p.suggested)})</button>
       {g.kind==="generico"&&<label>Presentación a comprar
        <select aria-label={"Presentación a comprar en "+(pharmacies.find(f=>String(f.id)===String(p.pharmacyId))?.name||p.pharmacyId)}
         disabled={!canEdit||p.suggested===null}
         value={chosenArticle(p,edit)} onChange={e=>setValue(p,"articleId",e.target.value)}>
         <option value="">Selecciona CN / artículo</option>
         {p.options.map(o=><option key={o.articleId} value={o.articleId}>{o.cn||"Sin CN"} · {o.articleName}</option>)}
        </select></label>}
       <label>Proveedor <input list={"fm-pl-sup-"+p.pharmacyId} disabled={!canEdit||p.suggested===null}
        placeholder="Código proveedor" value={edit.supplier||""}
        onChange={e=>setValue(p,"supplier",e.target.value)}/>
        <datalist id={"fm-pl-sup-"+p.pharmacyId}>{options.map(s=>
         <option key={s.code} value={s.code} label={s.name}>{s.name}</option>)}</datalist>
       </label>
      </div>
     </div>;
    })}</div>}</div>},
  
  {key:"unitsPeriod",label:"Vendidas período",value:g=>g.unitsPeriod,render:g=>whole(g.unitsPeriod)},
  {key:"units3",label:"Ventas 3m",value:g=>g.units3,render:g=>whole(g.units3)},
  {key:"units12",label:"Ventas 12m",value:g=>g.units12,render:g=>whole(g.units12)},
  {key:"stock",label:"Stock disponible",value:g=>g.stock??-1,render:g=>g.stock===null?"—":whole(g.stock)},
  {key:"suggested",label:"Pedido recomendado",value:g=>g.suggested??-1,
   render:g=>g.suggested===null?"Ver desglose":<strong>{whole(g.suggested)}</strong>},
  {key:"selected",label:"Pedir",value:g=>g.pharmacies.reduce((n,p)=>n+Number(overrides[key(p)]?.units??0),0),
   render:g=><strong>{whole(g.pharmacies.reduce((n,p)=>n+Number(overrides[key(p)]?.units??0),0))}</strong>}
 ];
 return <section className="card fm-planner">
  <div className="fm-planner-head"><div><h2><ShoppingCart size={19}/> Propuesta inteligente de compra</h2>
   <p>Visión global de la necesidad de compra. Los genéricos se agrupan por conjunto DCPF oficial y se preparan por farmacia.</p></div>
   <button className="btn btn-secondary" onClick={()=>setReload(n=>n+1)} type="button" disabled={busy}>Actualizar</button></div>
  <div className="fm-planner-period" role="group" aria-label="Período de ventas">
   {[["week","Esta semana"],["month","Este mes"],["year","Este año"],["custom","Personalizado"]].map(([id,label])=>
    <button type="button" key={id} className={"fm-planner-period-option "+(period===id?"active":"")}
     aria-pressed={period===id} onClick={()=>{
      setPeriod(id);if(id!=="custom"){const [a,b]=periodDates(id);setFrom(a);setTo(b)}
     }}>{label}</button>)}
  </div>
  <div className="fm-planner-filters">
   <label>Desde <input type="date" value={from} onChange={e=>{setFrom(e.target.value);setPeriod("custom")}}/></label>
   <label>Hasta <input type="date" value={to} onChange={e=>{setTo(e.target.value);setPeriod("custom")}}/></label>
   <label>Buscar CN, DCPF o artículo <input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nombre, CN o DCPF…"/></label>
  </div>
  <p className="fm-planner-scope">Grupo completo · {pharmacies.length} farmacias autorizadas. Los totales se calculan sobre el grupo; despliega cada fila para consultar el detalle de sus farmacias.</p>
  {error&&<p role="alert" className="fm-op-message fm-op-error"><AlertTriangle size={15}/>{error}</p>}
  {notice&&<p role="status" className="fm-op-message">{notice}</p>}
  {result?.available===false&&<p role="status" className="fm-op-message">{result.reason}</p>}
  {result?.truncated&&<p className="fm-op-message">El resultado supera {result.limit} referencias de farmacia. Usa la búsqueda para acotar antes de preparar una compra; no se puede guardar ni exportar una consulta incompleta.</p>}
  <div className="fm-planner-summary" aria-label="Resumen del grupo">
   <div><span>Vendidas período</span><strong>{whole(total("unitsPeriod"))}</strong></div>
   <div><span>Ventas 3 meses</span><strong>{whole(total("units3"))}</strong></div>
   <div><span>Ventas 12 meses</span><strong>{whole(total("units12"))}</strong></div>
   <div><span>Stock disponible</span><strong>{totalStock===null?"Parcial":whole(totalStock)}</strong></div>
   <div><span>Pedido recomendado</span><strong>{totalSuggestion===null?"Parcial":whole(totalSuggestion)}</strong></div>
  </div>
  <div className="fm-planner-summary-note">{whole(groups.length)} conjuntos o artículos · {whole(allLines.length)} líneas con proveedor · {whole(selectedTotal)} unidades asignadas
   {missingSupplier>0&&<span> · {missingSupplier} necesidades sin proveedor</span>}
   {missingArticle>0&&<span> · {missingArticle} necesidades genéricas sin presentación elegida</span>}
   {invalidQuantities>0&&<span role="alert"> · {invalidQuantities} cantidades inválidas</span>}
  </div>
  {bySupplier.length>0&&<div className="fm-planner-supplier-overview" aria-label="Pedidos agrupados por proveedor">
   <strong>Pedidos por proveedor</strong>
   {bySupplier.map(p=><div key={p.key}><span>{p.name}</span><small>{p.products} líneas · {p.pharmacies.size} farmacias</small>
    <b>{whole(p.units)} uds.</b></div>)}
  </div>}
  <ListTable rows={groups} columns={columns} rowKey={g=>g.key} label="artículos del preparador"
   defaultSort={{key:"suggested",direction:"desc"}} loading={busy&&!result}
   loadingLabel="Calculando necesidades por farmacia…"
   emptyText={busy?"Consultando artículos…":"No hay artículos para este filtro"}/>
  <div className="fm-planner-actions">
   <button type="button" className="btn btn-secondary" onClick={exportGrouped} disabled={!allLines.length||busy||invalidQuantities>0||missingArticle>0||missingSupplier>0||result?.truncated}>
    <Download size={16}/> Exportar CSV por proveedor</button>
   <button type="button" className="btn btn-primary" disabled={!canEdit||!allLines.length||busy||missingSupplier>0||missingArticle>0||invalidQuantities>0||result?.truncated}
    onClick={saveDrafts}><Save size={16}/>{busy?"Guardando…":"Guardar borradores por proveedor"}</button>
  </div>
  <p className="fm-op-fine">{result?.note||"La propuesta necesita ventas y stock sincronizados."} No se envía automáticamente ningún pedido. Los borradores se revisan y aprueban en la sección inferior.</p>
 </section>;
}
