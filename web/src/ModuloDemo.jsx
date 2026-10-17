import React,{useMemo,useState,useEffect} from "react";
import {BarChart,Bar,XAxis,YAxis,Tooltip,ResponsiveContainer,CartesianGrid} from "recharts";
import {ArrowDownToLine,ArrowRight,Search,X} from "lucide-react";
import ListTable from "./ListTable.jsx";
import {MultiSelectFilter} from "./MultiSelectFilter.jsx";
import {buildDemoTables,normalizeTables,money,number} from "./businessDemoData.js";
import {buildAnalysis} from "./businessAnalytics.js";
import "./moduleDemo.css";

const TITLES={
 dashboard:"Dashboard",ventas:"Ventas",compras:"Compras",proveedores:"Proveedores",
 stock:"Stock",reposicion:"Reposición",genericos:"Genéricos",
 rentabilidad:"Rentabilidad",acciones:"Acciones",informes:"Informes",asistente:"Asistente IA"
};
const SERIES={
 dashboard:["ventas","compras","Ventas y compras"],
 ventas:["ventas",null,"Evolución de ventas"],compras:["compras",null,"Evolución de compras"],
 proveedores:["compras",null,"Compras por periodo"],stock:["unidades",null,"Unidades vendidas"],
 reposicion:["unidades",null,"Demanda por periodo"],genericos:["genericos",null,"Compras de genéricos"],
 rentabilidad:["margen",null,"Margen estimado por periodo"],
 acciones:["compras",null,"Compras por periodo"],informes:["ventas","compras","Ventas y compras"]
};
const CARD=(label,key,unit,link)=>({label,key,unit,link});
function metricCards(module,k){
 const shared=[
  CARD("Ventas", "ventas","€","ventas"),
  CARD("Compras","compras","€","compras"),
  CARD("Stock valorado","stock","€","stock"),
  CARD("Margen estimado","margen","€","rentabilidad"),
  CARD("Potencial de precio","potencialCompra","€","compras"),
  CARD("Reposiciones","reposiciones","n","reposicion")
 ];
 const map={
  dashboard:shared,
  ventas:[shared[0],CARD("Unidades vendidas","unidades","n"),CARD("Artículos vendidos","articulosVendidos","n"),shared[3]],
  compras:[shared[1],shared[4],CARD("Proveedores","proveedores","n","proveedores"),CARD("Compra de genéricos","compraGenericos","€","genericos")],
  proveedores:[CARD("Proveedores","proveedores","n"),shared[1],shared[4],CARD("CN con compras","articulosVendidos","n","compras")],
  stock:[shared[2],CARD("Sobrestock estimado","sobrestock","€","acciones"),CARD("Sin ventas en periodo","stockSinRotacion","n"),CARD("Roturas detectadas","roturas","n","reposicion")],
  reposicion:[shared[5],CARD("Coste de reposición","reposicionCoste","€"),CARD("Roturas","roturas","n"),shared[2]],
  genericos:[CARD("Compra de genéricos","compraGenericos","€"),CARD("Potencial de precio","potencialGenericos","€","compras"),shared[1],CARD("Proveedores","proveedores","n","proveedores")],
  rentabilidad:[shared[3],CARD("Margen estimado","margenPct","%"),CARD("Cobertura de costes","coberturaCostes","%"),shared[0]],
  acciones:[CARD("Acciones identificadas","acciones","n"),shared[4],CARD("Sobrestock","sobrestock","€","stock"),shared[5]],
  informes:shared.slice(0,4),asistente:shared.slice(0,4)
 };
 return (map[module]||shared).map(c=>({...c,value:k[c.key]}));
}
function format(value,unit){
 if(value==null)return "—";
 if(unit==="€")return money(value);
 if(unit==="%")return number(value)+" %";
 return number(value);
}
function csvExport(module,columns,rows){
 const cells=[columns.map(c=>c.label),...rows.map(r=>columns.map(c=>c.value(r)??""))];
 const csv="\ufeff"+cells.map(record=>record.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(";")).join("\r\n");
 const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
 const link=document.createElement("a");link.href=url;link.download="farmetrica-"+module+".csv";link.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const C=(key,label,field,fmt)=>({key,label,value:r=>r[field],render:fmt?r=>fmt(r[field]):undefined});
function columnsFor(module,pharmacyMap){
 const pharmacy={key:"pharmacy",label:"Farmacia",filterMode:"multi",value:r=>pharmacyMap.get(String(r.pharmacyId))||"—"};
 const article=C("name","Artículo","name"),cn=C("cn","CN","cn");
 const family={key:"family",label:"Familia",filterMode:"multi",value:r=>r.family||"—"};
 const euro=(key,label)=>C(key,label,key,v=>v==null?"—":money(v)),num=(key,label)=>C(key,label,key,v=>v==null?"—":number(v));
 const common=[article,cn,pharmacy];
 switch(module){
  case "ventas":return [...common,family,num("units","Unidades"),euro("value","Ventas"),euro("margin","Margen estimado")];
  case "compras":return [...common,C("supplier","Proveedor","supplier"),num("units","Unidades"),C("puc","PUC","puc",v=>v==null?"—":money(v)),C("target","PUC objetivo","target",v=>v==null?"—":money(v)),euro("value","Compras"),euro("potential","Potencial de precio")];
  case "proveedores":return [C("name","Proveedor","name"),C("family","Tipo","family"),num("products","Artículos"),euro("value","Compras"),euro("potential","Potencial de precio")];
  case "stock":return [...common,num("units","Stock (uds.)"),C("coverage","Cobertura (días)","coverage",number),euro("value","Valor stock"),euro("excessValue","Sobrestock")];
  case "reposicion":return [...common,num("units","Stock actual"),num("need","Reposición (uds.)"),euro("needValue","Coste estimado")];
  case "genericos":return [...common,C("supplier","Proveedor","supplier"),C("grupoGenerico","Grupo","grupoGenerico"),euro("value","Compras"),C("puc","PUC","puc",money),C("target","PUC objetivo","target",v=>v==null?"—":money(v)),euro("potential","Potencial de precio")];
  case "rentabilidad":return [...common,euro("value","Ventas"),euro("margin","Margen estimado"),C("marginPct","Margen (%)","marginPct",v=>v==null?"—":number(v)+" %")];
  case "acciones":return [C("action","Acción","action"),...common,euro("impact","Importe asociado")];
  default:return [...common,euro("value","Ventas")];
 }
}
const REPORTS=[
 ["ventas","Ventas","Ventas del periodo"],["compras","Compras","Costes y PUC"],
 ["proveedores","Proveedores","Gasto por proveedor"],["stock","Stock","Stock y cobertura"],
 ["reposicion","Reposición","Necesidades de pedido"],["genericos","Genéricos","Compras de genéricos"],
 ["rentabilidad","Rentabilidad","Margen estimado"],["acciones","Acciones","Oportunidades"]
];
const QUESTIONS=[
 ["¿Qué artículos vendemos más?","ventas"],["¿Dónde pagamos más por un CN?","compras"],
 ["¿Qué proveedores concentran el gasto?","proveedores"],
 ["¿Dónde hay exceso de stock?","stock"],["¿Qué artículos debemos reponer?","reposicion"],
 ["¿Cómo evolucionan los márgenes?","rentabilidad"],
 ["¿Qué genéricos tienen precios mejorables?","genericos"],
 ["¿Qué acciones tienen mayor importe asociado?","acciones"]
];
const STORAGE="fm_analytics_filters_";
function readFilters(client){
 try{const saved=JSON.parse(sessionStorage.getItem(STORAGE+client)||"null");
  if(saved&&typeof saved==="object")return {period:saved.period||"6",
    pharmacyIds:Array.isArray(saved.pharmacyIds)?saved.pharmacyIds:[],
    families:Array.isArray(saved.families)?saved.families:[],search:String(saved.search||"")};
 }catch{}
 return {period:"6",pharmacyIds:[],families:[],search:""};
}
export default function ModuloDemo({module,pharmacies=[],clientSlug="ampedia",onNavigate=()=>{},canNavigate=()=>true,realTables=null}){
 const [filters,setFilters]=useState(()=>readFilters(clientSlug));
 const [detail,setDetail]=useState(null);
 const asOf=useMemo(()=>new Date(),[]);
 const ids=pharmacies.map(p=>String(p.id)).join(",");
 const tables=useMemo(()=>realTables?normalizeTables(realTables):buildDemoTables(pharmacies,asOf),[realTables,ids,asOf]);
 const pharmacyMap=useMemo(()=>new Map(pharmacies.map(p=>[String(p.id),p.name])),[ids]);
 const analysis=useMemo(()=>buildAnalysis(tables,{...filters,allowedPharmacyIds:pharmacies.map(p=>p.id)},asOf),[tables,filters,ids,asOf]);
 useEffect(()=>{sessionStorage.setItem(STORAGE+clientSlug,JSON.stringify(filters))},[filters,clientSlug]);
 const familyOptions=[...new Set(tables.articulos.map(a=>a.familia))].sort().map(v=>({label:v,value:v}));
 const pharmacyOptions=pharmacies.map(p=>({label:p.name,value:String(p.id)}));
 const change=(field,value)=>setFilters(f=>({...f,[field]:value}));
 const go=route=>{if(route&&canNavigate(route))onNavigate(route)};
 const cards=metricCards(module,analysis.kpis);
 const isDashboard=module==="dashboard",isReports=module==="informes",isAssistant=module==="asistente";
 const datasets={ventas:analysis.salesRows,compras:analysis.buyRows,
  proveedores:analysis.supplierRows,stock:analysis.stockRows,
  reposicion:analysis.replenishmentRows,genericos:analysis.genericRows,
  rentabilidad:analysis.profitRows,acciones:analysis.actions,
  dashboard:analysis.actions};
 const rows=datasets[module]||[];
 const columns=columnsFor(module==="dashboard"?"acciones":module,pharmacyMap);
 const chartConfig=SERIES[module]||SERIES.dashboard;
 const chart=analysis.monthly.map(x=>({...x,month:x.month.slice(5)+"/"+x.month.slice(2,4)}));
 return <div className="fm-demo fm-demo-v2">
  <div className="page-header"><h1>{TITLES[module]||"Dashboard"}</h1>
   {!realTables&&<span className="fm-demo-tag">Datos de ejemplo</span>}</div>
  <div className="fm-demo-filters">
   <div className="fm-filter-field"><span>Farmacias</span><MultiSelectFilter label="Farmacias" options={pharmacyOptions} value={filters.pharmacyIds} onChange={v=>change("pharmacyIds",v)}/></div>
   <div className="fm-filter-field"><span>Familias</span><MultiSelectFilter label="Familias" options={familyOptions} value={filters.families} onChange={v=>change("families",v)}/></div>
   <label><span>Periodo</span><select value={filters.period} onChange={e=>change("period",e.target.value)}><option value="3">3 meses</option><option value="6">6 meses</option><option value="12">12 meses</option></select></label>
   <label className="fm-demo-search"><span>Artículo o CN</span><div><Search size={15}/><input value={filters.search} onChange={e=>change("search",e.target.value)} placeholder="Buscar…" /></div></label>
  </div>
  <div className="fm-demo-kpis">{cards.map(c=>{
   const active=Boolean(c.link&&canNavigate(c.link));
   return <button key={c.label+c.key} type="button" className={"card fm-demo-kpi fm-kpi-link "+(active?"fm-kpi-active":"")}
    disabled={!active} onClick={()=>go(c.link)} aria-label={active?c.label+": abrir "+TITLES[c.link]:c.label}>
    <span>{c.label}</span><strong>{format(c.value,c.unit)}</strong>{active&&<ArrowRight size={17} className="fm-kpi-arrow"/>}
   </button>;
  })}</div>
  {isDashboard&&<section className="fm-module-links" aria-label="Acceso a módulos">
   {REPORTS.filter(([id])=>canNavigate(id)).map(([id,title])=><button key={id} type="button" className="card fm-module-link" onClick={()=>go(id)}><strong>{title}</strong><ArrowRight size={17}/></button>)}
  </section>}
  {!isAssistant&&<section className="card fm-demo-graph">
    <div className="section-heading"><h2>{chartConfig[2]}</h2></div>
    <div className="fm-demo-chart"><ResponsiveContainer width="100%" height="100%">
     <BarChart data={chart} margin={{top:12,right:10,left:0,bottom:0}}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#edf2ef"/>
      <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={11}/>
      <YAxis tickLine={false} axisLine={false} width={48} fontSize={10}/>
      <Tooltip formatter={(v,key)=>[key==="unidades"?number(v):money(v),TITLES[key]||key]}/>
      <Bar dataKey={chartConfig[0]} name={chartConfig[0]} fill="#159c70" radius={[5,5,0,0]}/>
      {chartConfig[1]&&<Bar dataKey={chartConfig[1]} name={chartConfig[1]} fill="#b4ddcd" radius={[5,5,0,0]}/>}
     </BarChart>
    </ResponsiveContainer></div>
   </section>}
  {isReports?<section className="card fm-demo-table">
   <div className="section-heading"><h2>Informes por área</h2></div>
   <div className="fm-link-list">{REPORTS.filter(([id])=>canNavigate(id)).map(([id,title,scope])=>
    <button key={id} className="fm-report-link" onClick={()=>go(id)}><span><strong>{title}</strong><small>{scope}</small></span><ArrowRight size={18}/></button>)}</div>
  </section>:isAssistant?<section className="card fm-demo-table">
   <div className="section-heading"><h2>Consultas de análisis</h2></div>
   <div className="fm-link-list">{QUESTIONS.filter(([,id])=>canNavigate(id)).map(([question,id])=>
    <button key={question} className="fm-report-link" onClick={()=>go(id)}><strong>{question}</strong><ArrowRight size={18}/></button>)}</div>
  </section>:<section className="card fm-demo-table">
   <div className="section-heading"><h2>{isDashboard?"Acciones prioritarias":TITLES[module]+" por artículo"}</h2>
    <button className="btn btn-secondary" type="button" onClick={()=>csvExport(module,columns,rows)}><ArrowDownToLine size={16}/> CSV</button></div>
   <ListTable rows={rows} rowKey={r=>r.id} label="registros" emptyText="Sin resultados"
    onRowClick={row=>isDashboard?go(row.targetModule):setDetail(row)} columns={columns}/>
  </section>}
  {detail&&<div className="fm-demo-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setDetail(null)}}>
   <div className="fm-demo-detail" role="dialog" aria-modal="true" aria-label="Detalle de registro">
    <button className="btn btn-secondary" type="button" onClick={()=>setDetail(null)}><X size={16}/> Cerrar</button>
    <h2>{detail.name}</h2>
    <dl>{columns.filter(c=>c.key!=="name").map(c=><React.Fragment key={c.key}><dt>{c.label}</dt><dd>{c.render?c.render(detail):String(c.value(detail)??"—")}</dd></React.Fragment>)}</dl>
   </div>
  </div>}
 </div>;
}
