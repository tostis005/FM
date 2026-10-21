import React,{useEffect,useMemo,useState} from "react";
import ListTable from "./ListTable.jsx";
import {PieChart,Pie,Cell,ResponsiveContainer,Tooltip} from "recharts";
import {euro,integer,percentage} from "./localeES.js";
import "./dashboardInsights.css";

const DAYS=["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];
const HOURS=[{from:0,to:9,label:"00–09"},
 ...Array.from({length:12},(_,i)=>({from:9+i,to:10+i,label:String(9+i).padStart(2,"0")+"–"+String(10+i).padStart(2,"0")})),
 {from:21,to:24,label:"21–24"}];
const CHANNELS={cooperativa:"Cooperativa",laboratorio:"Laboratorio"};
const COLORS={cooperativa:"#14966b",laboratorio:"#acdcca"};
const EMPTY=[];
const price=v=>v==null?"—":new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR",
 minimumFractionDigits:2,maximumFractionDigits:3}).format(Number(v));
const pct=v=>v==null?"—":percentage(v);
function useInsight(endpoint,{clientSlug,from,to,pharmacyIds,reloadKey,valid}){
 const scope=[clientSlug,from,to,pharmacyIds.join(","),reloadKey].join("|");
 const [result,setResult]=useState(null);
 useEffect(()=>{
  if(!valid)return;
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
 },[endpoint,scope,valid]);
 return !valid?{status:"empty"}:result?.scope===scope?result:{status:"loading"};
}
function Panel({title,subtitle,insight,children,empty="Sin movimientos en este período"}){
 return <section className="card fm-insight-panel" aria-busy={insight.status==="loading"}>
  <div className="fm-insight-head"><h2>{title}</h2><p>{subtitle}</p></div>
  {insight.status==="loading"?<p className="fm-insight-status" role="status">Cargando {title.toLowerCase()}…</p>:
   insight.status==="error"?<p className="fm-insight-status" role="alert">{insight.error}</p>:
   insight.status==="empty"?<p className="fm-insight-status">{empty}</p>:children}
 </section>;
}
function Heatmap({scope}){
 const insight=useInsight("horarios",scope);
 const cells=Array.isArray(insight.data?.cells)?insight.data.cells:EMPTY;
 const total=Number(insight.data?.total)||0;
 const grid=useMemo(()=>{
  const map=new Map();
  for(const cell of cells){
   const index=HOURS.findIndex(h=>Number(cell.hour)>=h.from&&Number(cell.hour)<h.to);
   if(index<0)continue;
   const key=String(cell.weekday)+"|"+index,old=map.get(key)||{value:0,lines:0};
   old.value+=Number(cell.sales||0);old.lines+=Number(cell.lines||0);
   map.set(key,old);
  }
  return map;
 },[cells]);
 const max=Math.max(0,...[...grid.values()].map(x=>Math.max(0,x.value)));
 return <Panel title="Mapa de calor de ventas" subtitle="Importe neto vendido por día de la semana y franja horaria · verde más intenso = más ventas" insight={insight}>
  {cells.length===0?<p className="fm-insight-status">No hay ventas registradas para la selección.</p>:
   <><div className="fm-heat-scroll"><div className="fm-heat-grid" role="table" aria-label="Importe de ventas según día y horario" style={{gridTemplateColumns:"98px repeat("+HOURS.length+", minmax(75px,1fr))"}}>
    <div className="fm-heat-axis" role="columnheader">Día</div>
    {HOURS.map(h=><div key={h.label} className="fm-heat-axis" role="columnheader">{h.label}</div>)}
    {DAYS.map((day,index)=><React.Fragment key={day}>
     <div className="fm-heat-day" role="rowheader">{day}</div>
     {HOURS.map((h,k)=>{
      const cell=grid.get(String(index+1)+"|"+k),value=cell?.value||0;
      const fraction=max>0?Math.sqrt(Math.max(0,value)/max):0;
      const background=value>0?"rgba(11, 158, 103, "+(0.12+fraction*0.83)+")":"#f4f8f6";
      const dark=fraction>0.58;
      return <div key={h.label} role="cell" className={"fm-heat-cell "+(dark?"fm-heat-cell-strong":"")}
       style={{backgroundColor:background}} title={day+" "+h.label+": "+euro(value)+" · "+integer(cell?.lines||0)+" líneas"}
       aria-label={day+" de "+h.from+" a "+h.to+": "+euro(value)}>
       {value!==0?euro(value):"—"}</div>;
     })}
    </React.Fragment>)}
   </div></div><p className="fm-insight-foot">Suma de movimientos de todo el período agrupados por día y hora de venta; incluye las franjas fuera del horario habitual. Total: <strong>{euro(total)}</strong>.</p></>}
 </Panel>;
}
function Sellers({scope}){
 const insight=useInsight("vendedores",scope);
 const [showAll,setShowAll]=useState(false);
 const sellers=Array.isArray(insight.data?.sellers)?insight.data.sellers:EMPTY;
 const maximum=Math.max(1,...sellers.map(x=>Math.max(0,x.sales)));
 return <Panel title="Ventas por vendedor" subtitle="Comparación de ventas netas · vendedores de las farmacias seleccionadas" insight={insight}>
  {!sellers.length?<p className="fm-insight-status">No hay vendedores con ventas para la selección.</p>:
   <><div className="fm-seller-list">
    {(showAll?sellers:sellers.slice(0,12)).map((s,i)=><div className="fm-seller-row" key={s.name+"|"+i}>
     <div className="fm-seller-label"><span title={s.name}>{s.name}</span><strong>{euro(s.sales)}</strong></div>
     <div className="fm-seller-track"><div style={{width:Math.max(0,s.sales)/maximum*100+"%"}}/></div>
    </div>)}
   </div>{sellers.length>12&&<button type="button" className="btn btn-secondary fm-seller-more"
     onClick={()=>setShowAll(!showAll)}>{showAll?"Ver los 12 primeros":"Ver todos ("+sellers.length+")"}</button>}
   <p className="fm-insight-foot">El ranking se calcula con el importe neto, incluyendo devoluciones. Se resuelve el nombre del vendedor por farmacia.</p></>}
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
function Purchases({scope,pharmacies}){
 const insight=useInsight("canales-compra",scope);
 const [filters,setFilters]=useState({});
 const [readyFilters,setReadyFilters]=useState({});
 const [sort,setSort]=useState({key:"potentialSaving",direction:"desc"});
 const [page,setPage]=useState(1);
 const [pageSize,setPageSize]=useState(25);
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
  {key:"coopPuc",label:"PUC coop.",value:r=>r.coopPuc,render:r=>price(r.coopPuc)},
  {key:"labPuc",label:"PUC lab.",value:r=>r.labPuc,render:r=>price(r.labPuc)},
  {key:"difference",label:"Diferencia",value:r=>r.difference,
   render:r=><span className={r.difference>0?"fm-cost-higher":"fm-cost-lower"}>{price(r.difference)}</span>},
  {key:"differencePct",label:"Ahorro %",value:r=>r.differencePct,
   render:r=>pct(r.differencePct)},
  {key:"cheaper",label:"Más económico",filterMode:"multi",value:r=>r.cheaper,
   render:r=>r.cheaper},
  {key:"potentialSaving",label:"Ahorro potencial",value:r=>r.potentialSaving,
   render:r=><strong>{euro(r.potentialSaving)}</strong>}
 ];
 const changeFilters=next=>{setFilters(next);setPage(1)};
 return <Panel title="¿Dónde estamos comprando mejor?" subtitle="Cooperativa frente a laboratorio · coste ponderado de las compras, según PUC registrado" insight={insight}>
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
        <span className="fm-channel-dot" style={{background:COLORS[channel]}/>
        <span>{CHANNELS[channel]}</span><strong>{euro(value)}</strong>
        <small>{known>0?pct(value/known*100):"—"}</small>
       </div>;
      })}
      <p className="fm-insight-foot">Importes de compras según su PUC. Solo se consideran cooperativas los proveedores con el indicador activado; el resto son laboratorios.</p>
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
       loadingLabel="Comparando PUC de laboratorio y cooperativa…"
       serverFilters={filters}
       onServerFiltersChange={changeFilters}
       filterOptions={{pharmacy:pharmacies.map(p=>p.name),cheaper:["Laboratorio","Cooperativa","Igual"]}}
       sort={sort}
       onSortChange={next=>{setSort(next);setPage(1)}}
       serverPagination={{total,page,pageSize,onPageChange:setPage,
        onPageSizeChange:n=>{setPageSize(n);setPage(1)}}}
      />
     </div>}
    <p className="fm-insight-foot">PUC medio ponderado por unidades compradas (sin devoluciones y con PUC positivo). El ahorro estimado compara las unidades compradas al canal más caro, sin considerar rappels, portes ni otras condiciones comerciales.</p>
   </>}
 </Panel>;
}
export default function DashboardInsights({clientSlug,period,pharmacyIds=[],pharmacies=[],reloadKey=0}){
 const scope={clientSlug,from:period.from,to:period.to,valid:period.valid,
  pharmacyIds,reloadKey};
 return <div className="fm-dashboard-insights">
  <Heatmap scope={scope}/>
  <div className="fm-dashboard-insights-bottom">
   <Sellers scope={scope}/>
   <Purchases scope={scope} pharmacies={pharmacies}/>
  </div>
 </div>;
}
