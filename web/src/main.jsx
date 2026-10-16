import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity, ArrowDownToLine, ArrowRight, Bell, CalendarDays, Check, CheckCircle2, ChevronDown,
  ChevronRight, CircleHelp, ClipboardList, Clock3, Filter, Home, LayoutDashboard, Leaf, LogOut,
  MoreHorizontal, Pencil, Plus, Search, Settings2, ShieldCheck, Sparkles, Store, Tag, Target,
  Trash2, TrendingUp, Users, X, BarChart3, Package, Copy, RefreshCcw
} from "lucide-react";
import { ResponsiveContainer, ComposedChart, CartesianGrid, XAxis, YAxis, Tooltip, Bar, Line } from "recharts";
import "./styles.css";
import { pharmacyBackendConfigured, hasPharmacySession, signInPharmacies, loadPharmacies, savePharmacyToServer } from "./farmaciasApi.js";

const DEFAULT_PHARMACIES = [
  {id:"F001",name:"Abadía",city:"",active:true,sourceCode:"ABA",sourceHost:"",sourceDatabase:"Farmatic"},
  {id:"F002",name:"Europa",city:"",active:true,sourceCode:"EUR",sourceHost:"",sourceDatabase:"Farmatic"},
  {id:"F003",name:"Buenavista",city:"",active:true,sourceCode:"BUE",sourceHost:"",sourceDatabase:"Farmatic"},
  {id:"F004",name:"Estación",city:"",active:true,sourceCode:"EST",sourceHost:"",sourceDatabase:"Farmatic"},
  {id:"F005",name:"Valdemarías",city:"",active:true,sourceCode:"POL",sourceHost:"",sourceDatabase:"Farmatic"}
];
const DEFAULT_USERS = [
  {id:"U01",name:"Laura Gómez",email:"laura.gomez@demo.es",role:"superadmin",pharmacies:[],active:true},
  {id:"U02",name:"Carlos Martínez",email:"carlos.martinez@demo.es",role:"gestor",pharmacies:["F001","F004"],active:true},
  {id:"U03",name:"Ana Torres",email:"ana.torres@demo.es",role:"farmacia",pharmacies:["F001"],active:true},
  {id:"U04",name:"Javier Ruiz",email:"javier.ruiz@demo.es",role:"gestor",pharmacies:["F002","F005"],active:true},
  {id:"U05",name:"María López",email:"maria.lopez@demo.es",role:"farmacia",pharmacies:["F002"],active:false}
];
const DEFAULT_PROMOS = [
  {id:"P100",name:"Rutina de hidratación",subtitle:"Cuidado facial · otoño",description:"Promoción especial en productos de hidratación facial para el cuidado diario de la piel.",status:"Activa",start:"2026-10-01",end:"2026-11-30",cns:["184579.6","188456.3","192334.1","203445.7"],targets:{F001:120,F002:95,F003:100,F004:85},sales:{F001:92,F002:71,F003:64,F004:56}},
  {id:"P101",name:"Cuidado de invierno",subtitle:"Higiene y dermocosmética",description:"Objetivo de venta de referencias para el cuidado de la piel en invierno.",status:"Activa",start:"2026-10-05",end:"2026-12-31",cns:["165238.4","171625.6","182347.2"],targets:{F001:140,F002:120,F005:110},sales:{F001:86,F002:79,F005:49}},
  {id:"P102",name:"Salud y bienestar",subtitle:"Vitaminas y complementos",description:"Campaña de complementos de bienestar para la red de farmacias.",status:"Activa",start:"2026-09-01",end:"2026-10-31",cns:["154235.7","145602.3","194510.5","190378.2"],targets:{F001:140,F002:130,F003:130,F004:120,F005:100},sales:{F001:124,F002:102,F003:81,F004:88,F005:64}},
  {id:"P103",name:"Fotoprotección total",subtitle:"Protección solar",description:"Campaña de fotoprotección estacional.",status:"Finalizada",start:"2026-06-01",end:"2026-09-30",cns:["187345.6","198345.2"],targets:{F001:90,F002:100,F003:110},sales:{F001:94,F002:103,F003:108}},
  {id:"P104",name:"Noviembre esencial",subtitle:"Próxima campaña",description:"Campaña de impulso para productos esenciales de noviembre.",status:"Borrador",start:"2026-11-01",end:"2026-11-30",cns:["173982.4","165708.9"],targets:{F002:120,F004:120,F005:110},sales:{}}
];
const EMPTY_PROMO = {id:null,name:"",subtitle:"",description:"",status:"Borrador",start:"2026-10-16",end:"2026-11-30",cns:[],targets:{},sales:{}};
const HISTORICAL = {F001:110,F002:95,F003:105,F004:80,F005:90};
const STORE_KEY = "farmetrica-prototype-v1";
const ROLES = {superadmin:"Superadministrador",gestor:"Gestor de farmacias",farmacia:"Personal de farmacia"};
const EUR = new Intl.NumberFormat("es-ES");
function parseCNs(value) {
  return [...new Set(value.split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean))];
}
function percent(s,t) {return t ? Math.round(s/t*100):0;}
function sum(values){return Object.values(values||{}).reduce((a,b)=>a+(Number(b)||0),0);}
function dateES(value){if(!value)return "—";const [y,m,d]=value.split("-");return d+"/"+m+"/"+y;}
function readState(){
  try {const saved=JSON.parse(localStorage.getItem(STORE_KEY));if(saved && Array.isArray(saved.promos) && Array.isArray(saved.pharmacies) && Array.isArray(saved.users)) {
    const oldDemo=saved.pharmacies.length===5 && saved.pharmacies.every(f=>["Farmacia Central","Farmacia Sol","Farmacia Europa","Farmacia Gran Vía","Farmacia Norte"].includes(f.name));
    return {...saved,pharmacies:oldDemo?DEFAULT_PHARMACIES:saved.pharmacies};
  }}catch {}
  return {promos:DEFAULT_PROMOS,pharmacies:DEFAULT_PHARMACIES,users:DEFAULT_USERS};
}
function downloadCSV(name, rows) {
  const csv="\ufeff"+rows.map(row=>row.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(";")).join("\r\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));a.download=name+".csv";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);
}
function Pill({status}){return <span className={"pill pill-"+status.toLowerCase()}><span className="pill-dot"/>{status}</span>;}
function Progress({value,wide=false}) {return <div className={"progress "+(wide?"progress-wide":"")}><div style={{width:Math.min(Math.max(value,0),100)+"%"}}/></div>}
function Kpi({icon:Icon,title,value,caption,kind="mint"}){return <div className="kpi card"><div className={"kpi-icon kpi-"+kind}><Icon size={23}/></div><div><div className="kpi-label">{title}</div><div className="kpi-value">{value}</div><div className="kpi-caption">{caption}</div></div></div>}
function Field({label,children,hint}) {return <label className="field"><span className="field-label">{label}</span>{children}{hint&&<small>{hint}</small>}</label>}
function FormActions({onCancel,label="Guardar cambios",disabled=false}){return <div className="form-actions"><button className="btn btn-secondary" type="button" onClick={onCancel}>Cancelar</button><button className="btn btn-primary" type="submit" disabled={disabled}><Check size={16}/>{label}</button></div>}
const NAV = [
  {id:"promociones",label:"Promociones",icon:Tag},
  {id:"seguimiento",label:"Seguimiento",icon:BarChart3},
  {id:"farmacias",label:"Farmacias",icon:Store},
  {id:"usuarios",label:"Usuarios",icon:Users},
  {id:"ajustes",label:"Ajustes",icon:Settings2}
];
function App(){
 const [data,setData]=useState(readState);
 const [page,setPage]=useState("promociones");
 const [search,setSearch]=useState("");
 const [statusFilter,setStatusFilter]=useState("Todos");
 const [from,setFrom]=useState("");
 const [to,setTo]=useState("");
 const [editingPromo,setEditingPromo]=useState(null);
 const [promoForm,setPromoForm]=useState({...EMPTY_PROMO});
 const [cnText,setCnText]=useState("");
 const [editingUser,setEditingUser]=useState(null);
 const [userForm,setUserForm]=useState({id:null,name:"",email:"",role:"farmacia",pharmacies:[],active:true});
 const [editingPharmacy,setEditingPharmacy]=useState(null);
 const [pharmacyForm,setPharmacyForm]=useState({id:"",name:"",city:"",active:true,sourceCode:"",sourceHost:"",sourceDatabase:"Farmatic"});
  const [pharmacyApiStatus,setPharmacyApiStatus]=useState(pharmacyBackendConfigured?"sin_sesion":"demo");
  const [pharmacyApiError,setPharmacyApiError]=useState("");
  const [savingPharmacy,setSavingPharmacy]=useState(false);
 const [selectedPromo,setSelectedPromo]=useState("P100");
 const [selectedPharmacy,setSelectedPharmacy]=useState("Todas");
 const [toast,setToast]=useState("");
 const [mobileMenu,setMobileMenu]=useState(false);
 useEffect(()=>{
    localStorage.setItem(STORE_KEY,JSON.stringify({...data,pharmacies:pharmacyBackendConfigured?DEFAULT_PHARMACIES:data.pharmacies}));
  },[data,pharmacyApiStatus]);
  useEffect(()=>{if(pharmacyBackendConfigured)void refreshPharmacies();},[]);
 useEffect(()=>{if(!toast)return;const id=setTimeout(()=>setToast(""),3800);return()=>clearTimeout(id);},[toast]);
 const {promos,pharmacies,users}=data;
 const selected=promos.find(p=>p.id===selectedPromo)||promos[0];
 const pharmaName=(id)=>pharmacies.find(f=>f.id===id)?.name||id;
 const filterText=search.toLocaleLowerCase("es");
 const filteredPromos=promos.filter(p=>(p.name+" "+p.subtitle+" "+p.cns.join(" ")).toLocaleLowerCase("es").includes(filterText)
  &&(statusFilter==="Todos"||p.status===statusFilter)
  &&(!from||p.end>=from)&&(!to||p.start<=to));
 const totals={active:promos.filter(p=>p.status==="Activa").length,pharmacies:pharmacies.filter(f=>f.active).length,cns:new Set(promos.flatMap(p=>p.cns)).size,goal:promos.filter(p=>p.status!=="Borrador").reduce((n,p)=>n+sum(p.targets),0)};
 const currentUsers=users.filter(u=>(u.name+" "+u.email+" "+ROLES[u.role]).toLocaleLowerCase("es").includes(filterText));
 const currentPharmacies=pharmacies.filter(f=>(f.id+" "+f.name+" "+f.city+" "+(f.sourceCode||"")+" "+(f.sourceHost||"")).toLocaleLowerCase("es").includes(filterText));
 function nav(id){setPage(id);setSearch("");setMobileMenu(false);}
 function startPromo(p){const entry=p||{...EMPTY_PROMO};setEditingPromo(p?.id||"nuevo");setPromoForm({...entry,cns:[...(entry.cns||[])],targets:{...(entry.targets||{})},sales:{...(entry.sales||{})}});setCnText((entry.cns||[]).join("\n"));}
 function savePromo(e){
  e.preventDefault();const codes=parseCNs(cnText);
  if(!promoForm.name.trim())return setToast("Introduce el nombre de la promoción");
  if(!codes.length)return setToast("Añade al menos un código nacional");
  if(promoForm.end<promoForm.start)return setToast("La fecha final debe ser posterior a la inicial");
  if(!Object.keys(promoForm.targets).length)return setToast("Selecciona al menos una farmacia");
  const result={...promoForm,id:promoForm.id||"P"+Date.now(),name:promoForm.name.trim(),cns:codes,targets:Object.fromEntries(Object.entries(promoForm.targets).map(([id,v])=>[id,Math.max(0,Number(v)||0)]))};
  setData(prev=>({...prev,promos:prev.promos.some(p=>p.id===result.id)?prev.promos.map(p=>p.id===result.id?result:p):[result,...prev.promos]}));
  setSelectedPromo(result.id);setEditingPromo(null);setToast("Promoción guardada en esta demostración");
 }
 function togglePromoPharmacy(id) {
  const targets={...promoForm.targets};if(id in targets)delete targets[id];else targets[id]=HISTORICAL[id]||100;
  setPromoForm({...promoForm,targets});
 }
 function copyPromo(p){startPromo({...p,id:null,name:p.name+" (copia)",status:"Borrador",sales:{}});setToast("Revisa la copia antes de guardarla");}
 function exportPromo(p) {
  downloadCSV("promocion-"+p.id,[
   ["Promoción",p.name,"Inicio",p.start,"Fin",p.end],
   ["Descripción",p.description],
   ["CN incluidos",p.cns.join(", ")],
   [],
   ["Código farmacia","Farmacia","Objetivo (unidades)","Ventas (unidades)","Avance (%)"],
   ...Object.entries(p.targets).map(([id,target])=>[id,pharmaName(id),target,p.sales?.[id]||0,percent(p.sales?.[id]||0,target)])
  ]);setToast("Archivo CSV compatible con Excel preparado");
 }
 function startUser(u){setEditingUser(u?.id||"nuevo");setUserForm(u?{...u,pharmacies:[...u.pharmacies]}:{id:null,name:"",email:"",role:"farmacia",pharmacies:[],active:true});}
 function saveUser(e) {
  e.preventDefault();if(!userForm.name.trim()||!userForm.email.includes("@"))return setToast("Revisa el nombre y correo");
  if(userForm.role!=="superadmin"&&!userForm.pharmacies.length)return setToast("Asigna alguna farmacia");
  const u={...userForm,id:userForm.id||"U"+Date.now(),pharmacies:userForm.role==="superadmin"?[]:userForm.pharmacies};
  setData(prev=>({...prev,users:prev.users.some(x=>x.id===u.id)?prev.users.map(x=>x.id===u.id?u:x):[...prev.users,u]}));
  setEditingUser(null);setToast("Usuario guardado en la demostración");
 }
 async function refreshPharmacies(){
    try {
      if (!(await hasPharmacySession())) {setPharmacyApiStatus("sin_sesion");return;}
      const records=await loadPharmacies();
      setData(prev=>({...prev,pharmacies:records}));
      setPharmacyApiStatus("connected");setPharmacyApiError("");
    } catch(err) {setPharmacyApiStatus("error");setPharmacyApiError(err.message);}
  }
  async function connectPharmacies(){
    try {setPharmacyApiError("");await signInPharmacies();await refreshPharmacies();}
    catch(err){setPharmacyApiStatus("error");setPharmacyApiError(err.message);}
  }
  function startPharmacy(f){
    if(pharmacyBackendConfigured && pharmacyApiStatus!=="connected")return setToast("Conecta Microsoft 365 para editar el maestro real");
    setEditingPharmacy(f?.id||"nuevo");
    setPharmacyForm(f?{...f}:{id:"",name:"",city:"",active:true,sourceCode:"",sourceHost:"",sourceDatabase:"Farmatic"});
  }
  async function savePharmacy(e) {
    e.preventDefault();const id=pharmacyForm.id.trim().toUpperCase();
    if(!/^[A-Z0-9_-]{2,16}$/.test(id)||!pharmacyForm.name.trim())return setToast("Revisa el código y el nombre");
    if(!/^[A-Z0-9_-]{2,16}$/.test((pharmacyForm.sourceCode||"").trim().toUpperCase()))return setToast("Indica un código de origen válido");
    if(editingPharmacy==="nuevo"&&pharmacies.some(f=>f.id===id))return setToast("Ese código ya existe");
    const f={...pharmacyForm,id,name:pharmacyForm.name.trim(),sourceCode:pharmacyForm.sourceCode.trim().toUpperCase(),sourceHost:pharmacyForm.sourceHost?.trim()||"",sourceDatabase:pharmacyForm.sourceDatabase?.trim()||"Farmatic"};
    if(pharmacyBackendConfigured && pharmacyApiStatus!=="connected")return setToast("Debes conectar Microsoft 365");
    setSavingPharmacy(true);
    try {
      if(pharmacyApiStatus==="connected"){
        await savePharmacyToServer(f,editingPharmacy==="nuevo");
        await refreshPharmacies();
        setToast("Farmacia guardada en PostgreSQL");
      } else {
        setData(prev=>({...prev,pharmacies:prev.pharmacies.some(x=>x.id===id)?prev.pharmacies.map(x=>x.id===id?f:x):[...prev.pharmacies,f]}));
        setToast("Solo demo: cambios guardados en este navegador");
      }
      setEditingPharmacy(null);
    } catch(err){setToast(err.message);}
    finally{setSavingPharmacy(false);}
  }
  const cnParsed=parseCNs(cnText);
 const trackingTargets=selected?Object.entries(selected.targets).filter(([id])=>selectedPharmacy==="Todas"||selectedPharmacy===id):[];
 const trackingGoal=sum(Object.fromEntries(trackingTargets));
 const trackingSales=trackingTargets.reduce((n,[id])=>n+Number(selected?.sales?.[id]||0),0);
 const chartData=useMemo(()=>{
  const weights=[0.10,0.14,0.19,0.22,0.16,0.19];
  let running=0;
  return weights.map((w,i)=>{const sales=Math.round(trackingSales*w);running+=sales;return {week:"Sem "+(i+1),ventas:sales,acumulado:running,objetivo:Math.round(trackingGoal*(i+1)/6)};});
 },[trackingSales,trackingGoal]);
 const title=NAV.find(n=>n.id===page)?.label||"Promociones";
 return <div className="app-shell">
  <aside className={"sidebar "+(mobileMenu?"sidebar-open":"")}>
   <button className="brand" onClick={()=>nav("promociones")}><span className="brand-mark"><Leaf size={23} strokeWidth={2.8}/></span><span>Farmétrica<span className="brand-dot">.</span></span></button>
   <div className="side-section">ESPACIO DE TRABAJO</div>
   <nav className="side-nav">{NAV.map(item=><button key={item.id} className={"side-link "+(page===item.id?"active":"")} onClick={()=>nav(item.id)}><item.icon size={19}/><span>{item.label}</span>{page===item.id&&<span className="active-dot"/>}</button>)}</nav>
   <div className="sidebar-bottom">
    <div className="side-feature"><span className="side-feature-icon"><Sparkles size={21}/></span><strong>Más impacto,<br/>mejor seguimiento.</strong><p>Gestiona objetivos y mide el avance de tus campañas.</p><span className="side-feature-decoration"><Leaf size={60}/></span></div>
    <div className="side-profile"><div className="avatar avatar-green">LG</div><div><strong>Laura Gómez</strong><span>Modo demostración</span></div><MoreHorizontal size={18}/></div>
   </div>
  </aside>
  {mobileMenu&&<button className="mobile-scrim" onClick={()=>setMobileMenu(false)} aria-label="Cerrar navegación"/>}
  <div className="workspace">
   <header className="topbar">
    <button className="mobile-toggle icon-btn" onClick={()=>setMobileMenu(true)} aria-label="Abrir menú"><LayoutDashboard size={20}/></button>
    <div className="topbar-title"><span className="bread">Farmétrica <ChevronRight size={13}/></span><strong>{title}</strong></div>
    <div className="topbar-right"><span className="topbar-demo"><span/> {pharmacyApiStatus==="connected"&&page==="farmacias"?"Farmacias · PostgreSQL":"Promociones en demo"}</span><button className="icon-btn" title="Sin notificaciones por ahora" onClick={()=>setToast("Sin notificaciones nuevas")}><Bell size={19}/></button><span className="topbar-divider"/><span className="avatar avatar-green">LG</span><span className="top-user">Laura Gómez<small>Superadministrador</small></span><ChevronDown size={14} className="muted desktop-only"/></div>
   </header>
   <main className="main-content">
    {page==="promociones"&&<>
     <div className="page-header"><div><div className="eyebrow"><span className="eyebrow-dot"/> CAMPAÑAS COMERCIALES</div><h1>Promociones</h1><p>Crea campañas, asigna objetivos y mide los resultados de tu red.</p></div><button className="btn btn-primary main-cta" onClick={()=>startPromo()}><Plus size={18}/> Nueva promoción</button></div>
     <div className="kpi-grid">
      <Kpi icon={Tag} title="Promociones activas" value={totals.active} caption="Campañas en curso"/>
      <Kpi icon={Store} title="Farmacias registradas" value={totals.pharmacies} caption="Red de farmacias"/>
      <Kpi icon={Package} title="Códigos nacionales" value={totals.cns} caption="Referencias en campañas" kind="blue"/>
      <Kpi icon={Target} title="Objetivo total" value={EUR.format(totals.goal)} caption="Unidades planificadas" kind="amber"/>
     </div>
     <div className="content-grid">
      <section className="card list-card"><div className="section-heading"><div><h2>Listado de promociones</h2><p>Todas tus campañas, en un solo lugar</p></div><span className="count-label">{filteredPromos.length} promociones</span></div>
       <div className="toolbar">
        <div className="search-wrap"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar promoción o CN..." aria-label="Buscar promociones"/></div>
        <div className="select-wrap"><Filter size={16}/><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} aria-label="Filtrar estado"><option>Todos</option><option>Activa</option><option>Borrador</option><option>Finalizada</option></select></div>
        <div className="date-mini"><CalendarDays size={16}/><input type="date" title="Desde" value={from} onChange={e=>setFrom(e.target.value)}/><span>—</span><input type="date" title="Hasta" value={to} onChange={e=>setTo(e.target.value)}/></div>
       </div>
       <div className="table-scroll"><table className="data-table"><thead><tr><th>Promoción</th><th>Estado</th><th>Fechas</th><th>CN</th><th>Farmacias</th><th>Objetivo</th><th>Progreso</th><th/></tr></thead><tbody>{filteredPromos.map(p=>{
         const g=sum(p.targets),s=sum(p.sales),pc=percent(s,g);
         return <tr key={p.id} onClick={()=>startPromo(p)} className="click-row"><td><div className="promotion-cell"><span className="promotion-icon"><Tag size={17}/></span><div><strong>{p.name}</strong><small>{p.subtitle||"Promoción"}</small></div></div></td><td><Pill status={p.status}/></td><td><div className="small-stack">{dateES(p.start)}<small>{dateES(p.end)}</small></div></td><td className="td-number">{p.cns.length}</td><td className="td-number">{Object.keys(p.targets).length}</td><td className="td-number">{EUR.format(g)} uds.</td><td><div className="table-progress"><Progress value={pc}/><span>{pc}%</span></div></td><td><button className="row-action" title="Editar promoción" onClick={e=>{e.stopPropagation();startPromo(p)}}><Pencil size={16}/></button></td></tr>})}</tbody></table>
        {!filteredPromos.length&&<div className="empty-state"><Search size={25}/><strong>No hay promociones con esos filtros</strong><p>Prueba con otra búsqueda o selecciona un periodo más amplio.</p></div>}
       </div>
      </section>
      <section className="card spotlight-card"><div className="spotlight-head"><div className="spotlight-icon"><Sparkles size={20}/></div><div><h2>Controla cada campaña</h2><p>Desde la creación hasta el objetivo final</p></div></div><div className="spotlight-body"><div className="spotlight-illustration"><div className="ill-circle ill-circle-a"/><div className="ill-circle ill-circle-b"/><Target size={67}/><div className="ill-check"><Check size={19}/></div></div><strong>Promociones bajo control</strong><p>Define los CN, selecciona farmacias y establece objetivos de venta en unidades.</p><button className="btn btn-primary btn-full" onClick={()=>startPromo()}><Plus size={17}/> Crear promoción</button><button className="text-link" onClick={()=>nav("seguimiento")}>Ver seguimiento de campañas <ArrowRight size={15}/></button></div></section>
     </div>
     <div className="tracking-overview card"><div className="section-heading"><div><h2>Seguimiento destacado</h2><p>Evolución y cumplimiento por farmacia</p></div><button className="btn btn-secondary" onClick={()=>nav("seguimiento")}>Ver análisis completo <ArrowRight size={15}/></button></div><TrackingContent selected={selected} chartData={chartData} trackingTargets={trackingTargets} trackingGoal={trackingGoal} trackingSales={trackingSales} pharmaName={pharmaName} compact={true}/></div>
    </>}
    {page==="seguimiento"&&<><div className="page-header"><div><div className="eyebrow"><span className="eyebrow-dot"/> RESULTADOS DE CAMPAÑAS</div><h1>Seguimiento</h1><p>Consulta el avance de cada promoción y compara farmacias.</p></div><button className="btn btn-secondary" onClick={()=>selected&&exportPromo(selected)}><ArrowDownToLine size={17}/> Exportar para Excel</button></div>
      <div className="tracking-filters card"><Field label="Promoción"><select value={selectedPromo} onChange={e=>setSelectedPromo(e.target.value)}>{promos.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Farmacia"><select value={selectedPharmacy} onChange={e=>setSelectedPharmacy(e.target.value)}><option value="Todas">Todas las farmacias</option>{pharmacies.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></Field><Field label="Periodo de promoción"><div className="static-input"><CalendarDays size={16}/>{selected?dateES(selected.start)+" — "+dateES(selected.end):"—"}</div></Field></div>
      <div className="tracking-kpis"><Kpi icon={Target} title="Objetivo de ventas" value={EUR.format(trackingGoal)} caption="Unidades"/><Kpi icon={TrendingUp} title="Ventas acumuladas" value={EUR.format(trackingSales)} caption="Unidades (datos de ejemplo)"/><Kpi icon={Activity} title="Cumplimiento" value={percent(trackingSales,trackingGoal)+"%"} caption="Sobre el objetivo"/><Kpi icon={Store} title="Farmacias en campaña" value={trackingTargets.length} caption="Participantes" kind="blue"/></div>
      <section className="card tracking-expanded"><div className="section-heading"><div><h2>{selected?.name||"Seguimiento"}</h2><p>Ventas acumuladas y evolución de la campaña</p></div><Pill status={selected?.status||"Borrador"}/></div><TrackingContent selected={selected} chartData={chartData} trackingTargets={trackingTargets} trackingGoal={trackingGoal} trackingSales={trackingSales} pharmaName={pharmaName}/></section>
      <div className="note"><CircleHelp size={17}/> Datos ilustrativos: las ventas reales se conectarán cuando esté lista la sincronización con PostgreSQL.</div>
    </>}
    {page==="farmacias"&&<><div className="page-header"><div><div className="eyebrow"><span className="eyebrow-dot"/> ESTRUCTURA DE LA RED</div><h1>Maestro de farmacias</h1><p>Configura los identificadores y servidores de origen de cada farmacia.</p></div><div className="pharmacy-header-actions">{pharmacyBackendConfigured&&pharmacyApiStatus!=="connected"&&<button className="btn btn-secondary" onClick={connectPharmacies}><ShieldCheck size={17}/> Conectar Microsoft 365</button>}<button className="btn btn-primary" onClick={()=>startPharmacy()} disabled={pharmacyBackendConfigured&&pharmacyApiStatus!=="connected"}><Plus size={17}/> Nueva farmacia</button></div></div>{pharmacyApiStatus==="connected"?<div className="note"><CheckCircle2 size={17}/> Maestro conectado a PostgreSQL. Los cambios se guardan para todos los administradores.</div>:<div className="note"><CircleHelp size={17}/>{pharmacyBackendConfigured?(pharmacyApiError||"Inicia sesión para consultar y modificar las farmacias reales."):"Modo demostración. Falta configurar Microsoft Entra ID y desplegar la API para activar PostgreSQL."}</div>}<div className="kpi-grid small-kpis"><Kpi icon={Store} title="Farmacias" value={pharmacies.length} caption="Total en el maestro"/><Kpi icon={CheckCircle2} title="Activas" value={pharmacies.filter(f=>f.active).length} caption="En funcionamiento"/><Kpi icon={Users} title="Usuarios asignados" value={users.filter(u=>u.role!=="superadmin").length} caption="En la red"/></div><div className="content-grid admin-grid"><div className="card list-card"><div className="section-heading"><div><h2>Listado de farmacias</h2><p>Identificadores utilizados por las importaciones</p></div></div><div className="toolbar"><div className="search-wrap"><Search size={17}/><input placeholder="Buscar por código, nombre o ciudad..." value={search} onChange={e=>setSearch(e.target.value)}/></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>ID</th><th>Nombre público</th><th>Origen</th><th>Servidor SQL</th><th>Estado</th><th>Usuarios</th><th/></tr></thead><tbody>{currentPharmacies.map(f=><tr key={f.id} onClick={()=>startPharmacy(f)} className="click-row"><td><span className="id-code">{f.id}</span></td><td><div className="pharma-cell"><span className="store-mini"><Store size={16}/></span><strong>{f.name}</strong></div></td><td><span className="id-code">{f.sourceCode||"—"}</span></td><td>{pharmacyApiStatus==="connected"?(f.sourceHost||"Servidor local"):"— (demo)"}</td><td><Pill status={f.active?"Activa":"Inactiva"}/></td><td>{users.filter(u=>u.role==="superadmin"||u.pharmacies.includes(f.id)).length}</td><td><Pencil size={16} className="muted"/></td></tr>)}</tbody></table></div></div><div className="card info-card"><div className="info-icon"><ShieldCheck size={24}/></div><h2>Identificadores únicos</h2><p>Usaremos el código de cada farmacia para vincular sus ventas de SQL Server y mostrar sus datos con el nombre correcto.</p><div className="info-band"><strong>F001 → Abadía (ABA)</strong></div><p>La IP identifica el origen SQL Server. La importación se configura por separado; la web no se conecta a los servidores de farmacia.</p></div></div></>}
    {page==="usuarios"&&<><div className="page-header"><div><div className="eyebrow"><span className="eyebrow-dot"/> EQUIPO Y PERMISOS</div><h1>Gestión de usuarios</h1><p>Organiza los roles y las farmacias asignadas a cada usuario.</p></div><button className="btn btn-primary" onClick={()=>startUser()}><Plus size={17}/> Nuevo usuario</button></div><div className="kpi-grid small-kpis"><Kpi icon={Users} title="Usuarios" value={users.length} caption="Registrados"/><Kpi icon={CheckCircle2} title="Activos" value={users.filter(u=>u.active).length} caption="Con acceso"/><Kpi icon={ShieldCheck} title="Roles" value="3" caption="Perfiles definidos" kind="blue"/></div><div className="content-grid admin-grid"><div className="card list-card"><div className="section-heading"><div><h2>Usuarios del sistema</h2><p>Identidad, permisos y farmacias asignadas</p></div></div><div className="toolbar"><div className="search-wrap"><Search size={17}/><input placeholder="Buscar usuario, correo o rol..." value={search} onChange={e=>setSearch(e.target.value)}/></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Usuario</th><th>Rol</th><th>Farmacias</th><th>Estado</th><th/></tr></thead><tbody>{currentUsers.map(u=><tr className="click-row" key={u.id} onClick={()=>startUser(u)}><td><div className="user-cell"><span className="avatar avatar-soft">{u.name.split(" ").slice(0,2).map(x=>x[0]).join("")}</span><div><strong>{u.name}</strong><small>{u.email}</small></div></div></td><td><span className={"role-pill role-"+u.role}>{ROLES[u.role]}</span></td><td>{u.role==="superadmin"?"Todas":u.pharmacies.map(pharmaName).join(", ")||"—"}</td><td><Pill status={u.active?"Activa":"Inactiva"}/></td><td><Pencil size={16} className="muted"/></td></tr>)}</tbody></table></div></div><div className="card role-card"><div className="section-heading"><div><h2>Roles del sistema</h2><p>Tres niveles de acceso</p></div></div><div className="role-desc"><span className="role-icon role-bg-green"><Store/></span><div><strong>Personal de farmacia</strong><p>Consulta únicamente sus farmacias y el seguimiento asignado.</p></div></div><div className="role-desc"><span className="role-icon role-bg-blue"><Users/></span><div><strong>Gestor de farmacias</strong><p>Gestiona promociones y usuarios de las farmacias asignadas.</p></div></div><div className="role-desc"><span className="role-icon role-bg-purple"><ShieldCheck/></span><div><strong>Superadministrador</strong><p>Administra toda la red, usuarios, códigos y configuración.</p></div></div><div className="note small-note"><CircleHelp size={16}/> Los permisos reales se activarán con Microsoft Entra ID y el backend.</div></div></div></>}
    {page==="ajustes"&&<><div className="page-header"><div><div className="eyebrow"><span className="eyebrow-dot"/> CONFIGURACIÓN</div><h1>Ajustes</h1><p>Estado del prototipo y próximas integraciones.</p></div></div><div className="settings-grid"><div className="card settings-card"><span className="settings-icon"><ShieldCheck/></span><h2>Microsoft 365</h2><p>Inicio de sesión con el tenant y control real de roles por farmacia.</p><span className="soon">Próxima fase</span></div><div className="card settings-card"><span className="settings-icon"><RefreshCcw/></span><h2>Sincronización de ventas</h2><p>Airbyte → PostgreSQL, con actualización incremental y trazabilidad.</p><span className="soon">Pendiente de conexión</span></div><div className="card settings-card"><span className="settings-icon"><Activity/></span><h2>Asistente con IA</h2><p>Chat con consultas validadas para analizar beneficios y ventas reales.</p><span className="soon">Futura fase</span></div></div><div className="card reset-card"><div><h2>Reiniciar datos de ejemplo</h2><p>Elimina únicamente los cambios guardados por esta demostración en tu navegador.</p></div><button className="btn btn-secondary" onClick={()=>{if(confirm("¿Restablecer todos los datos de ejemplo?")){localStorage.removeItem(STORE_KEY);setData({promos:DEFAULT_PROMOS,pharmacies:DEFAULT_PHARMACIES,users:DEFAULT_USERS});setToast("Demostración restablecida");}}}><RefreshCcw size={16}/> Restaurar demo</button></div></>}
   </main>
   <footer className="app-footer"><span>© 2026 Farmétrica · Prototipo visual</span><span>Datos simulados · No conectado a ventas reales</span></footer>
  </div>
  {editingPromo&&<div className="drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setEditingPromo(null)}}><div className="drawer"><div className="drawer-top"><div><span className="eyebrow">GESTIÓN DE CAMPAÑAS</span><h2>{editingPromo==="nuevo"?"Nueva promoción":"Editar promoción"}</h2><p>Configura productos y objetivos de venta por farmacia.</p></div><button className="icon-btn" aria-label="Cerrar" onClick={()=>setEditingPromo(null)}><X size={21}/></button></div><form onSubmit={savePromo} className="drawer-content">
   <Field label="Nombre de promoción"><input required placeholder="Ej.: Especial hidratación" value={promoForm.name} onChange={e=>setPromoForm({...promoForm,name:e.target.value})}/></Field>
   <Field label="Descripción"><textarea rows="3" placeholder="¿En qué consiste esta campaña?" value={promoForm.description} onChange={e=>setPromoForm({...promoForm,description:e.target.value})}/></Field>
   <div className="field-row"><Field label="Fecha de inicio"><input type="date" required value={promoForm.start} onChange={e=>setPromoForm({...promoForm,start:e.target.value})}/></Field><Field label="Fecha de fin"><input type="date" required value={promoForm.end} onChange={e=>setPromoForm({...promoForm,end:e.target.value})}/></Field></div>
   <Field label="Estado"><select value={promoForm.status} onChange={e=>setPromoForm({...promoForm,status:e.target.value})}><option>Activa</option><option>Borrador</option><option>Finalizada</option></select></Field>
   <div className="form-divider"/><div className="field-heading"><div><strong>Códigos nacionales (CN)</strong><small>Pega los códigos separados por líneas, comas o espacios.</small></div><span className="soft-counter">{cnParsed.length} CN</span></div><textarea rows="5" className="cn-area" placeholder={"184579.6\n188456.3\n192334.1"} value={cnText} onChange={e=>setCnText(e.target.value)}/><div className="parse-info"><CheckCircle2 size={15}/> Eliminamos automáticamente los códigos repetidos.</div>
   <div className="form-divider"/><div className="field-heading"><div><strong>Farmacias participantes</strong><small>Selecciona las farmacias incluidas en la promoción.</small></div><span className="soft-counter">{Object.keys(promoForm.targets).length} elegidas</span></div>
   <div className="pharmacy-picker">{pharmacies.filter(f=>f.active||f.id in promoForm.targets).map(f=><label key={f.id} className={"pharmacy-choice "+(f.id in promoForm.targets?"chosen":"")}><input type="checkbox" checked={f.id in promoForm.targets} onChange={()=>togglePromoPharmacy(f.id)}/><span className="choice-check">{f.id in promoForm.targets&&<Check size={14}/>}</span><span>{f.name}</span><small>{f.id}</small></label>)}</div>
   {Object.keys(promoForm.targets).length>0&&<div className="target-list"><div className="target-head"><strong>Objetivos por farmacia</strong><button type="button" onClick={()=>{const obj={...promoForm.targets};Object.keys(obj).forEach(k=>obj[k]=HISTORICAL[k]||100);setPromoForm({...promoForm,targets:obj});}}><Sparkles size={15}/> Sugerir desde ejemplo</button></div>{Object.entries(promoForm.targets).map(([id,value])=><div className="target-row" key={id}><div><strong>{pharmaName(id)}</strong><small>{id}</small></div><div className="numeric-input"><input type="number" min="0" value={value} onChange={e=>setPromoForm({...promoForm,targets:{...promoForm.targets,[id]:e.target.value}})} aria-label={"Objetivo "+pharmaName(id)}/><span>uds.</span></div></div>)}<div className="target-total"><span>Objetivo total</span><strong>{EUR.format(sum(promoForm.targets))} uds.</strong></div><small className="hint">Las sugerencias son ficticias; después utilizaremos ventas históricas reales.</small></div>}
   <FormActions onCancel={()=>setEditingPromo(null)} label={editingPromo==="nuevo"?"Crear promoción":"Guardar cambios"}/>
   {editingPromo!=="nuevo"&&<div className="drawer-extra"><button type="button" className="btn btn-secondary" onClick={()=>{const p={...promoForm};setEditingPromo(null);copyPromo(p)}}><Copy size={16}/> Duplicar promoción</button><button type="button" className="btn btn-secondary" onClick={()=>exportPromo(promoForm)}><ArrowDownToLine size={16}/> Exportar para Excel</button></div>}
  </form></div></div>}
  {editingUser&&<div className="drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setEditingUser(null)}}><div className="drawer"><div className="drawer-top"><div><span className="eyebrow">ACCESOS Y PERMISOS</span><h2>{editingUser==="nuevo"?"Nuevo usuario":"Editar usuario"}</h2><p>Asigna un rol y define las farmacias disponibles.</p></div><button className="icon-btn" onClick={()=>setEditingUser(null)} aria-label="Cerrar"><X/></button></div><form onSubmit={saveUser} className="drawer-content"><Field label="Nombre completo"><input required value={userForm.name} onChange={e=>setUserForm({...userForm,name:e.target.value})}/></Field><Field label="Correo electrónico"><input type="email" required value={userForm.email} onChange={e=>setUserForm({...userForm,email:e.target.value})}/></Field><Field label="Rol"><select value={userForm.role} onChange={e=>setUserForm({...userForm,role:e.target.value})}><option value="farmacia">Personal de farmacia</option><option value="gestor">Gestor de farmacias</option><option value="superadmin">Superadministrador</option></select></Field><Field label="Estado"><select value={String(userForm.active)} onChange={e=>setUserForm({...userForm,active:e.target.value==="true"})}><option value="true">Activo</option><option value="false">Inactivo</option></select></Field><div className="form-divider"/><div className="field-heading"><div><strong>Farmacias asignadas</strong><small>{userForm.role==="superadmin"?"Este rol tiene acceso a toda la red.":"Marca las farmacias a las que podrá acceder."}</small></div></div>{userForm.role!=="superadmin"&&<div className="pharmacy-picker">{pharmacies.map(f=><label key={f.id} className={"pharmacy-choice "+(userForm.pharmacies.includes(f.id)?"chosen":"")}><input type="checkbox" checked={userForm.pharmacies.includes(f.id)} onChange={()=>setUserForm({...userForm,pharmacies:userForm.pharmacies.includes(f.id)?userForm.pharmacies.filter(x=>x!==f.id):[...userForm.pharmacies,f.id]})}/><span className="choice-check">{userForm.pharmacies.includes(f.id)&&<Check size={14}/>}</span><span>{f.name}</span><small>{f.id}</small></label>)}</div>}<div className="note small-note"><ShieldCheck size={16}/> Estas asignaciones son solo visuales hasta habilitar autenticación y autorización en el servidor.</div><FormActions onCancel={()=>setEditingUser(null)}/></form></div></div>}
  {editingPharmacy&&<div className="drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setEditingPharmacy(null)}}><div className="drawer"><div className="drawer-top"><div><span className="eyebrow">MAESTRO DE FARMACIAS</span><h2>{editingPharmacy==="nuevo"?"Nueva farmacia":"Editar farmacia"}</h2><p>El código debe coincidir con el identificador de los datos importados.</p></div><button className="icon-btn" onClick={()=>setEditingPharmacy(null)} aria-label="Cerrar"><X/></button></div><form onSubmit={savePharmacy} className="drawer-content"><Field label="Código de farmacia"><input required disabled={editingPharmacy!=="nuevo"} placeholder="F006" value={pharmacyForm.id} onChange={e=>setPharmacyForm({...pharmacyForm,id:e.target.value})}/></Field><Field label="Nombre público"><input required placeholder="Farmacia Plaza Mayor" value={pharmacyForm.name} onChange={e=>setPharmacyForm({...pharmacyForm,name:e.target.value})}/></Field><Field label="Ciudad (opcional)"><input value={pharmacyForm.city} onChange={e=>setPharmacyForm({...pharmacyForm,city:e.target.value})}/></Field><Field label="Código de origen (ABA / EUR / BUE…)"><input required placeholder="ABA" maxLength="16" value={pharmacyForm.sourceCode||""} onChange={e=>setPharmacyForm({...pharmacyForm,sourceCode:e.target.value})}/></Field><Field label="Host/IP SQL Server"><input placeholder="Vacío para servidor local" value={pharmacyForm.sourceHost||""} onChange={e=>setPharmacyForm({...pharmacyForm,sourceHost:e.target.value})}/></Field><Field label="Base de datos de origen"><input required value={pharmacyForm.sourceDatabase||""} onChange={e=>setPharmacyForm({...pharmacyForm,sourceDatabase:e.target.value})}/></Field><div className="note small-note"><ShieldCheck size={16}/> Guarda solo el servidor. No introduzcas contraseñas aquí.</div><Field label="Estado"><select value={String(pharmacyForm.active)} onChange={e=>setPharmacyForm({...pharmacyForm,active:e.target.value==="true"})}><option value="true">Activa</option><option value="false">Inactiva</option></select></Field><FormActions onCancel={()=>setEditingPharmacy(null)} label={savingPharmacy?"Guardando…":"Guardar cambios"} disabled={savingPharmacy}/></form></div></div>}
  {toast&&<div className="toast"><CheckCircle2 size={18}/>{toast}<button onClick={()=>setToast("")}><X size={16}/></button></div>}
 </div>
}
function TrackingContent({selected,chartData,trackingTargets,trackingGoal,trackingSales,pharmaName,compact=false}){
 return <div className={"tracking-grid "+(compact?"tracking-compact":"")}>
  <div className="chart-panel"><div className="chart-header"><h3>Evolución semanal</h3><div className="legend"><span><i className="legend-bar"/> Ventas</span><span><i className="legend-line"/> Objetivo acumulado</span></div></div><div className="chart-area"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData} margin={{top:10,right:8,left:-24,bottom:0}}><CartesianGrid stroke="#e7efec" strokeDasharray="3 4" vertical={false}/><XAxis dataKey="week" tick={{fontSize:11,fill:"#81918c"}} axisLine={false} tickLine={false}/><YAxis tick={{fontSize:11,fill:"#81918c"}} axisLine={false} tickLine={false}/><Tooltip formatter={(value)=>[EUR.format(value)+" uds.",""]} contentStyle={{borderRadius:12,border:"1px solid #e3ebe7",boxShadow:"0 12px 25px #15282010"}}/><Bar dataKey="ventas" fill="#bcecd9" radius={[6,6,0,0]} barSize={compact?29:43}/><Line type="monotone" dataKey="objetivo" stroke="#0aaf78" strokeWidth={3} dot={{r:3,fill:"#0aaf78",strokeWidth:0}}/></ComposedChart></ResponsiveContainer></div><div className="chart-disclaimer">Distribución semanal simulada para la demo</div></div>
  <div className="pharma-progress-panel"><div className="chart-header"><h3>Avance por farmacia</h3><span className="mini-total">{EUR.format(trackingSales)} / {EUR.format(trackingGoal)} uds.</span></div><div className="pharma-progress-table"><div className="mini-table-head"><span>Farmacia</span><span>Vendido</span><span>Objetivo</span><span>Progreso</span></div>{trackingTargets.map(([id,t])=>{const sold=selected?.sales?.[id]||0;return <div key={id} className="mini-table-row"><strong>{pharmaName(id)}</strong><span>{EUR.format(sold)}</span><span>{EUR.format(t)}</span><div className="mini-progress"><Progress value={percent(sold,t)}/><b>{percent(sold,t)}%</b></div></div>})}{!trackingTargets.length&&<p className="empty-inline">Sin farmacias seleccionadas.</p>}</div></div>
 </div>;
}
createRoot(document.getElementById("root")).render(<App/>);