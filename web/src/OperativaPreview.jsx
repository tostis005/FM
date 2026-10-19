import React,{useMemo,useState} from "react";
import {AlertTriangle,ArrowRightLeft,CheckCircle2,ClipboardList,Package,Search,ShoppingCart,TrendingUp,Users} from "lucide-react";
import "./operativaPreview.css";
import SortableDataTable from "./SortableDataTable.jsx";

// Pantallas de diseño final, sin datos transaccionales reales ni escrituras ERP.
// Un borrador en esta vista vive únicamente en la memoria de la sesión React.
export const PREVIEW_SECTIONS={
 "productos":{title:"Productos",group:"stock"},
 "compras-preparador":{title:"Preparador de pedidos",group:"compras"},
 "compras-pendientes":{title:"Pendientes de asignar",group:"compras"},
 "compras-pedidos":{title:"Pedidos preparados",group:"compras"},
 "stock-traspasos":{title:"Traspasos entre farmacias",group:"stock"},
 "stock-historico":{title:"Histórico de stock",group:"stock"},
 "compras-devoluciones":{title:"Devoluciones a proveedores",group:"compras"},
 "ventas-tickets":{title:"Tickets",group:"ventas"},
 "ventas-devoluciones":{title:"Devoluciones y anulaciones",group:"ventas"},
 "proveedores-condiciones":{title:"Condiciones comerciales",group:"proveedores"},
 "rentabilidad-segmentos":{title:"Rentabilidad por segmento",group:"rentabilidad"},
 "rentabilidad-retorno":{title:"Retorno económico",group:"rentabilidad"},
 "oportunidades-seguimiento":{title:"Seguimiento de oportunidades",group:"acciones"},
 "alertas":{title:"Alertas",group:"acciones"},
 "mi-trabajo":{title:"Mi trabajo",group:"acciones"}
};
const euro=n=>new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(n);
const integer=n=>new Intl.NumberFormat("es-ES").format(n);
const initial=[
 {id:"A-001",name:"Artículo A · 20 uds.",segment:"Medicamentos",abcd:"A",stock:5,demand:32,needed:24,allocations:{A:20,B:0}},
 {id:"B-002",name:"Artículo B · 500 ml",segment:"Parafarmacia",abcd:"B",stock:8,demand:19,needed:12,allocations:{A:0,B:8}},
 {id:"C-003",name:"Artículo C · 30 uds.",segment:"Medicamentos",abcd:"A",stock:2,demand:24,needed:18,allocations:{A:0,B:0}},
 {id:"D-004",name:"Artículo D · 250 ml",segment:"Parafarmacia",abcd:"C",stock:10,demand:16,needed:6,allocations:{A:6,B:0}}
];
export function pendingUnits(item){return item.needed-Object.values(item.allocations).reduce((a,b)=>a+b,0)}
export function updateAssignment(items,id,provider,quantity){
 return items.map(x=>{
  if(x.id!==id)return x;
  const other=Object.entries(x.allocations).filter(([p])=>p!==provider).reduce((s,[,v])=>s+v,0);
  const next=Math.min(x.needed-other,Math.max(0,Math.trunc(Number.isFinite(Number(quantity))?Number(quantity):0)));
  return {...x,allocations:{...x.allocations,[provider]:next}};
 });
}
const opportunities=[
 {id:"OP-1041",title:"Mejorar condiciones de adquisición",type:"Compras",amount:1820,impact:"Ahorro potencial",priority:"Alta",owner:"Responsable de compras",status:"Nueva"},
 {id:"OP-1042",title:"Reducir stock de baja rotación",type:"Stock",amount:940,impact:"Capital liberable",priority:"Alta",owner:"Titular",status:"En estudio"},
 {id:"OP-1043",title:"Optimizar margen de artículos",type:"Rentabilidad",amount:610,impact:"Mejora del margen",priority:"Media",owner:"Sin asignar",status:"En curso"}
];
const alerts=[
 ["AL-301","Riesgo de rotura","Stock","Crítica","Equipo de compras","Pendiente"],
 ["AL-302","Aumento de coste de compra","Compras","Alta","Responsable","En revisión"],
 ["AL-303","Sincronización pendiente","Integraciones","Media","Administrador","Pendiente"]
];
const analytics={
 "productos":{kpis:[["Referencias","4.789"],["Medicamentos","3.285"],["Parafarmacia","1.420"],["Pendientes de clasificar","84"]],
  columns:["Código","Artículo","Segmento","ABCD","PVP","Coste","Margen unitario","Stock"],rows:[
   ["CN-001","Artículo A","Medicamentos","A","12,45 €","8,25 €","4,20 €","24"],
   ["EAN-002","Artículo B","Parafarmacia","B","15,99 €","9,20 €","6,79 €","35"],
   ["SKU-003","Artículo C","Sin clasificar","D","7,60 €","5,30 €","2,30 €","8"]
  ]},
 "ventas-tickets":{kpis:[["Tickets","1.248"],["Ticket medio","28,45 €"],["Ventas netas","35.505,60 €"]],
  columns:["Ticket","Fecha","Farmacia","Líneas","Unidades","Importe neto","Empleado"],
  rows:[["T-20824","19/10/2026","Farmacia Centro","3","4","42,70 €","Empleado 01"],["T-20823","19/10/2026","Farmacia Norte","1","1","16,35 €","Empleado 02"]]},
 "ventas-devoluciones":{kpis:[["Devoluciones","22"],["Importe devuelto","328,90 €"],["Anulaciones","5"]],
  columns:["Documento","Fecha","Farmacia","Artículo","Unidades","Importe","Motivo"],
  rows:[["DEV-440","19/10/2026","Farmacia Centro","Artículo A","−2","−24,90 €","Devolución"],["ANU-051","18/10/2026","Farmacia Norte","Artículo C","−1","−8,50 €","Anulación"]]},
 "compras-devoluciones":{kpis:[["Devoluciones","12"],["Unidades","36"],["Importe recuperable","368,20 €"]],
  columns:["Documento","Fecha","Proveedor","Artículo","Unidades","Importe","Estado"],
  rows:[["DP-201","19/10/2026","Proveedor A","Artículo A","8","92,20 €","Solicitada"],["DP-200","18/10/2026","Proveedor B","Artículo B","3","25,80 €","Confirmada"]]},
 "stock-historico":{kpis:[["Valor actual","74.920,00 €"],["Variación mensual","−3,8 %"],["Cobertura media","38 días"]],
  columns:["Fecha","Farmacia","Unidades","Valor de inventario","Variación"],
  rows:[["19/10/2026","Farmacia Centro","8.350","32.410,00 €","−1,2 %"],["30/09/2026","Farmacia Centro","8.502","32.805,00 €","−2,4 %"]]},
 "proveedores-condiciones":{kpis:[["Proveedores activos","12"],["Precios por revisar","38"],["Ahorro negociable","1.820,00 €"]],
  columns:["Proveedor","Referencias","Descuento","Plazo","Pedido mínimo","Precio","Última revisión"],
  rows:[["Proveedor A","845","4 %","24 h","250 €","Confirmado","18/10/2026"],["Proveedor B","510","3 %","48 h","150 €","Histórico","03/10/2026"]]},
 "rentabilidad-segmentos":{kpis:[["Margen bruto","12.640,00 €"],["Margen bruto %","31,4 %"],["Medicamentos","7.950,00 €"],["Parafarmacia","4.690,00 €"]],
  columns:["Segmento","Ventas netas","Coste de ventas","Margen bruto","Margen %","Unidades"],
  rows:[["Medicamentos","28.750,00 €","20.800,00 €","7.950,00 €","27,7 %","2.490"],["Parafarmacia","11.500,00 €","6.810,00 €","4.690,00 €","40,8 %","810"]]}
};
function Table({columns,rows}){
 return <SortableDataTable headers={columns} rows={rows} label="registros"/>;
}
function KPIs({items}){return <div className="fm-preview-kpis">{items.map(([label,value])=><article className="card fm-preview-kpi" key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>}
function OrderBuilder({mode}){
 const [items,setItems]=useState(initial);
 const [tab,setTab]=useState(mode==="compras-pendientes"?"pending":mode==="compras-pedidos"?"orders":"products");
 const [notice,setNotice]=useState("");
 const all=items.reduce((s,n)=>s+n.needed,0),pending=items.reduce((s,n)=>s+pendingUnits(n),0);
 const summary=[["Necesidades",integer(all)+" uds."],["Asignadas",integer(all-pending)+" uds."],["Pendientes de asignar",integer(pending)+" uds."],["Artículos",integer(items.length)]];
 const filtered=tab==="pending"?items.filter(n=>pendingUnits(n)>0):items;
 const update=(id,p,value)=>{setItems(v=>updateAssignment(v,id,p,value));setNotice("")};
 return <>
  <KPIs items={summary}/>
  <section className="card fm-preview-panel"><div className="fm-preview-panel-head"><h2>Preparación de pedidos</h2></div>
   <div className="fm-preview-tabs" role="tablist" aria-label="Vistas del preparador">
    {[["products","Por productos"],["providers","Por proveedores"],["pending","Pendientes de asignar"],["orders","Pedidos preparados"]]
      .map(([id,label])=><button role="tab" aria-selected={tab===id} className={tab===id?"active":""}
       type="button" key={id} onClick={()=>setTab(id)}>{label}</button>)}</div>
   {(tab==="products"||tab==="pending")&&<Table columns={["Artículo","Segmento · ABCD","Stock","Demanda","Necesidad","Proveedor A","Proveedor B","Pendiente"]}
    rows={filtered.map(n=>[
     <strong key={n.id}>{n.name}</strong>,n.segment+" · "+n.abcd,n.stock,n.demand,n.needed,
     <input className="fm-preview-qty" type="number" min="0" max={n.needed-n.allocations.B}
      aria-label={"Proveedor A "+n.name} value={n.allocations.A} onChange={e=>update(n.id,"A",e.target.value)}/>,
     <input className="fm-preview-qty" type="number" min="0" max={n.needed-n.allocations.A}
      aria-label={"Proveedor B "+n.name} value={n.allocations.B} onChange={e=>update(n.id,"B",e.target.value)}/>,
     <strong key={"p"+n.id}>{pendingUnits(n)}</strong>])}/>}
   {tab==="providers"&&<Table columns={["Proveedor","Artículo","Unidades asignadas","Pendiente del artículo"]} rows={
    items.flatMap(n=>["A","B"].filter(p=>n.allocations[p]>0).map(p=>[
     "Proveedor "+p,n.name,n.allocations[p],pendingUnits(n)]))}/>}
   {tab==="orders"&&<Table columns={["Pedido","Proveedor","Referencias","Importe previsto","Estado"]}
    rows={[["PED-0401","Proveedor A","4","1.284,30 €","Borrador"],["PED-0402","Proveedor B","7","862,15 €","Pendiente de aprobación"]]}/>}
   <div className="fm-preview-actions"><button className="btn btn-primary" type="button"
      onClick={()=>setNotice("No disponible en la demo: estos cambios no se guardan ni envían pedidos.")}>Guardar borrador</button>
    <button className="btn btn-secondary" type="button" onClick={()=>setNotice("No disponible en la demo: la exportación real se activará con los datos de compras.")}>Exportar pedido</button>
    {notice&&<span role="status" className="fm-preview-notice">{notice}</span>}
   </div>
  </section>
  <section className="card fm-preview-panel"><div className="fm-preview-panel-head"><h2>Configuración de reposición</h2></div>
   <div className="fm-preview-form">{[["Cobertura saludable","90"],["Intervalo de pedido","7"],["Plazo de entrega","2"],["Stock de seguridad","3"]].map(([label,value])=>
    <label key={label}>{label}<input type="number" min="0" defaultValue={value}/></label>)}</div>
  </section>
 </>;
}
function OpportunityList(){
 const [states,setStates]=useState({}),[selected,setSelected]=useState(""),[comment,setComment]=useState("");
 return <>
  <KPIs items={[["Oportunidades",String(opportunities.length)],["Ahorro potencial","1.820,00 €"],["Mejora de margen","610,00 €"],["Capital liberable","940,00 €"]]}/>
  <section className="card fm-preview-panel"><div className="fm-preview-panel-head"><h2>Seguimiento económico</h2></div>
   <Table columns={["ID","Oportunidad","Tipo","Impacto","Importe","Prioridad","Responsable","Estado","Historial"]} rows={
    opportunities.map(n=>[n.id,n.title,n.type,n.impact,euro(n.amount),n.priority,n.owner,
     <select key={n.id} aria-label={"Estado "+n.id} value={states[n.id]||n.status}
       onChange={e=>setStates(v=>({...v,[n.id]:e.target.value}))}>
      {["Nueva","En estudio","En curso","Aplicada parcialmente","Aplicada","Descartada","Pospuesta"].map(s=><option key={s}>{s}</option>)}
     </select>,<button key={"h"+n.id} className="btn btn-secondary" type="button" onClick={()=>setSelected(n.id)}>Historial</button>])}/>
   {selected&&<div className="fm-preview-history"><strong>{selected} · Historial</strong><p>Detección, responsable, acciones y resultados verificados.</p>
    <div className="fm-preview-actions"><input value={comment} onChange={e=>setComment(e.target.value)} aria-label="Nuevo comentario" placeholder="Añadir comentario"/>
    <button className="btn btn-secondary" onClick={()=>setComment("")}>Simular comentario</button></div></div>}
  </section>
 </>;
}
function WorkQueue({onlyAlerts=false}){
 const [states,setStates]=useState({});
 const work=onlyAlerts?alerts:[
  ["TA-102","Revisar pedido del proveedor A","Compras","Alta","Responsable","Pendiente"],
  ...alerts,
  ["OP-1041","Revisar oportunidad de compra","Oportunidades","Media","Responsable","En estudio"]];
 return <>
  <KPIs items={[["Pendientes",String(work.filter(x=>x[5]==="Pendiente").length)],["Críticas","1"],["Asignadas",String(work.length)]]}/>
  <section className="card fm-preview-panel"><div className="fm-preview-panel-head"><h2>{onlyAlerts?"Alertas que requieren atención":"Tareas asignadas"}</h2></div>
   <Table columns={["ID","Tarea o alerta","Módulo","Prioridad","Responsable","Estado"]} rows={work.map(n=>
    [...n.slice(0,5),<select key={n[0]} aria-label={"Estado "+n[0]} value={states[n[0]]||n[5]}
     onChange={e=>setStates(v=>({...v,[n[0]]:e.target.value}))}>
      {["Pendiente","En revisión","En curso","Resuelta","Descartada","Pospuesta","En estudio"].map(s=><option key={s}>{s}</option>)}
    </select>])}/>
  </section>
 </>;
}
function Transfers({pharmacies=[]}){
 const [states,setStates]=useState({});
 const names=pharmacies.length>1?pharmacies.map(p=>p.name):["Farmacia Centro","Farmacia Norte","Farmacia Sur"];
 const rows=[["TR-101",names[0],names[1], "Artículo A","12","315,00 €","Propuesta"],
  ["TR-102",names[1],names[2]||names[0],"Artículo B","8","228,00 €","En revisión"]];
 return <>
  <KPIs items={[["Propuestas","2"],["Unidades transferibles","20"],["Capital redistribuible","543,00 €"]]}/>
  <section className="card fm-preview-panel"><div className="fm-preview-panel-head"><h2>Redistribución entre farmacias</h2></div>
   <Table columns={["ID","Origen","Destino","Artículo","Unidades","Valor","Estado"]} rows={rows.map(r=>
    [...r.slice(0,6),<select key={r[0]} aria-label={"Estado "+r[0]} value={states[r[0]]||r[6]}
      onChange={e=>setStates(v=>({...v,[r[0]]:e.target.value}))}>
       {["Propuesta","En revisión","Aprobada","Realizada","Descartada"].map(s=><option key={s}>{s}</option>)}
      </select>])}/>
  </section>
 </>;
}
function ReturnScreen(){
 return <>
  <KPIs items={[["Ahorro potencial","8.450,00 €"],["Ahorro estimado","2.360,00 €"],["Ahorro verificado","1.120,00 €"],["Capital liberado","3.480,00 €"]]}/>
  <section className="card fm-preview-panel"><div className="fm-preview-panel-head"><h2>Resultados verificados</h2></div>
   <Table columns={["Actuación","Farmacia","Referencia","Importe verificado","Método","Estado"]}
    rows={[["Negociación de costes","Farmacia Centro","08/10/2026","720,00 €","Compras posteriores comparables","Verificado"],
      ["Mejora de rentabilidad","Farmacia Norte","12/10/2026","400,00 €","Margen posterior comparable","Verificado"],
      ["Reducción de sobrestock","Farmacia Sur","15/10/2026","—","Capital liberable, no ahorro realizado","En curso"]]}/>
  </section>
 </>;
}
function AnalyticSection({section}){
 const spec=analytics[section];const [q,setQ]=useState("");
 const rows=useMemo(()=>spec.rows.filter(row=>row.some(cell=>String(cell).toLowerCase().includes(q.trim().toLowerCase()))),[spec,q]);
 return <><KPIs items={spec.kpis}/><section className="card fm-preview-panel">
  <div className="fm-preview-panel-head"><h2>{PREVIEW_SECTIONS[section].title}</h2>
   <label className="fm-preview-search"><Search size={17}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar en resultados" aria-label="Buscar"/></label></div>
  <Table columns={spec.columns} rows={rows}/></section></>;
}
export default function OperativaPreview({section,pharmacies=[]}){
 const name=PREVIEW_SECTIONS[section]?.title||"Módulo";
 return <div className="fm-operativa-preview">
  <div className="fm-preview-heading"><div className="page-header"><div><h1>{name}</h1></div></div>
    <span className="fm-preview-badge">Pantalla de demostración</span></div>
  {analytics[section]?<AnalyticSection section={section}/>:
   section.startsWith("compras-")?<OrderBuilder key={section} mode={section}/>:
   section==="stock-traspasos"?<Transfers pharmacies={pharmacies}/>:
   section==="oportunidades-seguimiento"?<OpportunityList/>:
   section==="alertas"?<WorkQueue onlyAlerts/>:
   section==="mi-trabajo"?<WorkQueue/>:
   section==="rentabilidad-retorno"?<ReturnScreen/>:
   <section className="card fm-preview-panel">Módulo de demostración.</section>}
 </div>;
}
