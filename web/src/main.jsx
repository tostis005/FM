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
import { exportPromotionExcel, exportAllPromotionsZip } from "./exportaciones.js";
import { pharmacyBackendConfigured, hasPharmacySession, signInPharmacies, loadPharmacies, savePharmacyToServer } from "./farmaciasApi.js";

const DEFAULT_PHARMACIES = [
  {id:"1",name:"Abadía",city:"",active:true,sourceCode:"ABA",sourceHost:"",sourceDatabase:"Farmatic"},
  {id:"2",name:"Europa",city:"",active:true,sourceCode:"EUR",sourceHost:"",sourceDatabase:"Farmatic"},
  {id:"3",name:"Buenavista",city:"",active:true,sourceCode:"BUE",sourceHost:"",sourceDatabase:"Farmatic"},
  {id:"4",name:"Estación",city:"",active:true,sourceCode:"EST",sourceHost:"",sourceDatabase:"Farmatic"},
  {id:"5",name:"Valdemarías",city:"",active:true,sourceCode:"POL",sourceHost:"",sourceDatabase:"Farmatic"}
];
const DEFAULT_USERS = [
  {id:"U01",name:"Laura Gómez",email:"laura.gomez@demo.es",role:"superadmin",pharmacies:[],active:true},
  {id:"U02",name:"Carlos Martínez",email:"carlos.martinez@demo.es",role:"gestor",pharmacies:["1","4"],active:true},
  {id:"U03",name:"Ana Torres",email:"ana.torres@demo.es",role:"farmacia",pharmacies:["1"],active:true},
  {id:"U04",name:"Javier Ruiz",email:"javier.ruiz@demo.es",role:"gestor",pharmacies:["2","5"],active:true},
  {id:"U05",name:"María López",email:"maria.lopez@demo.es",role:"farmacia",pharmacies:["2"],active:false}
];
const DEFAULT_PROMOS = [
  {id:"P100",name:"Rutina de hidratación",subtitle:"Cuidado facial · otoño",description:"Promoción especial en productos de hidratación facial para el cuidado diario de la piel.",status:"Activa",start:"2026-10-01",end:"2026-11-30",cns:["184579.6","188456.3","192334.1","203445.7"],targets:{1:120,2:95,3:100,4:85},sales:{1:92,2:71,3:64,4:56}},
  {id:"P101",name:"Cuidado de invierno",subtitle:"Higiene y dermocosmética",description:"Objetivo de venta de referencias para el cuidado de la piel en invierno.",status:"Activa",start:"2026-10-05",end:"2026-12-31",cns:["165238.4","171625.6","182347.2"],targets:{1:140,2:120,5:110},sales:{1:86,2:79,5:49}},
  {id:"P102",name:"Salud y bienestar",subtitle:"Vitaminas y complementos",description:"Campaña de complementos de bienestar para la red de farmacias.",status:"Activa",start:"2026-09-01",end:"2026-10-31",cns:["154235.7","145602.3","194510.5","190378.2"],targets:{1:140,2:130,3:130,4:120,5:100},sales:{1:124,2:102,3:81,4:88,5:64}},
  {id:"P103",name:"Fotoprotección total",subtitle:"Protección solar",description:"Campaña de fotoprotección estacional.",status:"Finalizada",start:"2026-06-01",end:"2026-09-30",cns:["187345.6","198345.2"],targets:{1:90,2:100,3:110},sales:{1:94,2:103,3:108}},
  {id:"P104",name:"Noviembre esencial",subtitle:"Próxima campaña",description:"Campaña de impulso para productos esenciales de noviembre.",status:"Borrador",start:"2026-11-01",end:"2026-11-30",cns:["173982.4","165708.9"],targets:{2:120,4:120,5:110},sales:{}}
];
const EMPTY_PROMO = {id:null,name:"",subtitle:"",description:"",status:"Borrador",start:"2026-10-16",end:"2026-11-30",cns:[],targets:{},sales:{}};
const HISTORICAL = {1:110,2:95,3:105,4:80,5:90};
const STORE_KEY = "farmetrica-prototype-v1";
const ROLES = {superadmin:"Superadministrador",gestor:"Gestor de farmacias",farmacia:"Personal de farmacia"};
const EUR = new Intl.NumberFormat("es-ES");
function parseCNs(value) {
  return [...new Set(value.split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean))];
}
function percent(s,t) {return t ? Math.round(s/t*100):0;}
function sum(values){return Object.values(values||{}).reduce((a,b)=>a+(Number(b)||0),0);}
function dateES(value){if(!value)return "—";const [y,m,d]=value.split("-");return d+"/"+m+"/"+y;}
function migratePharmacyId(value){
  const key=String(value);
  return /^F00[1-5]$/.test(key)?String(Number(key.slice(1))):key;
}
function migrateSalesOrTargets(obj={}){
  return Object.fromEntries(Object.entries(obj||{}).map(([key,value])=>[migratePharmacyId(key),value]));
}
function readState(){
  try {
    const saved=JSON.parse(localStorage.getItem(STORE_KEY));
    if(saved && Array.isArray(saved.promos) && Array.isArray(saved.pharmacies) && Array.isArray(saved.users)) {
      const oldDemo=saved.pharmacies.length===5 && saved.pharmacies.every(f=>["Farmacia Central","Farmacia Sol","Farmacia Europa","Farmacia Gran Vía","Farmacia Norte"].includes(f.name));
      const pharmacies=oldDemo?DEFAULT_PHARMACIES:saved.pharmacies.map(f=>{
        const id=migratePharmacyId(f.id);
        const baseline=DEFAULT_PHARMACIES.find(p=>p.id===id);
        return {...baseline,...f,id,sourceCode:f.sourceCode||baseline?.sourceCode||"",sourceHost:f.sourceHost||"",sourceDatabase:f.sourceDatabase||"Farmatic"};
      });
      return {
        ...saved,pharmacies,
        promos:saved.promos.map(p=>({...p,targets:migrateSalesOrTargets(p.targets),sales:migrateSalesOrTargets(p.sales)})),
        users:saved.users.map(u=>({...u,pharmacies:(u.pharmacies||[]).map(migratePharmacyId)})),
      };
    }
  }catch {}
  return {promos:DEFAULT_PROMOS,pharmacies:DEFAULT_PHARMACIES,users:DEFAULT_USERS};
}
function downloadCSV(name, rows) {
  const csv="\ufeff"+rows.map(row=>row.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(";")).join("\r\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));a.download=name+".csv";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);
}
function Pill({status}){return <span className={"pill pill-"+status.toLowerCase()}><span className="pill-dot"/>{status}</span>;}
function Progress({value,wide=false}) {return <div className={"progress "+(wide?"progress-wide":"")}><div style={{width:Math.min(Math.max(value,0),100)+"%"}}/></div>}
function Kpi({icon:Icon,title,value,caption,kind="mint"}){return <div className="kpi card"><div className={"kpi-icon kpi-"+kind}><Icon size={23}/></div><div><div className="kpi-label">{title}</div><div className="kpi-value">{value}</div><div className="kpi-caption">{caption}</div></div></div>}
function CampaignMetrics({campaigns,heading,subtitle}){
 const goal=campaigns.reduce((n,p)=>n+sum(p.targets),0),sold=campaigns.reduce((n,p)=>n+sum(p.sales),0);
 const cns=new Set(campaigns.flatMap(p=>p.cns||[])).size;
 return <section className="card campaign-metrics"><div className="campaign-metrics-header"><div><div className="metrics-eyebrow">RESUMEN DE CAMPAÑAS</div><h2>{heading}</h2><p>{subtitle}</p></div><span className="metrics-status"><span/> Seguimiento</span></div>
  <div className="campaign-metrics-grid">
   <div className="campaign-metric"><span>Promociones</span><strong>{EUR.format(campaigns.length)}</strong><small>Campañas</small></div>
   <div className="campaign-metric"><span>Códigos nacionales</span><strong>{EUR.format(cns)}</strong><small>CN únicos</small></div>
   <div className="campaign-metric"><span>Objetivo</span><strong>{EUR.format(goal)}</strong><small>Unidades previstas</small></div>
   <div className="campaign-metric"><span>Vendidas</span><strong>{EUR.format(sold)}</strong><small>Datos ilustrativos</small></div>
   <div className="campaign-metric metric-progress"><span>Cumplimiento</span><strong>{percent(sold,goal)}%</strong><Progress value={percent(sold,goal)}/></div>
  </div></section>;
}
function Field({label,children,hint}) {return <label className="field"><span className="field-label">{label}</span>{children}{hint&&<small>{hint}</small>}</label>}
function FormActions({onCancel,label="Guardar cambios",disabled=false}){return <div className="form-actions"><button className="btn btn-secondary" type="button" onClick={onCancel}>Cancelar</button><button className="btn btn-primary" type="submit" disabled={disabled}><Check size={16}/>{label}</button></div>}
const NAV = [
  {id:"promociones",label:"Promociones",icon:Tag},
  {id:"farmacias",label:"Farmacias",icon:Store},
  {id:"usuarios",label:"Usuarios",icon:Users},
  {id:"ajustes",label:"Ajustes",icon:Settings2}
];
const ROUTES = new Set(NAV.map(item => item.id));
function promotionIdFromUrl(){
 const match=window.location.pathname.match(/^\/promociones\/([^/]+)\/seguimiento\/?$/);
 if(!match)return null;
 try{return decodeURIComponent(match[1]);}catch{return null;}
}
function selectedIdsFromUrl(){
 const oldId=promotionIdFromUrl();
 if(oldId)return [oldId];
 const query=new URLSearchParams(window.location.search);
 if(!query.has("ids"))return null;
 return [...new Set(query.get("ids").split(",").filter(Boolean))].slice(0,500);
}
function reportFiltersFromUrl(){
 const params=new URLSearchParams(window.location.search),selected=selectedIdsFromUrl();
 const status=params.get("estado")||(selected!==null?"Todos":"Activa");
 return {status:["Activa","Finalizada","Borrador","Todos"].includes(status)?status:"Activa",
  year:/^(19|20)\d{2}$/.test(params.get("anio")||"")?params.get("anio"):"Todos",ids:selected};
}
function pageFromUrl(){
 const path=window.location.pathname.replace(/^\/+|\/+$/g,"");
 if(path==="promociones/seguimiento"||path==="seguimiento"||promotionIdFromUrl())return "seguimiento-global";
 return ROUTES.has(path)?path:"promociones";
}

function App(){
 const [data,setData]=useState(readState);
 const [page,setPage]=useState(pageFromUrl);
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
 const [reportStatus,setReportStatus]=useState(()=>reportFiltersFromUrl().status);
 const [reportYear,setReportYear]=useState(()=>reportFiltersFromUrl().year);
 const [reportSearch,setReportSearch]=useState("");
 const [reportPageLimit,setReportPageLimit]=useState(25);
 const [reportSelectedIds,setReportSelectedIds]=useState(()=>{
  const ids=reportFiltersFromUrl().ids;
  return ids===null?data.promos.filter(p=>p.status==="Activa").map(p=>p.id):ids;
 });
 const [selectedPharmacy,setSelectedPharmacy]=useState("Todas");
 const [toast,setToast]=useState("");
 const [mobileMenu,setMobileMenu]=useState(false);
 useEffect(()=>{
    localStorage.setItem(STORE_KEY,JSON.stringify({...data,pharmacies:pharmacyBackendConfigured?DEFAULT_PHARMACIES:data.pharmacies}));
  },[data,pharmacyApiStatus]);
  useEffect(()=>{if(pharmacyBackendConfigured)void refreshPharmacies();},[]);
 useEffect(()=>{if(!toast)return;const id=setTimeout(()=>setToast(""),3800);return()=>clearTimeout(id);},[toast]);
 useEffect(()=>{
   const onBackForward=()=>{
   const filters=reportFiltersFromUrl();
   setReportStatus(filters.status);setReportYear(filters.year);
   setReportSelectedIds(filters.ids===null?data.promos.filter(p=>p.status==="Activa").map(p=>p.id):filters.ids);
   setReportSearch("");setSelectedPharmacy("Todas");
   setPage(pageFromUrl());setSearch("");setMobileMenu(false);
  };
   window.addEventListener("popstate",onBackForward);
   return ()=>window.removeEventListener("popstate",onBackForward);
 },[]);
 useEffect(()=>{
   const label=page==="seguimiento-global"?"Seguimiento":NAV.find(item=>item.id===page)?.label||"Promociones";
   document.title=`Farmetrica · ${label}`;
 },[page]);
 const {promos,pharmacies,users}=data;
 
 const pharmaName=(id)=>pharmacies.find(f=>f.id===id)?.name||id;
 const filterText=search.toLocaleLowerCase("es");
 const filteredPromos=promos.filter(p=>(p.name+" "+p.subtitle+" "+p.cns.join(" ")).toLocaleLowerCase("es").includes(filterText)
  &&(statusFilter==="Todos"||p.status===statusFilter)
  &&(!from||p.end>=from)&&(!to||p.start<=to));
 const activePromos=promos.filter(p=>p.status==="Activa");
 const reportYears=[...new Set(promos.map(p=>(p.start||"").slice(0,4)).filter(y=>/^(19|20)\d{2}$/.test(y)))].sort().reverse();
 const reportFilterBase=promos.filter(p=>(reportStatus==="Todos"||p.status===reportStatus)&&(reportYear==="Todos"||(p.start||"").slice(0,4)===reportYear));
 const reportVisible=reportFilterBase.filter(p=>(p.name+" "+p.id+" "+p.cns.join(" ")).toLocaleLowerCase("es").includes(reportSearch.toLocaleLowerCase("es")));
 const reportSelected=reportVisible.filter(p=>reportSelectedIds.includes(p.id));
 const reportPharmacyIds=[...new Set(reportSelected.flatMap(p=>Object.keys(p.targets||{})))];
 const effectivePharmacy=reportPharmacyIds.includes(selectedPharmacy)?selectedPharmacy:"Todas";
 const reportFilteredCampaigns=reportSelected.map(p=>({
  ...p,
  targets:effectivePharmacy==="Todas"?p.targets:Object.fromEntries(Object.entries(p.targets||{}).filter(([id])=>id===effectivePharmacy)),
  sales:effectivePharmacy==="Todas"?p.sales:Object.fromEntries(Object.entries(p.sales||{}).filter(([id])=>id===effectivePharmacy))
 }));
 const combinedReport=reportFilteredCampaigns.reduce((acc,p)=>{
  Object.entries(p.targets||{}).forEach(([id,val])=>{acc.targets[id]=(acc.targets[id]||0)+(Number(val)||0);});
  Object.entries(p.sales||{}).forEach(([id,val])=>{acc.sales[id]=(acc.sales[id]||0)+(Number(val)||0);});
  return acc;
 },{targets:{},sales:{}});
 const reportTargets=Object.entries(combinedReport.targets);
 const reportGoal=sum(combinedReport.targets);
 const reportSales=sum(combinedReport.sales);
 const reportCNs=[...new Set(reportSelected.flatMap(p=>p.cns||[]))];
 const reportChartData=useMemo(()=>{
  const weights=[.10,.14,.19,.22,.16,.19];
  let running=0;
  return weights.map((w,i)=>{const sales=Math.round(reportSales*w);running+=sales;return {week:"Sem "+(i+1),ventas:sales,acumulado:running,objetivo:Math.round(reportGoal*(i+1)/6)};});
 },[reportSales,reportGoal]);
 const currentUsers=users.filter(u=>(u.name+" "+u.email+" "+ROLES[u.role]).toLocaleLowerCase("es").includes(filterText));
 const currentPharmacies=pharmacies.filter(f=>(f.id+" "+f.name+" "+f.city+" "+(f.sourceCode||"")+" "+(f.sourceHost||"")).toLocaleLowerCase("es").includes(filterText));
 function nav(id,promoId){
  if(id==="seguimiento-campana"||id==="seguimiento-global"){
   const p=promoId?data.promos.find(item=>item.id===promoId):null;
   const status=p?p.status:"Activa",ids=p?[p.id]:data.promos.filter(item=>item.status==="Activa").map(item=>item.id);
   setReportStatus(status);setReportYear("Todos");setReportSearch("");setReportSelectedIds(ids);setSelectedPharmacy("Todas");
   const url="/promociones/seguimiento"+(p?"?ids="+encodeURIComponent(p.id)+"&estado="+encodeURIComponent(status):"");
   if(window.location.pathname+window.location.search!==url)window.history.pushState({page:"seguimiento-global"},"",url);
   setPage("seguimiento-global");setSearch("");setMobileMenu(false);return;
  }
  if(!ROUTES.has(id))return;
  const url="/"+id;
  if(window.location.pathname!==url)window.history.pushState({page:id},"",url);
  setPage(id);setSearch("");setMobileMenu(false);
 }
 function updateReportScope(status,year){
  setReportStatus(status);setReportYear(year);setReportSearch("");setReportPageLimit(25);setSelectedPharmacy("Todas");
  const eligible=data.promos.filter(p=>(status==="Todos"||p.status===status)&&(year==="Todos"||(p.start||"").slice(0,4)===year));
  setReportSelectedIds(prev=>{
   const kept=prev.filter(id=>eligible.some(p=>p.id===id));
   if(kept.length)return kept;
   return (status==="Todos"?eligible.filter(p=>p.status==="Activa"):eligible).map(p=>p.id);
  });
 }
 function selectReportAll(){
  setReportSelectedIds(prev=>[...new Set([...prev,...reportVisible.map(p=>p.id)])]);
 }
 function clearReportSelection(){
  setReportSelectedIds(prev=>prev.filter(id=>!reportVisible.some(p=>p.id===id)));
 }
 function toggleReportCampaign(id){
  setReportSelectedIds(prev=>prev.includes(id)?prev.filter(v=>v!==id):[...prev,id]);
 }
 function startPromo(p){const entry=p||{...EMPTY_PROMO};setEditingPromo(p?.id||"nuevo");setPromoForm({...entry,cns:[...(entry.cns||[])],targets:{...(entry.targets||{})},sales:{...(entry.sales||{})}});setCnText((entry.cns||[]).join("\n"));}
 function savePromo(e){
  e.preventDefault();const codes=parseCNs(cnText);
  if(!promoForm.name.trim())return setToast("Introduce el nombre de la promoción");
  if(!codes.length)return setToast("Añade al menos un código nacional");
  if(promoForm.end<promoForm.start)return setToast("La fecha final debe ser posterior a la inicial");
  if(!Object.keys(promoForm.targets).length)return setToast("Selecciona al menos una farmacia");
  const result={...promoForm,id:promoForm.id||"P"+Date.now(),name:promoForm.name.trim(),cns:codes,targets:Object.fromEntries(Object.entries(promoForm.targets).map(([id,v])=>[id,Math.max(0,Number(v)||0)]))};
  setData(prev=>({...prev,promos:prev.promos.some(p=>p.id===result.id)?prev.promos.map(p=>p.id===result.id?result:p):[result,...prev.promos]}));
  setEditingPromo(null);setToast("Promoción guardada en esta demostración");
 }
 function togglePromoPharmacy(id) {
  const targets={...promoForm.targets};if(id in targets)delete targets[id];else targets[id]=HISTORICAL[id]||100;
  setPromoForm({...promoForm,targets});
 }
 function copyPromo(p){startPromo({...p,id:null,name:p.name+" (copia)",status:"Borrador",sales:{}});setToast("Revisa la copia antes de guardarla");}
 async function exportPromo(p){
  try{await exportPromotionExcel(p,pharmaName);setToast("Excel de la promoción descargado");}
  catch(error){console.error(error);setToast("No se pudo generar el Excel");}
 }
 async function exportAllPromos(campaigns){
  if(!campaigns.length)return setToast("Selecciona al menos una promoción");
  try{await exportAllPromotionsZip(campaigns,pharmaName);setToast("ZIP con "+campaigns.length+" promociones descargado");}
  catch(error){console.error(error);setToast("No se pudo generar el ZIP");}
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
    e.preventDefault();const id=pharmacyForm.id.trim();
    if(!/^[1-9][0-9]{0,5}$/.test(id)||!pharmacyForm.name.trim())return setToast("Revisa el código y el nombre");
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
 const title=page==="seguimiento-global"?"Seguimiento":NAV.find(n=>n.id===page)?.label||"Promociones";
 useEffect(()=>{
  if(page!=="seguimiento-global")return;
  const params=new URLSearchParams();
  params.set("estado",reportStatus);
  if(reportYear!=="Todos")params.set("anio",reportYear);
  params.set("ids",reportSelectedIds.join(","));
  const url="/promociones/seguimiento?"+params.toString();
  if(window.location.pathname+window.location.search!==url)window.history.replaceState({page},"",url);
 },[page,reportStatus,reportYear,reportSelectedIds]);
 return <div className="app-shell">
  <aside className={"sidebar "+(mobileMenu?"sidebar-open":"")}>
   <button className="brand" onClick={()=>nav("promociones")}><span className="brand-mark"><Leaf size={23} strokeWidth={2.8}/></span><span>Farmetrica</span></button>
   <nav className="side-nav">{NAV.map(item=><React.Fragment key={item.id}><button className={"side-link "+(page===item.id?"active":"")} onClick={()=>nav(item.id)}><item.icon size={19}/><span>{item.label}</span>{page===item.id&&<span className="active-dot"/>}</button>{item.id==="promociones"&&<button className={"side-link side-sublink "+(page==="seguimiento-global"?"active":"")} onClick={()=>nav("seguimiento-global")}><BarChart3 size={16}/><span>Seguimiento</span>{page==="seguimiento-global"&&<span className="active-dot"/>}</button>}</React.Fragment>)}</nav>
  </aside>
  {mobileMenu&&<button className="mobile-scrim" onClick={()=>setMobileMenu(false)} aria-label="Cerrar navegación"/>}
  <div className="workspace">
   <header className="topbar">
    <button className="mobile-toggle icon-btn" onClick={()=>setMobileMenu(true)} aria-label="Abrir menú"><LayoutDashboard size={20}/></button>
    <div className="topbar-title"><span className="bread">Farmetrica <ChevronRight size={13}/></span><strong>{title}</strong></div>
    <div className="topbar-right"><button className="icon-btn" title="Sin notificaciones por ahora" onClick={()=>setToast("Sin notificaciones nuevas")}><Bell size={19}/></button><span className="topbar-divider"/><span className="avatar avatar-green">LG</span><span className="top-user">Laura Gómez<small>Superadministrador</small></span><ChevronDown size={14} className="muted desktop-only"/></div>
   </header>
   <main className="main-content">
    {page==="promociones"&&<>
 <div className="page-header"><div><div className="eyebrow"><span className="eyebrow-dot"/> CAMPAÑAS COMERCIALES</div><h1>Promociones</h1><p>Crea campañas, asigna objetivos y consulta su seguimiento.</p></div><button className="btn btn-primary main-cta" onClick={()=>startPromo()}><Plus size={18}/> Nueva promoción</button></div>
 <CampaignMetrics campaigns={activePromos} heading="Promociones activas" subtitle="Indicadores de las campañas en curso" />
 <section className="card list-card full-table-card">
  <div className="section-heading"><div><h2>Listado de promociones</h2><p>Abre una campaña para editarla o consulta directamente sus resultados.</p></div><span className="count-label">{filteredPromos.length} promociones</span></div>
  <div className="toolbar">
   <div className="search-wrap"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar promoción o CN..." aria-label="Buscar promociones"/></div>
   <div className="select-wrap"><Filter size={16}/><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} aria-label="Filtrar estado"><option>Todos</option><option>Activa</option><option>Borrador</option><option>Finalizada</option></select></div>
   <div className="date-mini"><CalendarDays size={16}/><input type="date" title="Desde" value={from} onChange={e=>setFrom(e.target.value)}/><span>—</span><input type="date" title="Hasta" value={to} onChange={e=>setTo(e.target.value)}/></div>
  </div>
  <div className="table-scroll"><table className="data-table campaign-table">
   <thead><tr><th>Promoción</th><th>Estado</th><th>Periodo</th><th>CN</th><th>Farmacias</th><th>Objetivo</th><th>Vendidas</th><th>Avance</th><th>Acciones</th></tr></thead>
   <tbody>{filteredPromos.map(p=>{const goal=sum(p.targets),sold=sum(p.sales),pc=percent(sold,goal);return <tr key={p.id} className="click-row" onClick={()=>startPromo(p)}>
    <td><div className="promotion-cell"><span className="promotion-icon"><Tag size={17}/></span><div><strong>{p.name}</strong><small>{p.subtitle||"Promoción"}</small></div></div></td>
    <td><Pill status={p.status}/></td><td><div className="small-stack">{dateES(p.start)}<small>{dateES(p.end)}</small></div></td>
    <td className="td-number">{p.cns.length}</td><td className="td-number">{Object.keys(p.targets).length}</td>
    <td className="td-number">{EUR.format(goal)}</td><td className="td-number">{EUR.format(sold)}</td>
    <td><div className="table-progress"><Progress value={pc}/><span>{pc}%</span></div></td>
    <td><div className="campaign-row-actions"><button className="btn btn-secondary btn-sm" onClick={e=>{e.stopPropagation();nav("seguimiento-campana",p.id)}}><BarChart3 size={14}/> Seguimiento</button><button className="row-action" title="Editar promoción" aria-label={"Editar "+p.name} onClick={e=>{e.stopPropagation();startPromo(p)}}><Pencil size={16}/></button></div></td>
   </tr>})}</tbody>
  </table>{!filteredPromos.length&&<div className="empty-state"><Search size={25}/><strong>No hay promociones con esos filtros</strong><p>Prueba con otra búsqueda o selecciona un periodo más amplio.</p></div>}</div>
 </section>
 <div className="note data-note"><CircleHelp size={16}/> Las ventas mostradas son ilustrativas hasta disponer de las importaciones reales.</div>
</>}
{page==="seguimiento-global"&&<>
 <div className="page-header">
  <div><div className="eyebrow"><span className="eyebrow-dot"/> REPORTING DE PROMOCIONES</div>
   <h1>Seguimiento</h1><p>Selecciona una o varias campañas para analizar objetivos, ventas y progreso desde una sola pantalla.</p></div>
  <button className="btn btn-primary" disabled={!reportSelected.length} onClick={()=>{if(reportSelected.length===1){void exportPromo(reportSelected[0]);}else{void exportAllPromos(reportSelected);}}}>
   <ArrowDownToLine size={17}/>{reportSelected.length===1?"Descargar Excel":reportSelected.length?"Descargar "+reportSelected.length+" Excel (ZIP)":"Selecciona campañas"}
  </button>
 </div>
 <section className="card report-selector">
  <div className="section-heading report-selector-heading">
   <div><h2>Seleccionar campañas</h2><p>Por defecto se muestran las activas. Filtra el histórico y marca únicamente las promociones que quieras analizar.</p></div>
   <span className="count-label">{reportSelected.length} seleccionadas</span>
  </div>
  <div className="report-filter-grid">
   <Field label="Estado"><select value={reportStatus} onChange={e=>updateReportScope(e.target.value,reportYear)}>
    <option value="Activa">Activas</option><option value="Finalizada">Finalizadas</option><option value="Borrador">Borradores</option><option value="Todos">Todos los estados</option>
   </select></Field>
   <Field label="Año de inicio"><select value={reportYear} onChange={e=>updateReportScope(reportStatus,e.target.value)}>
    <option value="Todos">Todos los años</option>{reportYears.map(year=><option value={year} key={year}>{year}</option>)}
   </select></Field>
   <Field label="Buscar promoción o CN"><input type="search" value={reportSearch} onChange={e=>{setReportSearch(e.target.value);setReportPageLimit(25);}} placeholder="Nombre, referencia, CN…"/></Field>
   <Field label="Farmacia"><select value={effectivePharmacy} onChange={e=>setSelectedPharmacy(e.target.value)}>
    <option value="Todas">Todas las farmacias</option>{pharmacies.filter(f=>reportPharmacyIds.includes(f.id)).map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
   </select></Field>
  </div>
  <div className="report-select-toolbar">
   <label className="report-select-all"><input type="checkbox" checked={reportVisible.length>0&&reportVisible.every(p=>reportSelectedIds.includes(p.id))} onChange={e=>e.target.checked?selectReportAll():clearReportSelection()} disabled={!reportVisible.length}/> Seleccionar todas las filtradas</label>
   <span className="report-selection-count">{reportSelected.length} de {reportVisible.length} seleccionadas en esta vista</span>
   <button type="button" className="text-link" onClick={clearReportSelection} disabled={!reportSelected.length}>Limpiar selección</button>
  </div>
  <div className="report-choice-scroll">
   {reportVisible.slice(0,reportPageLimit).map(p=><label className={"report-choice "+(reportSelectedIds.includes(p.id)?"report-choice-checked":"")} key={p.id}>
    <input type="checkbox" checked={reportSelectedIds.includes(p.id)} onChange={()=>toggleReportCampaign(p.id)}/>
    <span className="report-choice-body"><strong>{p.name}</strong><small>{dateES(p.start)} — {dateES(p.end)} · {p.cns.length} CN · {Object.keys(p.targets||{}).length} farmacias</small></span>
    <Pill status={p.status}/>
   </label>)}
   {!reportVisible.length&&<div className="report-choice-empty">No hay promociones con estos filtros. Prueba con otro estado, año o búsqueda.</div>}
  </div>
  {reportVisible.length>reportPageLimit&&<button className="report-more" type="button" onClick={()=>setReportPageLimit(v=>v+25)}>
   Mostrar más campañas ({reportVisible.length-reportPageLimit} pendientes) <ChevronDown size={16}/>
  </button>}
  <div className="report-selector-footer">La exportación incluye <strong>solo las {reportSelected.length} campañas seleccionadas en los filtros actuales</strong>, no todo el histórico.</div>
 </section>
 {reportSelected.length>0?<>
  <CampaignMetrics campaigns={reportFilteredCampaigns} heading={reportSelected.length===1?reportSelected[0].name:"Resumen de "+reportSelected.length+" campañas"} subtitle={effectivePharmacy==="Todas"?"Seguimiento consolidado de las promociones seleccionadas":"Resultados de la farmacia "+pharmaName(effectivePharmacy)} />
  <section className="card list-card full-table-card">
   <div className="section-heading"><div><h2>Comparativa de promociones</h2><p>Objetivo, vendido y progreso de la selección actual</p></div><span className="count-label">{reportSelected.length} campañas</span></div>
   <div className="table-scroll"><table className="data-table campaign-table"><thead><tr><th>Promoción</th><th>Estado</th><th>CN</th><th>Farmacias</th><th>Objetivo</th><th>Vendido</th><th>Avance</th><th>Acción</th></tr></thead><tbody>
    {reportFilteredCampaigns.map(p=>{const goal=sum(p.targets),sold=sum(p.sales);return <tr key={p.id}>
     <td><div className="promotion-cell"><span className="promotion-icon"><Tag size={17}/></span><div><strong>{p.name}</strong><small>{dateES(p.start)} — {dateES(p.end)}</small></div></div></td>
     <td><Pill status={p.status}/></td><td>{p.cns.length}</td><td>{Object.keys(p.targets||{}).length}</td><td>{EUR.format(goal)} uds.</td><td>{EUR.format(sold)} uds.</td>
     <td><div className="table-progress"><Progress value={percent(sold,goal)}/><span>{percent(sold,goal)}%</span></div></td>
     <td><button className="row-action" title={"Editar "+p.name} aria-label={"Editar "+p.name} onClick={()=>startPromo(p)}><Pencil size={16}/></button></td>
    </tr>})}
   </tbody></table></div>
  </section>
  <section className="card tracking-expanded report-tracking-panel">
   <div className="section-heading"><div><h2>Avance por farmacia</h2><p>Resultados agregados de las campañas seleccionadas</p></div><span className="count-label">{reportTargets.length} farmacias</span></div>
   <TrackingContent selected={combinedReport} chartData={reportChartData} trackingTargets={reportTargets} trackingGoal={reportGoal} trackingSales={reportSales} pharmaName={pharmaName}/>
  </section>
  <section className="card campaign-cn-panel">
   <div className="section-heading"><div><h2>Códigos nacionales incluidos</h2><p>Referencias únicas del conjunto seleccionado</p></div><span className="count-label">{reportCNs.length} CN</span></div>
   <div className="cn-chips">{reportCNs.slice(0,45).map(cn=><span key={cn} className="cn-chip">{cn}</span>)}{reportCNs.length>45&&<span className="cn-chip">+{reportCNs.length-45} más</span>}</div>
  </section>
 </>:<section className="card report-empty-state"><Package size={27}/><h2>Selecciona alguna campaña para ver su seguimiento</h2><p>Puedes marcar una, varias o todas las que aparezcan en los filtros.</p></section>}
 <div className="note data-note"><CircleHelp size={16}/> Los resultados de ventas y el gráfico semanal todavía son ilustrativos. La exportación utiliza las campañas seleccionadas, aunque hayas filtrado la visualización por farmacia.</div>
</>}
{page==="farmacias"&&<><div className="page-header"><div><div className="eyebrow"><span className="eyebrow-dot"/> ESTRUCTURA DE LA RED</div><h1>Maestro de farmacias</h1><p>Configura los identificadores y servidores de origen de cada farmacia.</p></div><div className="pharmacy-header-actions">{pharmacyBackendConfigured&&pharmacyApiStatus!=="connected"&&<button className="btn btn-secondary" onClick={connectPharmacies}><ShieldCheck size={17}/> Conectar Microsoft 365</button>}<button className="btn btn-primary" onClick={()=>startPharmacy()} disabled={pharmacyBackendConfigured&&pharmacyApiStatus!=="connected"}><Plus size={17}/> Nueva farmacia</button></div></div>{pharmacyApiStatus==="connected"?<div className="note"><CheckCircle2 size={17}/> Maestro conectado a PostgreSQL. Los cambios se guardan para todos los administradores.</div>:<div className="note"><CircleHelp size={17}/>{pharmacyBackendConfigured?(pharmacyApiError||"Inicia sesión para consultar y modificar las farmacias reales."):"Modo demostración. Falta configurar Microsoft Entra ID y desplegar la API para activar PostgreSQL."}</div>}<div className="kpi-grid small-kpis"><Kpi icon={Store} title="Farmacias" value={pharmacies.length} caption="Total en el maestro"/><Kpi icon={CheckCircle2} title="Activas" value={pharmacies.filter(f=>f.active).length} caption="En funcionamiento"/><Kpi icon={Users} title="Usuarios asignados" value={users.filter(u=>u.role!=="superadmin").length} caption="En la red"/></div><div className="full-width-grid"><div className="card list-card"><div className="section-heading"><div><h2>Listado de farmacias</h2><p>Identificadores utilizados por las importaciones</p></div></div><div className="toolbar"><div className="search-wrap"><Search size={17}/><input placeholder="Buscar por código, nombre o ciudad..." value={search} onChange={e=>setSearch(e.target.value)}/></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>ID</th><th>Nombre público</th><th>Origen</th><th>Servidor SQL</th><th>Estado</th><th>Usuarios</th><th/></tr></thead><tbody>{currentPharmacies.map(f=><tr key={f.id} onClick={()=>startPharmacy(f)} className="click-row"><td><span className="id-code">{f.id}</span></td><td><div className="pharma-cell"><span className="store-mini"><Store size={16}/></span><strong>{f.name}</strong></div></td><td><span className="id-code">{f.sourceCode||"—"}</span></td><td>{pharmacyApiStatus==="connected"?(f.sourceHost||"Servidor local"):"— (demo)"}</td><td><Pill status={f.active?"Activa":"Inactiva"}/></td><td>{users.filter(u=>u.role==="superadmin"||u.pharmacies.includes(f.id)).length}</td><td><Pencil size={16} className="muted"/></td></tr>)}</tbody></table></div></div></div></>}
    {page==="usuarios"&&<><div className="page-header"><div><div className="eyebrow"><span className="eyebrow-dot"/> EQUIPO Y PERMISOS</div><h1>Gestión de usuarios</h1><p>Organiza los roles y las farmacias asignadas a cada usuario.</p></div><button className="btn btn-primary" onClick={()=>startUser()}><Plus size={17}/> Nuevo usuario</button></div><div className="kpi-grid small-kpis"><Kpi icon={Users} title="Usuarios" value={users.length} caption="Registrados"/><Kpi icon={CheckCircle2} title="Activos" value={users.filter(u=>u.active).length} caption="Con acceso"/><Kpi icon={ShieldCheck} title="Roles" value="3" caption="Perfiles definidos" kind="blue"/></div><div className="content-grid admin-grid"><div className="card list-card"><div className="section-heading"><div><h2>Usuarios del sistema</h2><p>Identidad, permisos y farmacias asignadas</p></div></div><div className="toolbar"><div className="search-wrap"><Search size={17}/><input placeholder="Buscar usuario, correo o rol..." value={search} onChange={e=>setSearch(e.target.value)}/></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Usuario</th><th>Rol</th><th>Farmacias</th><th>Estado</th><th/></tr></thead><tbody>{currentUsers.map(u=><tr className="click-row" key={u.id} onClick={()=>startUser(u)}><td><div className="user-cell"><span className="avatar avatar-soft">{u.name.split(" ").slice(0,2).map(x=>x[0]).join("")}</span><div><strong>{u.name}</strong><small>{u.email}</small></div></div></td><td><span className={"role-pill role-"+u.role}>{ROLES[u.role]}</span></td><td>{u.role==="superadmin"?"Todas":u.pharmacies.map(pharmaName).join(", ")||"—"}</td><td><Pill status={u.active?"Activa":"Inactiva"}/></td><td><Pencil size={16} className="muted"/></td></tr>)}</tbody></table></div></div><div className="card role-card"><div className="section-heading"><div><h2>Roles del sistema</h2><p>Tres niveles de acceso</p></div></div><div className="role-desc"><span className="role-icon role-bg-green"><Store/></span><div><strong>Personal de farmacia</strong><p>Consulta únicamente sus farmacias y el seguimiento asignado.</p></div></div><div className="role-desc"><span className="role-icon role-bg-blue"><Users/></span><div><strong>Gestor de farmacias</strong><p>Gestiona promociones y usuarios de las farmacias asignadas.</p></div></div><div className="role-desc"><span className="role-icon role-bg-purple"><ShieldCheck/></span><div><strong>Superadministrador</strong><p>Administra toda la red, usuarios, códigos y configuración.</p></div></div></div></div></>}
    {page==="ajustes"&&<><div className="page-header"><div><div className="eyebrow"><span className="eyebrow-dot"/> CONFIGURACIÓN</div><h1>Ajustes</h1><p>Estado del prototipo y próximas integraciones.</p></div></div><div className="settings-grid"><div className="card settings-card"><span className="settings-icon"><ShieldCheck/></span><h2>Microsoft 365</h2><p>Inicio de sesión con el tenant y control real de roles por farmacia.</p><span className="soon">Próxima fase</span></div><div className="card settings-card"><span className="settings-icon"><RefreshCcw/></span><h2>Sincronización de ventas</h2><p>SQL Server → PostgreSQL, con cargas iniciales e incrementales y trazabilidad.</p><span className="soon">Pendiente de conexión</span></div><div className="card settings-card"><span className="settings-icon"><Activity/></span><h2>Asistente con IA</h2><p>Chat con consultas validadas para analizar beneficios y ventas reales.</p><span className="soon">Futura fase</span></div></div></>}
   </main>
   <footer className="app-footer"><span>© 2026 Farmetrica · Prototipo visual</span><span>Datos simulados · No conectado a ventas reales</span></footer>
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
  {editingPharmacy&&<div className="drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setEditingPharmacy(null)}}><div className="drawer"><div className="drawer-top"><div><span className="eyebrow">MAESTRO DE FARMACIAS</span><h2>{editingPharmacy==="nuevo"?"Nueva farmacia":"Editar farmacia"}</h2><p>El ID es numérico y debe coincidir con los datos importados.</p></div><button className="icon-btn" onClick={()=>setEditingPharmacy(null)} aria-label="Cerrar"><X/></button></div><form onSubmit={savePharmacy} className="drawer-content"><Field label="ID numérico de farmacia"><input required disabled={editingPharmacy!=="nuevo"} placeholder="6" value={pharmacyForm.id} onChange={e=>setPharmacyForm({...pharmacyForm,id:e.target.value})}/></Field><Field label="Nombre público"><input required placeholder="Farmacia Plaza Mayor" value={pharmacyForm.name} onChange={e=>setPharmacyForm({...pharmacyForm,name:e.target.value})}/></Field><Field label="Ciudad (opcional)"><input value={pharmacyForm.city} onChange={e=>setPharmacyForm({...pharmacyForm,city:e.target.value})}/></Field><Field label="Código de origen (ABA / EUR / BUE…)"><input required placeholder="ABA" maxLength="16" value={pharmacyForm.sourceCode||""} onChange={e=>setPharmacyForm({...pharmacyForm,sourceCode:e.target.value})}/></Field><Field label="Host/IP SQL Server"><input placeholder="Vacío para servidor local" value={pharmacyForm.sourceHost||""} onChange={e=>setPharmacyForm({...pharmacyForm,sourceHost:e.target.value})}/></Field><Field label="Base de datos de origen"><input required value={pharmacyForm.sourceDatabase||""} onChange={e=>setPharmacyForm({...pharmacyForm,sourceDatabase:e.target.value})}/></Field><div className="note small-note"><ShieldCheck size={16}/> Guarda solo el servidor. No introduzcas contraseñas aquí.</div><Field label="Estado"><select value={String(pharmacyForm.active)} onChange={e=>setPharmacyForm({...pharmacyForm,active:e.target.value==="true"})}><option value="true">Activa</option><option value="false">Inactiva</option></select></Field><FormActions onCancel={()=>setEditingPharmacy(null)} label={savingPharmacy?"Guardando…":"Guardar cambios"} disabled={savingPharmacy}/></form></div></div>}
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