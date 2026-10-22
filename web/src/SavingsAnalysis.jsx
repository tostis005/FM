import React,{useEffect,useRef,useState} from "react";
import {Download,RefreshCw} from "lucide-react";
import {downloadTableCSV} from "./tableExport.js";

const euro=n=>n==null?"No verificable":new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR",maximumFractionDigits:2}).format(Number(n));
const integer=n=>new Intl.NumberFormat("es-ES",{maximumFractionDigits:0}).format(Number(n||0));
export default function SavingsAnalysis({clientSlug,period,pharmacyIds=[]}){
 const [report,setReport]=useState(null),[error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 const filterKey=[clientSlug,period.from,period.to,pharmacyIds.join(",")].join("|");
 const latestKey=useRef(filterKey);latestKey.current=filterKey;
 const inRange=period.valid&&Date.parse(period.to)-Date.parse(period.from)<=366*86400000;
 // No mostrar un informe anterior con un período o farmacias nuevos.
 useEffect(()=>{setReport(null);setError("")},[filterKey]);
 const run=async()=>{
  if(!inRange||busy)return;
  const current=filterKey;
  setBusy(true);setError("");setReport(null);
  const params=new URLSearchParams({desde:period.from,hasta:period.to});
  if(pharmacyIds.length)params.set("farmacias",pharmacyIds.join(","));
  const load=async name=>{
   const response=await fetch("/api/analytics/ahorro/"+name+"?"+params,{
    credentials:"same-origin",cache:"no-store",headers:{"X-Farmetrica-Cliente":clientSlug}});
   const json=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(json.error||"Error en "+name+" (HTTP "+response.status+")");
   return json;
  };
  try{
   const results=await Promise.allSettled(["resumen","precios","stock"].map(load));
   if(latestKey.current!==current)return;
   const values=results.map(x=>x.status==="fulfilled"?x.value:null);
   const problems=results.map((x,i)=>x.status==="rejected"?["resumen","precios","stock"][i]+": "+x.reason.message:null).filter(Boolean);
   setReport({summary:values[0],prices:values[1],stock:values[2]});
   setError(problems.join(" · "));
  }finally{setBusy(false)}
 };
 const summary=report?.summary?.totals,prices=report?.prices;
 const priced=prices?.totals?.observed;
 const stock=report?.stock?.rows||[];
 const stockTotal=stock.reduce((sum,p)=>sum+Number(p.excessCapital||0),0);
 const withoutSales=stock.reduce((sum,p)=>sum+Number(p.withoutSalesValue||0),0);
 const exportCsv=()=>{if(!prices?.rows?.length)return;
  downloadTableCSV("farmetrica-ahorro-puc-verificado",
   ["Farmacia ID","Artículo ERP","PUC coop","PUC otro","Unidades coop","Líneas coop","Líneas otro","Diferencial histórico €"],
   prices.rows.map(p=>[p.fid,p.article,p.coop_puc,p.other_puc,p.coop_units,p.coop_lines,p.other_lines,p.diff_eur]));};
 return <section className="card fm-demo-table" aria-busy={busy}>
  <div className="section-heading"><div>
   <h2>Análisis de ahorro con datos reales</h2>
   <p>Comparación por artículo y farmacia, sin aplicar un porcentaje supuesto a las ventas.</p>
  </div>
   <button type="button" className="btn btn-secondary" onClick={run} disabled={busy||!inRange}>
    <RefreshCw size={16}/>{busy?" Calculando…":" Calcular ahorro real"}
   </button>
  </div>
  {report&&<p className="fm-insight-foot">Período: {period.from} — {period.to}. Farmacias: {pharmacyIds.length?"seleccionadas":"todas las autorizadas"}.</p>}
  {!inRange&&<p role="alert">Selecciona un período válido, máximo 367 días.</p>}
  {error&&<p role="alert" className="fm-insight-status">{error}</p>}
  {summary&&<div className="kpi-grid small-kpis">
   <div className="card"><span>Ventas netas</span><strong>{euro(summary.sales.amount)}</strong></div>
   <div className="card"><span>Compras netas</span><strong>{euro(summary.purchases.amount)}</strong></div>
   <div className="card"><span>Stock valorado</span><strong>{euro(summary.stock.amount)}</strong><small>{summary.stock.pricedReferences}/{summary.stock.references} referencias valoradas</small></div>
   <div className="card"><span>Diferencial de precios contrastado</span><strong>{euro(priced)}</strong><small>Histórico; no ahorro realizado</small></div>
  </div>}
  {summary&&<p className="fm-insight-foot">Gasto por canal identificado: cooperativas {euro(summary.purchases.channels.cooperativa?.amount??(summary.purchases.channels.cooperativa?null:0))}; proveedores no cooperativos identificados {euro(summary.purchases.channels.no_cooperativa?.amount??(summary.purchases.channels.no_cooperativa?null:0))}; sin clasificación verificada {euro(summary.purchases.channels.sin_verificar?.amount??(summary.purchases.channels.sin_verificar?null:0))}. Los importes solo se consideran completos si todas las líneas tienen importe.</p>}
  {prices&&<div>
   <h3>Comparación de costes realmente pagados</h3>
   <p>{integer(prices.totals?.verified)} referencias con al menos dos compras en cada canal. Diferencial histórico observado: <strong>{euro(priced)}</strong>. Importe indicativo incluyendo referencias con menos evidencia: {euro(prices.totals?.indicative)}.</p>
   <p className="fm-insight-foot">No supone que el precio pueda repetirse ni incluye descuentos posteriores, rappels, portes o mínimos de pedido. «No cooperativa» no equivale necesariamente a laboratorio.</p>
   {prices.rows?.length>0&&<div style={{overflowX:"auto"}}>
    <table><thead><tr><th>Farmacia</th><th>Artículo ERP</th><th>PUC coop.</th><th>PUC otro</th><th>Unid. coop.</th><th>Compras por canal</th><th>Diferencial €</th></tr></thead>
    <tbody>{prices.rows.map(p=><tr key={p.fid+"-"+p.article}>
     <td>{p.fid}</td><td>{p.article}</td><td>{euro(p.coop_puc)}</td><td>{euro(p.other_puc)}</td>
     <td>{integer(p.coop_units)}</td><td>{integer(p.coop_lines)} / {integer(p.other_lines)}</td>
     <td><strong>{euro(p.diff_eur)}</strong></td>
    </tr>)}</tbody></table>
    </div>}
   <button type="button" className="btn btn-secondary" onClick={exportCsv} disabled={!prices.rows?.length}>
    <Download size={15}/> CSV de las principales referencias
   </button>
  </div>}
  {report?.stock&&<div>
   <h3>Capital en existencias</h3>
   <p>Existencias con coste registrado y sin ventas en el período: <strong>{euro(withoutSales)}</strong>.
    Exceso respecto de los días de stock configurados: <strong>{euro(stockTotal)}</strong>.</p>
   <p className="fm-insight-foot">Estos importes representan capital potencialmente liberable, no un ahorro anual. Deben verificarse vigencia del stock, venta reciente y condiciones de reposición antes de actuar.</p>
  </div>}
 </section>;
}
