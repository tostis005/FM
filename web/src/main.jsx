import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity, ArrowDownToLine, ArrowRight, Bell, CalendarDays, Check, CheckCircle2, ChevronDown,
  ChevronRight, CircleHelp, ClipboardList, Clock3, Filter, Home, LayoutDashboard, LogOut,
  MoreHorizontal, Pencil, Plus, Search, Settings2, ShieldCheck, Sparkles, Store, Tag, Target,
  Trash2, TrendingUp, Users, X, BarChart3, Package, Copy, RefreshCcw, Upload, Database, Mail
} from "lucide-react";
import "./styles.css";
import "./loginTheme.css";
import AccessAdmin from "./Accesos.jsx";
import ModuloDemo from "./ModuloDemo.jsx";
import {promotionMetrics} from "./promotionMetrics.js";
import ProveedoresMaestro from "./ProveedoresMaestro.jsx";
import {ClientesPanel,EquipoCliente} from "./AdministracionSaas.jsx";
import DetalleVentas from "./DetalleVentas.jsx";
import SolicitudesDemo from "./SolicitudesDemo.jsx";
import ListTable, {ListPagination} from "./ListTable.jsx";
import { readPromotionExcel, mergeImportedPromos } from "./importarPromociones.js";
import { applyObjectiveRows } from "./objetivosImportacion.js";
import { OCTOBER_2026_OBJECTIVE_ROWS, OCTOBER_2026_OBJECTIVES_VERSION } from "./objetivosOctubre2026.js";
import { REAL_OCTOBER_EXAMPLES } from "./promocionesRealesOctubre.js";
import { parseCNs, isValidCN, normalizeStoredCNs } from "./cns.js";
import { exportPromotionExcel, exportLabSalesExcel, exportLabSalesZip } from "./exportaciones.js";
import {validateLabPromotion,readFullLabSales} from "./laboratoryExport.js";
import { pharmacyBackendConfigured, hasPharmacySession, signInPharmacies, loadPharmacies, savePharmacyToServer, loadPromotionSales, loadTicketLines } from "./farmaciasApi.js";

const DEFAULT_PHARMACIES = [
  {id:"1",name:"Abadía",city:"",active:true,sourceCode:"ABA",sourceHost:"",sourceDatabase:"Farmatic"},
  {id:"2",name:"Europa",city:"",active:true,sourceCode:"EUR",sourceHost:"",sourceDatabase:"Farmatic"},
  {id:"3",name:"Buenavista",city:"",active:true,sourceCode:"BUE",sourceHost:"",sourceDatabase:"Farmatic"},
  {id:"4",name:"Estación",city:"",active:true,sourceCode:"EST",sourceHost:"",sourceDatabase:"Farmatic"},
  {id:"5",name:"Valdemarías",city:"",active:true,sourceCode:"POL",sourceHost:"",sourceDatabase:"Farmatic"}
];
const EMPTY_PROMO = {id:null,name:"",subtitle:"",description:"",status:"Borrador",start:"2026-10-16",end:"2026-11-30",cns:[],targets:{},sales:{},type:"sin_clasificar",discountPercent:""};
const PROMOTION_TYPES = [
  {id:"sin_clasificar",name:"Sin clasificar"},
  {id:"dos_por_uno",name:"2×1"},
  {id:"tres_por_dos",name:"3×2"},
  {id:"segunda_porcentaje",name:"Segunda unidad al X %",needsPercent:true},
  {id:"descuento_porcentaje",name:"Descuento del X %",needsPercent:true},
  {id:"precio_especial",name:"Precio especial"},
  {id:"otras_unidades",name:"Unidades extra (4+1 / 3+1)"},
  {id:"descuento_importe",name:"Descuento fijo en euros",needsAmount:true},
  {id:"segunda_importe",name:"Importe descontado en segunda unidad",needsAmount:true},
  {id:"regalo",name:"Regalo por compra"},
  {id:"escalonado",name:"Descuento escalonado por cantidad"},
  {id:"otros",name:"Otros"}
];
const STORE_KEY = "farmetrica-prototype-v1";
const tenantStorageKey = (slug,email="") => {
 const id=String(email).trim().toLowerCase();
 // Conservar las campañas de la cuenta propietaria existente al migrar.
 if(slug==="ampedia"&&id==="jose.fraga@gmail.com")return STORE_KEY;
 return STORE_KEY+":"+slug+":"+(id||"anonymous");
};
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
function readState(slug=localStorage.getItem("fm_active_tenant")||"ampedia",email=""){
  try {
    const saved=JSON.parse(localStorage.getItem(tenantStorageKey(slug,email)));
    if(saved && Array.isArray(saved.promos) && Array.isArray(saved.pharmacies) && Array.isArray(saved.users)) {
      const oldDemo=saved.pharmacies.length===5 && saved.pharmacies.every(f=>["Farmacia Central","Farmacia Sol","Farmacia Europa","Farmacia Gran Vía","Farmacia Norte"].includes(f.name));
      const pharmacies=oldDemo?DEFAULT_PHARMACIES:saved.pharmacies.map(f=>{
        const id=migratePharmacyId(f.id);
        const baseline=DEFAULT_PHARMACIES.find(p=>p.id===id);
        return {...baseline,...f,id,sourceCode:f.sourceCode||baseline?.sourceCode||"",sourceHost:f.sourceHost||"",sourceDatabase:f.sourceDatabase||"Farmatic"};
      });
      const existing=saved.promos.filter(p=>!["P100","P101","P102","P103","P104"].includes(String(p.id))).map(p=>({...p,cns:normalizeStoredCNs(p.cns),
        targets:migrateSalesOrTargets(p.targets),sales:{},type:p.type||"sin_clasificar",discountPercent:p.discountPercent??""}));
      // Migración por navegador, una sola vez: conservar campañas, CNs, estados y ventas.
      // Los objetivos del Excel prevalecen sobre las metas de demostración anteriores.
      const shouldUpdate=saved.objectiveSeedVersion!==OCTOBER_2026_OBJECTIVES_VERSION;
      const promos=shouldUpdate?applyObjectiveRows(existing,OCTOBER_2026_OBJECTIVE_ROWS).promotions:existing;
      return {...saved,pharmacies,promos:promos.length?promos:applyObjectiveRows(REAL_OCTOBER_EXAMPLES,OCTOBER_2026_OBJECTIVE_ROWS).promotions,
        objectiveSeedVersion:OCTOBER_2026_OBJECTIVES_VERSION,
        users:saved.users.map(u=>({...u,pharmacies:(u.pharmacies||[]).map(migratePharmacyId)})),
      };
    }
  }catch {}
  if(slug!=="ampedia")return {promos:[],pharmacies:[],users:[],objectiveSeedVersion:OCTOBER_2026_OBJECTIVES_VERSION};
  const seeded=applyObjectiveRows(REAL_OCTOBER_EXAMPLES,OCTOBER_2026_OBJECTIVE_ROWS).promotions;
  return {promos:seeded,pharmacies:DEFAULT_PHARMACIES,users:[],
    objectiveSeedVersion:OCTOBER_2026_OBJECTIVES_VERSION};
}
function downloadCSV(name, rows) {
  const csv="\ufeff"+rows.map(row=>row.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(";")).join("\r\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));a.download=name+".csv";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);
}
function Pill({status}){return <span className={"pill pill-"+status.toLowerCase()}><span className="pill-dot"/>{status}</span>;}
function Progress({value,wide=false}) {return <div className={"progress "+(wide?"progress-wide":"")}><div style={{width:Math.min(Math.max(value,0),100)+"%"}}/></div>}
function Kpi({icon:Icon,title,value,caption,kind="mint"}){return <div className="kpi card"><div className={"kpi-icon kpi-"+kind}><Icon size={23}/></div><div><div className="kpi-label">{title}</div><div className="kpi-value">{value}</div></div></div>}
function CampaignMetrics({campaigns,heading,salesAvailable=false}){
 const m=promotionMetrics(campaigns,salesAvailable);
 const show=value=>value==null?"—":EUR.format(value);
 return <section className="card campaign-metrics">
  <div className="campaign-metrics-header"><h2>{heading}</h2></div>
  <div className="campaign-metrics-grid">
   <div className="campaign-metric"><span>Promociones</span><strong>{show(m.promotions)}</strong></div>
   <div className="campaign-metric"><span>CNs</span><strong>{show(m.cnCount)}</strong></div>
   <div className="campaign-metric"><span>Objetivo</span><strong>{show(m.target)}</strong></div>
   <div className="campaign-metric"><span>Vendidas</span><strong>{show(m.units)}</strong></div>
   <div className="campaign-metric metric-progress"><span>Cumplimiento</span>
    <strong>{m.completion==null?"—":m.completion+"%"}</strong>{m.completion!=null&&<Progress value={m.completion}/>}
   </div>
  </div>
 </section>;
}
function Field({label,children,hint}) {return <label className="field"><span className="field-label">{label}</span>{children}{hint&&<small>{hint}</small>}</label>}
function FormActions({onCancel,label="Guardar cambios",disabled=false}){return <div className="form-actions"><button className="btn btn-secondary" type="button" onClick={onCancel}>Cancelar</button><button className="btn btn-primary" type="submit" disabled={disabled}><Check size={16}/>{label}</button></div>}
const NAV=[
 {id:"dashboard",label:"Dashboard",icon:LayoutDashboard,module:"dashboard"},
 {id:"promociones",label:"Promociones",icon:Tag,module:"promociones"},
 {id:"ventas",label:"Ventas",icon:TrendingUp,module:"ventas"},
 {id:"compras",label:"Compras",icon:BarChart3,module:"compras"},
 {id:"proveedores",label:"Proveedores",icon:Users,module:"proveedores"},
 {id:"stock",label:"Stock",icon:Package,module:"stock"},
 {id:"reposicion",label:"Reposición",icon:RefreshCcw,module:"reposicion"},
 {id:"genericos",label:"Genéricos",icon:Activity,module:"genericos"},
 {id:"rentabilidad",label:"Rentabilidad",icon:Target,module:"rentabilidad"},
 {id:"acciones",label:"Acciones",icon:ClipboardList,module:"acciones"},
 {id:"informes",label:"Informes",icon:ArrowDownToLine,module:"informes"},
 {id:"asistente",label:"Asistente IA",icon:Sparkles,module:"asistente"},
 {id:"farmacias",label:"Farmacias",icon:Store,admin:true},
 {id:"proveedores-maestro",label:"Maestro de proveedores",icon:Users,admin:true},
 {id:"usuarios",label:"Usuarios",icon:Users,admin:true},
 {id:"clientes",label:"Clientes",icon:Database,super:true},
 {id:"solicitudes",label:"Solicitudes",icon:Mail,super:true},
 {id:"accesos",label:"Accesos",icon:ShieldCheck,super:true},
 {id:"ajustes",label:"Ajustes",icon:Settings2,admin:true}
];
const DEMO_MODULES=new Set(["dashboard","ventas","compras","proveedores","stock","reposicion","genericos","rentabilidad","acciones","informes","asistente"]);
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
 const status=params.get("estado")||"Todos";
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
  const [pharmacyApiStatus,setPharmacyApiStatus]=useState("sin_sesion");
  const [sessionUser,setSessionUser]=useState(null);
  const [tenantContext,setTenantContext]=useState(null);
  const [authError,setAuthError]=useState("");
  async function loadContext(slug){
    const response=await fetch("/api/tenant/context"+(slug?"?cliente="+encodeURIComponent(slug):""),{
      credentials:"same-origin",cache:"no-store"});
    if(!response.ok)throw Error("No tienes acceso al cliente seleccionado");
    const ctx=await response.json();
    localStorage.setItem("fm_active_tenant",ctx.client.slug);
    setTenantContext(ctx);
    return ctx;
  }
  useEffect(()=>{
    let live=true;
    const selected=localStorage.getItem("fm_active_tenant")||"";
    fetch("/api/auth/me",{credentials:"same-origin",cache:"no-store"})
      .then(r=>r.ok?r.json():Promise.reject(Error("Sin sesión")))
      .then(async body=>{
        if(!body.user){window.location.replace("/login");return;}
        const ctx=await loadContext(selected).catch(()=>loadContext(""));
        if(live){setSessionUser(body.user);setData(readState(ctx.client.slug,body.user.email));}
      })
      .catch(e=>{if(live){setAuthError(e.message);if(e.message==="Sin sesión")window.location.replace("/login");}});
    return()=>{live=false};
  },[]);
  async function activateClient(slug){
    if(slug===tenantContext?.client.slug)return;
    try{
      const ctx=await loadContext(slug);
      setData(readState(ctx.client.slug,sessionUser?.email));
      setSalesStatus("sin_conexion");setSalesByPromotion({});
      const initial=ctx.modules.promociones||sessionUser?.role==="superadministrador"?"promociones":
        Object.keys(ctx.modules).find(key=>ctx.modules[key])||"farmacias";
      window.history.pushState({page:initial},"","/"+initial);
      setPage(initial);setMobileMenu(false);setAuthError("");
    }catch(e){setAuthError(e.message)}
  }
  async function signOut(){
    try{await fetch("/api/auth/logout",{method:"POST",credentials:"same-origin"});}
    finally{window.location.replace("/login");}
  }
  const [pharmacyApiError,setPharmacyApiError]=useState("");
  const [savingPharmacy,setSavingPharmacy]=useState(false);
 const [reportStatus,setReportStatus]=useState(()=>reportFiltersFromUrl().status);
 const [reportYear,setReportYear]=useState(()=>reportFiltersFromUrl().year);
  const [reportModal,setReportModal]=useState(null);
 const [reportPage,setReportPage]=useState(0);
 const [reportPageSize,setReportPageSize]=useState(10);
 const [reportListSearch,setReportListSearch]=useState("");
 const [reportListSort,setReportListSort]=useState("name");
 const [cnSearch,setCnSearch]=useState("");
 const [cnSort,setCnSort]=useState("asc");
 const [cnPage,setCnPage]=useState(0);
 const [cnPageSize,setCnPageSize]=useState(25);
 const [expandedCampaignIds,setExpandedCampaignIds]=useState(()=>data.promos.filter(p=>p.status==="Activa").slice(0,2).map(p=>p.id));
 const [selectedPharmacyIds,setSelectedPharmacyIds]=useState(()=>reportFiltersFromUrl().pharmacies);
 const [pharmacySelectorOpen,setPharmacySelectorOpen]=useState(false);
 const pharmacySelectorRef=useRef(null);
 const reportCloseRef=useRef(null);
 const [reportSelectedIds,setReportSelectedIds]=useState(()=>{
  const ids=reportFiltersFromUrl().ids;
  return ids===null?data.promos.map(p=>p.id):ids;
 });
  const [salesStatus,setSalesStatus]=useState("sin_conexion");
  const [salesError,setSalesError]=useState("");
  const [salesByPromotion,setSalesByPromotion]=useState({});
  const [targetIncrease,setTargetIncrease]=useState("5");
  const importFileRef=useRef(null);
  const [importBusy,setImportBusy]=useState(false);
  const [labExportBusy,setLabExportBusy]=useState(false);
  const [toast,setToast]=useState("");
 const [mobileMenu,setMobileMenu]=useState(false);
 // Un menú móvil largo debe desplazarse sin mover la página de fondo.
 useEffect(()=>{
   if(!mobileMenu)return;
   const previous=document.body.style.overflow;
   document.body.style.overflow="hidden";
   const close=e=>{if(e.key==="Escape")setMobileMenu(false);};
   const onResize=()=>{if(window.innerWidth>790)setMobileMenu(false);};
   window.addEventListener("keydown",close);
   window.addEventListener("resize",onResize);
   return()=>{
     document.body.style.overflow=previous;
     window.removeEventListener("keydown",close);
     window.removeEventListener("resize",onResize);
   };
 },[mobileMenu]);
 useEffect(()=>{
    if(!tenantContext || !sessionUser)return;
    localStorage.setItem(tenantStorageKey(tenantContext.client.slug,sessionUser.email),JSON.stringify({...data,promos:data.promos.map(p=>({...p,sales:{}})),pharmacies:pharmacyBackendConfigured?DEFAULT_PHARMACIES:data.pharmacies}));
  },[data,pharmacyApiStatus,tenantContext?.client?.slug,sessionUser?.email]);
  useEffect(()=>{
    if (pharmacyBackendConfigured) void refreshPharmacies();
    const onAuth = () => { if (pharmacyBackendConfigured) void refreshPharmacies(); };
    window.addEventListener("farmawao-auth-changed", onAuth);
    return () => window.removeEventListener("farmawao-auth-changed", onAuth);
  },[tenantContext?.client?.slug]);
   useEffect(()=>{
     if(!tenantContext||!sessionUser||(tenantContext.modules?.promociones!==true && sessionUser.role!=="superadministrador")){setSalesStatus("sin_conexion");setSalesByPromotion({});return;}
     let cancelled=false;
     setSalesStatus("cargando");
     const sync=async()=>{
       try{
         const segments=[];
         for(const p of data.promos){
           if(!/^20\d{2}-\d{2}-\d{2}$/.test(p.start||"") || !/^20\d{2}-\d{2}-\d{2}$/.test(p.end||""))continue;
           for(let i=0;i<(p.cns||[]).length;i+=100){
             const cns=p.cns.slice(i,i+100);
             if(cns.length)segments.push({id:p.id+"__"+i,sourceId:p.id,start:p.start,end:p.end,cns});
           }
         }
         const chunks=[];
         for(let i=0;i<segments.length;i+=25)chunks.push(segments.slice(i,i+25));
         const results=await Promise.all(chunks.map(chunk=>loadPromotionSales(chunk)));
         if(cancelled)return;
         const byPromotion={};
         for(let i=0;i<segments.length;i++){
           const seg=segments[i],partial=results[Math.floor(i/25)]?.sales?.[seg.id]||{};
           const out=byPromotion[seg.sourceId]||(byPromotion[seg.sourceId]={});
           for(const [id,qty] of Object.entries(partial))out[id]=(out[id]||0)+(Number(qty)||0);
         }

         setSalesByPromotion(byPromotion);
         setSalesError("");
         setSalesStatus("real");
       }catch(error){
         if(cancelled)return;
         setSalesByPromotion({});setSalesStatus("error");setSalesError(error.message);
       }
     };
     void sync();
     return()=>{cancelled=true;};
   },[data.promos,tenantContext?.client?.slug,tenantContext?.modules?.promociones,sessionUser?.email]);
 useEffect(()=>{if(!toast)return;const id=setTimeout(()=>setToast(""),3800);return()=>clearTimeout(id);},[toast]);
 useEffect(()=>{
   const onBackForward=()=>{
   const filters=reportFiltersFromUrl();
   setReportStatus(filters.status);setReportYear(filters.year);
   setReportSelectedIds(filters.ids===null?data.promos.map(p=>p.id):filters.ids);
   setSelectedPharmacyIds(filters.pharmacies);setPharmacySelectorOpen(false);setReportPage(0);setReportModal(null);
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
 const {promos:rawPromos,users:storedUsers}=data;
 // Ocultar objetivos y farmacias fuera del ámbito autorizado de esta sesión.
 const pharmacies=tenantContext?.pharmacies||[];
 const permittedPharmacyIds=new Set(pharmacies.map(p=>String(p.id)));
 const storedPromos=(rawPromos||[]).map(p=>({...p,
   targets:Object.fromEntries(Object.entries(p.targets||{}).filter(([id])=>permittedPharmacyIds.has(String(id)))),
   sales:Object.fromEntries(Object.entries(p.sales||{}).filter(([id])=>permittedPharmacyIds.has(String(id))))
 })).filter(p=>["administrador","superadministrador"].includes(tenantContext?.role)||Object.keys(p.targets||{}).length>0);

  const users=sessionUser?.role==="superadministrador"
    ? [{id:"AUTH",name:sessionUser.name||sessionUser.email,email:sessionUser.email,role:"superadmin",pharmacies:[],active:true},
       ...storedUsers.filter(user=>user.role!=="superadmin")]
    : storedUsers;
  const promos=storedPromos.map(p=>({...p,sales:salesStatus==="real"?(salesByPromotion[p.id]||{}):{},salesSource:salesStatus==="real"?"Ventas reales de Farmatic · octubre 2026":"Sin conexión de ventas reales"}));
 
 const pharmaName=(id)=>pharmacies.find(f=>f.id===id)?.name||id;
 const filterText=search.toLocaleLowerCase("es");
 const filteredPromos=promos.filter(p=>(p.name+" "+p.subtitle+" "+p.cns.join(" ")).toLocaleLowerCase("es").includes(filterText)
  &&(statusFilter==="Todos"||p.status===statusFilter)
  &&(!from||p.end>=from)&&(!to||p.start<=to));
 const reportYears=[...new Set(promos.map(p=>(p.start||"").slice(0,4)).filter(y=>/^(19|20)\d{2}$/.test(y)))].sort().reverse();
 const reportFilterBase=promos.filter(p=>(reportStatus==="Todos"||p.status===reportStatus)&&(reportYear==="Todos"||(p.start||"").slice(0,4)===reportYear));
 const reportSelected=reportFilterBase.filter(p=>reportSelectedIds.includes(p.id));
 const draftFilterBase=reportModal?promos.filter(p=>(reportModal.status==="Todos"||p.status===reportModal.status)&&(reportModal.year==="Todos"||(p.start||"").slice(0,4)===reportModal.year)):[];
 const draftVisible=reportModal?draftFilterBase.filter(p=>(p.name+" "+p.id+" "+p.cns.join(" ")).toLocaleLowerCase("es").includes(reportModal.search.toLocaleLowerCase("es"))):[];
 const draftPageSize=reportModal?.pageSize||10;
 const draftMaxPage=Math.max(0,Math.ceil(draftVisible.length/draftPageSize)-1);
 const draftPage=Math.min(reportModal?.page||0,draftMaxPage);
 const reportPharmacyIds=[...new Set(reportSelected.flatMap(p=>Object.keys(p.targets||{})))];
 const effectivePharmacyIds=selectedPharmacyIds===null?reportPharmacyIds:selectedPharmacyIds.filter(id=>reportPharmacyIds.includes(id));
 const activePharmacySet=new Set(effectivePharmacyIds);
 const reportFilteredCampaigns=reportSelected.filter(p=>selectedPharmacyIds===null||Object.keys(p.targets||{}).some(id=>activePharmacySet.has(id))).map(p=>({
  ...p,
  targets:Object.fromEntries(Object.entries(p.targets||{}).filter(([id])=>activePharmacySet.has(id))),
  sales:Object.fromEntries(Object.entries(p.sales||{}).filter(([id])=>activePharmacySet.has(id)))
 }));
 const goalListFiltered=reportFilteredCampaigns.filter(p=>(p.name+" "+p.subtitle+" "+p.cns.join(" "))
   .toLocaleLowerCase("es").includes(reportListSearch.toLocaleLowerCase("es"))).sort((a,b)=>{
     const collate=(x,y)=>String(x).localeCompare(String(y),"es",{numeric:true});
     if(reportListSort==="goal-desc")return sum(b.targets)-sum(a.targets)||collate(a.name,b.name);
     if(reportListSort==="sales-desc")return sum(b.sales)-sum(a.sales)||collate(a.name,b.name);
     if(reportListSort==="advance-desc")return percent(sum(b.sales),sum(b.targets))-percent(sum(a.sales),sum(a.targets))||collate(a.name,b.name);
     if(reportListSort==="name-desc")return collate(b.name,a.name);
     return collate(a.name,b.name);
   });
 const reportMaxPage=Math.max(0,Math.ceil(goalListFiltered.length/reportPageSize)-1);
 const safeReportPage=Math.min(reportPage,reportMaxPage);
 const combinedReport=reportFilteredCampaigns.reduce((acc,p)=>{
  Object.entries(p.targets||{}).forEach(([id,val])=>{acc.targets[id]=(acc.targets[id]||0)+(Number(val)||0);});
  Object.entries(p.sales||{}).forEach(([id,val])=>{acc.sales[id]=(acc.sales[id]||0)+(Number(val)||0);});
  return acc;
 },{targets:{},sales:{}});
 const reportTargets=Object.entries(combinedReport.targets);
 const reportGoal=sum(combinedReport.targets);
 const reportSales=sum(combinedReport.sales);
 const reportCNs=[...new Set(reportSelected.flatMap(p=>p.cns||[]))];
 const searchedCNs=reportCNs.filter(cn=>(cn+" "+(reportSelected.find(p=>p.cnDescriptions?.[cn])?.cnDescriptions?.[cn]||"")).toLowerCase().includes(cnSearch.toLowerCase()));
 const orderedCNs=searchedCNs.sort((a,b)=>cnSort==="asc"?a.localeCompare(b,"es",{numeric:true}):b.localeCompare(a,"es",{numeric:true}));
 const safeCNPage=Math.min(cnPage,Math.max(0,Math.ceil(orderedCNs.length/cnPageSize)-1));
 const currentUsers=users.filter(u=>(u.name+" "+u.email+" "+ROLES[u.role]).toLocaleLowerCase("es").includes(filterText));
 const currentPharmacies=pharmacies.filter(f=>(f.id+" "+f.name+" "+f.city+" "+(f.sourceCode||"")+" "+(f.sourceHost||"")).toLocaleLowerCase("es").includes(filterText));
 function nav(id,promoId){
  if(id==="seguimiento-campana"||id==="seguimiento-global"){
   const p=promoId?promos.find(item=>item.id===promoId):null;
   const defaultStatus=data.promos.some(item=>item.status==="Activa")?"Activa":"Borrador";
   const status=p?p.status:defaultStatus,ids=p?[p.id]:data.promos.filter(item=>item.status===status).map(item=>item.id);
   setReportStatus(status);setReportYear("Todos");setReportSelectedIds(ids);setReportPage(0);setSelectedPharmacyIds(null);
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
  setReportModal({status:reportStatus,year:reportYear,search:"",ids:[...reportSelectedIds],page:0,pageSize:10});
 }
 function updateDraftScope(status,year){
  setReportModal(prev=>{
   if(!prev)return prev;
   const eligible=data.promos.filter(p=>(status==="Todos"||p.status===status)&&(year==="Todos"||(p.start||"").slice(0,4)===year));
   const kept=prev.ids.filter(id=>eligible.some(p=>p.id===id));
   return {...prev,status,year,search:"",page:0,ids:kept.length?kept:(status==="Todos"?eligible.filter(p=>p.status==="Activa"):eligible).map(p=>p.id)};
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
  setSelectedPharmacyIds(null);setReportPage(0);setReportModal(null);
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
  if(!codes.length&&promoForm.status!=="Borrador")return setToast("Añade al menos un CN antes de activar");
   const invalid=codes.filter(cn=>!isValidCN(cn));
   if(invalid.length)return setToast("Cada CN debe contener exactamente 6 dígitos, sin puntos. Revisa: "+invalid[0]);
  if(promoForm.status==="Activa"&&(!promoForm.start||!promoForm.end))return setToast("Ambas fechas son obligatorias para activar");
  if(promoForm.end&&promoForm.start&&promoForm.end<promoForm.start)return setToast("La fecha final debe ser posterior a la inicial");
  const selections=Object.entries(promoForm.targets);
  const promoType=PROMOTION_TYPES.find(t=>t.id===promoForm.type);
   const requiresPct=promoType?.needsPercent;
  if(promoForm.status==="Activa" && !selections.length)return setToast("Selecciona farmacias y completa sus objetivos antes de activar");
  if(promoForm.status==="Activa" && selections.some(([,v])=>v==="" || !Number.isInteger(Number(v)) || Number(v)<=0))
     return setToast("Para activar, todos los objetivos por farmacia son obligatorios y deben ser mayores que cero");
  if(promoForm.status==="Activa" && promoForm.type==="sin_clasificar")
     return setToast("Clasifica el tipo de promoción antes de activarla");
  if(promoForm.status==="Activa" && requiresPct &&
    (promoForm.discountPercent==="" || !Number.isFinite(Number(promoForm.discountPercent)) || Number(promoForm.discountPercent)<=0 || Number(promoForm.discountPercent)>100))
     return setToast("Introduce el porcentaje de descuento antes de activar");
  if(promoForm.status==="Activa"&&PROMOTION_TYPES.find(t=>t.id===promoForm.type)?.needsAmount&&!(Number(promoForm.discountAmount)>0))return setToast("Completa el importe del descuento en euros");
  if(selections.some(([,v])=>v!=="" && (!Number.isInteger(Number(v)) || Number(v)<0)))
     return setToast("Los objetivos deben ser unidades enteras no negativas");
  const result={...promoForm,sales:{},id:promoForm.id||"P"+Date.now(),name:promoForm.name.trim(),cns:codes,targets:Object.fromEntries(selections.map(([id,v])=>[id,v===""?"":Number(v)]))};
  setData(prev=>({...prev,promos:prev.promos.some(p=>p.id===result.id)?prev.promos.map(p=>p.id===result.id?result:p):[result,...prev.promos]}));
  setEditingPromo(null);setToast("Promoción guardada");
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
  async function importPromotionFile(event){
    const file=event.target.files?.[0];if(!file)return;
    setImportBusy(true);
    try{
      const campaigns=await readPromotionExcel(file);
      const {additions,updates,duplicates,expanded,warnings}=mergeImportedPromos(data.promos,campaigns);
      const newPromos=additions.map(p=>({...p,status:"Borrador"}));
      if(newPromos.length||updates.length)setData(prev=>({...prev,promos:[
        ...newPromos,...prev.promos.map(old=>updates.find(u=>u.id===old.id)||old)
      ]}));
      setStatusFilter("Borrador");
      setToast(newPromos.length+" nuevas, "+updates.length+" actualizadas (objetivos/CNs), "+
        duplicates+" sin cambios; "+warnings+" requieren revisión.");
    }catch(error){setToast(error.message||"No se pudo importar el Excel");}
    finally{setImportBusy(false);event.target.value="";}
  }
  function copyPromo(p){startPromo({...p,id:null,name:p.name+" (copia)",status:"Borrador",sales:{}});setToast("Revisa la copia antes de guardarla");}
 async function exportPromo(p){
  try{await exportPromotionExcel(p,pharmaName);setToast("Excel de la promoción descargado");}
  catch(error){console.error(error);setToast("No se pudo generar el Excel");}
 }
 async function exportLabCampaigns(campaigns){
  if(labExportBusy)return;
  if(!campaigns.length){setToast("Selecciona alguna campaña para exportar");return;}
  if(salesStatus!=="real"){
    setToast("Para exportar al laboratorio es necesaria la conexión a ventas reales de PostgreSQL.");
    return;
  }
  try{
    // Validación global previa: no iniciar una exportación parcial.
    campaigns.forEach(validateLabPromotion);
  }catch(error){setToast(error.message);return;}
  if(campaigns.length>10&&!window.confirm(
    "¿Preparar "+campaigns.length+" Excel de laboratorio en un ZIP? Puede tardar unos minutos."))return;
  setLabExportBusy(true);
  try{
    const items=[];
    for(let i=0;i<campaigns.length;i++){
      const promo=campaigns[i];
      setToast("Preparando laboratorio "+(i+1)+"/"+campaigns.length+": "+promo.name);
      const lines=await readFullLabSales(promo,loadTicketLines);
      items.push({promo,lines});
    }
    // Se descarga cuando todas las promociones se han leído correctamente.
    if(items.length===1){
      await exportLabSalesExcel(items[0].promo,items[0].lines);
      setToast("Excel para laboratorio descargado: "+items[0].promo.name);
    }else{
      await exportLabSalesZip(items);
      setToast("ZIP para laboratorios descargado: "+items.length+" Excel, uno por campaña.");
    }
  }catch(error){
    setToast("No se pudo exportar para laboratorio: "+(error.message||"Error inesperado"));
  }finally{setLabExportBusy(false);}
 }

 function startUser(u){setEditingUser(u?.id||"nuevo");setUserForm(u?{...u,pharmacies:[...u.pharmacies]}:{id:null,name:"",email:"",role:"farmacia",pharmacies:[],active:true});}
 function saveUser(e) {
  e.preventDefault();if(!userForm.name.trim()||!userForm.email.includes("@"))return setToast("Revisa el nombre y correo");
  if(userForm.role!=="superadmin"&&!userForm.pharmacies.length)return setToast("Asigna alguna farmacia");
  const u={...userForm,id:userForm.id||"U"+Date.now(),pharmacies:userForm.role==="superadmin"?[]:userForm.pharmacies};
  setData(prev=>({...prev,users:prev.users.some(x=>x.id===u.id)?prev.users.map(x=>x.id===u.id?u:x):[...prev.users,u]}));
  setEditingUser(null);setToast("Usuario guardado");
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
    if(pharmacyBackendConfigured && pharmacyApiStatus!=="connected")return setToast("Inicia sesión como administrador desde Accesos");
    setEditingPharmacy(f?.id||"nuevo");
    setPharmacyForm(f?{...f}:{id:"",name:"",city:"",active:true,sourceCode:"",sourceHost:"",sourceDatabase:"Farmatic"});
  }
  async function savePharmacy(e) {
    e.preventDefault();const id=pharmacyForm.id.trim();
    if((editingPharmacy!=="nuevo"&&!/^[1-9][0-9]{0,8}$/.test(id))||!pharmacyForm.name.trim())return setToast("Revisa el código y el nombre");
    if(!/^[A-Z0-9_-]{2,16}$/.test((pharmacyForm.sourceCode||"").trim().toUpperCase()))return setToast("Indica un código de origen válido");
    if(editingPharmacy==="nuevo"&&pharmacies.some(f=>f.id===id))return setToast("Ese código ya existe");
    const f={...pharmacyForm,id,name:pharmacyForm.name.trim(),sourceCode:pharmacyForm.sourceCode.trim().toUpperCase(),sourceHost:pharmacyForm.sourceHost?.trim()||"",sourceDatabase:pharmacyForm.sourceDatabase?.trim()||"Farmatic"};
    if(pharmacyBackendConfigured && pharmacyApiStatus!=="connected")return setToast("Inicia sesión como administrador desde Accesos");
    setSavingPharmacy(true);
    try {
      if(pharmacyApiStatus==="connected"){
        await savePharmacyToServer(f,editingPharmacy==="nuevo");
        await refreshPharmacies();
        setToast("Farmacia guardada en PostgreSQL");
      } else {
        setData(prev=>({...prev,pharmacies:prev.pharmacies.some(x=>x.id===id)?prev.pharmacies.map(x=>x.id===id?f:x):[...prev.pharmacies,f]}));
        setToast("Cambios guardados");
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
 const role=tenantContext?.role;
 const visibleNav=NAV.filter(item=>{
   if(item.super)return sessionUser?.role==="superadministrador";
   if(item.admin)return ["administrador","superadministrador"].includes(role);
   if(item.module)return sessionUser?.role==="superadministrador"||tenantContext?.modules?.[item.module]===true;
   return true;
 });
 const allowed=page==="seguimiento-global"
   ? (sessionUser?.role==="superadministrador"||tenantContext?.modules?.promociones)
   : visibleNav.some(item=>item.id===page);
 useEffect(()=>{
   if(tenantContext && !allowed)nav(visibleNav.find(item=>item.module)?.id||visibleNav[0]?.id||"promociones");
 },[tenantContext,page,allowed]);
 if(!tenantContext||!allowed)return <div className="app-shell"><main className="main-content">{authError||"Preparando tu espacio de trabajo…"}</main></div>;
 return <div className="app-shell">
  <aside id="farmetrica-sidebar" aria-label="Navegación principal" className={"sidebar "+(mobileMenu?"sidebar-open":"")}>
   <button className="brand" onClick={()=>nav("promociones")}><span className="brand-mark" aria-hidden="true"><img className="fm-emblem" src="/brand-logo.webp?v=4" alt="" /></span><span>Farmetrica</span></button>
   <nav className="side-nav" aria-label="Módulos">{visibleNav.map(item=><React.Fragment key={item.id}><button className={"side-link "+(page===item.id?"active":"")} onClick={()=>nav(item.id)}><item.icon size={19}/><span>{item.label}</span>{page===item.id&&<span className="active-dot"/>}</button>{item.id==="promociones"&&<button className={"side-link side-sublink "+(page==="seguimiento-global"?"active":"")} onClick={()=>nav("seguimiento-global")}><BarChart3 size={16}/><span>Seguimiento</span>{page==="seguimiento-global"&&<span className="active-dot"/>}</button>}</React.Fragment>)}</nav>
  </aside>
  {mobileMenu&&<button className="mobile-scrim" type="button" onClick={()=>setMobileMenu(false)} aria-label="Cerrar navegación"/>}
  <div className="workspace">
   <header className="topbar">
    <button className="mobile-toggle icon-btn" type="button" aria-controls="farmetrica-sidebar" aria-expanded={mobileMenu} onClick={()=>setMobileMenu(v=>!v)} aria-label={mobileMenu?"Cerrar menú":"Abrir menú"}><LayoutDashboard size={20}/></button>
    <div className="topbar-title"><strong className="topbar-wordmark">Farmetrica</strong></div>
    <div className="topbar-right">{tenantContext.clients.length>1&&<select className="fm-client-selector" aria-label="Cambiar de cliente" value={tenantContext.client.slug} onChange={e=>activateClient(e.target.value)}>{tenantContext.clients.map(c=><option key={c.slug} value={c.slug}>{c.name}</option>)}</select>}<button className="icon-btn" title="Sin notificaciones por ahora" onClick={()=>setToast("Sin notificaciones nuevas")}><Bell size={19}/></button><span className="topbar-divider"/><span className="avatar avatar-green">{(sessionUser?.email||"FM").slice(0,2).toUpperCase()}</span>
       <span className="top-user">{sessionUser?.name||sessionUser?.email||"Administrador"}<small>{sessionUser?.role==="superadministrador"?"Superadministrador":tenantContext.role==="administrador"?"Administrador de cliente":"Usuario autorizado"}</small></span>
       <button type="button" className="icon-btn" title="Cerrar sesión" aria-label="Cerrar sesión" onClick={signOut}><LogOut size={18}/></button></div>
   </header>
   <main className="main-content">
    {page==="promociones"&&<>
 <div className="page-header"><div><h1>Promociones</h1></div>
    <div className="campaign-header-actions">
      <input ref={importFileRef} type="file" accept=".xlsx" hidden onChange={importPromotionFile}/>
      <button className="btn btn-secondary" type="button" disabled={importBusy} onClick={()=>importFileRef.current?.click()}><Upload size={17}/>{importBusy?"Importando…":"Importar Excel"}</button>
      
      <button className="btn btn-primary main-cta" onClick={()=>startPromo()}><Plus size={18}/> Nueva promoción</button>
    </div></div>
  {salesStatus==="error"&&<p role="alert" className="fm-inline-status">{salesError||"No se pudieron consultar las ventas"}</p>}
 <CampaignMetrics campaigns={filteredPromos} heading="Resumen de promociones" salesAvailable={salesStatus==="real"}/>
 <section className="card list-card full-table-card">
  <div className="section-heading"><div><h2>Listado de promociones</h2></div><span className="count-label">{filteredPromos.length} promociones</span></div>
  <div className="toolbar">
   <div className="search-wrap"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar promoción o CN..." aria-label="Buscar promociones"/></div>
   <div className="select-wrap"><Filter size={16}/><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} aria-label="Filtrar estado"><option value="Todos">Todos los estados</option><option>Activa</option><option>Borrador</option><option>Finalizada</option></select></div>
   <div className="fm-visible-date-filters"><label>Fecha de inicio<input type="date" aria-label="Fecha de inicio" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Fecha de fin<input type="date" aria-label="Fecha de fin" value={to} onChange={e=>setTo(e.target.value)}/></label></div>
  </div>
  <ListTable rows={filteredPromos} rowKey={p=>p.id} label="promociones"
    tableClass="campaign-table" onRowClick={startPromo} emptyText="No hay promociones con estos filtros"
    columns={[
      {key:"name",label:"Promoción",value:p=>p.name+" "+(p.subtitle||""),render:p=><div className="promotion-cell"><span className="promotion-icon"><Tag size={17}/></span><div><strong>{p.name}</strong><small>{p.subtitle||"Promoción"}</small></div></div>},
      {key:"type",label:"Tipo",filterMode:"multi",value:p=>PROMOTION_TYPES.find(t=>t.id===p.type)?.name||"Por revisar",render:p=><span className="id-code">{PROMOTION_TYPES.find(t=>t.id===p.type)?.name||"Por revisar"}</span>},
      {key:"status",label:"Estado",filterMode:"multi",value:p=>p.status,render:p=><Pill status={p.status}/>},
      {key:"start",label:"Periodo",value:p=>p.start,render:p=><div className="small-stack">{dateES(p.start)}<small>{dateES(p.end)}</small></div>},
      {key:"cns",label:"CN",filterMode:"multi",filterValues:p=>p.cns||[],
  options:items=>[...new Set(items.flatMap(p=>p.cns||[]))].map(cn=>({value:cn,label:cn})),
  value:p=>p.cns.length,render:p=><span className="td-number">{p.cns.length}</span>},
      {key:"pharmacies",label:"Farmacias",filterMode:"multi",
  filterValues:p=>Object.keys(p.targets||{}),
  options:items=>pharmacies.filter(f=>items.some(p=>Object.hasOwn(p.targets||{},f.id)))
    .map(f=>({value:f.id,label:f.name})),
  value:p=>Object.keys(p.targets||{}).length,render:p=><span className="td-number">{Object.keys(p.targets||{}).length}</span>},
      {key:"goal",label:"Objetivo",value:p=>sum(p.targets),render:p=><span className="td-number">{EUR.format(sum(p.targets))}</span>},
      {key:"sales",label:"Vendidas",value:p=>salesStatus==="real"?sum(p.sales):null,render:p=><span className="td-number">{salesStatus==="real"?EUR.format(sum(p.sales)):"—"}</span>},
      {key:"advance",label:"Avance",value:p=>salesStatus==="real"&&sum(p.targets)>0?percent(sum(p.sales),sum(p.targets)):null,render:p=>salesStatus==="real"&&sum(p.targets)>0?<div className="table-progress"><Progress value={percent(sum(p.sales),sum(p.targets))}/><span>{percent(sum(p.sales),sum(p.targets))}%</span></div>:<span className="td-number">—</span>},
      {key:"actions",label:"Acciones",value:()=>"",sortable:false,searchable:false,render:p=><div className="campaign-row-actions"><button className="btn btn-secondary btn-sm" onClick={e=>{e.stopPropagation();nav("seguimiento-campana",p.id)}}><BarChart3 size={14}/> Seguimiento</button><button className="row-action" title="Editar promoción" aria-label={"Editar "+p.name} onClick={e=>{e.stopPropagation();startPromo(p)}}><Pencil size={16}/></button></div>}
    ]}/>
 </section>

</>}
{page==="seguimiento-global"&&<>
 <div className="page-header report-page-header">
  <div>
   <h1>Seguimiento</h1></div>
  <div className="campaign-header-actions">
   <button className="btn btn-secondary" onClick={openReportFilters}><Filter size={17}/> Filtrar campañas <span className="report-button-count">{reportSelected.length}</span></button>
   <button className="btn btn-primary" type="button" disabled={!reportSelected.length||labExportBusy}
     onClick={()=>void exportLabCampaigns(reportSelected)}
     title="Exportar tickets reales de cada promoción con el formato del laboratorio">
    <ArrowDownToLine size={17}/>{labExportBusy?"Preparando Excel…":reportSelected.length===1?"Exportar Excel laboratorio":reportSelected.length?"Exportar "+reportSelected.length+" Excel (ZIP)":"Selecciona campañas"}
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
  <CampaignMetrics campaigns={reportFilteredCampaigns} heading={reportSelected.length===1?reportSelected[0].name:"Promociones seleccionadas"} salesAvailable={salesStatus==="real"}/>
  {reportSelected.length>1&&<section className="card report-pharmacy-totals report-pharmacy-highlight">
   <div className="report-consolidated-head"><div className="report-consolidated-icon"><Store size={23}/></div><div className="report-consolidated-title"><h2>Consolidado por farmacia</h2></div><span className="report-consolidated-count">{reportTargets.length} farmacias</span></div>
   <div className="report-consolidated-stats"><div><span>Objetivo conjunto</span><strong>{EUR.format(reportGoal)} uds.</strong></div><div><span>Unidades vendidas</span><strong>{EUR.format(reportSales)} uds.</strong></div><div><span>Avance global</span><strong>{percent(reportSales,reportGoal)}%</strong></div></div>
   <div className="goal-pharmacy-summary">{reportTargets.map(([id,target])=><div className="goal-summary-line" key={id}><div className="goal-summary-name"><Store size={15}/><strong>{pharmaName(id)}</strong></div><GoalProgressBar goal={Number(target)} sold={Number(combinedReport.sales?.[id]||0)}/></div>)}{!reportTargets.length&&<div className="report-choice-empty">No hay farmacias con objetivos en la selección.</div>}</div>
  </section>}
  <section className="card report-goals-panel">
   <div className="section-heading goal-panel-title"><div><h2>Avance hacia los objetivos</h2></div><span className="count-label">{reportFilteredCampaigns.length} campañas</span></div>
   <div className="goal-chart-legend"><span className="goal-legend-fill"/><span>Vendido respecto al objetivo</span><span className="goal-legend-marker"/> <span>Meta 100 %</span><span className="goal-legend-over">≥100 %</span><span>Objetivo alcanzado</span></div>
   <div className="list-options">
     <label>Buscar campaña <input type="search" value={reportListSearch}
        onChange={e=>{setReportListSearch(e.target.value);setReportPage(0)}} placeholder="Nombre, laboratorio o CN…"/></label>
     <label>Ordenar <select value={reportListSort} onChange={e=>{setReportListSort(e.target.value);setReportPage(0)}}>
       <option value="name">Campaña A-Z</option><option value="name-desc">Campaña Z-A</option>
       <option value="goal-desc">Objetivo mayor</option><option value="sales-desc">Ventas mayores</option>
       <option value="advance-desc">Avance mayor</option>
     </select></label>
   </div>
   <div className="goal-accordion-actions"><button type="button" onClick={()=>setExpandedCampaignIds(goalListFiltered.map(p=>p.id))}>Desplegar todas</button><span>·</span><button type="button" onClick={()=>setExpandedCampaignIds([])}>Plegar todas</button></div>
   <div className="goal-campaign-list">{!goalListFiltered.length&&<div className="report-choice-empty">No hay campañas para los filtros seleccionados.</div>}{goalListFiltered.slice(safeReportPage*reportPageSize,(safeReportPage+1)*reportPageSize).map(p=><CampaignGoalCard key={p.id} promo={p} pharmaName={pharmaName} expanded={expandedCampaignIds.includes(p.id)} onToggle={()=>toggleCampaignExpanded(p.id)} singlePharmacy={effectivePharmacyIds.length===1}/>)}</div>
   <ListPagination total={goalListFiltered.length} page={safeReportPage} pageSize={reportPageSize}
      label="campañas" onPageChange={setReportPage}
      onPageSizeChange={n=>{setReportPageSize(n);setReportPage(0)}}/>
  </section>
  <DetalleVentas promotions={reportSelected} pharmacies={pharmacies} connected={salesStatus==="real"}/>
  <section className="card campaign-cn-panel">
   <div className="section-heading"><div><h2>CNs incluidos</h2></div><span className="count-label">{reportCNs.length} CNs</span></div>
   <div className="list-options"><label>Buscar CN <input type="search" placeholder="CN o descripción…" value={cnSearch} onChange={e=>{setCnSearch(e.target.value);setCnPage(0)}}/></label>
     <label>Ordenar <select value={cnSort} onChange={e=>{setCnSort(e.target.value);setCnPage(0)}}><option value="asc">CN ascendente</option><option value="desc">CN descendente</option></select></label></div>
   <div className="cn-chips">{orderedCNs.slice(safeCNPage*cnPageSize,(safeCNPage+1)*cnPageSize).map(cn=><span key={cn} className="cn-chip" title={reportSelected.find(p=>p.cnDescriptions?.[cn])?.cnDescriptions?.[cn]||""}>{cn}</span>)}
     {!orderedCNs.length&&<span className="empty-inline">No hay CNs para la búsqueda.</span>}</div>
   <ListPagination total={orderedCNs.length} page={safeCNPage} pageSize={cnPageSize} label="CNs"
     onPageChange={setCnPage} onPageSizeChange={n=>{setCnPageSize(n);setCnPage(0)}}/>
  </section>
 </>:<section className="card report-empty-state"><Package size={27}/><h2>Selecciona alguna campaña para ver su seguimiento</h2><p>Puedes marcar una, varias o todas las que aparezcan en los filtros.</p></section>}
 {salesStatus==="error"&&<p role="alert" className="fm-inline-status">{salesError||"No se pudieron consultar las ventas"}</p>}
</>}
{page==="farmacias"&&<><div className="page-header"><div><h1>Maestro de farmacias</h1></div><div className="pharmacy-header-actions">{pharmacyBackendConfigured&&pharmacyApiStatus!=="connected"&&<button className="btn btn-secondary" onClick={()=>nav("accesos")}><ShieldCheck size={17}/> Iniciar sesión</button>}<button className="btn btn-primary" onClick={()=>startPharmacy()} disabled={pharmacyBackendConfigured&&pharmacyApiStatus!=="connected"}><Plus size={17}/> Nueva farmacia</button></div></div><div className="kpi-grid small-kpis"><Kpi icon={Store} title="Farmacias" value={pharmacies.length} caption="Total en el maestro"/><Kpi icon={CheckCircle2} title="Activas" value={pharmacies.filter(f=>f.active).length} caption="En funcionamiento"/><Kpi icon={Users} title="Inactivas" value={pharmacies.filter(f=>!f.active).length} caption=""/></div><div className="full-width-grid"><div className="card list-card"><div className="section-heading"><div><h2>Listado de farmacias</h2></div></div><div className="toolbar"><div className="search-wrap"><Search size={17}/><input placeholder="Buscar por código, nombre o ciudad..." value={search} onChange={e=>setSearch(e.target.value)}/></div></div><ListTable rows={currentPharmacies} rowKey={f=>f.id} label="farmacias"
  onRowClick={startPharmacy} emptyText="No hay farmacias con esos filtros"
  columns={[
    {key:"id",label:"ID",value:f=>Number(f.id),render:f=><span className="id-code">{f.id}</span>},
    {key:"name",label:"Nombre público",filterMode:"multi",value:f=>f.name,render:f=><div className="pharma-cell"><span className="store-mini"><Store size={16}/></span><strong>{f.name}</strong></div>},
    {key:"code",label:"Origen",filterMode:"multi",value:f=>f.sourceCode||"",render:f=><span className="id-code">{f.sourceCode||"—"}</span>},
    {key:"host",label:"Servidor SQL",value:f=>pharmacyApiStatus==="connected"?f.sourceHost||"Servidor local":"Sin conexión",render:f=>pharmacyApiStatus==="connected"?(f.sourceHost||"Servidor local"):"—"},
    {key:"active",label:"Estado",filterMode:"multi",value:f=>f.active?"Activa":"Inactiva",render:f=><Pill status={f.active?"Activa":"Inactiva"}/>},
    {key:"users",label:"Usuarios",value:f=>users.filter(u=>u.role==="superadmin"||u.pharmacies.includes(f.id)).length},
    {key:"actions",label:"",value:()=>"",sortable:false,searchable:false,render:()=> <Pencil size={16} className="muted"/>}
  ]}/></div></div></>}
    {page==="usuarios"&&<EquipoCliente client={tenantContext.client.slug} pharmacies={tenantContext.pharmacies}/>}
     {page==="proveedores-maestro"&&<ProveedoresMaestro key={tenantContext.client.slug} clientSlug={tenantContext.client.slug}/>}
    {page==="clientes"&&<ClientesPanel onUpdated={()=>loadContext(tenantContext.client.slug)}/>}
    {page==="solicitudes"&&<SolicitudesDemo/>}
    {DEMO_MODULES.has(page)&&<ModuloDemo key={tenantContext.client.slug} module={page}
      pharmacies={tenantContext.pharmacies} clientSlug={tenantContext.client.slug}
      onNavigate={nav} canNavigate={id=>visibleNav.some(item=>item.id===id)}/>} 
    {page==="accesos"&&<AccessAdmin onAuthenticated={()=>window.dispatchEvent(new Event("farmawao-auth-changed"))}/>}
     {page==="ajustes"&&<div className="fm-production-settings">
      <div className="page-header"><h1>Ajustes</h1></div>
      <div className="fm-module-links">
       {[["usuarios","Usuarios"],["farmacias","Farmacias"],["proveedores-maestro","Proveedores"],["clientes","Clientes"],["solicitudes","Solicitudes"],["accesos","Accesos"]]
        .filter(([id])=>visibleNav.some(item=>item.id===id))
        .map(([id,label])=><button className="card fm-module-link" key={id} onClick={()=>nav(id)}><strong>{label}</strong><ArrowRight size={17}/></button>)}
      </div>
     </div>}
   </main>
   <footer className="app-footer"><span>© 2026 Farmetrica</span></footer>
  </div>
  {reportModal&&<div className="report-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setReportModal(null)}}>
   <section className="report-modal" role="dialog" aria-modal="true" aria-labelledby="report-modal-title">
    <div className="report-modal-top">
     <div><h2 id="report-modal-title">Filtrar campañas</h2></div>
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
      <Field label="Buscar por promoción o CN"><input type="search" placeholder="Nombre, código o CN…" value={reportModal.search} onChange={e=>setReportModal(prev=>({...prev,search:e.target.value,page:0}))}/></Field>
     </div>
     <div className="report-modal-selection-head">
      <label className="report-select-all"><input type="checkbox" disabled={!draftVisible.length} checked={draftVisible.length>0&&draftVisible.every(p=>reportModal.ids.includes(p.id))} onChange={e=>e.target.checked?selectDraftAll(draftVisible):clearDraftVisible(draftVisible)}/> Seleccionar todas las campañas filtradas</label>
      <span>{draftFilterBase.filter(p=>reportModal.ids.includes(p.id)).length} elegidas · {draftVisible.length} resultados</span>
      <button type="button" className="report-modal-clear" disabled={!draftVisible.some(p=>reportModal.ids.includes(p.id))} onClick={()=>clearDraftVisible(draftVisible)}>Limpiar visibles</button>
     </div>
     <div className="report-modal-campaigns">
      {draftVisible.slice(draftPage*draftPageSize,(draftPage+1)*draftPageSize).map(p=><label className={"report-choice "+(reportModal.ids.includes(p.id)?"report-choice-checked":"")} key={p.id}>
       <input type="checkbox" checked={reportModal.ids.includes(p.id)} onChange={()=>toggleDraftCampaign(p.id)}/>
       <span className="report-choice-body"><strong>{p.name}</strong><small>{dateES(p.start)} — {dateES(p.end)} · {p.cns.length} CN · {Object.keys(p.targets||{}).length} farmacias</small></span><Pill status={p.status}/>
      </label>)}
      {!draftVisible.length&&<div className="report-choice-empty">No hay campañas para los filtros seleccionados. Prueba con otro estado, año o búsqueda.</div>}
     </div>
     <ListPagination total={draftVisible.length} page={draftPage} pageSize={draftPageSize}
        label="campañas" onPageChange={n=>setReportModal(prev=>({...prev,page:n}))}
        onPageSizeChange={n=>setReportModal(prev=>({...prev,pageSize:n,page:0}))}/>
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
    {PROMOTION_TYPES.find(t=>t.id===promoForm.type)?.needsAmount&&<Field label="Importe de descuento (€)"><input type="number" min="0.01" step="0.01" value={promoForm.discountAmount||""} onChange={e=>setPromoForm({...promoForm,discountAmount:e.target.value})}/></Field>}
    {promoForm.importWarnings?.length>0&&<div className="note data-note"><CircleHelp size={16}/> Pendiente de revisar: {promoForm.importWarnings.join(" · ")}</div>}
    {PROMOTION_TYPES.find(t=>t.id===promoForm.type)?.needsPercent&&<Field label="Porcentaje de descuento (%)"><input type="number" min="0.01" max="100" step="0.01" placeholder="Ej.: 50" value={promoForm.discountPercent} onChange={e=>setPromoForm({...promoForm,discountPercent:e.target.value})}/></Field>}
   <div className="form-divider"/><div className="field-heading"><div><strong>CNs (6 dígitos)</strong><small>Introduce un CN por línea o sepáralos por comas o espacios. Solo seis números, sin puntos.</small></div><span className="soft-counter">{cnParsed.length} CNs</span></div><textarea rows="5" className="cn-area" placeholder={"184579\n188456\n192334"} value={cnText} onChange={e=>setCnText(e.target.value)}/>{cnParsed.some(cn=>!isValidCN(cn))?<div className="parse-info cn-format-error"><CircleHelp size={15}/> Hay CNs incorrectos. Cada CN debe tener exactamente 6 dígitos, sin puntos ni letras.</div>:<div className="parse-info"><CheckCircle2 size={15}/> CNs válidos de 6 dígitos. Eliminamos automáticamente los duplicados.</div>}
   {Object.keys(promoForm.cnDescriptions||{}).length>0&&<div className="import-cn-catalog"><strong>Productos importados del Excel</strong>{Object.entries(promoForm.cnDescriptions).slice(0,22).map(([cn,description])=><div key={cn}><code>{cn}</code><span>{description}</span></div>)}{Object.keys(promoForm.cnDescriptions).length>22&&<small>Mostrando 22 de {Object.keys(promoForm.cnDescriptions).length} descripciones</small>}</div>}
    <div className="form-divider"/><div className="field-heading"><div><strong>Farmacias participantes</strong><small>Selecciona las farmacias incluidas en la promoción.</small></div><span className="soft-counter">{Object.keys(promoForm.targets).length} elegidas</span></div>
   <div className="pharmacy-picker">{pharmacies.filter(f=>f.active||f.id in promoForm.targets).map(f=><label key={f.id} className={"pharmacy-choice "+(f.id in promoForm.targets?"chosen":"")}><input type="checkbox" checked={f.id in promoForm.targets} onChange={()=>togglePromoPharmacy(f.id)}/><span className="choice-check">{f.id in promoForm.targets&&<Check size={14}/>}</span><span>{f.name}</span><small>{f.id}</small></label>)}</div>
   {Object.keys(promoForm.targets).length>0&&<div className="target-list"><div className="target-head"><strong>Objetivos por farmacia</strong><div className="increase-controls"><label>Incremento <input type="number" step="0.5" min="-100" max="500" value={targetIncrease} onChange={e=>setTargetIncrease(e.target.value)} aria-label="Incremento porcentual"/> %</label><button type="button" onClick={applyIncrease}>Aplicar</button></div></div>{Object.entries(promoForm.targets).map(([id,value])=><div className="target-row" key={id}><div><strong>{pharmaName(id)}</strong><small>{id}</small></div><div className="numeric-input"><input type="number" min="0" value={value} onChange={e=>setPromoForm({...promoForm,targets:{...promoForm.targets,[id]:e.target.value}})} aria-label={"Objetivo "+pharmaName(id)}/><span>uds.</span></div></div>)}<div className="target-total"><span>Objetivo total</span><strong>{EUR.format(sum(promoForm.targets))} uds.</strong></div><small className="hint">Deja el objetivo vacío mientras sea borrador. Introduce valores base y pulsa Aplicar para incrementar el porcentaje; cambiar el campo no altera los objetivos hasta pulsar el botón. El cálculo desde histórico se añadirá más adelante.</small></div>}
   <FormActions onCancel={()=>setEditingPromo(null)} label={editingPromo==="nuevo"?"Crear promoción":"Guardar cambios"}/>
   {editingPromo!=="nuevo"&&<div className="drawer-extra"><button type="button" className="btn btn-secondary" onClick={()=>{const p={...promoForm};setEditingPromo(null);copyPromo(p)}}><Copy size={16}/> Duplicar promoción</button><button type="button" className="btn btn-secondary" onClick={()=>exportPromo(promoForm)}><ArrowDownToLine size={16}/> Descargar ficha de promoción</button></div>}
  </form></div></div>}
  {editingUser&&<div className="drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setEditingUser(null)}}><div className="drawer"><div className="drawer-top"><div><h2>{editingUser==="nuevo"?"Nuevo usuario":"Editar usuario"}</h2><p>Asigna un rol y define las farmacias disponibles.</p></div><button className="icon-btn" onClick={()=>setEditingUser(null)} aria-label="Cerrar"><X/></button></div><form onSubmit={saveUser} className="drawer-content"><Field label="Nombre completo"><input required value={userForm.name} onChange={e=>setUserForm({...userForm,name:e.target.value})}/></Field><Field label="Correo electrónico"><input type="email" required value={userForm.email} onChange={e=>setUserForm({...userForm,email:e.target.value})}/></Field><Field label="Rol"><select value={userForm.role} onChange={e=>setUserForm({...userForm,role:e.target.value})}><option value="farmacia">Personal de farmacia</option><option value="gestor">Gestor de farmacias</option><option value="superadmin">Superadministrador</option></select></Field><Field label="Estado"><select value={String(userForm.active)} onChange={e=>setUserForm({...userForm,active:e.target.value==="true"})}><option value="true">Activo</option><option value="false">Inactivo</option></select></Field><div className="form-divider"/><div className="field-heading"><div><strong>Farmacias asignadas</strong><small>{userForm.role==="superadmin"?"Este rol tiene acceso a toda la red.":"Marca las farmacias a las que podrá acceder."}</small></div></div>{userForm.role!=="superadmin"&&<div className="pharmacy-picker">{pharmacies.map(f=><label key={f.id} className={"pharmacy-choice "+(userForm.pharmacies.includes(f.id)?"chosen":"")}><input type="checkbox" checked={userForm.pharmacies.includes(f.id)} onChange={()=>setUserForm({...userForm,pharmacies:userForm.pharmacies.includes(f.id)?userForm.pharmacies.filter(x=>x!==f.id):[...userForm.pharmacies,f.id]})}/><span className="choice-check">{userForm.pharmacies.includes(f.id)&&<Check size={14}/>}</span><span>{f.name}</span><small>{f.id}</small></label>)}</div>}<div className="note small-note"><ShieldCheck size={16}/> Estas asignaciones son solo visuales hasta habilitar autenticación y autorización en el servidor.</div><FormActions onCancel={()=>setEditingUser(null)}/></form></div></div>}
  {editingPharmacy&&<div className="drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setEditingPharmacy(null)}}><div className="drawer"><div className="drawer-top"><div><h2>{editingPharmacy==="nuevo"?"Nueva farmacia":"Editar farmacia"}</h2><p>El identificador se asigna automáticamente a las farmacias nuevas.</p></div><button className="icon-btn" onClick={()=>setEditingPharmacy(null)} aria-label="Cerrar"><X/></button></div><form onSubmit={savePharmacy} className="drawer-content">{editingPharmacy!=="nuevo"&&<Field label="ID de farmacia"><input disabled value={pharmacyForm.id}/></Field>}<Field label="Nombre público"><input required placeholder="Farmacia Plaza Mayor" value={pharmacyForm.name} onChange={e=>setPharmacyForm({...pharmacyForm,name:e.target.value})}/></Field><Field label="Ciudad (opcional)"><input value={pharmacyForm.city} onChange={e=>setPharmacyForm({...pharmacyForm,city:e.target.value})}/></Field><Field label="Código de origen (ABA / EUR / BUE…)"><input required placeholder="ABA" maxLength="16" value={pharmacyForm.sourceCode||""} onChange={e=>setPharmacyForm({...pharmacyForm,sourceCode:e.target.value})}/></Field><Field label="Host/IP SQL Server"><input placeholder="Vacío para servidor local" value={pharmacyForm.sourceHost||""} onChange={e=>setPharmacyForm({...pharmacyForm,sourceHost:e.target.value})}/></Field><Field label="Base de datos de origen"><input required value={pharmacyForm.sourceDatabase||""} onChange={e=>setPharmacyForm({...pharmacyForm,sourceDatabase:e.target.value})}/></Field><div className="note small-note"><ShieldCheck size={16}/> Guarda solo el servidor. No introduzcas contraseñas aquí.</div><Field label="Estado"><select value={String(pharmacyForm.active)} onChange={e=>setPharmacyForm({...pharmacyForm,active:e.target.value==="true"})}><option value="true">Activa</option><option value="false">Inactiva</option></select></Field><FormActions onCancel={()=>setEditingPharmacy(null)} label={savingPharmacy?"Guardando…":"Guardar cambios"} disabled={savingPharmacy}/></form></div></div>}
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