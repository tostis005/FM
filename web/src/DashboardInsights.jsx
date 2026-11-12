import React,{useEffect,useMemo,useState} from "react";
import ListTable from "./ListTable.jsx";
import {Clock3,UsersRound} from "lucide-react";
import SalesCardHeading from "./SalesCardHeading.jsx";
import {putPurchaseLink} from "./PurchasePlanner.jsx";
import {PieChart,Pie,Cell,ResponsiveContainer,Tooltip} from "recharts";
import {euro,integer,percentage} from "./localeES.js";
import {salesTicketWindows,mapTicketWindows} from "./salesTicketWindows.js";
import {HEAT_STOPS,HEAT_DAYS,heatColor,heatmapHours,mergeSalesHeatmap} from "./salesHeatmap.js";
import "./dashboardInsights.css";

const CHANNELS={cooperativa:"Mayorista*",laboratorio:"Laboratorio"};
const COLORS={cooperativa:"#14966b",laboratorio:"#acdcca"};
const EMPTY=[];
const price=v=>v==null?"—":new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR",
 minimumFractionDigits:2,maximumFractionDigits:3}).format(Number(v));
const pct=v=>v==null?"—":percentage(v);
function useInsight(endpoint,{clientSlug,from,to,pharmacyIds,reloadKey,valid},shared=null){
 const scope=[clientSlug,from,to,pharmacyIds.join(","),reloadKey].join("|");
 const [result,setResult]=useState(null);
 // No repetir dos consultas pesadas si falla la solicitud conjunta de Ventas.
 const fallback=false;
 useEffect(()=>{
  if(!valid||(shared&&!fallback))return;
  const controller=new AbortController();
  const params=new URLSearchParams({desde:from,hasta:to});
  if(pharmacyIds.length)params.set("farmacias",pharmacyIds.join(","));
  if(endpoint==="canales-compra")params.set("resumen","1");
  setResult({scope,status:"loading"});
  const timeout=setTimeout(()=>{
   if(controller.signal.aborted)return;
   setResult({scope,status:"error",
    error:"La consulta tarda demasiado. Prueba un período más corto."});
   controller.abort();
  },30000);
  fetch("/api/analytics/dashboard/"+endpoint+"?"+params,{
   credentials:"same-origin",cache:"no-store",
   headers:{"X-Farmetrica-Cliente":clientSlug},signal:controller.signal
  }).then(async response=>{
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(body.error||"No se puede cargar el análisis");
   return body;
  }).then(data=>{if(!controller.signal.aborted)setResult({scope,status:"ready",data})})
   .catch(error=>{if(!controller.signal.aborted)setResult({scope,status:"error",error:error.message})})
   .finally(()=>clearTimeout(timeout));
  return()=>{clearTimeout(timeout);controller.abort()};
 },[endpoint,scope,valid,Boolean(shared),fallback]);
 if(!valid)return {status:"empty"};
 // En Ventas, el mapa y el ranking reutilizan una sola respuesta compartida.
 // Compras sigue usando su consulta independiente, sin alterar sus permisos.
 if(shared&&!fallback)return shared.status==="ready"?
  {status:"ready",data:shared.data?.[endpoint]}:
  {status:shared.status,error:shared.error};
 // Recuperación excepcional: si falla la consulta conjunta, estas dos
 // visualizaciones conservan su endpoint previo en lugar de quedarse vacías.
 return result?.scope===scope?result:{status:"loading"};
}
function Panel({title,subtitle,icon,insight,children,empty="Sin movimientos en este período"}){
 return <section className="card fm-insight-panel" aria-busy={insight.status==="loading"}>
  {icon?<SalesCardHeading icon={icon} title={title}/>:
   <div className="fm-insight-head"><h2>{title}</h2><p>{subtitle}</p></div>}
  {insight.status==="loading"?<p className="fm-insight-status" role="status">Cargando {title.toLowerCase()}…</p>:
   insight.status==="error"?<p className="fm-insight-status" role="alert">{insight.error}</p>:
   insight.status==="empty"?<p className="fm-insight-status">{empty}</p>:children}
 </section>;
}
// Los tickets se consultan aparte del panorama económico: así el recuento
// por operaciones nunca bloquea las familias ni los vendedores.
function useTicketHeatmap({clientSlug,from,to,pharmacyIds,reloadKey,valid}){
 const token=[clientSlug,from,to,pharmacyIds.join(","),reloadKey].join("|");
 const [result,setResult]=useState(null);
 useEffect(()=>{
  if(!valid)return;
  const controller=new AbortController();
  const windows=salesTicketWindows(from,to);
  setResult({token,status:"loading"});
  const maxWait=Math.min(360000,Math.max(135000,windows.length*105000));
  const timeout=setTimeout(()=>{
   if(controller.signal.aborted)return;
   setResult({token,status:"error",
    error:"El recuento de tickets tarda demasiado. Prueba un período más corto."});
   controller.abort();
  },maxWait);
  void mapTicketWindows(windows,async window=>{
   const params=new URLSearchParams({desde:window.from,hasta:window.to});
   if(pharmacyIds.length)params.set("farmacias",pharmacyIds.join(","));
   const response=await fetch("/api/analytics/ventas/horarios-tickets?"+params,{
    credentials:"same-origin",cache:"no-store",
    headers:{"X-Farmetrica-Cliente":clientSlug},signal:controller.signal
   });
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||"No se pudo contar las operaciones");
   if(!Array.isArray(data.cells)||!Number.isFinite(Number(data.total)))
    throw Error("El recuento de tickets está incompleto");
   return data;
  },{concurrency:1,onProgress:(done,total)=>{
   if(!controller.signal.aborted&&done<total)
    setResult({token,status:"loading",
     message:"Consultando tickets históricos ("+done+" de "+total+" tramos)…"});
  }}).then(parts=>{
   if(!controller.signal.aborted)
    setResult({token,status:"ready",data:mergeSalesHeatmap(parts)});
  }).catch(error=>{
   if(!controller.signal.aborted)setResult({token,status:"error",error:error.message});
  }).finally(()=>clearTimeout(timeout));
  return()=>{clearTimeout(timeout);controller.abort()};
 },[token,valid]);
 return !valid?{status:"empty"}:result?.token===token?result:{status:"loading"};
}
function Heatmap({scope}){
 const insight=useTicketHeatmap(scope);
 const cells=Array.isArray(insight.data?.cells)?insight.data.cells:EMPTY;
 const total=Number(insight.data?.total)||0;
 const grid=useMemo(()=>{
  const map=new Map();
  for(const cell of cells){
   const key=String(cell.weekday)+"|"+String(cell.hour);
   map.set(key,(map.get(key)||0)+Number(cell.tickets||0));
  }
  return map;
 },[cells]);
 const hours=useMemo(()=>heatmapHours(cells),[cells]);
 // Escala relativa a las franjas con actividad: rojo = más tickets.
 const levels=[...new Set([...grid.values()].filter(value=>value>0))].sort((a,b)=>a-b);
 return <Panel title="Mapa de calor de operaciones" icon={Clock3} insight={insight}>
  {insight.status==="ready"&&cells.length===0?
   <p className="fm-insight-status">No hay tickets registrados para la selección.</p>:
   <><div className="fm-heat-scroll">
    <div className="fm-heat-grid" role="table"
     aria-label="Número de tickets por día de la semana y franja horaria"
     style={{gridTemplateColumns:"112px repeat(7,minmax(76px,1fr))"}}>
     <div className="fm-heat-row" role="row">
      <div className="fm-heat-axis" role="columnheader">Horario</div>
      {HEAT_DAYS.map(day=><div key={day} className="fm-heat-axis" role="columnheader">{day}</div>)}
     </div>
     {hours.map(({hour,label})=><div key={hour} className="fm-heat-row" role="row">
      <div className="fm-heat-day" role="rowheader">{label}</div>
      {HEAT_DAYS.map((day,index)=>{
       const value=grid.get(String(index+1)+"|"+String(hour))||0;
       const rank=value>0&&levels.length>1?levels.indexOf(value)/(levels.length-1):0;
       const background=value>0?heatColor(rank):"#eef2eb";
       return <div key={day} role="cell"
        className={"fm-heat-cell"+(value>0&&rank>=0.7?" fm-heat-cell-strong":"")}
        style={{backgroundColor:background}}
        title={day+" "+label+": "+integer(value)+" operaciones"}
        aria-label={day+" de "+label+": "+integer(value)+" tickets"}>
        {integer(value)}
       </div>;
      })}
     </div>)}
    </div>
   </div>
   <div className="fm-heat-legend" aria-label="Leyenda de operaciones por franja">
    <span>Menos operaciones</span>
    {HEAT_STOPS.map(color=><span key={color} className="fm-heat-legend-swatch"
     style={{backgroundColor:color}} aria-hidden="true"/>)}
    <span>Más operaciones</span><span className="fm-heat-legend-empty"
     aria-hidden="true"/><span>Sin operaciones</span>
   </div>
   <p className="fm-sales-heat-total">Total de operaciones: <strong>{integer(total)} tickets</strong></p></>}
 </Panel>;
}
function Sellers({scope,shared}){
 const insight=useInsight("vendedores",scope,shared);
 const [showAll,setShowAll]=useState(false);
 const [mode,setMode]=useState("sales");
 const sellers=Array.isArray(insight.data?.sellers)?insight.data.sellers:EMPTY;
 const ordered=useMemo(()=>[...sellers].sort((a,b)=>
  (Number(b[mode])||0)-(Number(a[mode])||0)),[sellers,mode]);
 const maximum=Math.max(1,...ordered.map(x=>Math.max(0,Number(x[mode])||0)));
 const controls=<div className="fm-so-controls fm-heat-controls">
  <div className="fm-so-segment" role="group" aria-label="Indicador por vendedor">
   <button type="button" aria-pressed={mode==="sales"} className={mode==="sales"?"is-active":""}
    onClick={()=>setMode("sales")}>Ventas €</button>
   <button type="button" aria-pressed={mode==="units"} className={mode==="units"?"is-active":""}
    onClick={()=>setMode("units")}>Unidades</button>
  </div>
 </div>;
 return <Panel title="Ventas por vendedor" icon={UsersRound} insight={insight} controls={controls}>
  {!ordered.length?<p className="fm-insight-status">No hay vendedores con ventas para la selección.</p>:
   <><div className="fm-seller-list">
    {(showAll?ordered:ordered.slice(0,12)).map((s,i)=><div className="fm-seller-row" key={s.pharmacyId+"|"+s.sellerId+"|"+i}>
     <div className="fm-seller-label">
      <span title={s.name}>{s.name}</span>
      <strong>{mode==="sales"?euro(s.sales):integer(s.units)+" uds."}</strong>
     </div>
     <div className="fm-seller-track">
      <div style={{width:Math.max(0,Number(s[mode])||0)/maximum*100+"%"}}/>
     </div>
    </div>)}
   </div>{ordered.length>12&&<button type="button" className="btn btn-secondary fm-seller-more"
     onClick={()=>setShowAll(!showAll)}>{showAll?"Ver los 12 primeros":"Ver todos ("+ordered.length+")"}</button>}
   </>}
 </Panel>;
}
function useComparator(scope,{page,pageSize,sort,filters}){
 const key=JSON.stringify([scope.clientSlug,scope.from,scope.to,scope.pharmacyIds,scope.reloadKey,
  page,pageSize,sort,filters]);
 const [result,setResult]=useState(null);
 useEffect(()=>{
  if(!scope.valid)return;
  const controller=new AbortController();
  const params=new URLSearchParams({desde:scope.from,hasta:scope.to,
   pagina:String(page),tamano:String(pageSize),orden:sort.key,direccion:sort.direction});
  if(scope.pharmacyIds.length)params.set("farmacias",scope.pharmacyIds.join(","));
  if(Object.entries(filters).some(([,v])=>Array.isArray(v)?v.length:Boolean(v)))
   params.set("columnas",JSON.stringify(filters));
  setResult({key,status:"loading"});
  const timeout=setTimeout(()=>controller.abort(),32000);
  fetch("/api/analytics/dashboard/comparador-puc?"+params,{
   credentials:"same-origin",cache:"no-store",
   headers:{"X-Farmetrica-Cliente":scope.clientSlug},signal:controller.signal
  }).then(async response=>{
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(body.error||"No se puede consultar el comparador");
   return body;
  }).then(data=>{if(!controller.signal.aborted)setResult({key,status:"ready",data})})
   .catch(e=>{if(!controller.signal.aborted)setResult({key,status:"error",error:e.message})})
   .finally(()=>clearTimeout(timeout));
  return()=>{clearTimeout(timeout);controller.abort()};
 },[key,scope.valid]);
 return !scope.valid?{status:"empty"}:result?.key===key?result:{status:"loading"};
}
function Purchases({scope,pharmacies,onNavigate,canNavigate}){
 const insight=useInsight("canales-compra",scope);
 const [filters,setFilters]=useState({});
 const [readyFilters,setReadyFilters]=useState({});
 const [sort,setSort]=useState({key:"potentialSaving",direction:"desc"});
 const [page,setPage]=useState(1);
 const [pageSize,setPageSize]=useState(25);
 const [posting,setPosting]=useState(""),[postNotice,setPostNotice]=useState("");
 const createOpportunity=async r=>{
  const rowKey=String(r.pharmacyId)+"|"+String(r.articleId);
  setPosting(rowKey);setPostNotice("");
  try{
   const title="Revisar compra de "+String(r.articleName||r.cn||r.articleId).slice(0,140);
   const response=await fetch("/api/operativa",{method:"POST",credentials:"same-origin",
    headers:{"Content-Type":"application/json","X-Farmetrica-Cliente":scope.clientSlug},
    body:JSON.stringify({
     recurso:"oportunidades",farmacia:r.pharmacyId,regla:"comparador-puc:"+String(r.articleId).slice(0,90),
     titulo:title,
     accion:"Verificar condiciones de laboratorio y mayorista para esta referencia y preparar el próximo pedido.",
     descripcion:"Oportunidad generada desde el comparador de PUC. Es una diferencia histórica; no implica ahorro conseguido.",
     impacto_tipo:"ahorro_potencial",importe_potencial:Math.max(0,Number(r.potentialSaving)||0),
     periodo:scope.from+" / "+scope.to,metodo:"Comparación PUC histórico por canal",
     prioridad:"media"
    })});
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(result.error||"No se pudo registrar la oportunidad");
   onNavigate?.("acciones");
  }catch(e){setPostNotice(e.message);}finally{setPosting("");}
 };
 useEffect(()=>{
  const timer=setTimeout(()=>setReadyFilters(filters),300);
  return()=>clearTimeout(timer);
 },[filters]);
 const comparator=useComparator(scope,{page,pageSize,sort,filters:readyFilters});
 const channels=Array.isArray(insight.data?.channels)?insight.data.channels:EMPTY;
 const comparisons=Array.isArray(comparator.data?.rows)?comparator.data.rows:EMPTY;
 const total=Number(comparator.data?.total||0);
 const classified=channels.filter(c=>["cooperativa","laboratorio"].includes(c.channel)&&c.value>0);
 const known=classified.reduce((n,c)=>n+c.value,0);
 const names=new Map(pharmacies.map(p=>[String(p.id),p.name]));
 const columns=[
  {key:"article",label:"Artículo / CN",value:r=>r.articleName||r.cn||r.articleId,
   render:r=><div><strong>{r.articleName||r.cn||r.articleId}</strong>
    <small>{r.cn||"ID ERP "+r.articleId}</small></div>},
  {key:"pharmacy",label:"Farmacia",filterMode:"multi",
   value:r=>names.get(String(r.pharmacyId))||"Farmacia "+r.pharmacyId},
  {key:"coopPuc",label:"PUC mayorista*",value:r=>r.coopPuc,render:r=>price(r.coopPuc)},
  {key:"labPuc",label:"PUC lab.",value:r=>r.labPuc,render:r=>price(r.labPuc)},
  {key:"difference",label:"Diferencia",value:r=>r.difference,
   render:r=><span className={r.difference>0?"fm-cost-higher":"fm-cost-lower"}>{price(r.difference)}</span>},
  {key:"differencePct",label:"Ahorro %",value:r=>r.differencePct,
   render:r=>pct(r.differencePct)},
  {key:"cheaper",label:"Más económico",filterMode:"multi",value:r=>r.cheaper,
   render:r=>r.cheaper},
  {key:"potentialSaving",label:"Ahorro potencial",value:r=>r.potentialSaving,
   render:r=><strong>{euro(r.potentialSaving)}</strong>},
  {key:"action",label:"Acciones",sortable:false,searchable:false,value:()=>"",
   render:r=><div className="fm-insight-actions">
    <button className="btn btn-secondary" type="button" disabled={!canNavigate?.("compras-preparador")}
     onClick={()=>{putPurchaseLink(scope.clientSlug,{cn:r.cn,articleId:r.articleId,pharmacyId:r.pharmacyId,
      supplier:"",from:scope.from,to:scope.to});onNavigate?.("compras-preparador");}}>Añadir al pedido</button>
    <button className="btn btn-secondary" type="button" disabled={!canNavigate?.("oportunidades-seguimiento")||Boolean(posting)}
     onClick={()=>void createOpportunity(r)}>
     {posting===String(r.pharmacyId)+"|"+String(r.articleId)?"Guardando…":"Registrar oportunidad"}</button>
   </div>}
 ];
 const changeFilters=next=>{setFilters(next);setPage(1)};
 return <Panel title="¿Dónde estamos comprando mejor?" subtitle="Comparativa de mayorista y laboratorio · coste ponderado de las compras, según PUC registrado" insight={insight}>
  {insight.data?.available===false?<p className="fm-insight-status">{insight.data.reason||"No hay datos de compras por artículo."}</p>:
   <>
    <div className="fm-purchase-overview">
     <div className="fm-purchase-pie">
      {classified.length>0?<ResponsiveContainer width="100%" height={190}>
       <PieChart><Pie data={classified} dataKey="value" nameKey="channel" innerRadius={51}
        outerRadius={79} paddingAngle={2} stroke="none">{classified.map(c=>
         <Cell key={c.channel} fill={COLORS[c.channel]}/>)}</Pie>
        <Tooltip formatter={(value,name)=>[euro(value),CHANNELS[name]||name]}/></PieChart>
      </ResponsiveContainer>:<p className="fm-insight-status">Sin compras clasificadas con PUC válido.</p>}
     </div>
     <div className="fm-purchase-legend">
      {["cooperativa","laboratorio"].map(channel=>{
       const item=channels.find(x=>x.channel===channel),value=item?.value||0;
       return <div key={channel} className="fm-purchase-legend-row">
        <span className="fm-channel-dot" style={{background:COLORS[channel]}}/>
        <span>{CHANNELS[channel]}</span><strong>{euro(value)}</strong>
        <small>{known>0?pct(value/known*100):"—"}</small>
       </div>;
      })}
      <p className="fm-insight-foot">Importes de compras según su PUC. La categoría Mayorista* recoge por ahora las cooperativas identificadas; no presupone que estén clasificados todos los mayoristas. Revisa los proveedores antes de interpretar la comparación.</p>
     </div>
    </div>
    <div className="fm-insight-divider"/>
    <div className="fm-purchase-heading"><div><h3>Comparador de PUC por artículo</h3>
     <p>Exclusivamente artículos comprados en ambos canales en la misma farmacia y período. Orden y filtros aplicados sobre todos los resultados, no solo la página.</p></div>
     <span className="fm-insight-count">{integer(total)} referencias</span>
    </div>
    {comparator.status==="error"?<p role="alert" className="fm-insight-status">{comparator.error}</p>:
     comparator.data?.available===false?<p className="fm-insight-status">{comparator.data.reason}</p>:
     <div className="fm-puc-comparator-table">
      <ListTable
       rows={comparisons}
       columns={columns}
       rowKey={r=>r.pharmacyId+"|"+r.articleId}
       label="artículos comparables"
       tableClass="fm-puc-smart-table"
       emptyText={known===0?"No hay compras con PUC de ambos canales para comparar.":"No hay artículos que coincidan en ambos canales con estos filtros."}
       loading={comparator.status==="loading"}
       loadingLabel="Comparando PUC de laboratorio y mayorista…"
       serverFilters={filters}
       onServerFiltersChange={changeFilters}
       filterOptions={{pharmacy:pharmacies.map(p=>p.name),cheaper:["Laboratorio","Cooperativa","Igual"]}}
       sort={sort}
       onSortChange={next=>{setSort(next);setPage(1)}}
       serverPagination={{total,page,pageSize,onPageChange:setPage,
        onPageSizeChange:n=>{setPageSize(n);setPage(1)}}}
      />
     </div>}
    {postNotice&&<p role="alert" className="fm-insight-status">{postNotice}</p>}
    <p className="fm-insight-foot">PUC medio ponderado por unidades compradas (sin devoluciones y con PUC positivo). El ahorro estimado compara las unidades compradas al canal más caro, sin considerar rappels, portes ni otras condiciones comerciales.</p>
   </>}
 </Panel>;
}
export default function DashboardInsights({mode="dashboard",clientSlug,period,pharmacyIds=[],pharmacies=[],reloadKey=0,onNavigate=()=>{},canNavigate=()=>false,salesActivity=null}){
 const scope={clientSlug,from:period.from,to:period.to,valid:period.valid,
  pharmacyIds,reloadKey};
 return <div className={"fm-dashboard-insights"+(mode==="ventas"?" fm-dashboard-insights-sales":"")}>
  {mode==="ventas"&&<><Heatmap scope={scope} shared={salesActivity}/><Sellers scope={scope} shared={salesActivity}/></>}
  {mode==="compras"&&<Purchases scope={scope} pharmacies={pharmacies}
   onNavigate={onNavigate} canNavigate={canNavigate}/>}
 </div>;
}
