import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity, ArrowDownToLine, ArrowRight, Bell, CalendarDays, Check, CheckCircle2, ChevronDown,
  ChevronRight, CircleHelp, ClipboardList, Clock3, Filter, Home, LayoutDashboard, Leaf, LogOut,
  MoreHorizontal, Pencil, Plus, Search, Settings2, ShieldCheck, Sparkles, Store, Tag, Target,
  Trash2, TrendingUp, Users, X, BarChart3, Package, Copy, RefreshCcw, Upload, Database
} from "lucide-react";
import "./styles.css";
import { parseCNs, isValidCN, normalizeStoredCNs } from "./cns.js";
import { exportPromotionExcel, exportAllPromotionsZip } from "./exportaciones.js";
import { pharmacyBackendConfigured, hasPharmacySession, signInPharmacies, loadPharmacies, savePharmacyToServer, loadSalesCatalog, loadSalesCoverage, loadPromotionSales } from "./farmaciasApi.js";

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
  {id:"P100",name:"Rutina de hidratación",subtitle:"Cuidado facial · otoño",description:"Promoción especial en productos de hidratación facial para el cuidado diario de la piel.",status:"Activa",start:"2026-10-01",end:"2026-11-30",cns:["184579","188456","192334","203445"],targets:{1:120,2:95,3:100,4:85},sales:{1:92,2:71,3:64,4:56}},
  {id:"P101",name:"Cuidado de invierno",subtitle:"Higiene y dermocosmética",description:"Objetivo de venta de referencias para el cuidado de la piel en invierno.",status:"Activa",start:"2026-10-05",end:"2026-12-31",cns:["165238","171625","182347"],targets:{1:140,2:120,5:110},sales:{1:86,2:79,5:49}},
  {id:"P102",name:"Salud y bienestar",subtitle:"Vitaminas y complementos",description:"Campaña de complementos de bienestar para la red de farmacias.",status:"Activa",start:"2026-09-01",end:"2026-10-31",cns:["154235","145602","194510","190378"],targets:{1:140,2:130,3:130,4:120,5:100},sales:{1:124,2:102,3:81,4:88,5:64}},
  {id:"P103",name:"Fotoprotección total",subtitle:"Protección solar",description:"Campaña de fotoprotección estacional.",status:"Finalizada",start:"2026-06-01",end:"2026-09-30",cns:["187345","198345"],targets:{1:90,2:100,3:110},sales:{1:94,2:103,3:108}},
  {id:"P104",name:"Noviembre esencial",subtitle:"Próxima campaña",description:"Campaña de impulso para productos esenciales de noviembre.",status:"Borrador",start:"2026-11-01",end:"2026-11-30",cns:["173982","165708"],targets:{2:120,4:120,5:110},sales:{}}
];
const EMPTY_PROMO = {id:null,name:"",subtitle:"",description:"",status:"Borrador",start:"2026-10-16",end:"2026-11-30",cns:[],targets:{},sales:{},type:"sin_clasificar",discountPercent:""};
const PROMOTION_TYPES = [
  {id:"sin_clasificar",name:"Sin clasificar"},
  {id:"dos_por_uno",name:"2×1"},
  {id:"tres_por_dos",name:"3×2"},
  {id:"segunda_porcentaje",name:"Segunda unidad al X %",needsPercent:true},
  {id:"descuento_porcentaje",name:"Descuento del X %",needsPercent:true},
  {id:"precio_especial",name:"Precio especial"},
  {id:"otros",name:"Otros"}
];
const STORE_KEY = "farmetrica-prototype-v1";
const ROLES = {superadmin:"Superadministrador",gestor:"Gestor de farmacias",farmacia:"Personal de farmacia"};
const EUR = new Intl.NumberFormat("es-ES");
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
        promos:saved.promos.map(p=>({...p,cns:normalizeStoredCNs(p.cns),targets:migrateSalesOrTargets(p.targets),sales:{},type:p.type||"sin_clasificar",discountPercent:p.discountPercent??""})),
        users:saved.users.map(u=>({...u,pharmacies:(u.pharmacies||[]).map(migratePharmacyId)})),
      };
    }
  }catch {}
  return {promos:DEFAULT_PROMOS.map(p=>({...p,sales:{},type:"sin_clasificar",discountPercent:""})),pharmacies:DEFAULT_PHARMACIES,users:DEFAULT_USERS};
}
function downloadCSV(name, rows) {
  const csv="\ufeff"+rows.map(row=>row.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(";")).join("\r\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));a.download=name+".csv";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);
}
function Pill({status}){return <span className={"pill pill-"+status.toLowerCase()}><span className="pill-dot"/>{status}</span>;}
function Progress({value,wide=false}) {return <div className={"progress "+(wide?"progress-wide":"")}><div style={{width:Math.min(Math.max(value,0),100)+"%"}}/></div>}
function Kpi({icon:Icon,title,value,caption,kind="mint"}){return <div className="kpi card"><div className={"kpi-icon kpi-"+kind}><Icon size={23}/></div><div><div className="kpi-label">{title}</div><div className="kpi-value">{value}</div><div className="kpi-caption">{caption}</div></div></div>}
function CampaignMetrics({campaigns,heading,subtitle,salesLabel="Pendiente de conexión"}){
 const goal=campaigns.reduce((n,p)=>n+sum(p.targets),0),sold=campaigns.reduce((n,p)=>n+sum(p.sales),0);
 const cns=new Set(campaigns.flatMap(p=>p.cns||[])).size;
 return <section className="card campaign-metrics"><div className="campaign-metrics-header"><div><h2>{heading}</h2><p>{subtitle}</p></div><span className="metrics-status"><span/> Seguimiento</span></div>
  <div className="campaign-metrics-grid">
   <div className="campaign-metric"><span>Promociones</span><strong>{EUR.format(campaigns.length)}</strong><small>Campañas</small></div>
   <div className="campaign-metric"><span>CNs</span><strong>{EUR.format(cns)}</strong><small>CNs únicos</small></div>
   <div className="campaign-metric"><span>Objetivo</span><strong>{EUR.format(goal)}</strong><small>Unidades previstas</small></div>
   <div className="campaign-metric"><span>Vendidas</span><strong>{EUR.format(sold)}</strong><small>{salesLabel}</small></div>
   <div className="campaign-metric metric-progress"><span>Cumplimiento</span><strong>{percent(sold,goal)}%</strong><Progress value={percent(sold,goal)}/></div>
  </div></section>;
}
function SalesNotice({status,error,coverage,onConnect,canConnect}){
  const live=status==="real",count=(coverage||[]).filter(f=>Number(f.lineas)>0).length;
  return <div className={"note data-note sales-connection "+(live?"sales-connected":"")}>
    <Database size={17}/>
    <span>{live?"Ventas reales de Farmatic conectadas. "+count+" de 5 farmacias con registros; unidades netas por CN y periodo.":
      status==="cargando"?"Consultando ventas reales de PostgreSQL…":
      status==="error"?"No se pudieron consultar las ventas reales: "+error:
      "Ventas pendientes: los objetivos son de demostración y no se muestran ventas ficticias."}</span>
    {!live&&canConnect&&<button type="button" className="btn btn-secondary btn-sm" onClick={onConnect}>Conectar Microsoft 365</button>}
  </div>;
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
 return [...new Set(query.get("ids").split(",").filter(Boolean))];
}
function reportFiltersFromUrl(){
 const params=new URLSearchParams(window.location.search),selected=selectedIdsFromUrl();
 const status=params.get("estado")||(selected!==null?"Todos":"Activa");
 return {status:["Activa","Finalizada","Borrador","Todos"].includes(status)?status:"Activa",
  year:/^(19|20)\d{2}$/.test(params.get("anio")||"")?params.get("anio"):"Todos",ids:selected,
  pharmacies:params.has("farmacias")?[...new Set(params.get("farmacias").split(",").filter(Boolean))]:null};
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
  const [reportModal,setReportModal]=useState(null);
 const [reportDetailLimit,setReportDetailLimit]=useState(15);
 const [expandedCampaignIds,setExpandedCampaignIds]=useState(()=>data.promos.filter(p=>p.status==="Activa").slice(0,2).map(p=>p.id));
 const [selectedPharmacyIds,setSelectedPharmacyIds]=useState(()=>reportFiltersFromUrl().pharmacies);
 const [pharmacySelectorOpen,setPharmacySelectorOpen]=useState(false);
 const pharmacySelectorRef=useRef(null);
 const reportCloseRef=useRef(null);
 const [reportSelectedIds,setReportSelectedIds]=useState(()=>{
  const ids=reportFiltersFromUrl().ids;
  return ids===null?data.promos.filter(p=>p.status==="Activa").map(p=>p.id):ids;
 });
  const [salesStatus,setSalesStatus]=useState("sin_conexion");
  const [salesError,setSalesError]=useState("");
  const [salesCatalog,setSalesCatalog]=useState([]);
  const [salesByPromotion,setSalesByPromotion]=useState({});
  const [salesCoverage,setSalesCoverage]=useState([]);
  const [targetIncrease,setTargetIncrease]=useState("5");
  const [toast,setToast]=useState("");
 const [mobileMenu,setMobileMenu]=useState(false);
 useEffect(()=>{
    localStorage.setItem(STORE_KEY,JSON.stringify({...data,promos:data.promos.map(p=>({...p,sales:{}})),pharmacies:pharmacyBackendConfigured?DEFAULT_PHARMACIES:data.pharmacies}));
  },[data,pharmacyApiStatus]);
  useEffect(()=>{if(pharmacyBackendConfigured)void refreshPharmacies();},[]);
   useEffect(()=>{
     if(pharmacyApiStatus!=="connected"){setSalesStatus("sin_conexion");setSalesByPromotion({});return;}
     let cancelled=false;
     setSalesStatus("cargando");
     const sync=async()=>{
       try{
         const chunks=[];
         for(let i=0;i<data.promos.length;i+=25)chunks.push(data.promos.slice(i,i+25));
         const [catalog,coverage,...results]=await Promise.all([
           loadSalesCatalog(),loadSalesCoverage(),...chunks.map(chunk=>loadPromotionSales(chunk))
         ]);
         if(cancelled)return;
         setSalesCatalog(catalog.products||[]);
         setSalesCoverage(coverage.pharmacies||[]);
         setSalesByPromotion(Object.assign({},...results.map(result=>result.sales||{})));
         setSalesError("");
         setSalesStatus("real");
       }catch(error){
         if(cancelled)return;
         setSalesByPromotion({});setSalesStatus("error");setSalesError(error.message);
       }
     };
     void sync();
     return()=>{cancelled=true;};
   },[pharmacyApiStatus,data.promos]);
 useEffect(()=>{if(!toast)return;const id=setTimeout(()=>setToast(""),3800);return()=>clearTimeout(id);},[toast]);
 useEffect(()=>{
   const onBackForward=()=>{
   const filters=reportFiltersFromUrl();
   setReportStatus(filters.status);setReportYear(filters.year);
   setReportSelectedIds(filters.ids===null?data.promos.filter(p=>p.status==="Activa").map(p=>p.id):filters.ids);
   setSelectedPharmacyIds(filters.pharmacies);setPharmacySelectorOpen(false);setReportDetailLimit(15);setReportModal(null);
   setPage(pageFromUrl());setSearch("");setMobileMenu(false);
  };
   window.addEventListener("popstate",onBackForward);
   return ()=>window.removeEventListener("popstate",onBackForward);
 },[data.promos]);
 useEffect(()=>{
  if(!pharmacySelectorOpen)return;
  const onPointerDown=e=>{if(pharmacySelectorRef.current&&!pharmacySelectorRef.current.contains(e.target))setPharmacySelectorOpen(false);};
  const onEscape=e=>{if(e.key==="Escape")setPharmacySelectorOpen(false);};
  document.addEventListener("pointerdown",onPointerDown);
  window.addEventListener("keydown",onEscape);
  return()=>{document.removeEventListener("pointerdown",onPointerDown);window.removeEventListener("keydown",onEscape);};
 },[pharmacySelectorOpen]);
 useEffect(()=>{
  if(!reportModal)return;
  const old=document.body.style.overflow;
  document.body.style.overflow="hidden";
  reportCloseRef.current?.focus();
  const onKeyDown=e=>{if(e.key==="Escape")setReportModal(null);};
  window.addEventListener("keydown",onKeyDown);
  return ()=>{document.body.style.overflow=old;window.removeEventListener("keydown",onKeyDown);};
 },[Boolean(reportModal)]);
 useEffect(()=>{
   const label=page==="seguimiento-global"?"Seguimiento":NAV.find(item=>item.id===page)?.label||"Promociones";
   document.title=`Farmetrica · ${label}`;
 },[page]);
 const {promos:storedPromos,pharmacies,users}=data;
  const promos=storedPromos.map(p=>({...p,sales:salesStatus==="real"?(salesByPromotion[p.id]||{}):{},salesSource:salesStatus==="real"?"Ventas reales de Farmatic · octubre 2026":"Sin conexión de ventas reales"}));
 
 const pharmaName=(id)=>pharmacies.find(f=>f.id===id)?.name||id;
 const filterText=search.toLocaleLowerCase("es");
 const filteredPromos=promos.filter(p=>(p.name+" "+p.subtitle+" "+p.cns.join(" ")).toLocaleLowerCase("es").includes(filterText)
  &&(statusFilter==="Todos"||p.status===statusFilter)
  &&(!from||p.end>=from)&&(!to||p.start<=to));
 const activePromos=promos.filter(p=>p.status==="Activa");
 const reportYears=[...new Set(promos.map(p=>(p.start||"").slice(0,4)).filter(y=>/^(19|20)\d{2}$/.test(y)))].sort().reverse();
 const reportFilterBase=promos.filter(p=>(reportStatus==="Todos"||p.status===reportStatus)&&(reportYear==="Todos"||(p.start||"").slice(0,4)===reportYear));
 const reportSelected=reportFilterBase.filter(p=>reportSelectedIds.includes(p.id));
 const draftFilterBase=reportModal?promos.filter(p=>(reportModal.status==="Todos"||p.status===reportModal.status)&&(reportModal.year==="Todos"||(p.start||"").slice(0,4)===reportModal.year)):[];
 const draftVisible=reportModal?draftFilterBase.filter(p=>(p.name+" "+p.id+" "+p.cns.join(" ")).toLocaleLowerCase("es").includes(reportModal.search.toLocaleLowerCase("es"))):[];
 const reportPharmacyIds=[...new Set(reportSelected.flatMap(p=>Object.keys(p.targets||{})))];
 const effectivePharmacyIds=selectedPharmacyIds===null?reportPharmacyIds:selectedPharmacyIds.filter(id=>reportPharmacyIds.includes(id));
 const activePharmacySet=new Set(effectivePharmacyIds);
 const reportFilteredCampaigns=reportSelected.filter(p=>selectedPharmacyIds===null||Object.keys(p.targets||{}).some(id=>activePharmacySet.has(id))).map(p=>({
  ...p,
  targets:Object.fromEntries(Object.entries(p.targets||{}).filter(([id])=>activePharmacySet.has(id))),
  sales:Object.fromEntries(Object.entries(p.sales||{}).filter(([id])=>activePharmacySet.has(id)))
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
 const currentUsers=users.filter(u=>(u.name+" "+u.email+" "+ROLES[u.role]).toLocaleLowerCase("es").includes(filterText));
 const currentPharmacies=pharmacies.filter(f=>(f.id+" "+f.name+" "+f.city+" "+(f.sourceCode||"")+" "+(f.sourceHost||"")).toLocaleLowerCase("es").includes(filterText));
 function nav(id,promoId){
  if(id==="seguimiento-campana"||id==="seguimiento-global"){
   const p=promoId?promos.find(item=>item.id===promoId):null;
   const status=p?p.status:"Activa",ids=p?[p.id]:data.promos.filter(item=>item.status==="Activa").map(item=>item.id);
   setReportStatus(status);setReportYear("Todos");setReportSelectedIds(ids);setReportDetailLimit(15);setSelectedPharmacyIds(null);
   setExpandedCampaignIds(p?[p.id]:data.promos.filter(item=>item.status==="Activa").slice(0,2).map(item=>item.id));
   const url="/promociones/seguimiento"+(p?"?ids="+encodeURIComponent(p.id)+"&estado="+encodeURIComponent(status):"");
   if(window.location.pathname+window.location.search!==url)window.history.pushState({page:"seguimiento-global"},"",url);
   setPage("seguimiento-global");setSearch("");setMobileMenu(false);return;
  }
  if(!ROUTES.has(id))return;
  const url="/"+id;
  if(window.location.pathname!==url)window.history.pushState({page:id},"",url);
  setPage(id);setSearch("");setMobileMenu(false);
 }
 function openReportFilters(){
  setReportModal({status:reportStatus,year:reportYear,search:"",ids:[...reportSelectedIds],limit:25});
 }
 function updateDraftScope(status,year){
  setReportModal(prev=>{
   if(!prev)return prev;
   const eligible=data.promos.filter(p=>(status==="Todos"||p.status===status)&&(year==="Todos"||(p.start||"").slice(0,4)===year));
   const kept=prev.ids.filter(id=>eligible.some(p=>p.id===id));
   return {...prev,status,year,search:"",limit:25,ids:kept.length?kept:(status==="Todos"?eligible.filter(p=>p.status==="Activa"):eligible).map(p=>p.id)};
  });
 }
 function selectDraftAll(visible){setReportModal(prev=>prev?{...prev,ids:[...new Set([...prev.ids,...visible.map(p=>p.id)])]}:prev);}
 function clearDraftVisible(visible){setReportModal(prev=>prev?{...prev,ids:prev.ids.filter(id=>!visible.some(p=>p.id===id))}:prev);}
 function toggleDraftCampaign(id){setReportModal(prev=>prev?{...prev,ids:prev.ids.includes(id)?prev.ids.filter(v=>v!==id):[...prev.ids,id]}:prev);}
 function applyReportFilters(){
  if(!reportModal)return;
  const {status,year,ids}=reportModal;
  const eligible=data.promos.filter(p=>(status==="Todos"||p.status===status)&&(year==="Todos"||(p.start||"").slice(0,4)===year));
  setReportStatus(status);setReportYear(year);
  setReportSelectedIds(eligible.map(p=>p.id).filter(id=>ids.includes(id)));
  setSelectedPharmacyIds(null);setReportDetailLimit(15);setReportModal(null);
 }
 function toggleReportPharmacy(id){
  setSelectedPharmacyIds(prev=>{
   if(prev===null)return [id];
   const next=prev.includes(id)?prev.filter(v=>v!==id):[...prev,id];
   return next.length?next:null;
  });
 }
 function toggleCampaignExpanded(id){
  setExpandedCampaignIds(prev=>prev.includes(id)?prev.filter(value=>value!==id):[...prev,id]);
 }
 function startPromo(p){const entry=p||{...EMPTY_PROMO};setEditingPromo(p?.id||"nuevo");setTargetIncrease("5");setPromoForm({...entry,type:entry.type||"sin_clasificar",discountPercent:entry.discountPercent??"",cns:[...(entry.cns||[])],targets:{...(entry.targets||{})},sales:{}});setCnText((entry.cns||[]).join("\n"));}
 function savePromo(e){
  e.preventDefault();const codes=parseCNs(cnText);
  if(!promoForm.name.trim())return setToast("Introduce el nombre de la promoción");
  if(!codes.length)return setToast("Añade al menos un CN de seis dígitos");
   const invalid=codes.filter(cn=>!isValidCN(cn));
   if(invalid.length)return setToast("Cada CN debe contener exactamente 6 dígitos, sin puntos. Revisa: "+invalid[0]);
  if(promoForm.end<promoForm.start)return setToast("La fecha final debe ser posterior a la inicial");
  const selections=Object.entries(promoForm.targets);
  const requiresPct=PROMOTION_TYPES.find(t=>t.id===promoForm.type)?.needsPercent;
  if(promoForm.status==="Activa" && !selections.length)return setToast("Selecciona farmacias y completa sus objetivos antes de activar");
  if(promoForm.status==="Activa" && selections.some(([,v])=>v==="" || !Number.isInteger(Number(v)) || Number(v)<=0))
     return setToast("Para activar, todos los objetivos por farmacia son obligatorios y deben ser mayores que cero");
  if(promoForm.status==="Activa" && promoForm.type==="sin_clasificar")
     return setToast("Clasifica el tipo de promoción antes de activarla");
  if(promoForm.status==="Activa" && requiresPct &&
    (promoForm.discountPercent==="" || !Number.isFinite(Number(promoForm.discountPercent)) || Number(promoForm.discountPercent)<=0 || Number(promoForm.discountPercent)>100))
     return setToast("Introduce el porcentaje de descuento antes de activar");
  if(selections.some(([,v])=>v!=="" && (!Number.isInteger(Number(v)) || Number(v)<0)))
     return setToast("Los objetivos deben ser unidades enteras no negativas");
  const result={...promoForm,sales:{},id:promoForm.id||"P"+Date.now(),name:promoForm.name.trim(),cns:codes,targets:Object.fromEntries(selections.map(([id,v])=>[id,v===""?"":Number(v)]))};
  setData(prev=>({...prev,promos:prev.promos.some(p=>p.id===result.id)?prev.promos.map(p=>p.id===result.id?result:p):[result,...prev.promos]}));
  setEditingPromo(null);setToast("Promoción guardada en esta demostración");
 }
 function togglePromoPharmacy(id) {
  const targets={...promoForm.targets};if(id in targets)delete targets[id];else targets[id]="";
  setPromoForm({...promoForm,targets});
 }
 function applyIncrease(){
    const increase=Number(targetIncrease);
    if(targetIncrease==="" || !Number.isFinite(increase) || increase < -100 || increase > 500)
       return setToast("Introduce un porcentaje entre -100 y 500");
    const targets={...promoForm.targets};
    if(!Object.values(targets).some(v=>v!=="" && Number(v)>0))
       return setToast("Introduce primero los objetivos base de las farmacias");
    Object.keys(targets).forEach(id=>{if(targets[id]!=="" && Number(targets[id])>=0)targets[id]=Math.max(0,Math.ceil(Number(targets[id])*(1+increase/100)));});
    setPromoForm({...promoForm,targets});
    setToast("Incremento aplicado. Puedes retocar cada objetivo antes de guardar");
  }
  function addLiveExample(){
    if(salesStatus!=="real" || !salesCatalog.length)return setToast("Conecta primero las ventas reales de Farmatic");
    const cns=salesCatalog.slice(0,20).map(item=>item.cn);
    const p={...EMPTY_PROMO,id:"PF"+Date.now(),name:"Selección real de "+cns.length+" CNs · octubre 2026",
      subtitle:"Ejemplo con datos de Farmatic",
      description:"CNs seleccionados por ventas netas en octubre de 2026. Pendiente de clasificar y de asignar objetivos. No se ha verificado que compartan proveedor.",
      start:"2026-10-01",end:"2026-10-31",cns,targets:Object.fromEntries(pharmacies.filter(f=>f.active).map(f=>[f.id,""]))};
    setData(prev=>({...prev,promos:[p,...prev.promos]}));startPromo(p);
    setToast("Borrador con CNs reales; objetivos pendientes de asignar");
  }
  function copyPromo(p){startPromo({...p,id:null,name:p.name+" (copia)",status:"Borrador",sales:{}});setToast("Revisa la copia antes de guardarla");}
 async function exportPromo(p){
  try{await exportPromotionExcel(p,pharmaName);setToast("Excel de la promoción descargado");}
  catch(error){console.error(error);setToast("No se pudo generar el Excel");}
 }
 async function exportAllPromos(campaigns){
  if(!campaigns.length)return setToast("Selecciona al menos una promoción");
  if(campaigns.length>10&&!window.confirm("¿Descargar los Excel de "+campaigns.length+" promociones seleccionadas en un ZIP?"))return;
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
   if(selectedPharmacyIds!==null)params.set("farmacias",selectedPharmacyIds.join(","));
  const url="/promociones/seguimiento?"+params.toString();
  if(window.location.pathname+window.location.search!==url)window.history.replaceState({page},"",url);
 },[page,reportStatus,reportYear,reportSelectedIds,selectedPharmacyIds]);
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
 <div className="page-header"><div><h1>Promociones</h1><p>Crea campañas, asigna objetivos y consulta su seguimiento.</p></div>
    <div className="campaign-header-actions">
      <button className="btn btn-secondary" type="button" onClick={()=>setToast("Importación de Excel pendiente de definir cuando recibamos el archivo modelo. No se ha cargado ningún fichero.")}><Upload size={17}/> Importar Excel</button>
      {salesStatus==="real"&&<button className="btn btn-secondary" type="button" onClick={addLiveExample}><Database size={17}/> Ejemplo con 20 CNs reales</button>}
      <button className="btn btn-primary main-cta" onClick={()=>startPromo()}><Plus size={18}/> Nueva promoción</button>
    </div></div>
  <SalesNotice status={salesStatus} error={salesError} coverage={salesCoverage} canConnect={pharmacyBackendConfigured} onConnect={connectPharmacies}/>
 <CampaignMetrics campaigns={activePromos} heading="Promociones activas" subtitle="Indicadores de las campañas en curso" salesLabel={salesStatus==="real"?"Unidades netas · Farmatic":"Sin conexión real"} />
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
 <div className="note data-note"><CircleHelp size={16}/> Las promociones existentes siguen siendo ejemplos guardados en el navegador. Las cifras de ventas solo son reales si se confirma conexión a Farmatic.</div>
</>}
{page==="seguimiento-global"&&<>
 <div className="page-header report-page-header">
  <div>
   <h1>Seguimiento</h1><p>Consulta de un vistazo el avance de tus campañas y farmacias hacia sus objetivos.</p></div>
  <div className="campaign-header-actions">
   <button className="btn btn-secondary" onClick={openReportFilters}><Filter size={17}/> Filtrar campañas <span className="report-button-count">{reportSelected.length}</span></button>
   <button className="btn btn-primary" disabled={!reportSelected.length} onClick={()=>{if(reportSelected.length===1){void exportPromo(reportSelected[0]);}else{void exportAllPromos(reportSelected);}}}>
    <ArrowDownToLine size={17}/>{reportSelected.length===1?"Descargar Excel":reportSelected.length?"Descargar "+reportSelected.length+" Excel (ZIP)":"Selecciona campañas"}
   </button>
  </div>
 </div>
 <div className="report-active-summary">
  <div className="report-scope-info"><span className="scope-indicator"/><strong>{reportSelected.length} {reportSelected.length===1?"promoción seleccionada":"promociones seleccionadas"}</strong><span className="report-scope-separator">·</span><span>{reportStatus==="Activa"?"Activas":reportStatus==="Finalizada"?"Finalizadas":reportStatus==="Borrador"?"Borradores":"Todos los estados"}</span>{reportYear!=="Todos"&&<span>· {reportYear}</span>}</div>
  <div className="report-quick-pharmacy" ref={pharmacySelectorRef}><Store size={15}/><span>Farmacias</span><div className="report-pharmacy-dropdown">
   <button className="report-pharmacy-trigger" type="button" aria-haspopup="true" aria-expanded={pharmacySelectorOpen} aria-controls="report-pharmacy-options" onClick={()=>setPharmacySelectorOpen(v=>!v)}>
    <span>{selectedPharmacyIds===null?"Todas las farmacias":effectivePharmacyIds.length===1?pharmaName(effectivePharmacyIds[0]):effectivePharmacyIds.length+" farmacias seleccionadas"}</span><ChevronDown size={15}/>
   </button>
   {pharmacySelectorOpen&&<div className="report-pharmacy-menu" id="report-pharmacy-options" role="group" aria-label="Seleccionar farmacias del seguimiento">
    <div className="report-pharmacy-menu-head"><strong>Filtrar por farmacias</strong><button type="button" className="icon-btn" aria-label="Cerrar selección de farmacias" onClick={()=>setPharmacySelectorOpen(false)}><X size={15}/></button></div>
    <label className="report-pharmacy-option"><input type="checkbox" checked={selectedPharmacyIds===null} onChange={()=>setSelectedPharmacyIds(null)}/><span>Todas las farmacias</span></label>
    <div className="report-pharmacy-menu-divider"/>
    {pharmacies.filter(f=>reportPharmacyIds.includes(f.id)).map(f=><label key={f.id} className="report-pharmacy-option">
     <input type="checkbox" checked={selectedPharmacyIds!==null&&selectedPharmacyIds.includes(f.id)} onChange={()=>toggleReportPharmacy(f.id)}/><span>{f.name}</span>
    </label>)}
    <div className="report-pharmacy-menu-foot"><small>{selectedPharmacyIds===null?"Todas incluidas":effectivePharmacyIds.length+" de "+reportPharmacyIds.length+" seleccionadas"}</small><button type="button" className="btn btn-primary btn-sm" onClick={()=>setPharmacySelectorOpen(false)}>Listo</button></div>
   </div>}
  </div></div>
 </div>
 {reportSelected.length>0?<>
  <CampaignMetrics campaigns={reportFilteredCampaigns} heading={reportSelected.length===1?reportSelected[0].name:"Resumen de "+reportSelected.length+" campañas"} subtitle={selectedPharmacyIds===null?"Seguimiento consolidado de las promociones seleccionadas":effectivePharmacyIds.length===1?"Resultados de "+pharmaName(effectivePharmacyIds[0]):"Resultados de "+effectivePharmacyIds.length+" farmacias seleccionadas"} salesLabel={salesStatus==="real"?"Unidades netas · Farmatic":"Sin conexión real"} />
  <section className="card report-pharmacy-totals report-pharmacy-highlight">
   <div className="report-consolidated-head"><div className="report-consolidated-icon"><Store size={23}/></div><div className="report-consolidated-title"><h2>Consolidado por farmacia</h2><p>Objetivos y ventas acumulados de las promociones seleccionadas, agrupados por farmacia.</p></div><span className="report-consolidated-count">{reportTargets.length} farmacias</span></div>
   <div className="report-consolidated-stats"><div><span>Objetivo conjunto</span><strong>{EUR.format(reportGoal)} uds.</strong></div><div><span>Unidades vendidas</span><strong>{EUR.format(reportSales)} uds.</strong></div><div><span>Avance global</span><strong>{percent(reportSales,reportGoal)}%</strong></div></div>
   <div className="goal-pharmacy-summary">{reportTargets.map(([id,target])=><div className="goal-summary-line" key={id}><div className="goal-summary-name"><Store size={15}/><strong>{pharmaName(id)}</strong></div><GoalProgressBar goal={Number(target)} sold={Number(combinedReport.sales?.[id]||0)}/></div>)}{!reportTargets.length&&<div className="report-choice-empty">No hay farmacias con objetivos en la selección.</div>}</div>
  </section>
  <section className="card report-goals-panel">
   <div className="section-heading goal-panel-title"><div><h2>Avance hacia los objetivos</h2><p>Despliega cada promoción para conocer el progreso de las farmacias. Todas las barras llegan al 100 % en el extremo derecho.</p></div><span className="count-label">{reportFilteredCampaigns.length} campañas</span></div>
   <div className="goal-chart-legend"><span className="goal-legend-fill"/><span>Vendido respecto al objetivo</span><span className="goal-legend-marker"/> <span>Meta 100 %</span><span className="goal-legend-over">≥100 %</span><span>Objetivo alcanzado</span></div>
   <div className="goal-accordion-actions"><button type="button" onClick={()=>setExpandedCampaignIds(reportFilteredCampaigns.map(p=>p.id))}>Desplegar todas</button><span>·</span><button type="button" onClick={()=>setExpandedCampaignIds([])}>Plegar todas</button></div>
   <div className="goal-campaign-list">{!reportFilteredCampaigns.length&&<div className="report-choice-empty">Ninguna campaña de esta selección incluye las farmacias filtradas.</div>}{reportFilteredCampaigns.slice(0,reportDetailLimit).map(p=><CampaignGoalCard key={p.id} promo={p} pharmaName={pharmaName} expanded={expandedCampaignIds.includes(p.id)} onToggle={()=>toggleCampaignExpanded(p.id)} singlePharmacy={effectivePharmacyIds.length===1}/>)}</div>
   {reportFilteredCampaigns.length>reportDetailLimit&&<button className="report-more-goals" type="button" onClick={()=>setReportDetailLimit(v=>v+15)}><ChevronDown size={17}/> Mostrar {Math.min(15,reportFilteredCampaigns.length-reportDetailLimit)} campañas más</button>}
  </section>
  <section className="card campaign-cn-panel">
   <div className="section-heading"><div><h2>CNs incluidos</h2><p>Referencias únicas de seis dígitos del conjunto seleccionado</p></div><span className="count-label">{reportCNs.length} CNs</span></div>
   <div className="cn-chips">{reportCNs.slice(0,45).map(cn=><span key={cn} className="cn-chip">{cn}</span>)}{reportCNs.length>45&&<span className="cn-chip">+{reportCNs.length-45} más</span>}</div>
  </section>
 </>:<section className="card report-empty-state"><Package size={27}/><h2>Selecciona alguna campaña para ver su seguimiento</h2><p>Puedes marcar una, varias o todas las que aparezcan en los filtros.</p></section>}
 <SalesNotice status={salesStatus} error={salesError} coverage={salesCoverage} canConnect={pharmacyBackendConfigured} onConnect={connectPharmacies}/>
</>}
{page==="farmacias"&&<><div className="page-header"><div><h1>Maestro de farmacias</h1><p>Configura los identificadores y servidores de origen de cada farmacia.</p></div><div className="pharmacy-header-actions">{pharmacyBackendConfigured&&pharmacyApiStatus!=="connected"&&<button className="btn btn-secondary" onClick={connectPharmacies}><ShieldCheck size={17}/> Conectar Microsoft 365</button>}<button className="btn btn-primary" onClick={()=>startPharmacy()} disabled={pharmacyBackendConfigured&&pharmacyApiStatus!=="connected"}><Plus size={17}/> Nueva farmacia</button></div></div>{pharmacyApiStatus==="connected"?<div className="note"><CheckCircle2 size={17}/> Maestro conectado a PostgreSQL. Los cambios se guardan para todos los administradores.</div>:<div className="note"><CircleHelp size={17}/>{pharmacyBackendConfigured?(pharmacyApiError||"Inicia sesión para consultar y modificar las farmacias reales."):"Modo demostración. Falta configurar Microsoft Entra ID y desplegar la API para activar PostgreSQL."}</div>}<div className="kpi-grid small-kpis"><Kpi icon={Store} title="Farmacias" value={pharmacies.length} caption="Total en el maestro"/><Kpi icon={CheckCircle2} title="Activas" value={pharmacies.filter(f=>f.active).length} caption="En funcionamiento"/><Kpi icon={Users} title="Usuarios asignados" value={users.filter(u=>u.role!=="superadmin").length} caption="En la red"/></div><div className="full-width-grid"><div className="card list-card"><div className="section-heading"><div><h2>Listado de farmacias</h2><p>Identificadores utilizados por las importaciones</p></div></div><div className="toolbar"><div className="search-wrap"><Search size={17}/><input placeholder="Buscar por código, nombre o ciudad..." value={search} onChange={e=>setSearch(e.target.value)}/></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>ID</th><th>Nombre público</th><th>Origen</th><th>Servidor SQL</th><th>Estado</th><th>Usuarios</th><th/></tr></thead><tbody>{currentPharmacies.map(f=><tr key={f.id} onClick={()=>startPharmacy(f)} className="click-row"><td><span className="id-code">{f.id}</span></td><td><div className="pharma-cell"><span className="store-mini"><Store size={16}/></span><strong>{f.name}</strong></div></td><td><span className="id-code">{f.sourceCode||"—"}</span></td><td>{pharmacyApiStatus==="connected"?(f.sourceHost||"Servidor local"):"— (demo)"}</td><td><Pill status={f.active?"Activa":"Inactiva"}/></td><td>{users.filter(u=>u.role==="superadmin"||u.pharmacies.includes(f.id)).length}</td><td><Pencil size={16} className="muted"/></td></tr>)}</tbody></table></div></div></div></>}
    {page==="usuarios"&&<><div className="page-header"><div><h1>Gestión de usuarios</h1><p>Organiza los roles y las farmacias asignadas a cada usuario.</p></div><button className="btn btn-primary" onClick={()=>startUser()}><Plus size={17}/> Nuevo usuario</button></div><div className="kpi-grid small-kpis"><Kpi icon={Users} title="Usuarios" value={users.length} caption="Registrados"/><Kpi icon={CheckCircle2} title="Activos" value={users.filter(u=>u.active).length} caption="Con acceso"/><Kpi icon={ShieldCheck} title="Roles" value="3" caption="Perfiles definidos" kind="blue"/></div><div className="content-grid admin-grid"><div className="card list-card"><div className="section-heading"><div><h2>Usuarios del sistema</h2><p>Identidad, permisos y farmacias asignadas</p></div></div><div className="toolbar"><div className="search-wrap"><Search size={17}/><input placeholder="Buscar usuario, correo o rol..." value={search} onChange={e=>setSearch(e.target.value)}/></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Usuario</th><th>Rol</th><th>Farmacias</th><th>Estado</th><th/></tr></thead><tbody>{currentUsers.map(u=><tr className="click-row" key={u.id} onClick={()=>startUser(u)}><td><div className="user-cell"><span className="avatar avatar-soft">{u.name.split(" ").slice(0,2).map(x=>x[0]).join("")}</span><div><strong>{u.name}</strong><small>{u.email}</small></div></div></td><td><span className={"role-pill role-"+u.role}>{ROLES[u.role]}</span></td><td>{u.role==="superadmin"?"Todas":u.pharmacies.map(pharmaName).join(", ")||"—"}</td><td><Pill status={u.active?"Activa":"Inactiva"}/></td><td><Pencil size={16} className="muted"/></td></tr>)}</tbody></table></div></div><div className="card role-card"><div className="section-heading"><div><h2>Roles del sistema</h2><p>Tres niveles de acceso</p></div></div><div className="role-desc"><span className="role-icon role-bg-green"><Store/></span><div><strong>Personal de farmacia</strong><p>Consulta únicamente sus farmacias y el seguimiento asignado.</p></div></div><div className="role-desc"><span className="role-icon role-bg-blue"><Users/></span><div><strong>Gestor de farmacias</strong><p>Gestiona promociones y usuarios de las farmacias asignadas.</p></div></div><div className="role-desc"><span className="role-icon role-bg-purple"><ShieldCheck/></span><div><strong>Superadministrador</strong><p>Administra toda la red, usuarios, códigos y configuración.</p></div></div></div></div></>}
    {page==="ajustes"&&<><div className="page-header"><div><h1>Ajustes</h1><p>Estado del prototipo y próximas integraciones.</p></div></div><div className="settings-grid"><div className="card settings-card"><span className="settings-icon"><ShieldCheck/></span><h2>Microsoft 365</h2><p>Inicio de sesión con el tenant y control real de roles por farmacia.</p><span className="soon">Próxima fase</span></div><div className="card settings-card"><span className="settings-icon"><RefreshCcw/></span><h2>Sincronización de ventas</h2><p>SQL Server → PostgreSQL, con cargas iniciales e incrementales y trazabilidad.</p><span className="soon">Pendiente de conexión</span></div><div className="card settings-card"><span className="settings-icon"><Activity/></span><h2>Asistente con IA</h2><p>Chat con consultas validadas para analizar beneficios y ventas reales.</p><span className="soon">Futura fase</span></div></div></>}
   </main>
   <footer className="app-footer"><span>© 2026 Farmetrica · Prototipo visual</span><span>Datos simulados · No conectado a ventas reales</span></footer>
  </div>
  {reportModal&&<div className="report-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setReportModal(null)}}>
   <section className="report-modal" role="dialog" aria-modal="true" aria-labelledby="report-modal-title">
    <div className="report-modal-top">
     <div><h2 id="report-modal-title">Filtrar campañas</h2><p>Selecciona las promociones que quieres incluir en tus indicadores y gráficos.</p></div>
     <button className="icon-btn report-modal-close" ref={reportCloseRef} onClick={()=>setReportModal(null)} aria-label="Cancelar y cerrar filtros" title="Cerrar sin aplicar"><X size={23}/></button>
    </div>
    <div className="report-modal-body">
     <div className="report-modal-filters">
      <Field label="Estado"><select value={reportModal.status} onChange={e=>updateDraftScope(e.target.value,reportModal.year)}>
       <option value="Activa">Activas</option><option value="Finalizada">Finalizadas</option><option value="Borrador">Borradores</option><option value="Todos">Todos los estados</option>
      </select></Field>
      <Field label="Año de inicio"><select value={reportModal.year} onChange={e=>updateDraftScope(reportModal.status,e.target.value)}>
       <option value="Todos">Todos los años</option>{reportYears.map(year=><option value={year} key={year}>{year}</option>)}
      </select></Field>
      <Field label="Buscar por promoción o CN"><input type="search" placeholder="Nombre, código o CN…" value={reportModal.search} onChange={e=>setReportModal(prev=>({...prev,search:e.target.value,limit:25}))}/></Field>
     </div>
     <div className="report-modal-selection-head">
      <label className="report-select-all"><input type="checkbox" disabled={!draftVisible.length} checked={draftVisible.length>0&&draftVisible.every(p=>reportModal.ids.includes(p.id))} onChange={e=>e.target.checked?selectDraftAll(draftVisible):clearDraftVisible(draftVisible)}/> Seleccionar todas las campañas filtradas</label>
      <span>{draftFilterBase.filter(p=>reportModal.ids.includes(p.id)).length} elegidas · {draftVisible.length} resultados</span>
      <button type="button" className="report-modal-clear" disabled={!draftVisible.some(p=>reportModal.ids.includes(p.id))} onClick={()=>clearDraftVisible(draftVisible)}>Limpiar visibles</button>
     </div>
     <div className="report-modal-campaigns">
      {draftVisible.slice(0,reportModal.limit).map(p=><label className={"report-choice "+(reportModal.ids.includes(p.id)?"report-choice-checked":"")} key={p.id}>
       <input type="checkbox" checked={reportModal.ids.includes(p.id)} onChange={()=>toggleDraftCampaign(p.id)}/>
       <span className="report-choice-body"><strong>{p.name}</strong><small>{dateES(p.start)} — {dateES(p.end)} · {p.cns.length} CN · {Object.keys(p.targets||{}).length} farmacias</small></span><Pill status={p.status}/>
      </label>)}
      {!draftVisible.length&&<div className="report-choice-empty">No hay campañas para los filtros seleccionados. Prueba con otro estado, año o búsqueda.</div>}
     </div>
     {draftVisible.length>reportModal.limit&&<button className="report-more" type="button" onClick={()=>setReportModal(prev=>({...prev,limit:prev.limit+25}))}><ChevronDown size={16}/> Ver otras {Math.min(25,draftVisible.length-reportModal.limit)} campañas</button>}
    </div>
    <div className="report-modal-bottom">
     <div className="report-modal-bottom-info"><strong>{draftFilterBase.filter(p=>reportModal.ids.includes(p.id)).length} {draftFilterBase.filter(p=>reportModal.ids.includes(p.id)).length===1?"campaña seleccionada":"campañas seleccionadas"}</strong><small>Los cambios se mostrarán al pulsar Aplicar filtros.</small></div>
     <div className="report-modal-actions"><button className="btn btn-secondary" onClick={()=>setReportModal(null)}>Cancelar</button><button className="btn btn-primary" onClick={applyReportFilters}><Check size={17}/> Aplicar filtros y visualizar</button></div>
    </div>
   </section>
  </div>}
  {editingPromo&&<div className="drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setEditingPromo(null)}}><div className="drawer"><div className="drawer-top"><div><h2>{editingPromo==="nuevo"?"Nueva promoción":"Editar promoción"}</h2><p>Configura productos y objetivos de venta por farmacia.</p></div><button className="icon-btn" aria-label="Cerrar" onClick={()=>setEditingPromo(null)}><X size={21}/></button></div><form onSubmit={savePromo} className="drawer-content">
   <Field label="Nombre de promoción"><input required placeholder="Ej.: Especial hidratación" value={promoForm.name} onChange={e=>setPromoForm({...promoForm,name:e.target.value})}/></Field>
   <Field label="Descripción"><textarea rows="3" placeholder="¿En qué consiste esta campaña?" value={promoForm.description} onChange={e=>setPromoForm({...promoForm,description:e.target.value})}/></Field>
   <div className="field-row"><Field label="Fecha de inicio"><input type="date" required value={promoForm.start} onChange={e=>setPromoForm({...promoForm,start:e.target.value})}/></Field><Field label="Fecha de fin"><input type="date" required value={promoForm.end} onChange={e=>setPromoForm({...promoForm,end:e.target.value})}/></Field></div>
   <Field label="Estado"><select value={promoForm.status} onChange={e=>setPromoForm({...promoForm,status:e.target.value})}><option>Activa</option><option>Borrador</option><option>Finalizada</option></select></Field>
    <Field label="Tipo de promoción"><select value={promoForm.type||"sin_clasificar"} onChange={e=>setPromoForm({...promoForm,type:e.target.value,discountPercent:PROMOTION_TYPES.find(t=>t.id===e.target.value)?.needsPercent?promoForm.discountPercent:""})}>{PROMOTION_TYPES.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
    {PROMOTION_TYPES.find(t=>t.id===promoForm.type)?.needsPercent&&<Field label="Porcentaje de descuento (%)"><input type="number" min="0.01" max="100" step="0.01" placeholder="Ej.: 50" value={promoForm.discountPercent} onChange={e=>setPromoForm({...promoForm,discountPercent:e.target.value})}/></Field>}
   <div className="form-divider"/><div className="field-heading"><div><strong>CNs (6 dígitos)</strong><small>Introduce un CN por línea o sepáralos por comas o espacios. Solo seis números, sin puntos.</small></div><span className="soft-counter">{cnParsed.length} CNs</span></div><textarea rows="5" className="cn-area" placeholder={"184579\n188456\n192334"} value={cnText} onChange={e=>setCnText(e.target.value)}/>{cnParsed.some(cn=>!isValidCN(cn))?<div className="parse-info cn-format-error"><CircleHelp size={15}/> Hay CNs incorrectos. Cada CN debe tener exactamente 6 dígitos, sin puntos ni letras.</div>:<div className="parse-info"><CheckCircle2 size={15}/> CNs válidos de 6 dígitos. Eliminamos automáticamente los duplicados.</div>}
   <div className="form-divider"/><div className="field-heading"><div><strong>Farmacias participantes</strong><small>Selecciona las farmacias incluidas en la promoción.</small></div><span className="soft-counter">{Object.keys(promoForm.targets).length} elegidas</span></div>
   <div className="pharmacy-picker">{pharmacies.filter(f=>f.active||f.id in promoForm.targets).map(f=><label key={f.id} className={"pharmacy-choice "+(f.id in promoForm.targets?"chosen":"")}><input type="checkbox" checked={f.id in promoForm.targets} onChange={()=>togglePromoPharmacy(f.id)}/><span className="choice-check">{f.id in promoForm.targets&&<Check size={14}/>}</span><span>{f.name}</span><small>{f.id}</small></label>)}</div>
   {Object.keys(promoForm.targets).length>0&&<div className="target-list"><div className="target-head"><strong>Objetivos por farmacia</strong><div className="increase-controls"><label>Incremento <input type="number" step="0.5" min="-100" max="500" value={targetIncrease} onChange={e=>setTargetIncrease(e.target.value)} aria-label="Incremento porcentual"/> %</label><button type="button" onClick={applyIncrease}>Aplicar</button></div></div>{Object.entries(promoForm.targets).map(([id,value])=><div className="target-row" key={id}><div><strong>{pharmaName(id)}</strong><small>{id}</small></div><div className="numeric-input"><input type="number" min="0" value={value} onChange={e=>setPromoForm({...promoForm,targets:{...promoForm.targets,[id]:e.target.value}})} aria-label={"Objetivo "+pharmaName(id)}/><span>uds.</span></div></div>)}<div className="target-total"><span>Objetivo total</span><strong>{EUR.format(sum(promoForm.targets))} uds.</strong></div><small className="hint">Deja el objetivo vacío mientras sea borrador. Introduce valores base y pulsa Aplicar para incrementar el porcentaje; cambiar el campo no altera los objetivos hasta pulsar el botón. El cálculo desde histórico se añadirá más adelante.</small></div>}
   <FormActions onCancel={()=>setEditingPromo(null)} label={editingPromo==="nuevo"?"Crear promoción":"Guardar cambios"}/>
   {editingPromo!=="nuevo"&&<div className="drawer-extra"><button type="button" className="btn btn-secondary" onClick={()=>{const p={...promoForm};setEditingPromo(null);copyPromo(p)}}><Copy size={16}/> Duplicar promoción</button><button type="button" className="btn btn-secondary" onClick={()=>exportPromo(promoForm)}><ArrowDownToLine size={16}/> Exportar para Excel</button></div>}
  </form></div></div>}
  {editingUser&&<div className="drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setEditingUser(null)}}><div className="drawer"><div className="drawer-top"><div><h2>{editingUser==="nuevo"?"Nuevo usuario":"Editar usuario"}</h2><p>Asigna un rol y define las farmacias disponibles.</p></div><button className="icon-btn" onClick={()=>setEditingUser(null)} aria-label="Cerrar"><X/></button></div><form onSubmit={saveUser} className="drawer-content"><Field label="Nombre completo"><input required value={userForm.name} onChange={e=>setUserForm({...userForm,name:e.target.value})}/></Field><Field label="Correo electrónico"><input type="email" required value={userForm.email} onChange={e=>setUserForm({...userForm,email:e.target.value})}/></Field><Field label="Rol"><select value={userForm.role} onChange={e=>setUserForm({...userForm,role:e.target.value})}><option value="farmacia">Personal de farmacia</option><option value="gestor">Gestor de farmacias</option><option value="superadmin">Superadministrador</option></select></Field><Field label="Estado"><select value={String(userForm.active)} onChange={e=>setUserForm({...userForm,active:e.target.value==="true"})}><option value="true">Activo</option><option value="false">Inactivo</option></select></Field><div className="form-divider"/><div className="field-heading"><div><strong>Farmacias asignadas</strong><small>{userForm.role==="superadmin"?"Este rol tiene acceso a toda la red.":"Marca las farmacias a las que podrá acceder."}</small></div></div>{userForm.role!=="superadmin"&&<div className="pharmacy-picker">{pharmacies.map(f=><label key={f.id} className={"pharmacy-choice "+(userForm.pharmacies.includes(f.id)?"chosen":"")}><input type="checkbox" checked={userForm.pharmacies.includes(f.id)} onChange={()=>setUserForm({...userForm,pharmacies:userForm.pharmacies.includes(f.id)?userForm.pharmacies.filter(x=>x!==f.id):[...userForm.pharmacies,f.id]})}/><span className="choice-check">{userForm.pharmacies.includes(f.id)&&<Check size={14}/>}</span><span>{f.name}</span><small>{f.id}</small></label>)}</div>}<div className="note small-note"><ShieldCheck size={16}/> Estas asignaciones son solo visuales hasta habilitar autenticación y autorización en el servidor.</div><FormActions onCancel={()=>setEditingUser(null)}/></form></div></div>}
  {editingPharmacy&&<div className="drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setEditingPharmacy(null)}}><div className="drawer"><div className="drawer-top"><div><h2>{editingPharmacy==="nuevo"?"Nueva farmacia":"Editar farmacia"}</h2><p>El ID es numérico y debe coincidir con los datos importados.</p></div><button className="icon-btn" onClick={()=>setEditingPharmacy(null)} aria-label="Cerrar"><X/></button></div><form onSubmit={savePharmacy} className="drawer-content"><Field label="ID numérico de farmacia"><input required disabled={editingPharmacy!=="nuevo"} placeholder="6" value={pharmacyForm.id} onChange={e=>setPharmacyForm({...pharmacyForm,id:e.target.value})}/></Field><Field label="Nombre público"><input required placeholder="Farmacia Plaza Mayor" value={pharmacyForm.name} onChange={e=>setPharmacyForm({...pharmacyForm,name:e.target.value})}/></Field><Field label="Ciudad (opcional)"><input value={pharmacyForm.city} onChange={e=>setPharmacyForm({...pharmacyForm,city:e.target.value})}/></Field><Field label="Código de origen (ABA / EUR / BUE…)"><input required placeholder="ABA" maxLength="16" value={pharmacyForm.sourceCode||""} onChange={e=>setPharmacyForm({...pharmacyForm,sourceCode:e.target.value})}/></Field><Field label="Host/IP SQL Server"><input placeholder="Vacío para servidor local" value={pharmacyForm.sourceHost||""} onChange={e=>setPharmacyForm({...pharmacyForm,sourceHost:e.target.value})}/></Field><Field label="Base de datos de origen"><input required value={pharmacyForm.sourceDatabase||""} onChange={e=>setPharmacyForm({...pharmacyForm,sourceDatabase:e.target.value})}/></Field><div className="note small-note"><ShieldCheck size={16}/> Guarda solo el servidor. No introduzcas contraseñas aquí.</div><Field label="Estado"><select value={String(pharmacyForm.active)} onChange={e=>setPharmacyForm({...pharmacyForm,active:e.target.value==="true"})}><option value="true">Activa</option><option value="false">Inactiva</option></select></Field><FormActions onCancel={()=>setEditingPharmacy(null)} label={savingPharmacy?"Guardando…":"Guardar cambios"} disabled={savingPharmacy}/></form></div></div>}
  {toast&&<div className="toast"><CheckCircle2 size={18}/>{toast}<button onClick={()=>setToast("")}><X size={16}/></button></div>}
 </div>
}
function GoalProgressBar({goal,sold}){
 const pct=goal>0?Math.round(sold/goal*100):null;
 const width=pct===null?0:Math.max(0,Math.min(100,pct));
 const remaining=goal>0?Math.max(0,goal-sold):null;
 const tone=pct===null?"empty":pct>=100?"done":pct>=80?"near":pct>=50?"mid":"low";
 const detail=pct===null?"Sin objetivo":remaining>0?"Faltan "+EUR.format(remaining)+" uds.":pct>100?"Superado en "+EUR.format(sold-goal)+" uds.":"Objetivo cumplido";
 return <div className={"goal-progress goal-"+tone}>
  <div className="goal-track-wrap">
   <div className="goal-track" role="progressbar" aria-label={pct===null?"Sin objetivo":"Cumplimiento del objetivo"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={width} aria-valuetext={pct===null?"Sin objetivo":pct+" por ciento, "+EUR.format(sold)+" de "+EUR.format(goal)+" unidades"}>
    <div className="goal-track-fill" style={{width:width+"%"}}/>
    <span className="goal-target-line"/>
   </div>
   <span className={"goal-pct "+(pct!==null&&pct>=100?"is-done":"")}>{pct===null?"—":pct+"%"}</span>
  </div>
  <div className="goal-progress-meta"><span>{EUR.format(sold)} / {EUR.format(goal)} uds.</span><span>{detail}</span></div>
 </div>;
}
function CampaignGoalCard({promo,pharmaName,expanded,onToggle,singlePharmacy=false}){
 const goal=sum(promo.targets),sold=sum(promo.sales),entries=Object.entries(promo.targets||{});
 const campaignPercent=goal>0?percent(sold,goal):null;
 return <article className={"goal-campaign-card "+(expanded?"goal-campaign-open":"goal-campaign-closed")}>
  <button type="button" className="goal-campaign-heading goal-campaign-toggle" aria-expanded={expanded} onClick={onToggle} aria-label={(expanded?"Plegar ":"Desplegar ")+promo.name}>
   <span className="goal-campaign-title"><span className="goal-icon"><Tag size={17}/></span><span className="goal-title-copy"><strong>{promo.name}</strong><small>{entries.length} {entries.length===1?"farmacia":"farmacias"} · {promo.cns.length} CN · {promo.id}</small></span></span>
   <span className="goal-campaign-side"><span className={"goal-accordion-pct "+(campaignPercent!==null&&campaignPercent>=100?"achieved":"")}>{campaignPercent===null?"Sin objetivo":campaignPercent+"%"}</span><Pill status={promo.status}/><ChevronDown size={18} className={"goal-chevron "+(expanded?"expanded":"")}/></span>
  </button>
  {expanded&&<div className="goal-campaign-expanded">
   {singlePharmacy?
    <div className="goal-campaign-total goal-single-pharmacy"><div className="goal-group-label"><span>{entries.length?pharmaName(entries[0][0]):"Farmacia sin objetivo"}</span><span className="goal-100-label">META 100 % <span className="goal-flag"/></span></div><GoalProgressBar goal={goal} sold={sold}/></div>
    :<>
     <div className="goal-campaign-total"><div className="goal-group-label"><span>Objetivo total de la promoción</span><span className="goal-100-label">META 100 % <span className="goal-flag"/></span></div><GoalProgressBar goal={goal} sold={sold}/></div>
     <div className="goal-farmacies-list">{entries.map(([id,value])=><div key={id} className="goal-farm-row"><div className="goal-farm-name"><Store size={14}/><span>{pharmaName(id)}</span></div><GoalProgressBar goal={Number(value)||0} sold={Number(promo.sales?.[id]||0)}/></div>)}{!entries.length&&<p className="goal-no-pharmacies">No hay farmacias con objetivos para esta selección.</p>}</div>
    </>}
  </div>}
 </article>;
}
createRoot(document.getElementById("root")).render(<App/>);