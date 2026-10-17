import React,{useMemo,useState} from "react";
import {BarChart,Bar,XAxis,YAxis,Tooltip,ResponsiveContainer,CartesianGrid} from "recharts";
import {Activity,ArrowDownToLine,BarChart3,Filter,Info,Search,TrendingUp} from "lucide-react";
import ListTable from "./ListTable.jsx";
import "./moduleDemo.css";

// Las cifras de este componente son exclusivamente de demostración.
const euros=n=>new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(n);
const qty=n=>new Intl.NumberFormat("es-ES").format(n);
const CONFIG={
 dashboard:{title:"Visión general",subtitle:"Una visión clara de las oportunidades y el estado del negocio.",kpis:[["Ventas del periodo",189420,"€"],["Compras del periodo",137800,"€"],["Stock valorado",215600,"€"],["Oportunidades detectadas",38,"n"]],heading:"Principales oportunidades",metric:"Importe"},
 ventas:{title:"Análisis de ventas",subtitle:"Evolución comercial, productos, familias y comportamiento de la demanda.",kpis:[["Ventas netas",189420,"€"],["Unidades vendidas",14032,"n"],["Ticket medio",25.8,"€"],["Familias activas",24,"n"]],heading:"Ventas por familia",metric:"Ventas"},
 compras:{title:"Compras inteligentes",subtitle:"Detecta precios mejorables y prepara decisiones de compra con referencias claras.",kpis:[["Gasto observado",137800,"€"],["Mejora potencial",8400,"€"],["Artículos analizados",1240,"n"],["PUC sobre objetivo",93,"n"]],heading:"Artículos con oportunidad de compra",metric:"Sobrecoste potencial"},
 proveedores:{title:"Inteligencia de proveedores",subtitle:"Compara gasto real y precios objetivo para preparar negociaciones.",kpis:[["Proveedores",28,"n"],["Importe comprado",137800,"€"],["Mejora potencial",8400,"€"],["Artículos comparados",1240,"n"]],heading:"Ranking de proveedores",metric:"Mejora potencial"},
 stock:{title:"Control de stock",subtitle:"Identifica capital inmovilizado, sobrestock y productos de baja rotación.",kpis:[["Stock valorado",215600,"€"],["Capital inmovilizado",30500,"€"],["Sobrestock estimado",12700,"€"],["Productos sin rotación",186,"n"]],heading:"Productos que requieren revisión",metric:"Valor inmovilizado"},
 reposicion:{title:"Reposición y roturas",subtitle:"Prioriza artículos según cobertura, demanda y riesgo de falta de stock.",kpis:[["Artículos críticos",42,"n"],["Venta potencial en riesgo",6800,"€"],["Pedidos sugeridos",74,"n"],["Cobertura media",21,"d"]],heading:"Prioridades de reposición",metric:"Venta en riesgo"},
 genericos:{title:"Gestión de genéricos",subtitle:"Compara alternativas de compra y oportunidades planificables entre proveedores.",kpis:[["Grupos analizados",218,"n"],["Compra a cooperativas",54000,"€"],["Potencial planificable",4800,"€"],["Grupos prioritarios",31,"n"]],heading:"Grupos de genéricos",metric:"Mejora potencial"},
 rentabilidad:{title:"Análisis de rentabilidad",subtitle:"Márgenes por familias y productos, indicando fiabilidad de los costes.",kpis:[["Ventas analizadas",189420,"€"],["Margen estimado",31.4,"%"],["Artículos de margen bajo",118,"n"],["Cobertura de costes",86,"%"]],heading:"Rentabilidad por familia",metric:"Margen estimado"},
 acciones:{title:"Acciones prioritarias",subtitle:"Del análisis a decisiones concretas, con estados y seguimiento.",kpis:[["Pendientes",38,"n"],["Revisadas",17,"n"],["Ignoradas",4,"n"],["Importe potencial identificado",19200,"€"]],heading:"Acciones sugeridas",metric:"Importe potencial"},
 informes:{title:"Centro de informes",subtitle:"Prepara reportes claros para analizar y compartir información.",kpis:[["Informes disponibles",12,"n"],["Áreas de análisis",6,"n"],["Farmacias incluidas",5,"n"],["Vistas guardadas",3,"n"]],heading:"Informes disponibles",metric:"Registros"},
 asistente:{title:"Asistente de análisis",subtitle:"Explora preguntas comerciales sobre datos fiables y auditables.",kpis:[["Fuentes conectables",4,"n"],["Preguntas sugeridas",12,"n"],["Módulos analizables",6,"n"],["Consultas ejecutadas",0,"n"]],heading:"Preguntas para explorar",metric:"Prioridad"}
};
const SAMPLE_NAMES={
 proveedores:["Cooperativa Norte","Laboratorio Delta","Distribución Salud","Laboratorio Verde","Cooperativa Centro","Laboratorio Atlas","Proveedor Integral","Distribuciones Farma"],
 genericos:["Grupo omeprazol","Grupo atorvastatina","Grupo enalapril","Grupo metformina","Grupo losartán","Grupo simvastatina","Grupo bisoprolol","Grupo amlodipino"],
 ventas:["Dermocosmética","Higiene","OTC","Complementos","Infantil","Ortopedia","Protección solar","Nutrición"],
 rentabilidad:["Dermocosmética","Higiene","OTC","Complementos","Infantil","Ortopedia","Protección solar","Nutrición"],
 informes:["Informe de ventas","Comparativa de compras","Ranking de proveedores","Stock parado","Roturas prioritarias","Márgenes por familia","Negociación por proveedor","Evolución de promociones"],
 asistente:["¿Qué proveedores revisar primero?","¿Qué productos tienen más stock parado?","¿Dónde compramos por encima del PUC objetivo?","¿Qué familias tienen márgenes bajos?","¿Qué artículos podrían romper stock?","¿Cómo evolucionan las ventas?","¿Qué comprar menos?","¿Qué revisar esta semana?"]
};
const PRODUCT_NAMES=["Crema hidratante 50 ml","Protector solar FPS 50","Gel de higiene 500 ml","Complemento vitamina C","Champú dermoprotector","Pasta dentífrica","Solución salina","Crema reparadora"];
const PHARMACY_NAMES=["Abadía","Europa","Buenavista","Estación","Valdemarías"];
const MONTHS=["Mayo","Junio","Julio","Agosto","Septiembre","Octubre"];
function formatValue(v,kind){return kind==="€"?euros(v):kind==="%"?qty(v)+" %":kind==="d"?qty(v)+" días":qty(v)}
function exportDemo(rows,key){const lines=[["Concepto","Farmacia","Categoría","Valor ilustrativo"],...rows.map(r=>[r.name,r.pharmacy,r.category,r.amount])];const csv="\ufeff"+lines.map(r=>r.map(c=>'"'+String(c).replaceAll('"','""')+'"').join(";")).join("\r\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));a.download="farmetrica-"+key+"-DEMO.csv";a.click();URL.revokeObjectURL(a.href)}
export default function ModuloDemo({module,pharmacies=[]}){
 const config=CONFIG[module]||CONFIG.dashboard;
 const [pharmacy,setPharmacy]=useState("todas"),[period,setPeriod]=useState("6"),[search,setSearch]=useState(""),[category,setCategory]=useState("todas");
 const [detail,setDetail]=useState(null);
 const demoPharmacies=pharmacies.length?pharmacies.map(p=>p.name):PHARMACY_NAMES;
 const rows=useMemo(()=>Array.from({length:32},(_,i)=>({
  id:i+1,name:(SAMPLE_NAMES[module]||PRODUCT_NAMES)[i%8]+(i>=8?" · "+(Math.floor(i/8)+1):""),
  pharmacy:demoPharmacies[i%demoPharmacies.length],
  category:["Compras","Stock","Ventas","Rentabilidad"][i%4],
  amount:Math.round((7750/(1+i*.37))*(module==="acciones"?.7:1)),
  change:Math.round((i%2?-1:1)*(4+i%16)*10)/10,
  code:String(180000+i*137).slice(0,6),
 })),[module,demoPharmacies.join("|")]);
 const filtered=rows.filter(r=>(pharmacy==="todas"||r.pharmacy===pharmacy)&&
   (category==="todas"||r.category===category)&&
   (r.name+" "+r.pharmacy+" "+r.code).toLowerCase().includes(search.toLowerCase()));
 const chart=MONTHS.slice(-Number(period)).map((month,i)=>({month,actual:Math.round(9700+i*1970+((i*7)%3)*1100),referencia:Math.round(8900+i*1700)}));
 return <div className="fm-demo">
  <div className="page-header"><div><h1>{config.title}</h1><p>{config.subtitle}</p></div>
   <span className="fm-demo-tag"><Info size={15}/> DEMOSTRACIÓN · DATOS FICTICIOS</span></div>
  <div className="fm-demo-note"><Activity size={17}/> Esta pantalla muestra cómo funcionará el módulo. Las cifras son ilustrativas y no corresponden a las farmacias conectadas.</div>
  <div className="fm-demo-filters">
   <label><span>Farmacia</span><select value={pharmacy} onChange={e=>setPharmacy(e.target.value)}><option value="todas">Todas las farmacias</option>{demoPharmacies.map(p=><option key={p}>{p}</option>)}</select></label>
   <label><span>Periodo</span><select value={period} onChange={e=>setPeriod(e.target.value)}><option value="3">Últimos 3 meses</option><option value="6">Últimos 6 meses</option></select></label>
   <label><span>Área</span><select value={category} onChange={e=>setCategory(e.target.value)}><option value="todas">Todas las áreas</option>{["Compras","Stock","Ventas","Rentabilidad"].map(v=><option key={v}>{v}</option>)}</select></label>
   <label className="fm-demo-search"><span>Buscar</span><div><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Producto, CN, farmacia..."/></div></label>
  </div>
  <div className="fm-demo-kpis">{config.kpis.map(([title,n,kind])=><div key={title} className="card fm-demo-kpi"><span>{title}</span><strong>{formatValue(n,kind)}</strong><small>Valor de ejemplo</small></div>)}</div>
  <div className="fm-demo-panels">
   <section className="card fm-demo-graph"><div className="section-heading"><div><h2>Evolución comparativa</h2><p>Información ilustrativa del periodo seleccionado</p></div><BarChart3 size={20}/></div>
    <div className="fm-demo-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart} margin={{top:12,right:8,left:0,bottom:0}}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e9efeb"/><XAxis dataKey="month" tickLine={false} axisLine={false}/><YAxis tickLine={false} axisLine={false} width={48}/><Tooltip formatter={v=>euros(v)}/><Bar dataKey="actual" name="Valor observado (demo)" fill="#169568" radius={[5,5,0,0]}/><Bar dataKey="referencia" name="Referencia (demo)" fill="#b8dcd0" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></div>
   </section>
   <section className="card fm-demo-insights"><div className="section-heading"><div><h2>Lectura rápida</h2><p>Qué merece atención</p></div><TrendingUp size={19}/></div>
    <div className="fm-demo-insight"><strong>Identificar lo prioritario</strong><p>Ordena el análisis por impacto económico, sin mezclar magnitudes distintas.</p></div>
    <div className="fm-demo-insight"><strong>Del indicador al detalle</strong><p>Revisa los artículos y farmacias que explican cada cifra.</p></div>
    <div className="fm-demo-insight"><strong>Hechos y estimaciones</strong><p>El producto diferenciará datos reales, referencias y oportunidades potenciales.</p></div>
   </section>
  </div>
  <section className="card fm-demo-table"><div className="section-heading"><div><h2>{config.heading}</h2><p>{filtered.length} resultados ilustrativos con filtros y ordenación</p></div><button className="btn btn-secondary" onClick={()=>exportDemo(filtered,module)}><ArrowDownToLine size={16}/> Exportar CSV demo</button></div>
   <ListTable rows={filtered} rowKey={r=>r.id} label="registros de demostración" emptyText="No hay resultados con estos filtros" onRowClick={setDetail}
    columns={[{key:"name",label:"Concepto",value:r=>r.name,render:r=><strong>{r.name}</strong>},
      {key:"code",label:"Código",value:r=>r.code},
      {key:"pharmacy",label:"Farmacia",filterMode:"multi",value:r=>r.pharmacy},
      {key:"category",label:"Área",filterMode:"multi",value:r=>r.category},
      {key:"amount",label:config.metric,value:r=>r.amount,render:r=><strong>{euros(r.amount)}</strong>},
      {key:"change",label:"Variación",value:r=>r.change,render:r=><span>{r.change>0?"+":""}{r.change}%</span>} ]}/>
  </section>
  {detail&&<div className="fm-demo-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setDetail(null)}}><div className="fm-demo-detail" role="dialog" aria-modal="true"><button className="btn btn-secondary" onClick={()=>setDetail(null)}>Cerrar</button><h2>{detail.name}</h2><p>Ficha ilustrativa para conectar el análisis general con un registro concreto.</p><dl><dt>Farmacia</dt><dd>{detail.pharmacy}</dd><dt>Código</dt><dd>{detail.code}</dd><dt>{config.metric}</dt><dd>{euros(detail.amount)}</dd></dl><div className="fm-demo-note">Ejemplo sin conexión a datos reales.</div></div></div>}
 </div>;
}
