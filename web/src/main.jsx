import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity, ArrowDownToLine, ArrowRight, ArrowRightLeft, Bell, CalendarDays, Check, CheckCircle2, ChevronDown,
  ChevronRight, CircleHelp, ClipboardList, Clock3, Filter, Home, LayoutDashboard, LogOut,
  MoreHorizontal, Pencil, Plus, Search, Settings2, ShieldCheck, Sparkles, Store, Tag, Target, ShoppingCart,
  Trash2, TrendingUp, Users, X, BarChart3, Package, Copy, RefreshCcw, Upload, Database, Mail
} from "lucide-react";
import "./styles.css";
import "./loginTheme.css";
// Base visual de tarjetas de stock y operativa: se carga en el primer acceso.
import "./operativaPreview.css";
import "./settingsLayout.css";
import "./navigationBreadcrumbs.css";
const AccessAdmin=React.lazy(()=>import("./Accesos.jsx"));
const CambiarContrasena=React.lazy(()=>import("./CambiarContrasena.jsx"));
const ModuloDemo=React.lazy(()=>import("./ModuloDemo.jsx"));
const Genericos=React.lazy(()=>import("./Genericos.jsx"));
const ConfiguracionPrecios=React.lazy(()=>import("./ConfiguracionPrecios.jsx"));
const ConfiguracionDiasStock=React.lazy(()=>import("./ConfiguracionDiasStock.jsx"));
const ConfiguracionPreparador=React.lazy(()=>import("./ConfiguracionPreparador.jsx"));
const ConfiguracionAnalisisVentas=React.lazy(()=>import("./ConfiguracionAnalisisVentas.jsx"));
import {promotionMetrics,promotionAverageCompletion,hasOverlappingPromotions,participatingPromotionSales} from "./promotionMetrics.js";
import {dateES,quantity,integer,percentage} from "./localeES.js";
const ProveedoresMaestro=React.lazy(()=>import("./ProveedoresUnificados.jsx"));
const ClientesPanel=React.lazy(()=>import("./AdministracionSaas.jsx").then(m=>({default:m.ClientesPanel})));
const FuentesMaestras=React.lazy(()=>import("./FuentesMaestras.jsx"));
const EquipoCliente=React.lazy(()=>import("./EquipoPerfiles.jsx"));
const PerfilesGlobales=React.lazy(()=>import("./Perfiles.jsx"));
const DetalleVentas=React.lazy(()=>import("./DetalleVentas.jsx"));
const SolicitudesDemo=React.lazy(()=>import("./SolicitudesDemo.jsx"));
const AsistenteDemo=React.lazy(()=>import("./AsistenteDemo.jsx"));
const PharmacyState=React.lazy(()=>import("./PharmacyState.jsx"));
const PoliticaReposicionFarmacia=React.lazy(()=>import("./PoliticaReposicionFarmacia.jsx"));
const OperativaReal=React.lazy(()=>import("./OperativaReal.jsx"));
const CentroTrabajo=React.lazy(()=>import("./CentroTrabajo.jsx"));
const PantallasReales=React.lazy(()=>import("./PantallasReales.jsx"));
const StockSinRecepciones=React.lazy(()=>import("./StockSinRecepciones.jsx"));
const PickingList=React.lazy(()=>import("./PickingList.jsx"));
const ObjetivosPromociones=React.lazy(()=>import("./ObjetivosPromociones.jsx"));
const PromotionColorReport=React.lazy(()=>import("./PromotionColorReport.jsx"));
import ListTable, {ListPagination} from "./ListTable.jsx";
import {LoadingStatus,SkeletonLine,StartupScreen,KpiValue} from "./LoadingState.jsx";
import { readPromotionExcel, importedPromotionStatus } from "./importarPromociones.js";
import {mergeObjectivesIntoPromotion,objectivePromotionIsEditable} from "./promotionObjectiveFlow.js";
import {objectiveEditorUrl,objectiveEditorRoute} from "./promotionObjectiveRoute.js";
import {objectiveTargetsForPeriod,preferredObjectiveMonth,objectiveMonthDates,promotionObjectiveMonths,hasMonthlyObjectives,hasGoalInMonth,promotionDraftGoalMonths,assignProposalToMonth,objectiveMonthsOutsideCampaign} from "./promotionMonthlyObjectives.js";
import {promotionExcelBatchId,importResultSummary,promotionVisibleInPharmacyScope} from "./promotionImportFlow.js";
import {civilToday,effectivePromotionStatus,promotionReportingEnd,promotionDurationMode,promotionStatusSourceOnSave} from "./promotionLifecycle.js";
import {splitPromotionSalesPeriod} from "./promotionSalesRanges.js";
import {promotionSalesInterval,includePromotionForSales,scopePromotionSales} from "./promotionSalesVisibility.js";
import {REAL_SECTIONS,DOCUMENT_SCREENS} from "./moduleRoutes.js";
import {navigationBreadcrumbs} from "./navigationBreadcrumbs.js";
import {MultiSelectFilter} from "./MultiSelectFilter.jsx";
import {ReportPageHeader,ReportFilterBar,QUICK_PERIODS} from "./ReportControls.jsx";
import {resolveSalesPeriod} from "./salesPeriods.js";
import {currentPromotionMonth,promotionMonthRange,promotionMonthFromRange,promotionOverlapsPeriod,promotionMatchesReportScope} from "./promotionMonthFilter.js";
import {mapLimited} from "./asyncBatches.js";
import {reconcilePharmacyIds} from "./reportFilterScopes.js";
import {readSharedReportFilters,updateSharedReportFilters} from "./sharedReportFilters.js";
import { applyObjectiveRows } from "./objetivosImportacion.js";
import { OCTOBER_2026_OBJECTIVE_ROWS, OCTOBER_2026_OBJECTIVES_VERSION } from "./objetivosOctubre2026.js";
import { REAL_OCTOBER_EXAMPLES } from "./promocionesRealesOctubre.js";
import { parseCNs, isValidCN, normalizeStoredCNs } from "./cns.js";
import { exportPromotionExcel, exportLabSalesExcel, exportLabSalesZip } from "./exportaciones.js";
import {validateLabPromotion,preparePromotionLabExport} from "./laboratoryExport.js";
import {promotionTicketPolicy} from "./promotionTicketRules.js";
import { pharmacyBackendConfigured, hasPharmacySession, signInPharmacies, loadPharmacies, savePharmacyToServer, loadPromotionSales, loadTicketLines, loadStoredPromotions, saveStoredPromotion, deleteStoredPromotion, importStoredPromotions, deleteStoredPromotions,activateStoredPromotions } from "./farmaciasApi.js";

const DEFAULT_PHARMACIES = [
  {id:"1",name:"Abadía",city:"",active:true,sourceCode:"ABA",sourceHost:"",sourceDatabase:"Farmatic"},
  {id:"2",name:"Europa",city:"",active:true,sourceCode:"EUR",sourceHost:"",sourceDatabase:"Farmatic"},
  {id:"3",name:"Buenavista",city:"",active:true,sourceCode:"BUE",sourceHost:"",sourceDatabase:"Farmatic"},
  {id:"4",name:"Estación",city:"",active:true,sourceCode:"EST",sourceHost:"",sourceDatabase:"Farmatic"},
  {id:"5",name:"Valdemarías",city:"",active:true,sourceCode:"POL",databaseCode:"VAL",displayCode:"POL",sourceHost:"",sourceDatabase:"Farmatic"}
];
const EMPTY_PROMO = {id:null,name:"",subtitle:"",description:"",status:"Borrador",start:"2026-10-16",end:"2026-11-30",cns:[],targets:{},sales:{},type:"sin_clasificar",discountPercent:"",durationMode:"dates"};
const PROMOTION_TYPES = [
  {id:"sin_clasificar",name:"Sin clasificar"},
  {id:"dos_por_uno",name:"2×1"},
  {id:"tres_por_dos",name:"3×2"},
  {id:"segunda_porcentaje",name:"Segunda unidad con X % de descuento",needsPercent:true},
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
function percent(s,t) {return t ? Math.round(s/t*100):0;}
function sum(values){return Object.values(values||{}).reduce((a,b)=>a+(Number(b)||0),0);}
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
      return {...saved,pharmacies,promos, // Conservar un listado vacío tras eliminar todas las promociones.
        objectiveSeedVersion:OCTOBER_2026_OBJECTIVES_VERSION,
        users:saved.users.map(u=>({...u,pharmacies:(u.pharmacies||[]).map(migratePharmacyId)})),
      };
    }
  }catch {}
  if(slug!=="ampedia")return {promos:[],pharmacies:[],users:[],objectiveSeedVersion:OCTOBER_2026_OBJECTIVES_VERSION};
  // En una sesión nueva, PostgreSQL es la fuente de promociones: no crear
  // campañas de ejemplo que pudieran haberse eliminado en otro navegador.
  return {promos:[],pharmacies:DEFAULT_PHARMACIES,users:[],
    objectiveSeedVersion:OCTOBER_2026_OBJECTIVES_VERSION};
}
function downloadCSV(name, rows) {
  const csv="\ufeff"+rows.map(row=>row.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(";")).join("\r\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));a.download=name+".csv";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);
}
function Pill({status}){return <span className={"pill pill-"+status.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"-")}><span className="pill-dot"/>{status==="Finalizada"?"Archivada":status}</span>;}
function Progress({value,wide=false}) {return <div className={"progress "+(wide?"progress-wide":"")}><div style={{width:Math.min(Math.max(value,0),100)+"%"}}/></div>}
function Kpi({icon:Icon,title,value,caption,kind="mint",loading=false}){return <div className="kpi card"><div className={"kpi-icon kpi-"+kind}><Icon size={23}/></div><div className="kpi-content"><div className="kpi-label">{title}</div><div className="kpi-value"><KpiValue loading={loading} label={title} loadingText="Calculando…" value={value}/></div><div className="kpi-caption">{caption||"\u00a0"}</div></div></div>}
function CampaignMetrics({campaigns,heading,salesAvailable=false,salesLoading=false}){
 const m=promotionMetrics(campaigns,salesAvailable);
 const show=value=>value==null?"—":integer(value);
 return <section className="card campaign-metrics">
  <div className="campaign-metrics-header"><h2>{heading}</h2></div>
  <div className="campaign-metrics-grid">
   <div className="campaign-metric"><span>Promociones</span><strong>{show(m.promotions)}</strong></div>
   <div className="campaign-metric"><span>CNs</span><strong>{show(m.cnCount)}</strong></div>
   <div className="campaign-metric"><span>Objetivo</span><strong>{quantity(m.target)}</strong></div>
   <div className="campaign-metric"><span title="Unidades vendidas que cumplen las condiciones de la promoción">Unidades en promoción</span><KpiValue loading={salesLoading} label="Unidades en promoción" loadingText="Calculando…" value={quantity(m.units)}/></div>
   <div className="campaign-metric"><span title="Todas las unidades vendidas de los CN de la promoción, incluidas las que no cumplen sus condiciones">Unidades totales</span><KpiValue loading={salesLoading} label="Unidades totales" loadingText="Calculando…" value={quantity(m.totalUnits)}/></div>
    <div className="campaign-metric metric-progress"><span>{campaigns.length>1?"Cumplimiento medio":"Cumplimiento"}</span>
    <KpiValue loading={salesLoading} label="Cumplimiento" loadingText="Calculando…" value={m.completion==null?"—":percentage(m.completion)}/>{!salesLoading&&m.completion!=null&&<Progress value={m.completion}/>} 
   </div>
  </div>
 </section>;
}
function Field({label,children,hint}) {return <label className="field"><span className="field-label">{label}</span>{children}{hint&&<small>{hint}</small>}</label>}
function FormActions({onCancel,label="Guardar cambios",disabled=false}){return <div className="form-actions"><button className="btn btn-secondary" type="button" onClick={onCancel}>Cancelar</button><button className="btn btn-primary" type="submit" disabled={disabled}><Check size={16}/>{label}</button></div>}
const NAV=[
 {id:"dashboard",label:"Inicio",icon:LayoutDashboard,module:"dashboard"},
 {id:"ventas",label:"Ventas",icon:TrendingUp,module:"ventas"},
 {id:"ventas-tickets",label:"Tickets",icon:ClipboardList,module:"ventas",childOf:"ventas"},
 {id:"ventas-devoluciones",label:"Devoluciones y anulaciones",icon:RefreshCcw,module:"ventas",childOf:"ventas"},
 {id:"compras",label:"Compras",icon:BarChart3,module:"compras"},
 {id:"compras-recepciones",label:"Recepciones completas",icon:ClipboardList,module:"compras",childOf:"compras"},
 {id:"reposicion",label:"Reposición",icon:RefreshCcw,module:"reposicion",childOf:"compras"},
 {id:"compras-preparador",label:"Preparador de pedidos",icon:ShoppingCart,module:"compras",childOf:"compras"},
 {id:"compras-pendientes",label:"Pendientes de asignar",icon:ClipboardList,module:"compras",childOf:"compras"},
 {id:"compras-pedidos",label:"Pedidos preparados",icon:Package,module:"compras",childOf:"compras"},
 {id:"compras-devoluciones",label:"Devoluciones a proveedores",icon:RefreshCcw,module:"compras",childOf:"compras"},
 {id:"stock",label:"Stock",icon:Package,module:"stock"},
 {id:"stock-historico",label:"Histórico de stock",icon:BarChart3,module:"stock",childOf:"stock"},
  {id:"stock-sin-recepciones",label:"Stock sin recepciones",icon:Clock3,module:"stock",childOf:"stock"},
 {id:"stock-traspasos",label:"Traspasos entre farmacias",icon:ArrowRightLeft,module:"stock",childOf:"stock"},
 {id:"picking-list",label:"Picking List · PharmaWow",icon:ClipboardList,module:"stock",childOf:"stock"},
 {id:"productos",label:"Productos",icon:Package,module:"stock"},
 {id:"proveedores",label:"Proveedores",icon:Users,module:"proveedores"},
 {id:"proveedores-condiciones",label:"Análisis de proveedores",icon:ClipboardList,module:"proveedores",childOf:"proveedores"},
 {id:"genericos",label:"Genéricos",icon:Activity,module:"genericos"},
 {id:"rentabilidad",label:"Rentabilidad",icon:Target,module:"rentabilidad"},
 {id:"rentabilidad-segmentos",label:"Por familia",icon:BarChart3,module:"rentabilidad",childOf:"rentabilidad"},
 {id:"rentabilidad-retorno",label:"Retorno económico",icon:TrendingUp,module:"rentabilidad",childOf:"rentabilidad"},
 {id:"informes",label:"Informes",icon:ArrowDownToLine,module:"informes",childOf:"rentabilidad"},
 {id:"promociones",label:"Promociones",icon:Tag,module:"promociones"},
 {id:"promociones-objetivos",label:"Nueva campaña",icon:Plus,module:"promociones",childOf:"promociones"},
 {id:"acciones",label:"Trabajo y ahorro",icon:ClipboardList,module:"acciones"},
 {id:"oportunidades-seguimiento",label:"Seguimiento",icon:CheckCircle2,module:"acciones",childOf:"acciones"},
 {id:"alertas",label:"Alertas",icon:Bell,module:"acciones"},
 {id:"mi-trabajo",label:"Mi trabajo",icon:ClipboardList,module:"acciones",childOf:"alertas"},
 {id:"farmacias",label:"Farmacias",icon:Store,admin:true},
 {id:"usuarios",label:"Usuarios",icon:Users,admin:true},
 {id:"perfiles",label:"Perfiles",icon:ShieldCheck,admin:true},
 {id:"estado",label:"Estado",icon:Activity,admin:true},
 {id:"ajustes",label:"Ajustes",icon:Settings2,admin:true},
 {id:"clientes",label:"Clientes",icon:Database,super:true},
 {id:"fuentes",label:"Fuentes de datos",icon:Database,super:true},
 {id:"solicitudes",label:"Solicitudes",icon:Mail,super:true},
 {id:"accesos",label:"Accesos",icon:ShieldCheck,super:true}
];
function AppBreadcrumbs({items,onNavigate}){
 return <nav className="fm-breadcrumbs" aria-label="Ruta de navegación">
  <ol>{items.map((crumb,index)=><li key={(crumb.id||"group")+"-"+index}>
   {index>0&&<ChevronRight size={14} className="fm-breadcrumb-separator" aria-hidden="true"/>}
   {crumb.link?
    <button type="button" className="fm-breadcrumb-link" onClick={()=>onNavigate(crumb.id)}>
     {crumb.id==="dashboard"&&<Home size={15} aria-hidden="true"/>}
     <span>{crumb.label}</span>
    </button>:
    <span className={"fm-breadcrumb-label"+(crumb.current?" is-current":"")}
     aria-current={crumb.current?"page":undefined}>
     {crumb.id==="dashboard"&&<Home size={15} aria-hidden="true"/>}
     {crumb.label}
    </span>}
  </li>)}</ol>
 </nav>;
}
const ADMIN_IDS=new Set(["clientes","fuentes","solicitudes","accesos"]);
const CONFIG_IDS=new Set(["farmacias","usuarios","perfiles","estado","ajustes"]);
const DEMO_MODULES=new Set(["dashboard","ventas","compras","stock","reposicion","genericos","rentabilidad","informes"]);
// La demo comercial concentra el menú sin borrar pantallas, permisos, rutas ni datos.
// Las vistas avanzadas siguen accesibles por enlace directo y pueden recuperarse.
const DEMO_NAV_IDS=new Set(["dashboard","ventas","compras","compras-preparador",
 "stock","stock-sin-recepciones","picking-list","proveedores","genericos","promociones","promociones-objetivos","acciones"]);
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
 const month=promotionMonthRange(params.get("mes"))?params.get("mes"):"";
 return {status:["Activa","Finalizada","Borrador","Todos"].includes(status)?status:"Activa",
  month,year:!month&&/^(19|20)\d{2}$/.test(params.get("anio")||"")?params.get("anio"):"Todos",ids:selected,
  pharmacies:params.has("farmacias")?[...new Set(params.get("farmacias").split(",").filter(Boolean))]:null};
}
function pageFromUrl(){
 const path=window.location.pathname.replace(/^\/+|\/+$/g,"");
 if(path==="promociones/seguimiento"||path==="seguimiento"||promotionIdFromUrl())return "seguimiento-global";
 if(path==="promociones/nueva"||path==="promociones/simulador")return "promociones-objetivos";
 if(path==="proveedores-maestro")return "proveedores";
 return ROUTES.has(path)?path:"dashboard";
}

function App(){
 const [data,setData]=useState(readState);
 const [page,setPage]=useState(pageFromUrl);
 // La SPA debe empezar arriba al navegar entre módulos, submenús o al usar
 // Atrás/Adelante. El navegador no debe restaurar el scroll de otra ruta.
 useEffect(()=>{
  const previous=window.history.scrollRestoration;
  window.history.scrollRestoration="manual";
  return()=>{window.history.scrollRestoration=previous};
 },[]);
 useLayoutEffect(()=>{
  window.scrollTo({top:0,left:0,behavior:"instant"});
 },[page]);
 // Los submenús pueden abrirse mediante sus flechas sin navegar de pantalla.
 const [expandedNavIds,setExpandedNavIds]=useState(()=>{
  const initial=pageFromUrl();
  const parent=initial==="seguimiento-global"?"promociones":NAV.find(item=>item.id===initial)?.childOf||initial;
  return [parent];
 });
 const [search,setSearch]=useState("");
 const [statusFilter,setStatusFilter]=useState("Todos");
  const [promotionClock,setPromotionClock]=useState(()=>new Date());
  useEffect(()=>{const id=setInterval(()=>setPromotionClock(new Date()),15*60*1000);return()=>clearInterval(id);},[]);
 const [from,setFrom]=useState(()=>promotionMonthRange(currentPromotionMonth())?.from||"");
 const [to,setTo]=useState(()=>promotionMonthRange(currentPromotionMonth())?.to||"");
 const [editingPromo,setEditingPromo]=useState(null);
 const [objectiveCampaign,setObjectiveCampaign]=useState(null);
 const [objectiveMonth,setObjectiveMonth]=useState("");
 const [objectiveSession,setObjectiveSession]=useState(0);
 const [objectiveCatalogLoaded,setObjectiveCatalogLoaded]=useState(false);
 const [objectiveRouteRevision,setObjectiveRouteRevision]=useState(0);
 const [objectiveRestoreError,setObjectiveRestoreError]=useState("");
 const [savingPromo,setSavingPromo]=useState(false);
 const [promoSaveError,setPromoSaveError]=useState("");
 const [promoForm,setPromoForm]=useState({...EMPTY_PROMO});
 const [formObjectiveMonth,setFormObjectiveMonth]=useState("");
 const [cnText,setCnText]=useState("");
 const [editingUser,setEditingUser]=useState(null);
 const [userForm,setUserForm]=useState({id:null,name:"",email:"",role:"farmacia",pharmacies:[],active:true});
 const [editingPharmacy,setEditingPharmacy]=useState(null);
 const [pharmacyForm,setPharmacyForm]=useState({id:"",name:"",city:"",active:true,sourceCode:"",sourceHost:"",sourceDatabase:"Farmatic"});
  const [pharmacyApiStatus,setPharmacyApiStatus]=useState("cargando");
 const [pharmacyLastUpdated,setPharmacyLastUpdated]=useState(null);
  const [sessionUser,setSessionUser]=useState(null);
  const [passwordModal,setPasswordModal]=useState(false);
  const [tenantContext,setTenantContext]=useState(null);
  const [authError,setAuthError]=useState("");
  const [promotionStoreStatus,setPromotionStoreStatus]=useState("checking");
  async function tenantState(ctx,email){
    setPromotionStoreStatus("checking");
    setObjectiveCatalogLoaded(false);
    const local=readState(ctx.client.slug,email);
    // Copia recuperable antes de reconciliar con las promociones compartidas.
    try{
      const key="fm_promos_respaldo_v1:"+ctx.client.slug+":"+String(email||"").toLowerCase();
      if(local.promos.length&&!localStorage.getItem(key))
        localStorage.setItem(key,JSON.stringify(local.promos));
    }catch{} // La cuota local nunca debe bloquear el acceso.
    try{
      const server=await loadStoredPromotions();
      const remote=server.promotions||[];
      // El catálogo activo procede exclusivamente de PostgreSQL. Conservar
      // copias anteriores sólo como respaldo, sin mostrarlas como vigentes.
      if(!Array.isArray(remote))throw Error("Catálogo de promociones incompleto");
      setPromotionStoreStatus("connected");
      return {...local,promos:remote};
    }catch{
      setPromotionStoreStatus("error");
      return {...local,promos:[]}; // No mostrar campañas almacenadas sólo localmente.
    }
  }
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
    // La comprobación de cookie y el contexto de farmacia son independientes.
    // Lanzarlas a la vez elimina un viaje de red serial en cada arranque.
    // Ninguna vista privada se muestra hasta validar AMBAS respuestas.
    const userRequest=fetch("/api/auth/me",{credentials:"same-origin",cache:"no-store"})
      .then(r=>r.ok?r.json():Promise.reject(Error("Sin sesión")));
    const contextRequest=loadContext(selected).catch(()=>loadContext(""));
    Promise.all([userRequest,contextRequest])
      .then(async ([body,ctx])=>{
        if(!body.user){window.location.replace("/login");return;}
        // La navegación analítica no depende de descargar todas las promociones.
        // Mostrar la sesión y el cliente autorizado en cuanto responde /context;
        // reconciliar las campañas en segundo plano sin bloquear Inicio.
        if(live){setSessionUser(body.user);
          setData({...readState(ctx.client.slug,body.user.email),promos:[]});}
        const loaded=await tenantState(ctx,body.user.email);
        if(live&&localStorage.getItem("fm_active_tenant")===ctx.client.slug){
          setData(current=>({...current,promos:loaded.promos,
           objectiveSeedVersion:loaded.objectiveSeedVersion}));
          setObjectiveCatalogLoaded(true);
        }
      })
      .catch(e=>{if(live){setAuthError(e.message);if(e.message==="Sin sesión")window.location.replace("/login");}});
    return()=>{live=false};
  },[]);
  async function retryPromotions(){
   if(!tenantContext)return;
   setPromotionStoreStatus("checking");
   try{
    const server=await loadStoredPromotions();
    if(!Array.isArray(server.promotions))throw Error("El servidor no devolvió un catálogo válido");
    setData(prev=>({...prev,promos:server.promotions}));
    setPromotionStoreStatus("connected");setObjectiveCatalogLoaded(true);
   }catch(err){
    setPromotionStoreStatus("error");
    setToast("No se pudieron cargar las promociones: "+err.message);
   }
  }
  async function activateClient(slug){
    if(slug===tenantContext?.client.slug)return;
    try{
      setPromotionStoreStatus("checking");
      setData(prev=>({...prev,promos:[]}));
      const ctx=await loadContext(slug);
      setData(await tenantState(ctx,sessionUser?.email));setObjectiveCatalogLoaded(true);
      setSalesStatus("sin_conexion");setSalesByPromotion({});setTotalSalesByPromotion({});
      const initial=ctx.sections?.dashboard||sessionUser?.role==="superadministrador"?"dashboard":
        NAV.find(item=>item.module&&ctx.sections?.[item.id])?.id||
        (ctx.sections?.["seguimiento-global"]?"seguimiento-global":"farmacias");
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
 const [reportMonth,setReportMonth]=useState(()=>reportFiltersFromUrl().month);
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
 const [sharedPharmacyIds,setSharedPharmacyIds]=useState([]);
 const [salesLastUpdated,setSalesLastUpdated]=useState(null);
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
 const [goalSalesByPromotion,setGoalSalesByPromotion]=useState({});
   const [totalSalesByPromotion,setTotalSalesByPromotion]=useState({});
  const importFileRef=useRef(null);
  const [importBusy,setImportBusy]=useState(false);
  const [importFeedback,setImportFeedback]=useState(null);
 const [importViewIds,setImportViewIds]=useState(null);
  const [labExportBusy,setLabExportBusy]=useState(false);
  const [labIncludeSeller,setLabIncludeSeller]=useState(false);
  const [toast,setToast]=useState("");
 const [deletingPromoId,setDeletingPromoId]=useState(null);
 const [selectedPromotionIds,setSelectedPromotionIds]=useState([]);
 const [deletingSelected,setDeletingSelected]=useState(false);
 const [activatingSelected,setActivatingSelected]=useState(false);
 const [activationError,setActivationError]=useState("");
 useEffect(()=>setSelectedPromotionIds([]),[tenantContext?.client?.slug]);
 const [mobileMenu,setMobileMenu]=useState(false);
 const [settingsOpen,setSettingsOpen]=useState(()=>CONFIG_IDS.has(pageFromUrl()));
 const [adminOpen,setAdminOpen]=useState(()=>ADMIN_IDS.has(pageFromUrl()));
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
    // PostgreSQL es el catálogo principal. No duplicar miles de CN en el
    // almacenamiento local del móvil (Safari puede quedarse sin cuota).
    const persist={...data,promos:promotionStoreStatus==="connected"?[]:
      data.promos.map(p=>({...p,sales:{}})),
      pharmacies:pharmacyBackendConfigured?DEFAULT_PHARMACIES:data.pharmacies};
    try{localStorage.setItem(tenantStorageKey(tenantContext.client.slug,sessionUser.email),JSON.stringify(persist));}
    catch{} // La cuota de almacenamiento no debe romper la pantalla tras importar.
  },[data,pharmacyApiStatus,tenantContext?.client?.slug,sessionUser?.email]);
  useEffect(()=>{
    if (pharmacyBackendConfigured) void refreshPharmacies();
    const onAuth = () => { if (pharmacyBackendConfigured) void refreshPharmacies(); };
    window.addEventListener("farmawao-auth-changed", onAuth);
    return () => window.removeEventListener("farmawao-auth-changed", onAuth);
  },[tenantContext?.client?.slug]);
   useEffect(()=>{
     if(!["promociones","seguimiento-global"].includes(page)||!tenantContext||!sessionUser||promotionStoreStatus!=="connected"||(tenantContext.modules?.promociones!==true && sessionUser.role!=="superadministrador")){setSalesStatus("sin_conexion");setSalesByPromotion({});setGoalSalesByPromotion({});setTotalSalesByPromotion({});return;}
     let cancelled=false;
     setSalesStatus("cargando");
     const sync=async()=>{
       try{
         const segments=[];
         const selectedMonthRange=page==="seguimiento-global"&&reportMonth?promotionMonthRange(reportMonth):null;
         for(const p of data.promos){
           if(!includePromotionForSales(p,{page,from,to,importIds:importViewIds,
              selectedIds:reportSelectedIds,reportMatches:promo=>
               promotionMatchesReportScope({...promo,status:effectivePromotionStatus(promo,new Date(),reportTimeZone)},
                {status:reportStatus,month:reportMonth,year:reportYear})}))continue;
           const range=promotionSalesInterval(p,new Date(),reportTimeZone);
           if(!range)continue;
           // Mantener las reglas originales de venta; limitar por el mes al consultar objetivos.
           const begin=selectedMonthRange&&selectedMonthRange.from>range.start?
             selectedMonthRange.from:range.start;
           const finish=selectedMonthRange&&selectedMonthRange.to<range.end?
             selectedMonthRange.to:range.end;
           if(begin>finish)continue;
           // En "todos los meses" distinguimos ventas comerciales de ventas
           // correspondientes a meses con objetivos configurados.
           const slices=page==="seguimiento-global"&&!reportMonth&&hasMonthlyObjectives(p)?
             promotionObjectiveMonths(p).map(month=>{
              const dates=objectiveMonthDates(p,month);
              if(!dates)return null;
              return {start:dates.from>begin?dates.from:begin,
               end:dates.to<finish?dates.to:finish,goalRelevant:hasGoalInMonth(p,month)};
             }).filter(x=>x&&x.start<=x.end):
             [{start:begin,end:finish,goalRelevant:true}];
           for(const slice of slices)
            for(const segment of splitPromotionSalesPeriod(slice.start,slice.end))
             segments.push({...p,...segment,id:"S"+segments.length,parentId:p.id,
              goalRelevant:slice.goalRelevant});
         }
         const chunks=[];
         for(let i=0;i<segments.length;i+=25)chunks.push(segments.slice(i,i+25));
         const results=await mapLimited(chunks,2,
           chunk=>loadPromotionSales(chunk),{shouldStop:()=>cancelled});
         if(cancelled)return;
         const byPromotion={},byTotalPromotion={},byGoalPromotion={};
         for(let i=0;i<segments.length;i++){
           const seg=segments[i],partial=results[Math.floor(i/25)]?.sales?.[seg.id]||{};
           const out=byPromotion[seg.parentId]||(byPromotion[seg.parentId]={});
           for(const [id,qty] of Object.entries(partial)){
            out[id]=(out[id]||0)+(Number(qty)||0);
            if(seg.goalRelevant){
             const goals=byGoalPromotion[seg.parentId]||(byGoalPromotion[seg.parentId]={});
             goals[id]=(goals[id]||0)+(Number(qty)||0);
            }
           }
            const totals=results[Math.floor(i/25)]?.totalSales?.[seg.id]||{};
            const totalOut=byTotalPromotion[seg.parentId]||(byTotalPromotion[seg.parentId]={});
            for(const [id,qty] of Object.entries(totals))totalOut[id]=(totalOut[id]||0)+(Number(qty)||0);
         }

         setSalesByPromotion(byPromotion);setGoalSalesByPromotion(byGoalPromotion);setTotalSalesByPromotion(byTotalPromotion);
         setSalesLastUpdated(new Date());setSalesError("");
         setSalesStatus("real");
       }catch(error){
         if(cancelled)return;
         setSalesByPromotion({});setGoalSalesByPromotion({});setTotalSalesByPromotion({});setSalesStatus("error");setSalesError(error.message);
       }
     };
     void sync();
     return()=>{cancelled=true;};
   },[data.promos,promotionStoreStatus,tenantContext?.client?.slug,tenantContext?.modules?.promociones,sessionUser?.email,page,from,to,importViewIds,reportSelectedIds,reportStatus,reportMonth,reportYear]);
 useEffect(()=>{if(!toast)return;const id=setTimeout(()=>setToast(""),3800);return()=>clearTimeout(id);},[toast]);
 useEffect(()=>{
   const onBackForward=()=>{
   const filters=reportFiltersFromUrl();
   setReportStatus(filters.status);setReportYear(filters.year);setReportMonth(filters.month);
   setReportSelectedIds(filters.ids===null?data.promos.map(p=>p.id):filters.ids);
   setSelectedPharmacyIds(filters.pharmacies);setPharmacySelectorOpen(false);setReportPage(0);setReportModal(null);
   setObjectiveRouteRevision(v=>v+1);
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
   const label=page==="seguimiento-global"?"Seguimiento":NAV.find(item=>item.id===page)?.label||"Dashboard";
   document.title=`Farmetrica · ${label}`;
 },[page]);
 const {promos:rawPromos,users:storedUsers}=data;
 // Ocultar objetivos y farmacias fuera del ámbito autorizado de esta sesión.
 const pharmacies=tenantContext?.pharmacies||[];
 // Persistir un único ámbito de farmacias por cliente al cambiar de módulo.
 const pharmacyScopeKey=pharmacies.map(p=>String(p.id)).join(",");
 useEffect(()=>{
  if(!tenantContext?.client?.slug)return;
  const saved=reconcilePharmacyIds(
   readSharedReportFilters(tenantContext.client.slug).pharmacyIds||[],pharmacies);
  setSharedPharmacyIds(saved);
  if(page==="seguimiento-global"&&!new URLSearchParams(window.location.search).has("farmacias"))
   setSelectedPharmacyIds(saved.length?saved:null);
 },[tenantContext?.client?.slug,page,pharmacyScopeKey]);
 function selectSharedPharmacies(value){
  const pharmacyIds=reconcilePharmacyIds(value,pharmacies);
  setSharedPharmacyIds(pharmacyIds);
  updateSharedReportFilters(tenantContext?.client?.slug,{pharmacyIds});
  if(page==="seguimiento-global")setSelectedPharmacyIds(pharmacyIds.length?pharmacyIds:null);
 }
 const permittedPharmacyIds=new Set(pharmacies.map(p=>String(p.id)));
 const storedPromos=(rawPromos||[]).map(p=>({...p,
   targets:Object.fromEntries(Object.entries(p.targets||{}).filter(([id])=>permittedPharmacyIds.has(String(id)))),
   monthlyObjectives:p.monthlyObjectives?Object.fromEntries(Object.entries(p.monthlyObjectives).map(([month,entry])=>
    [month,{...entry,targets:Object.fromEntries(Object.entries(entry?.targets||{})
     .filter(([id])=>permittedPharmacyIds.has(String(id))))}])):undefined,
   sales:Object.fromEntries(Object.entries(p.sales||{}).filter(([id])=>permittedPharmacyIds.has(String(id)))),
    totalSales:Object.fromEntries(Object.entries(p.totalSales||{}).filter(([id])=>permittedPharmacyIds.has(String(id))))
 }));
 // La API ya entrega solamente las promociones autorizadas. Volver a filtrarlas
 // por objetivos en React ocultaba los borradores de Excel sin farmacia asignada.

  const users=sessionUser?.role==="superadministrador"
    ? [{id:"AUTH",name:sessionUser.name||sessionUser.email,email:sessionUser.email,role:"superadmin",pharmacies:[],active:true},
       ...storedUsers.filter(user=>user.role!=="superadmin")]
    : storedUsers;
 const reportTimeZone=tenantContext?.client?.slug==="ampedia"?"Europe/Madrid":
  Intl.DateTimeFormat().resolvedOptions().timeZone;
  const promos=storedPromos.map(p=>({...p,status:effectivePromotionStatus(p,promotionClock,reportTimeZone),totalSales:salesStatus==="real"?scopePromotionSales(p,totalSalesByPromotion[p.id],"total"):{},sales:salesStatus==="real"?scopePromotionSales(p,salesByPromotion[p.id],"attributed"):{},goalSales:salesStatus==="real"?scopePromotionSales(p,goalSalesByPromotion[p.id],"attributed"):{},salesSource:salesStatus==="real"?"Ventas sincronizadas · "+tenantContext?.client?.schema+".ventas":"Sin conexión de ventas reales"}));
 
 const pharmaName=(id)=>pharmacies.find(f=>f.id===id)?.name||id;

 const promotionSelectedMonth=promotionMonthFromRange(from,to);
 const promotionQuickPeriod=promotionSelectedMonth===currentPromotionMonth(new Date(),reportTimeZone)
   ?"this_month":QUICK_PERIODS.filter(([key])=>key!=="this_month").find(([key])=>{
     const range=resolveSalesPeriod(key,new Date(),{},reportTimeZone);
     return range.valid&&range.from===from&&range.to===to;
   })?.[0]||"";
 function selectPromotionMonth(month){
   setImportViewIds(null);
   const range=promotionMonthRange(month);
   if(!range)return;
   setFrom(range.from);setTo(range.to);setSelectedPromotionIds([]);
 }
 function selectPromotionQuickPeriod(key){
   setImportViewIds(null);
   if(key==="this_month"){selectPromotionMonth(currentPromotionMonth(new Date(),reportTimeZone));return;}
   const range=resolveSalesPeriod(key,new Date(),{},reportTimeZone);
   if(!range.valid)return;
   setFrom(range.from);setTo(range.to);setSelectedPromotionIds([]);
 }
 const filterText=search.toLocaleLowerCase("es");
 const importedIdSet=importViewIds?new Set(importViewIds.map(String)):null;
 const filteredPromos=promos.filter(p=>importedIdSet?importedIdSet.has(String(p.id)):
  (p.name+" "+p.subtitle+" "+p.cns.join(" ")).toLocaleLowerCase("es").includes(filterText)
  &&(statusFilter==="Todos"||p.status===statusFilter)
  &&promotionOverlapsPeriod(p,from,to)
  &&(promotionVisibleInPharmacyScope(p,sharedPharmacyIds)||
    (canManagePromotions&&p.status==="Borrador"&&!Object.keys(p.targets||{}).length)));
 const scopedFilteredPromos=filteredPromos.map(p=>sharedPharmacyIds.length?{
  ...p,targets:Object.fromEntries(Object.entries(p.targets||{}).filter(([id])=>sharedPharmacyIds.includes(String(id)))),
  sales:Object.fromEntries(Object.entries(p.sales||{}).filter(([id])=>sharedPharmacyIds.includes(String(id)))),
   totalSales:Object.fromEntries(Object.entries(p.totalSales||{}).filter(([id])=>sharedPharmacyIds.includes(String(id))))
 }:p);
 const reportFilterBase=promos.filter(p=>promotionMatchesReportScope(p,{
  status:reportStatus,month:reportMonth,year:reportYear}));
 const reportSelected=reportFilterBase.filter(p=>reportSelectedIds.includes(p.id));
 const draftFilterBase=reportModal?promos.filter(p=>promotionMatchesReportScope(p,reportModal)):[];
 const draftVisible=reportModal?draftFilterBase.filter(p=>(p.name+" "+p.id+" "+p.cns.join(" ")).toLocaleLowerCase("es").includes(reportModal.search.toLocaleLowerCase("es"))):[];
 const draftPageSize=reportModal?.pageSize||10;
 const draftMaxPage=Math.max(0,Math.ceil(draftVisible.length/draftPageSize)-1);
 const draftPage=Math.min(reportModal?.page||0,draftMaxPage);
 const reportPharmacyIds=[...new Set([
  ...reportSelected.flatMap(p=>Object.keys(p.targets||{})),
  ...(reportSelected.some(p=>!Object.keys(p.targets||{}).length)?
   pharmacies.map(f=>String(f.id)):[])
 ])];
 const effectivePharmacyIds=selectedPharmacyIds===null?reportPharmacyIds:selectedPharmacyIds.filter(id=>reportPharmacyIds.includes(id));
 const activePharmacySet=new Set(effectivePharmacyIds);
 const reportFilteredCampaigns=reportSelected.filter(p=>selectedPharmacyIds===null||
  !Object.keys(p.targets||{}).length||Object.keys(p.targets||{}).some(id=>activePharmacySet.has(id))).map(p=>({
  ...p,
  targets:Object.fromEntries(Object.entries(objectiveTargetsForPeriod(p,reportMonth))
   .filter(([id])=>activePharmacySet.has(id))),
  sales:Object.fromEntries(Object.entries(reportMonth?p.sales:p.goalSales||{})
   .filter(([id])=>activePharmacySet.has(id))),
   totalSales:Object.fromEntries(Object.entries(p.totalSales||{}).filter(([id])=>activePharmacySet.has(id)))
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
  const reportTotalSales=reportFilteredCampaigns.reduce((n,p)=>n+sum(p.totalSales),0);
 const reportCNs=[...new Set(reportFilteredCampaigns.flatMap(p=>p.cns||[]))];
 const searchedCNs=reportCNs.filter(cn=>(cn+" "+(reportSelected.find(p=>p.cnDescriptions?.[cn])?.cnDescriptions?.[cn]||"")).toLowerCase().includes(cnSearch.toLowerCase()));
 const orderedCNs=searchedCNs.sort((a,b)=>cnSort==="asc"?a.localeCompare(b,"es",{numeric:true}):b.localeCompare(a,"es",{numeric:true}));
 const safeCNPage=Math.min(cnPage,Math.max(0,Math.ceil(orderedCNs.length/cnPageSize)-1));
 const currentUsers=users.filter(u=>(u.name+" "+u.email+" "+ROLES[u.role]).toLocaleLowerCase("es").includes(filterText));
 // El almacén solo aparece en el maestro: los informes y permisos continúan
 // utilizando exclusivamente farmacias reales.
 const establishments=tenantContext?.establishments||pharmacies;
 const currentPharmacies=establishments.filter(f=>(f.name+" "+f.city+" "+(f.sourceCode||"")).toLocaleLowerCase("es").includes(filterText));
 function nav(id,promoId,{preserveObjectiveDraft=false,objectiveMonth:requestedObjectiveMonth=""}={}){
  if(id==="promociones-objetivos"&&!preserveObjectiveDraft){
   setObjectiveCampaign(null);setObjectiveMonth("");setObjectiveRestoreError("");
  }
  const intended=id==="seguimiento-campana"?"seguimiento-global":id;
  const isAdministrative=CONFIG_IDS.has(intended)||ADMIN_IDS.has(intended);
  if(!(isAdministrative?visibleNav.some(item=>item.id===intended):intended==="acciones"?canOpenWorkCenter():canOpenSection(intended))){
   const next=NAV.find(item=>item.childOf===intended&&canOpenSection(item.id))?.id||
    (intended==="promociones"&&canOpenSection("seguimiento-global")?"seguimiento-global":null);
   if(next)return nav(next);
   return;
  }
  if(id==="seguimiento-campana"||id==="seguimiento-global"){
   const p=promoId?promos.find(item=>item.id===promoId):null;
   const defaultStatus=data.promos.some(item=>item.status==="Activa")?"Activa":"Borrador";
   const status=p?p.status:defaultStatus,ids=p?[p.id]:data.promos.filter(item=>item.status===status).map(item=>item.id);
   // Entrar al seguimiento de una campaña concreta no debe descartarla
   // por conservar el filtro mensual de la página anterior.
   const month=p?"":promotionSelectedMonth;
   setReportStatus(status);setReportYear("Todos");setReportMonth(month);
   setReportSelectedIds(ids);setReportPage(0);setSelectedPharmacyIds(null);
   setExpandedCampaignIds(p?[p.id]:data.promos.filter(item=>item.status==="Activa").slice(0,2).map(item=>item.id));
   const params=new URLSearchParams();
   if(p){params.set("ids",p.id);params.set("estado",status);}
   if(month)params.set("mes",month);
   const url="/promociones/seguimiento"+(params.size?"?"+params.toString():"");
   if(window.location.pathname+window.location.search!==url)window.history.pushState({page:"seguimiento-global"},"",url);
   setPage("seguimiento-global");setSearch("");setMobileMenu(false);return;
  }
  if(!ROUTES.has(id))return;
  const url=id==="promociones-objetivos"?objectiveEditorUrl(promoId||"",requestedObjectiveMonth):"/"+id;
  if(window.location.pathname+window.location.search!==url)window.history.pushState({page:id},"",url);
  setPage(id);setSearch("");setMobileMenu(false);
 }
 function openReportFilters(){
  setReportModal({status:reportStatus,year:reportYear,month:reportMonth,
   search:"",ids:[...reportSelectedIds],page:0,pageSize:10});
 }
 function updateDraftScope(status,month){
  setReportModal(prev=>{
   if(!prev)return prev;
   const eligible=data.promos.filter(p=>promotionMatchesReportScope(p,{status,month}));
   const kept=prev.ids.filter(id=>eligible.some(p=>p.id===id));
   return {...prev,status,month,year:"Todos",search:"",page:0,
    ids:kept.length?kept:(status==="Todos"?eligible.filter(p=>p.status==="Activa"):eligible).map(p=>p.id)};
  });
 }
 function selectReportMonth(month){
  if(month&&!promotionMonthRange(month))return;
  const eligible=data.promos.filter(p=>promotionMatchesReportScope(p,{status:reportStatus,month}));
  setReportMonth(month);setReportYear("Todos");
  setReportSelectedIds(previous=>{
   const kept=previous.filter(id=>eligible.some(p=>p.id===id));
   return kept.length?kept:(reportStatus==="Todos"?eligible.filter(p=>p.status==="Activa"):eligible).map(p=>p.id);
  });
  setReportPage(0);
 }
 function selectDraftAll(visible){setReportModal(prev=>prev?{...prev,ids:[...new Set([...prev.ids,...visible.map(p=>p.id)])]}:prev);}
 function clearDraftVisible(visible){setReportModal(prev=>prev?{...prev,ids:prev.ids.filter(id=>!visible.some(p=>p.id===id))}:prev);}
 function toggleDraftCampaign(id){setReportModal(prev=>prev?{...prev,ids:prev.ids.includes(id)?prev.ids.filter(v=>v!==id):[...prev.ids,id]}:prev);}
 function applyReportFilters(){
  if(!reportModal)return;
  const {status,month,ids}=reportModal;
  const eligible=data.promos.filter(p=>promotionMatchesReportScope(p,reportModal));
  setReportStatus(status);setReportMonth(month);setReportYear(reportModal.year);
  setReportSelectedIds(eligible.map(p=>p.id).filter(id=>ids.includes(id)));
  setSelectedPharmacyIds(sharedPharmacyIds.length?sharedPharmacyIds:null);setReportPage(0);setReportModal(null);
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
 function startPromo(p){if(p?.id?!canEditPromotions:!canCreatePromotions)return setToast("Tu perfil no permite esta operación.");if(p?.id&&p.managerCanEdit===false)return setToast("Esta campaña incluye farmacias fuera de tu ámbito.");setPromoSaveError("");const entry=p||{...EMPTY_PROMO};setEditingPromo(p?.id||"nuevo");setFormObjectiveMonth(entry.simulatorDraft?"":preferredObjectiveMonth(entry,promotionSelectedMonth,new Date()));setPromoForm({...entry,durationMode:promotionDurationMode(entry),type:entry.type||"sin_clasificar",discountPercent:entry.discountPercent??"",importWarnings:(entry.importWarnings||[]).filter(w=>!/30 d[ií]as|revisar vigencia/i.test(String(w))),cns:[...(entry.cns||[])],targets:{...(entry.targets||{})},sales:{}});setCnText((entry.cns||[]).join("\n"));}
 function openObjectivePlanner(p){
  if(!canEditPromotions||p?.managerCanEdit===false)
   return setToast("No tienes permiso para asignar objetivos a esta promoción.");
  if(!canOpenSection("promociones-objetivos"))
   return setToast("No tienes acceso a Nueva campaña para asignar objetivos.");
  const draft={...p,cns:p?.cns||[],targets:{...(p?.targets||{})},
   cnDescriptions:{...(p?.cnDescriptions||{})}};
  const month=preferredObjectiveMonth(draft,formObjectiveMonth||reportMonth||promotionSelectedMonth,new Date());
  setObjectiveMonth(month);
  setObjectiveCampaign(draft);setObjectiveSession(n=>n+1);
  setObjectiveRestoreError("");
  setEditingPromo(null);
  nav("promociones-objetivos",draft.id,{preserveObjectiveDraft:true,objectiveMonth:month});
 }
 async function saveObjectivesFromPlanner(objectives){
  if(!canEditPromotions||promotionStoreStatus!=="connected")
   throw Error("No se pueden guardar objetivos sin una conexión activa");
  const stored=data.promos.find(p=>p.id===objectiveCampaign?.id);
  if(!stored||stored.managerCanEdit===false)
   throw Error("La promoción ha desaparecido o no está autorizada. Vuelve al listado.");
  const combined={...stored,...objectiveCampaign,managerCanEdit:stored.managerCanEdit};
  const updated=mergeObjectivesIntoPromotion(combined,objectives,new Date(),reportTimeZone);
  const {managerCanEdit:_editFlag,goalSales:_derivedGoalSales,totalSales:_derivedTotal,
   salesSource:_derivedSource,...persistable}=updated;
  const response=await saveStoredPromotion(persistable);
  if(!response.saved)throw Error("El servidor no confirmó el guardado");
  // Guardar objetivos de una campaña existente no debe abrir el formulario
  // comercial ni cambiar de pantalla: actualizar el editor con lo persistido.
  const refreshed={...persistable,managerCanEdit:stored.managerCanEdit};
  setData(prev=>({...prev,promos:prev.promos.map(p=>p.id===updated.id?
   {...persistable,managerCanEdit:p.managerCanEdit}:p)}));
  setObjectiveCampaign(refreshed);
 }
 function continuePlannerToDrawer(objectives){
  // El simulador ofrece una propuesta, no objetivos guardados ni asociados
  // a un mes hasta elegir las fechas comerciales en el panel lateral.
  const draft={...EMPTY_PROMO,...objectives,id:null,name:"",description:"",
   start:"",end:"",status:"Borrador",monthlyObjectives:undefined,
   durationMode:"dates",simulatorDraft:true};
  setObjectiveCampaign(null);
  nav("promociones");
  startPromo(draft);
 }
 function returnFromPlanner(){
  // Salir del editor existente vuelve al listado, no al formulario lateral.
  setObjectiveCampaign(null);
  setObjectiveMonth("");
  nav("promociones");
 }
 async function savePromo(e){
  e.preventDefault();
  setPromoSaveError("");
  const rejectPromo=message=>{setPromoSaveError(message);setToast(message);};
  if(savingPromo)return;
  if(!(promoForm?.id?canEditPromotions:canCreatePromotions))return rejectPromo("Tu perfil no permite crear o editar esta promoción.");
  if(promotionStoreStatus!=="connected")
   return rejectPromo("No se pueden guardar promociones sin conexión con PostgreSQL. Reintenta cargar el catálogo.");
  const retroactiveFromSimulator=Boolean(promoForm.simulatorDraft&&promoForm.status==="Finalizada");
  const needsRetroactiveValidation=Boolean(promoForm.retroactive||retroactiveFromSimulator);
  const codes=parseCNs(cnText);
  if(!promoForm.name.trim())return rejectPromo("Introduce el nombre de la promoción");
  if(!codes.length&&(promoForm.status==="Activa"||needsRetroactiveValidation))return rejectPromo("Añade al menos un CN para vincular ventas a la promoción.");
   const invalid=codes.filter(cn=>!isValidCN(cn));
   if(invalid.length)return rejectPromo("Cada CN debe contener exactamente 6 dígitos, sin puntos. Revisa: "+invalid[0]);
  if((promoForm.status==="Activa"||needsRetroactiveValidation)&&!promoForm.start)return rejectPromo("La fecha de inicio es obligatoria.");
  const durationMode=promotionDurationMode(promoForm);
  if(promoForm.simulatorDraft&&!promoForm.start)
   return rejectPromo("Indica las fechas de la promoción antes de asignar los objetivos.");
  // «Activa» publica la campaña, no inicia su vigencia comercial: permitir
  // publicar antes de la fecha inicial y mantenerla publicada al vencer.
   if(durationMode==="dates"&&!promoForm.end)
    return rejectPromo("Las campañas por fechas necesitan una fecha de fin.");
   if(durationMode==="dates"&&promoForm.end&&promoForm.start&&promoForm.end<promoForm.start)
    return rejectPromo("La fecha final debe ser posterior a la inicial");
  const selections=Object.entries(promoForm.targets);
  const promoType=PROMOTION_TYPES.find(t=>t.id===promoForm.type);
   const requiresPct=promoType?.needsPercent;
  if(promoForm.status==="Activa" && !selections.length)return rejectPromo("Selecciona farmacias y completa sus objetivos antes de activar");
  if(promoForm.status==="Activa"&&selections.some(([,v])=>
    v===""||!Number.isSafeInteger(Number(v))||Number(v)<0))
    return rejectPromo("Para activar, indica objetivos enteros no negativos por farmacia.");
  if(promoForm.status==="Activa"&&!selections.some(([,v])=>Number(v)>0))
    return rejectPromo("Para activar, necesitas al menos un objetivo mayor que cero. Las farmacias sin ventas pueden tener objetivo cero.");
  if(needsRetroactiveValidation&&promoForm.type==="sin_clasificar")
    return rejectPromo("Indica el tipo de promoción para atribuir las unidades históricas. Los objetivos pueden quedar vacíos.");
  if(promoForm.status==="Activa" && promoForm.type==="sin_clasificar")
     return rejectPromo("Clasifica el tipo de promoción antes de activarla");
  if((promoForm.status==="Activa"||needsRetroactiveValidation) && requiresPct &&
    (promoForm.discountPercent==="" || !Number.isFinite(Number(promoForm.discountPercent)) || Number(promoForm.discountPercent)<=0 || Number(promoForm.discountPercent)>100))
     return rejectPromo("Introduce el porcentaje de descuento antes de activar");
  if((promoForm.status==="Activa"||needsRetroactiveValidation)&&PROMOTION_TYPES.find(t=>t.id===promoForm.type)?.needsAmount&&!(Number(promoForm.discountAmount)>0))return rejectPromo("Completa el importe del descuento en euros");
   if((promoForm.status==="Activa"||needsRetroactiveValidation)&&promoForm.type==="precio_especial"&&
     (promoForm.specialPrice===""||promoForm.specialPrice==null||!(Number(promoForm.specialPrice)>=0)))
      return rejectPromo("Completa el precio especial por unidad");
  if(selections.some(([,v])=>v!=="" && (!Number.isInteger(Number(v)) || Number(v)<0)))
     return rejectPromo("Los objetivos deben ser unidades enteras no negativas");
  if(needsRetroactiveValidation){
   const todayMadrid=civilToday(new Date(),reportTimeZone);
   if(!/^20\d{2}-\d{2}-\d{2}$/.test(promoForm.start||"")||
      !/^20\d{2}-\d{2}-\d{2}$/.test(promoForm.end||"")||
      promoForm.end>todayMadrid)
     return rejectPromo("La promoción retroactiva requiere fechas válidas y un período ya terminado.");
   if(promoForm.status!=="Finalizada")
     return rejectPromo("Las promociones retroactivas se guardan como finalizadas.");
   if(!selections.length)
     return rejectPromo("Selecciona al menos una farmacia para atribuir las ventas históricas.");
   try{promotionTicketPolicy(promoForm);}
   catch(error){return rejectPromo(error.message);}
  }
  const original=data.promos.find(p=>String(p.id)===String(promoForm.id));
  const now=new Date(),today=civilToday(now,reportTimeZone);
  const oldStatus=original?effectivePromotionStatus(original,now,reportTimeZone):"";
  const {managerCanEdit:_scopeFlag,totalSales:_derivedTotals,goalSales:_derivedGoalSales,salesSource:_derivedSource,simulatorDraft:_simDraft,...fields}=promoForm;
   const result={...fields,durationMode,end:durationMode==="stock"?"":promoForm.end,
    endRaw:durationMode==="stock"?"":promoForm.endRaw,
    retroactive:needsRetroactiveValidation,sales:{},id:promoForm.id||"P"+Date.now(),
    name:promoForm.name.trim(),cns:codes,
    targets:Object.fromEntries(selections.map(([id,v])=>[id,v===""?"":Number(v)]))};
  if(promoForm.simulatorDraft){
   try{
    Object.assign(result,assignProposalToMonth(result,formObjectiveMonth));
   }catch(error){return rejectPromo(error.message);}
  }else{
   const outside=objectiveMonthsOutsideCampaign(result);
   if(outside.length)return rejectPromo("Las fechas dejarían fuera de la promoción los objetivos de "+
    outside.join(", ")+". Ajusta las fechas o revisa los objetivos antes de guardar.");
  }
  if(result.status==="Finalizada"){
    if(needsRetroactiveValidation&&!result.closedOn)result.closedOn=result.end;
    const manualClose=oldStatus!=="Finalizada"||Boolean(result.closedOn&&!original?.closedOn);
    if(manualClose){
      if(result.closedOn&&result.closedOn<result.start)return rejectPromo("El cierre no puede ser anterior al inicio");
      result.closedOn=result.closedOn||today;
      result.closedAt=result.closedAt||now.toISOString();
      result.statusSource="manual";
    }else result.statusSource=original?.statusSource||"manual";
  }else{
    delete result.closedAt;delete result.closedOn;delete result.closedReason;
    result.statusSource=promotionStatusSourceOnSave(original,result,now,reportTimeZone);
  }
  setSavingPromo(true);
  try{
   await saveStoredPromotion(result);
   setData(prev=>({...prev,promos:prev.promos.some(p=>p.id===result.id)?
    prev.promos.map(p=>p.id===result.id?result:p):[result,...prev.promos]}));
   setEditingPromo(null);
   if(result.retroactive){
     setStatusFilter("Finalizada");
     setFrom(result.start);setTo(result.end);
     setToast("Promoción retroactiva guardada. Revisa Seguimiento para consultar sus ventas históricas.");
   }else setToast("Promoción guardada correctamente");
  }catch(err){
   const message="No se ha guardado la promoción: "+err.message+". Reintenta.";
   setPromoSaveError(message);setToast(message);
  }finally{setSavingPromo(false)}

 }
 async function removePromotion(p){
  if(!canDeletePromotions||p.managerCanEdit===false)return;
  if(deletingPromoId||deletingSelected)return;
  const confirmed=window.confirm(
   '¿Eliminar definitivamente la promoción "'+p.name+'"?\n\n'+
   'Se borrará de Farmetrica para todas las personas de este cliente. No se puede deshacer.'
  );
  if(!confirmed)return;
  setDeletingPromoId(p.id);
  try{
   // Solo quitar la campaña de la lista tras confirmar la operación del servidor.
   await deleteStoredPromotion(p.id);
   setData(prev=>({...prev,promos:prev.promos.filter(x=>String(x.id)!==String(p.id))}));
   setReportSelectedIds(prev=>prev.filter(id=>String(id)!==String(p.id)));
   setSelectedPromotionIds(prev=>prev.filter(id=>String(id)!==String(p.id)));
   setExpandedCampaignIds(prev=>prev.filter(id=>String(id)!==String(p.id)));
   if(String(promoForm.id)===String(p.id))setEditingPromo(null);
   setToast("Promoción eliminada de Farmetrica");
  }catch(err){
   setToast("No se pudo eliminar la promoción: "+err.message);
  }finally{setDeletingPromoId(null);}
 }
 async function removeSelectedPromotions(){
  if(!canDeletePromotions||deletingSelected||deletingPromoId)return;
  const ids=[...new Set(selectedPromotionIds)].filter(id=>data.promos.some(p=>String(p.id)===String(id)));
  if(!ids.length)return;
  if(data.promos.some(p=>ids.some(id=>String(id)===String(p.id))&&p.managerCanEdit===false))return setToast("Desmarca las promociones fuera de tus farmacias asignadas.");
  if(ids.length>500)return setToast("Selecciona un máximo de 500 promociones por eliminación.");
  if(!window.confirm("¿Eliminar definitivamente "+ids.length+" promociones seleccionadas?\n\nNo se puede deshacer."))return;
  setDeletingSelected(true);
  try{
   const result=await deleteStoredPromotions(ids);
   const removed=new Set((result.deletedIds||[]).map(String));
   setData(prev=>({...prev,promos:prev.promos.filter(p=>!removed.has(String(p.id)))}));
   setReportSelectedIds(prev=>prev.filter(id=>!removed.has(String(id))));
   setExpandedCampaignIds(prev=>prev.filter(id=>!removed.has(String(id))));
   setSelectedPromotionIds(prev=>prev.filter(id=>!removed.has(String(id))));
   if(removed.has(String(promoForm.id)))setEditingPromo(null);
   setToast(removed.size+" promociones eliminadas");
  }catch(err){setToast("No se pudieron eliminar las promociones: "+err.message)}
  finally{setDeletingSelected(false)}
 }
 async function activateSelectedPromotions(){
  if(!canEditPromotions||activatingSelected||deletingSelected)return;
  const selected=promos.filter(p=>selectedPromotionIds.some(id=>String(id)===String(p.id)));
  const drafts=selected.filter(p=>p.status==="Borrador");
  if(!drafts.length)return setToast("No hay promociones en borrador seleccionadas.");
  if(drafts.some(p=>p.managerCanEdit===false))return setToast("Hay promociones fuera de tus permisos.");
  if(drafts.length>200)return setToast("Selecciona un máximo de 200 borradores.");
  if(!window.confirm("¿Activar "+drafts.length+" promociones? Serán visibles para las farmacias participantes, aunque sus fechas sean futuras."))return;
  setActivationError("");
  setActivatingSelected(true);
  try{
   const result=await activateStoredPromotions(drafts.map(p=>String(p.id)));
   const activated=new Set((result.activatedIds||[]).map(String));
   if(activated.size!==drafts.length)throw Error("No se confirmó la activación de todas las promociones");
   setData(prev=>({...prev,promos:prev.promos.map(p=>activated.has(String(p.id))?
    {...p,status:"Activa",statusSource:"manual"}:p)}));
   setSelectedPromotionIds(prev=>prev.filter(id=>!activated.has(String(id))));
   setToast(activated.size+" promociones activadas correctamente.");
  }catch(error){
   setActivationError(error.message||"No se pudieron activar las promociones.");
   setToast("No se activó ninguna promoción. Revisa el motivo en el listado.");
  }finally{setActivatingSelected(false);}
 }
 function togglePromoPharmacy(id) {
  const targets={...promoForm.targets};
  const removed=Object.hasOwn(targets,id);
  if(removed)delete targets[id];else targets[id]="";
  // Una farmacia retirada no puede permanecer oculta en objetivos de otros meses.
  // No cambiar las unidades de las demás farmacias.
  const monthlyObjectives=removed&&promoForm.monthlyObjectives?
   Object.fromEntries(Object.entries(promoForm.monthlyObjectives).map(([month,entry])=>{
    const next={...(entry.targets||{})};delete next[id];
    return [month,{...entry,targets:next}];
   })):promoForm.monthlyObjectives;
  setPromoForm({...promoForm,targets,monthlyObjectives});
 }
 async function importPromotionFile(event){
   const input=event.currentTarget;
   const file=input?.files?.[0];if(!file)return;
   if(importBusy)return;
   setImportBusy(true);
   setImportFeedback({kind:"progress",message:"Importando Excel…"});
   try{
    if(!canImportPromotions)throw Error("Tu perfil no permite importar promociones");
    const campaigns=await readPromotionExcel(file);
    const batchId=await promotionExcelBatchId(file);
    const timeZone=tenantContext?.client?.slug==="ampedia"?"Europe/Madrid":
      Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now=new Date();
    const newPromos=campaigns.map(p=>({...p,
      importBatchId:batchId,importedAt:now.toISOString(),importedOn:civilToday(now,timeZone),
      statusSource:"automatic",status:importedPromotionStatus({...p,importedOn:civilToday(now,timeZone)},now,timeZone)}));
    setImportFeedback({kind:"progress",message:"Guardando promociones…"});
    const result=await importStoredPromotions(newPromos);
    const source="Excel: "+file.name;
    const summary=importResultSummary(result,newPromos,source);
    setData(prev=>({...prev,promos:result.promotions}));
    setReportSelectedIds(prev=>[...new Set([...prev,...result.promotions.map(p=>p.id)])]);
    // Las campañas importadas sin objetivos son borradores; el filtro Activa
    // y la selección de farmacias solían ocultarlas aunque el servidor las
    // hubiera guardado. Mostrar las del fichero sin depender de esos filtros.
    setSearch("");setStatusFilter("Todos");
    setImportViewIds(summary.visibleIds);
    setFrom("");setTo("");
    setImportFeedback({kind:"success",
      message:summary.imported?
       summary.imported+" "+(summary.imported===1?"promoción importada":"promociones importadas"):
       summary.skipped+" "+(summary.skipped===1?"promoción ya importada":"promociones ya importadas")});
   }catch(error){
    // El aviso permanece visible: en móvil un toast de 3 segundos se perdía
    // antes de que el usuario llegara a leer el error.
    setImportFeedback({kind:"error",
      message:"No se pudo importar: "+(error.message||"Error al leer el Excel")});
   }finally{setImportBusy(false);if(input)input.value="";}
  }
  function exportLocalPromos(){
    const key="fm_promos_respaldo_v1:"+tenantContext?.client?.slug+":"+String(sessionUser?.email||"").toLowerCase();
    const backup=localStorage.getItem(key)||JSON.stringify(data.promos);
    const url=URL.createObjectURL(new Blob([backup],{type:"application/json;charset=utf-8"}));
    const a=document.createElement("a");a.href=url;a.download="farmetrica-promociones-respaldo.json";a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function saveExistingLocalPromos(){
    try{
      const remote=await loadStoredPromotions();
      const ids=new Set((remote.promotions||[]).map(p=>String(p.id)));
      const missing=data.promos.filter(p=>!ids.has(String(p.id)));
      if(!missing.length){setToast("Todas las promociones locales ya están en PostgreSQL.");return;}
      if(!window.confirm("Guardar "+missing.length+" promociones de este navegador en PostgreSQL sin sobrescribir campañas existentes?"))return;
      let failures=0;
      for(let i=0;i<missing.length;i+=5){
        const results=await Promise.allSettled(missing.slice(i,i+5).map(p=>saveStoredPromotion(p)));
        failures+=results.filter(r=>r.status==="rejected").length;
      }
      setToast(failures?failures+" promociones siguen pendientes; permanecen en este navegador.":missing.length+" promociones transferidas a PostgreSQL.");
    }catch(err){setToast("No se pudo transferir: "+err.message);}
  }
  function copyPromo(p){startPromo({...p,id:null,name:p.name+" (copia)",status:"Borrador",sales:{}});setToast("Revisa la copia antes de guardarla");}
 async function exportPromo(p){
  try{await exportPromotionExcel(p,pharmaName);setToast("Excel de la promoción descargado");}
  catch(error){console.error(error);setToast("No se pudo generar el Excel");}
 }
 async function exportLabCampaigns(campaigns,mode="real"){
  if(labExportBusy)return;
  if(!campaigns.length){setToast("Selecciona alguna campaña para exportar");return;}
  if(salesStatus!=="real"){
    setToast("Para exportar al laboratorio es necesaria la conexión con las ventas sincronizadas.");
    return;
  }
  try{
    campaigns.forEach(p=>{validateLabPromotion({...p,end:promotionReportingEnd(p,new Date(),reportTimeZone)});promotionTicketPolicy(p);});
    if(!effectivePharmacyIds.length)throw Error("Selecciona al menos una farmacia");
  }catch(error){setToast(error.message);return;}
  if(campaigns.length>10&&!window.confirm(
    "¿Preparar "+campaigns.length+" Excel de laboratorio en un ZIP? Puede tardar unos minutos."))return;
  setLabExportBusy(true);
  try{
    const items=[];
    for(let i=0;i<campaigns.length;i++){
      const original=campaigns[i];
       const promo={...original,end:promotionReportingEnd(original,new Date(),reportTimeZone)};
      const selectedIds=effectivePharmacyIds.filter(id=>Object.hasOwn(promo.targets||{},id));
      if(!selectedIds.length)continue;
      setToast("Preparando laboratorio "+(i+1)+"/"+campaigns.length+": "+promo.name);
      const lines=await preparePromotionLabExport(promo,loadTicketLines,
        {pharmacyIds:selectedIds,mode});
      items.push({promo,lines});
    }
    if(!items.length)throw Error("No hay farmacias participantes en la selección.");
    const options={includeSeller:labIncludeSeller,mode};
    if(items.length===1){
      await exportLabSalesExcel(items[0].promo,items[0].lines,options);
      setToast("Excel "+(mode==="simulated"?"con promociones aplicadas":"real")+" descargado.");
    }else{
      await exportLabSalesZip(items,options);
      setToast("ZIP descargado: "+items.length+" Excel de laboratorio.");
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
    setPharmacyApiStatus("cargando");
    try {
      if (!(await hasPharmacySession())) {setPharmacyApiStatus("sin_sesion");return;}
      const records=await loadPharmacies();
      setData(prev=>({...prev,pharmacies:records}));
      // Solo el maestro administrativo ve almacenes; no entran en los
      // selectores de ventas, promociones, medicamentos ni usuarios.
      if(tenantContext?.client?.slug){
       const response=await fetch("/api/tenant/establecimientos",{
        credentials:"same-origin",cache:"no-store",
        headers:{"X-Farmetrica-Cliente":tenantContext.client.slug}});
       if(response.ok){
        const all=await response.json();
        if(Array.isArray(all))setTenantContext(c=>c?{...c,establishments:all}:c);
       }
      }
      setPharmacyApiStatus("connected");setPharmacyApiError("");setPharmacyLastUpdated(new Date());
    } catch(err) {setPharmacyApiStatus("error");setPharmacyApiError(err.message);}
  }
  async function connectPharmacies(){
    try {setPharmacyApiError("");await signInPharmacies();await refreshPharmacies();}
    catch(err){setPharmacyApiStatus("error");setPharmacyApiError(err.message);}
  }
  function startPharmacy(f){
    if(f?.establishmentType==="almacen"){
      setToast("Almacén central · ID "+f.id+" · código "+f.sourceCode+" · origen "+f.sourceDatabase+". Se configura desde el sincronizador.");
      return;
    }
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
  const configuredDrawerMonths=Object.keys(promoForm.monthlyObjectives||{}).sort();
 const goalProposalMonths=promoForm.simulatorDraft?promotionDraftGoalMonths(promoForm):[];
 const selectedProposalMonth=goalProposalMonths.length===1?goalProposalMonths[0]:
  goalProposalMonths.includes(formObjectiveMonth)?formObjectiveMonth:"";
 const activeDrawerMonth=configuredDrawerMonths.includes(formObjectiveMonth)?formObjectiveMonth:configuredDrawerMonths[0]||"";
 const drawerTargets=promoForm.simulatorDraft?promoForm.targets:activeDrawerMonth?
  promoForm.monthlyObjectives?.[activeDrawerMonth]?.targets||{}:promoForm.targets;
 const cnParsed=parseCNs(cnText);
 const title=page==="seguimiento-global"?"Seguimiento":NAV.find(n=>n.id===page)?.label||"Dashboard";
 useEffect(()=>{
  if(page!=="seguimiento-global")return;
  const params=new URLSearchParams();
  params.set("estado",reportStatus);
  if(reportMonth)params.set("mes",reportMonth);
  else if(reportYear!=="Todos")params.set("anio",reportYear);
  params.set("ids",reportSelectedIds.join(","));
   if(selectedPharmacyIds!==null)params.set("farmacias",selectedPharmacyIds.join(","));
  const url="/promociones/seguimiento?"+params.toString();
  if(window.location.pathname+window.location.search!==url)window.history.replaceState({page},"",url);
 },[page,reportStatus,reportYear,reportMonth,reportSelectedIds,selectedPharmacyIds]);
 useEffect(()=>{if(CONFIG_IDS.has(page))setSettingsOpen(true);if(ADMIN_IDS.has(page))setAdminOpen(true)},[page]);
 useEffect(()=>{
  // Si se navega directamente a una subpágina, mostrar sus opciones.
  const parent=page==="seguimiento-global"?"promociones":NAV.find(item=>item.id===page)?.childOf||page;
  setExpandedNavIds(previous=>previous.includes(parent)?previous:[...previous,parent]);
 },[page]);
 const role=tenantContext?.role;
 const canManagePromotions=["gestor","administrador","superadministrador"].includes(role);
 // Los perfiles limitan operaciones sin modificar la política previa de rol.
 const promotionPermissions=tenantContext?.profile?.permissions;
 const promotionAllowed=operation=>role==="superadministrador"||
   promotionPermissions==null||promotionPermissions?.promociones?.includes(operation);
 const canCreatePromotions=canManagePromotions&&promotionAllowed("crear");
 const canEditPromotions=canManagePromotions&&promotionAllowed("editar");
 const canDeletePromotions=canManagePromotions&&promotionAllowed("eliminar");
 const canImportPromotions=canManagePromotions&&promotionAllowed("importar");
 const canExportPromotions=promotionAllowed("exportar");
 const objectiveLocation=page==="promociones-objetivos"?
  objectiveEditorRoute(window.location.pathname,window.location.search):null;
 // En F5, Ctrl+R, enlaces compartidos y Atrás/Adelante reconstruir el
 // borrador del servidor. No abrir jamás "Nueva campaña" si existe un ID.
 useEffect(()=>{
  if(page!=="promociones-objetivos")return;
  const route=objectiveEditorRoute(window.location.pathname,window.location.search);
  if(!route?.id&&!route?.invalid){
   setObjectiveRestoreError("");
   if(objectiveCampaign){setObjectiveCampaign(null);setObjectiveMonth("");}
   return;
  }
  if(route.invalid){
   setObjectiveRestoreError("El identificador de promoción de la URL no es válido.");
   return;
  }
  if(!sessionUser||!tenantContext||!objectiveCatalogLoaded)return;
  if(promotionStoreStatus!=="connected"){
   if(promotionStoreStatus==="error")
    setObjectiveRestoreError("No se pudieron cargar las promociones del servidor. Reintenta la conexión.");
   return;
  }
  const stored=data.promos.find(p=>String(p.id)===route.id);
  if(!stored||stored.managerCanEdit===false||
   !["gestor","administrador","superadministrador"].includes(tenantContext.role)){
   setObjectiveRestoreError("La promoción ya no existe o no tienes permiso para editar sus objetivos.");
   return;
  }
  const selected=preferredObjectiveMonth(stored,route.month,new Date());
  if(route.month!==selected)
   window.history.replaceState({page:"promociones-objetivos"},"",
    objectiveEditorUrl(route.id,selected));
  if(objectiveCampaign?.id===stored.id&&objectiveMonth===selected){
   setObjectiveRestoreError("");
   return;
  }
  setObjectiveRestoreError("");
  setObjectiveCampaign(stored);
  setObjectiveMonth(selected);
  setObjectiveSession(v=>v+1);
 },[page,objectiveCatalogLoaded,promotionStoreStatus,data.promos,
  objectiveRouteRevision,tenantContext?.client?.slug,sessionUser?.email,
  objectiveCampaign?.id,objectiveMonth]);
 // Para el personal de farmacia, abrir el catálogo publicado sin limitarlo
 // al mes en curso: también deben ver campañas activadas para el mes próximo.
 useEffect(()=>{
  if(!role)return;
  if(!["gestor","administrador","superadministrador"].includes(role)){
   setFrom("");setTo("");setStatusFilter("Activa");setImportViewIds(null);
  }
 },[tenantContext?.client?.slug,role]);
 const canOpenSection=id=>sessionUser?.role==="superadministrador"||
   tenantContext?.sections?.[id]===true;
 const canOpenWorkCenter=()=>["acciones","oportunidades-seguimiento","mi-trabajo","alertas","rentabilidad-retorno"]
   .some(canOpenSection);
 const visibleNav=NAV.filter(item=>{
   if(item.super)return sessionUser?.role==="superadministrador";
   if(item.id==="picking-list"&&!["administrador","gestor","superadministrador"].includes(role))return false;
   if(item.admin)return ["administrador","superadministrador"].includes(role)||(["usuarios","estado","perfiles"].includes(item.id)&&role==="gestor");
   if(item.id==="acciones")return canOpenWorkCenter();
   if(item.module)return canOpenSection(item.id)||
     NAV.some(child=>child.childOf===item.id&&canOpenSection(child.id))||
     (item.id==="promociones"&&canOpenSection("seguimiento-global"));
   return true;
 });
 const breadcrumbs=navigationBreadcrumbs(page,NAV,canOpenSection,
  {editingObjectives:Boolean(objectiveCampaign||objectiveLocation?.id)});
 const allowed=page==="proveedores"?canOpenSection(page):
   CONFIG_IDS.has(page)||ADMIN_IDS.has(page)?
   visibleNav.some(item=>item.id===page):page==="acciones"?canOpenWorkCenter():canOpenSection(page);
 // Durante la carga, el cliente puede estar listo antes que el usuario.
 // No redirigir de /ventas a /promociones mientras el rol aún no está resuelto.
 useEffect(()=>{
   if(tenantContext && sessionUser && !allowed)
     nav(visibleNav.find(item=>item.module&&canOpenSection(item.id))?.id||
       (canOpenSection("seguimiento-global")?"seguimiento-global":visibleNav[0]?.id)||"dashboard");
 },[tenantContext,sessionUser,page,allowed]);
 if(!tenantContext||!sessionUser||!allowed)return <StartupScreen error={authError}/>;
 return <div className="app-shell">
  <aside id="farmetrica-sidebar" aria-label="Navegación principal" className={"sidebar "+(mobileMenu?"sidebar-open":"")}>
   <button className="brand" onClick={()=>nav(visibleNav.find(item=>item.module&&canOpenSection(item.id))?.id||visibleNav[0]?.id||"dashboard")}><span className="brand-mark" aria-hidden="true"><img className="fm-emblem" src="/brand-logo.webp?v=4" alt="" /></span><span>Farmetrica</span></button>
   <nav className="side-nav" aria-label="Módulos">
    {visibleNav.filter(item=>!item.childOf&&!CONFIG_IDS.has(item.id)&&!ADMIN_IDS.has(item.id)&&DEMO_NAV_IDS.has(item.id)).map(item=>{
     const children=visibleNav.filter(child=>child.childOf===item.id&&DEMO_NAV_IDS.has(child.id));
     const hasChildren=children.length>0||(item.id==="promociones"&&canOpenSection("seguimiento-global"));
     const expanded=hasChildren&&expandedNavIds.includes(item.id);
     const submenuId="fm-submenu-"+item.id;
     return <React.Fragment key={item.id}>
      <div className={hasChildren?"side-nav-parent has-submenu":"side-nav-parent"}>
       <button className={"side-link "+(page===item.id?"active":"")} type="button"
        onClick={()=>nav(item.id)} aria-current={page===item.id?"page":undefined}>
        <item.icon size={19}/><span>{item.label}</span>
        {item.preview&&<small className="side-preview-badge">Demo</small>}
        {page===item.id&&<span className="active-dot"/>}
       </button>
       {hasChildren&&<button className="side-nav-caret" type="button"
        aria-label={(expanded?"Ocultar":"Mostrar")+" subopciones de "+item.label}
        aria-expanded={expanded} aria-controls={submenuId}
        onClick={()=>setExpandedNavIds(previous=>expanded?
         previous.filter(id=>id!==item.id):[...previous,item.id])}>
         <ChevronDown size={20} strokeWidth={3} className={"side-settings-chevron"+(expanded?" open":"")}/>
        </button>}
      </div>
      {hasChildren&&<div id={submenuId} className="side-nav-submenu" hidden={!expanded}>
       {children.map(child=><button key={child.id}
        className={"side-link side-sublink "+(page===child.id?"active":"")}
        type="button" onClick={()=>nav(child.id)} aria-current={page===child.id?"page":undefined}>
        <child.icon size={16}/><span>{child.label}</span>
        {child.preview&&<small className="side-preview-badge">Demo</small>}
        {page===child.id&&<span className="active-dot"/>}</button>)}
       {item.id==="promociones"&&canOpenSection("seguimiento-global")&&<button
        className={"side-link side-sublink "+(page==="seguimiento-global"?"active":"")}
        type="button" onClick={()=>nav("seguimiento-global")}
        aria-current={page==="seguimiento-global"?"page":undefined}>
         <BarChart3 size={16}/><span>Seguimiento</span>
         {page==="seguimiento-global"&&<span className="active-dot"/>}
        </button>}
      </div>}
     </React.Fragment>;
    })}
    {visibleNav.some(item=>CONFIG_IDS.has(item.id))&&<>
     <button className={"side-link "+(CONFIG_IDS.has(page)?"active":"")} type="button"
      aria-expanded={settingsOpen} aria-controls="fm-settings-nav" onClick={()=>setSettingsOpen(v=>!v)}>
      <Settings2 size={19}/><span>Configuración</span>
      <ChevronDown size={20} strokeWidth={3} className={"side-settings-chevron"+(settingsOpen?" open":"")}/>
     </button>
     {settingsOpen&&<div id="fm-settings-nav" className="side-settings-children">
      {visibleNav.filter(item=>CONFIG_IDS.has(item.id)).map(item=>
       <button key={item.id} type="button" className={"side-link "+(page===item.id?"active":"")}
        onClick={()=>nav(item.id)}><item.icon size={16}/><span>{item.label}</span>
        {page===item.id&&<span className="active-dot"/>}</button>)}
     </div>}
    </>}
    {visibleNav.some(item=>ADMIN_IDS.has(item.id))&&<>
     <button className={"side-link "+(ADMIN_IDS.has(page)?"active":"")} type="button"
      aria-expanded={adminOpen} aria-controls="fm-admin-nav" onClick={()=>setAdminOpen(v=>!v)}>
      <ShieldCheck size={19}/><span>Administración</span>
      <ChevronDown size={20} strokeWidth={3} className={"side-settings-chevron"+(adminOpen?" open":"")}/>
     </button>
     {adminOpen&&<div id="fm-admin-nav" className="side-settings-children">
      {visibleNav.filter(item=>ADMIN_IDS.has(item.id)).map(item=>
       <button key={item.id} type="button" className={"side-link "+(page===item.id?"active":"")}
        onClick={()=>nav(item.id)}><item.icon size={16}/><span>{item.label}</span>
        {page===item.id&&<span className="active-dot"/>}</button>)}
     </div>}
    </>}
   </nav>
  </aside>
  {mobileMenu&&<button className="mobile-scrim" type="button" onClick={()=>setMobileMenu(false)} aria-label="Cerrar navegación"/>}
  <div className="workspace">
   <header className="topbar">
    <button className="mobile-toggle icon-btn" type="button" aria-controls="farmetrica-sidebar" aria-expanded={mobileMenu} onClick={()=>setMobileMenu(v=>!v)} aria-label={mobileMenu?"Cerrar menú":"Abrir menú"}><LayoutDashboard size={20}/></button>
    <div className="topbar-title"><strong className="topbar-wordmark">Farmetrica</strong></div>
    <div className="topbar-right">{tenantContext.clients.length>1&&<select className="fm-client-selector" aria-label="Cambiar de cliente" value={tenantContext.client.slug} onChange={e=>activateClient(e.target.value)}>{tenantContext.clients.map(c=><option key={c.slug} value={c.slug}>{c.name}</option>)}</select>}<button className="icon-btn" title="Sin notificaciones por ahora" onClick={()=>setToast("Sin notificaciones nuevas")}><Bell size={19}/></button><span className="topbar-divider"/><span className="avatar avatar-green">{(sessionUser?.email||"FM").slice(0,2).toUpperCase()}</span>
       {(sessionUser?.source==="local"||sessionUser?.source==="interno")&&<button type="button" className="btn btn-secondary btn-sm"
        onClick={()=>setPasswordModal(true)} aria-label="Cambiar contraseña">
        <ShieldCheck size={14}/> Cambiar contraseña</button>}
       <span className="top-user">{sessionUser?.name||sessionUser?.email||"Administrador"}<small>{sessionUser?.role==="superadministrador"?"Superadministrador":tenantContext.role==="administrador"?"Administrador de cliente":"Usuario autorizado"}</small></span>
       <button type="button" className="icon-btn" title="Cerrar sesión" aria-label="Cerrar sesión" onClick={signOut}><LogOut size={18}/></button></div>
   </header>
   <main className="main-content">
   <AppBreadcrumbs items={breadcrumbs} onNavigate={nav}/>
   <React.Suspense fallback={<LoadingStatus label="Cargando sección…"/>}>
    {["promociones","seguimiento-global"].includes(page)&&promotionStoreStatus!=="connected"&&
     <section className="card fm-preview-panel" role={promotionStoreStatus==="error"?"alert":"status"}>
      <h2>{promotionStoreStatus==="error"?"No se pudieron consultar las promociones":"Consultando promociones…"}</h2>
      <p>{promotionStoreStatus==="error"?
       "El catálogo compartido no está disponible. No se muestran copias antiguas del navegador para evitar confusiones.":
       "Cargando las campañas compartidas del cliente."}</p>
      {promotionStoreStatus==="error"&&<button className="btn btn-secondary" type="button"
       onClick={()=>void retryPromotions()}>Reintentar</button>}
     </section>}
    {page==="promociones"&&promotionStoreStatus==="connected"&&<>
 <ReportPageHeader title="Promociones" updatedAt={salesLastUpdated}
  onRefresh={()=>void retryPromotions()} refreshing={promotionStoreStatus==="checking"||salesStatus==="cargando"}
  period={from&&to&&from<=to?{valid:true,from,to}:null}
  actions={<div className="campaign-header-actions">
   <input ref={importFileRef} type="file" accept=".xlsx" hidden onChange={importPromotionFile}/>
   {canImportPromotions&&<button className="btn btn-secondary" type="button" disabled={importBusy||promotionStoreStatus!=="connected"}
    aria-busy={importBusy} onClick={()=>importFileRef.current?.click()}>
    {importBusy?<span className="fm-load-spinner" aria-hidden="true"/>:<Upload size={17}/>}
    {importBusy?"Importando y guardando…":"Importar Excel"}</button>}

  </div>}/>
  {importFeedback&&<div className={"fm-import-result fm-import-result-"+importFeedback.kind}
    role={importFeedback.kind==="error"?"alert":"status"} aria-live={importFeedback.kind==="error"?"assertive":"polite"}>
    {importFeedback.kind==="success"?<CheckCircle2 size={16} aria-hidden="true"/>:
     importFeedback.kind==="error"?<CircleHelp size={16} aria-hidden="true"/>:
     <span className="fm-load-spinner" aria-hidden="true"/>}
    <span className="fm-import-result-message">{importFeedback.message}</span>
    {importFeedback.kind!=="progress"&&<button type="button" className="icon-btn"
      onClick={()=>setImportFeedback(null)}
      aria-label="Cerrar aviso de importación"><X size={16}/></button>}
   </div>}
 <ReportFilterBar showPeriod={false} pharmacies={pharmacies} pharmacyIds={sharedPharmacyIds}
  onPharmacyChange={ids=>{setImportViewIds(null);selectSharedPharmacies(ids)}}
  quickPeriodKey={promotionQuickPeriod} onQuickPeriodChange={selectPromotionQuickPeriod}>
  <label className="fm-unified-filter">Buscar promoción o CN
   <input type="search" value={search} onChange={e=>{setImportViewIds(null);setSearch(e.target.value)}} placeholder="Nombre, laboratorio o CN…"/></label>
  <label className="fm-unified-filter">Estado
   <select value={statusFilter} onChange={e=>{setImportViewIds(null);setStatusFilter(e.target.value)}}>
    <option value="Todos">Todos los estados</option><option>Activa</option><option>Borrador</option>
    <option value="Finalizada">Archivada</option>
   </select></label>
  <label className="fm-unified-filter">Mes y año
   <input type="month" value={promotionSelectedMonth} onChange={e=>selectPromotionMonth(e.target.value)}
    aria-label="Seleccionar mes y año de promociones"/></label>
  <label className="fm-unified-filter">Desde
   <input type="date" value={from} onChange={e=>{setImportViewIds(null);setFrom(e.target.value);setSelectedPromotionIds([])}}/></label>
  <label className="fm-unified-filter">Hasta
   <input type="date" value={to} onChange={e=>{setImportViewIds(null);setTo(e.target.value);setSelectedPromotionIds([])}}/></label>
  <button type="button" className="fm-promotion-all-periods" aria-pressed={!from&&!to}
   onClick={()=>{setImportViewIds(null);setFrom("");setTo("");setSelectedPromotionIds([])}}>Ver todos los meses</button>
 </ReportFilterBar>
  {salesStatus==="cargando"&&<div className="fm-loading-message"><LoadingStatus label="Calculando ventas y objetivos de las promociones…"/></div>}
  {salesStatus==="error"&&<p role="alert" className="fm-inline-status">{salesError||"No se pudieron consultar las ventas"}</p>}
 <CampaignMetrics campaigns={scopedFilteredPromos} heading="Resumen de promociones" salesAvailable={salesStatus==="real"} salesLoading={salesStatus==="cargando"}/>
 <section className="card list-card full-table-card">
  <div className="section-heading"><div><h2>Listado de promociones</h2>
    {importViewIds&&<div className="fm-imported-view">
      <span>Promociones del Excel</span>
      <button type="button" className="btn btn-secondary btn-sm" onClick={()=>{
       setImportViewIds(null);
       const month=promotionMonthRange(currentPromotionMonth(new Date(),reportTimeZone));
       if(month){setFrom(month.from);setTo(month.to);}
       setSelectedPromotionIds([]);
      }}>Volver al mes actual</button>
    </div>}</div>
    <div className="fm-promotions-bulk-actions">
     {(canEditPromotions||canDeletePromotions)&&selectedPromotionIds.length>0&&<>
      <span className="count-label">{selectedPromotionIds.length} seleccionadas</span>
      <button type="button" className="btn btn-secondary btn-sm" disabled={deletingSelected||Boolean(deletingPromoId)}
       onClick={()=>setSelectedPromotionIds([])}>Deseleccionar</button>
      {canEditPromotions&&selectedPromotionIds.some(id=>promos.some(p=>String(p.id)===String(id)&&p.status==="Borrador"))&&
       <button type="button" className="btn btn-secondary btn-sm" disabled={activatingSelected||deletingSelected||Boolean(deletingPromoId)}
        onClick={()=>void activateSelectedPromotions()}><Check size={15}/>
        {activatingSelected?"Activando…":"Activar seleccionadas"}</button>}
      {canDeletePromotions&&<button type="button" className="btn btn-secondary btn-sm fm-delete-promo" disabled={activatingSelected||deletingSelected||Boolean(deletingPromoId)}
       onClick={()=>void removeSelectedPromotions()}><Trash2 size={15}/>
       {deletingSelected?"Eliminando…":"Eliminar seleccionadas"}</button>}
     </>}
     <span className="count-label">{scopedFilteredPromos.length} promociones</span>
    </div>
   </div>
  {activationError&&<div className="fm-promotion-activation-error" role="alert">
   <div><strong>No se activó ninguna promoción</strong>
    <p>{activationError}</p>
    <small>Puedes corregir los datos de la promoción indicada y volver a intentarlo. Los objetivos de otros meses se pueden añadir más adelante.</small>
   </div>
   <button type="button" className="btn btn-secondary btn-sm"
    onClick={()=>setActivationError("")}>Cerrar aviso</button>
  </div>}
  <ListTable rows={scopedFilteredPromos} rowKey={p=>p.id} label="promociones" defaultSort={{key:"start",direction:"desc"}} loading={salesStatus==="cargando"} loadingLabel="Calculando ventas de las promociones…"
    tableClass="campaign-table"
     selection={(canEditPromotions||canDeletePromotions)?{
      selectedKeys:selectedPromotionIds,onChange:setSelectedPromotionIds,
      disabled:deletingSelected||Boolean(deletingPromoId)}:null}
     onRowClick={canEditPromotions?p=>startPromo(promos.find(original=>original.id===p.id)||p):undefined} emptyText="No hay promociones con estos filtros"
    columns={[
      {key:"name",label:"Promoción",value:p=>p.name+" "+(p.subtitle||""),render:p=><div className="promotion-cell"><span className="promotion-icon"><Tag size={17}/></span><div><strong>{p.name}</strong><small>{p.subtitle||"Promoción"}</small></div></div>},
      {key:"type",label:"Tipo",filterMode:"multi",value:p=>PROMOTION_TYPES.find(t=>t.id===p.type)?.name||"Por revisar",render:p=><span className="id-code">{PROMOTION_TYPES.find(t=>t.id===p.type)?.name||"Por revisar"}</span>},
      {key:"status",label:"Estado",filterMode:"multi",value:p=>p.status,render:p=><Pill status={p.status}/>},
      {key:"start",label:"Periodo",value:p=>p.start,render:p=><div className="small-stack">{dateES(p.start)}<small>{p.end?dateES(p.end):promotionDurationMode(p)==="stock"?"Hasta agotar stock":"Sin fecha de fin"}</small></div>},
      {key:"cns",label:"CN",filterMode:"multi",filterValues:p=>p.cns||[],
  options:items=>[...new Set(items.flatMap(p=>p.cns||[]))].map(cn=>({value:cn,label:cn})),
  value:p=>p.cns.length,render:p=><span className="td-number">{p.cns.length}</span>},
      {key:"pharmacies",label:"Farmacias",filterMode:"multi",
  filterValues:p=>Object.keys(p.targets||{}),
  options:items=>pharmacies.filter(f=>items.some(p=>Object.hasOwn(p.targets||{},f.id)))
    .map(f=>({value:f.id,label:f.name})),
  value:p=>Object.keys(p.targets||{}).length,render:p=><span className="td-number">{Object.keys(p.targets||{}).length}</span>},
      {key:"goal",label:"Objetivo",value:p=>sum(p.targets),render:p=><span className="td-number">{quantity(sum(p.targets))}</span>},
      {key:"sales",label:"Uds. en promoción",value:p=>salesStatus==="real"?sum(p.sales):null,render:p=><span className="td-number">{salesStatus==="cargando"?<SkeletonLine width="64px" height="17px"/>:salesStatus==="real"?quantity(sum(p.sales)):"—"}</span>},
      {key:"totalSales",label:"Uds. totales",value:p=>salesStatus==="real"?sum(p.totalSales):null,render:p=><span className="td-number">{salesStatus==="cargando"?<SkeletonLine width="64px" height="17px"/>:salesStatus==="real"?quantity(sum(p.totalSales)):"—"}</span>},
       {key:"advance",label:"Avance",value:p=>salesStatus==="real"&&sum(p.targets)>0?percent(sum(p.sales),sum(p.targets)):null,render:p=>salesStatus==="cargando"?<SkeletonLine width="95px" height="15px"/>:salesStatus==="real"&&sum(p.targets)>0?<div className="table-progress"><Progress value={percent(sum(p.sales),sum(p.targets))}/><span>{percent(sum(p.sales),sum(p.targets))}%</span></div>:<span className="td-number">—</span>},
      {key:"actions",label:"Acciones",value:()=>"",sortable:false,searchable:false,
       render:p=><div className="campaign-row-actions fm-promotion-unified-actions">
        {canEditPromotions&&p.managerCanEdit!==false&&<button type="button" className="btn btn-secondary btn-sm"
         onClick={e=>{e.stopPropagation();startPromo(promos.find(original=>original.id===p.id)||p);}}>
         <Pencil size={14}/> Editar</button>}
        {canEditPromotions&&objectivePromotionIsEditable(p)&&<button type="button" className="btn btn-secondary btn-sm"
         onClick={e=>{e.stopPropagation();openObjectivePlanner(promos.find(original=>original.id===p.id)||p);}}>
         <Target size={14}/> {hasMonthlyObjectives(p)?"Editar objetivos":"Asignar objetivos"}</button>}
        <button type="button" className="btn btn-secondary btn-sm"
         onClick={e=>{e.stopPropagation();nav("seguimiento-campana",p.id);}}>
         <BarChart3 size={14}/> Seguimiento</button>
        {canEditPromotions&&p.managerCanEdit!==false&&p.status!=="Finalizada"&&p.start<=civilToday(new Date(),reportTimeZone)&&
         <button type="button" className="btn btn-secondary btn-sm"
          onClick={e=>{e.stopPropagation();const original=promos.find(x=>x.id===p.id)||p;
           startPromo({...original,status:"Finalizada",closedOn:civilToday(new Date(),reportTimeZone)});}}>
          Finalizar</button>}
        {canDeletePromotions&&p.managerCanEdit!==false&&<button type="button"
         className="btn btn-secondary btn-sm fm-delete-promo" disabled={Boolean(deletingPromoId)||deletingSelected}
         aria-label={"Eliminar "+p.name}
         onClick={e=>{e.stopPropagation();void removePromotion(promos.find(original=>original.id===p.id)||p);}}>
         <Trash2 size={14}/> Eliminar</button>}
       </div>}
    ]}/>
 </section>

</>}
{page==="seguimiento-global"&&promotionStoreStatus==="connected"&&<>
 <ReportPageHeader title="Seguimiento" updatedAt={salesLastUpdated}
  period={from&&to&&from<=to?{valid:true,from,to}:null}
  onRefresh={()=>void retryPromotions()} refreshing={promotionStoreStatus==="checking"||salesStatus==="cargando"}
  actions={<div className="campaign-header-actions">
   <button className="btn btn-secondary" onClick={openReportFilters}><Filter size={17}/>
    Filtrar campañas <span className="report-button-count">{reportSelected.length}</span></button>
   {canExportPromotions&&<label className="fm-lab-seller-option">
    <input type="checkbox" checked={labIncludeSeller} disabled={labExportBusy}
      onChange={e=>setLabIncludeSeller(e.target.checked)}/> Incluir vendedor
   </label>}
   {canExportPromotions&&<button className="btn btn-secondary" type="button"
    disabled={!reportFilteredCampaigns.length||!effectivePharmacyIds.length||labExportBusy}
    onClick={()=>void exportLabCampaigns(reportFilteredCampaigns,"real")}
    title="Ventas reales de tickets válidos; importes sin modificar">
    {labExportBusy?<span className="fm-load-spinner" aria-hidden="true"/>:<ArrowDownToLine size={17}/>}
    Exportar real
   </button>}
   {canExportPromotions&&<button className="btn btn-primary" type="button"
    disabled={!reportFilteredCampaigns.length||!effectivePharmacyIds.length||labExportBusy}
    onClick={()=>void exportLabCampaigns(reportFilteredCampaigns,"simulated")}
    title="Importes teóricos aplicando la promoción por ticket">
    {labExportBusy?<span className="fm-load-spinner" aria-hidden="true"/>:<ArrowDownToLine size={17}/>}
    Exportar con promociones aplicadas
   </button>}
  </div>}/>
 <ReportFilterBar showPeriod={false} pharmacies={pharmacies}
   pharmacyIds={selectedPharmacyIds||[]} onPharmacyChange={selectSharedPharmacies}>
   <label className="fm-unified-filter">Buscar campaña o CN
    <input type="search" value={reportListSearch} onChange={e=>{setReportListSearch(e.target.value);setReportPage(0)}}
     placeholder="Nombre, laboratorio o CN…"/></label>
   <label className="fm-unified-filter">Mes y año
    <input type="month" value={reportMonth} onChange={e=>selectReportMonth(e.target.value)}
     aria-label="Seleccionar mes y año de seguimiento"/></label>
   <button type="button" className="fm-promotion-all-periods"
    aria-pressed={!reportMonth&&reportYear==="Todos"} onClick={()=>selectReportMonth("")}>
    Ver todos los meses</button>
 </ReportFilterBar>
 <div className="report-active-summary">
  <div className="report-scope-info"><span className="scope-indicator"/><strong>{reportSelected.length} {reportSelected.length===1?"promoción seleccionada":"promociones seleccionadas"}</strong><span className="report-scope-separator">·</span><span>{reportStatus==="Activa"?"Activas":reportStatus==="Finalizada"?"Archivadas":reportStatus==="Borrador"?"Borradores":"Todos los estados"}</span>{reportMonth?<span>· {new Date(reportMonth+"-01T12:00:00Z").toLocaleDateString("es-ES",{month:"long",year:"numeric",timeZone:"UTC"})}</span>:reportYear!=="Todos"&&<span>· Año {reportYear}</span>}</div>
 </div>
 {reportSelected.length>0?<>
  <CampaignMetrics campaigns={reportFilteredCampaigns} heading={reportSelected.length===1?reportSelected[0].name:"Promociones seleccionadas"} salesAvailable={salesStatus==="real"} salesLoading={salesStatus==="cargando"}/>
  {reportSelected.length>1&&<section className="card report-pharmacy-totals report-pharmacy-highlight">
   <div className="report-consolidated-head"><div className="report-consolidated-icon"><Store size={23}/></div><div className="report-consolidated-title"><h2>Consolidado por farmacia</h2></div><span className="report-consolidated-count">{reportTargets.length} farmacias</span></div>
   <div className="report-consolidated-stats"><div><span>Objetivo conjunto</span><strong>{quantity(reportGoal)} uds.</strong></div><div><span>Uds. en promoción</span><strong>{salesStatus==="cargando"?<SkeletonLine width="110px" height="22px"/>:salesStatus==="real"?quantity(reportSales)+" uds.":"—"}</strong></div><div><span>Uds. totales</span><strong>{salesStatus==="cargando"?<SkeletonLine width="110px" height="22px"/>:salesStatus==="real"?quantity(reportTotalSales)+" uds.":"—"}</strong></div><div><span>Cumplimiento medio</span><strong>{salesStatus==="cargando"?<SkeletonLine width="75px" height="22px"/>:salesStatus==="real"?percentage(promotionAverageCompletion(reportFilteredCampaigns)):"—"}</strong></div></div>
   {hasOverlappingPromotions(reportFilteredCampaigns)&&
     <p role="note" className="fm-sales-period-info">
      Hay promociones con el mismo CN, farmacia y fechas solapadas. Una misma
      venta puede atribuirse a varias promociones; este total no representa unidades únicas.
     </p>}
    <div className="goal-pharmacy-summary">{reportTargets.map(([id,target])=><div className="goal-summary-line" key={id}><div className="goal-summary-name"><Store size={15}/><strong>{pharmaName(id)}</strong></div><GoalProgressBar goal={Number(target)} sold={Number(combinedReport.sales?.[id]||0)} loading={salesStatus==="cargando"} available={salesStatus==="real"}/></div>)}{!reportTargets.length&&<div className="report-choice-empty">No hay farmacias con objetivos en la selección.</div>}</div>
  </section>}
  <PromotionColorReport campaigns={reportFilteredCampaigns} pharmacies={pharmacies}
   pharmacyName={pharmaName} month={reportMonth} today={civilToday(new Date(),reportTimeZone)}
   salesReady={salesStatus==="real"} onMessage={setToast}/>
  <section className="card report-goals-panel">
   <div className="section-heading goal-panel-title"><div><h2>Avance hacia los objetivos</h2></div><span className="count-label">{reportFilteredCampaigns.length} campañas</span></div>
   <div className="goal-chart-legend"><span className="goal-legend-fill"/><span>Vendido respecto al objetivo</span><span className="goal-legend-marker"/> <span>Meta 100 %</span><span className="goal-legend-over">≥100 %</span><span>Objetivo alcanzado</span></div>
   <div className="list-options">
     <label>Ordenar <select value={reportListSort} onChange={e=>{setReportListSort(e.target.value);setReportPage(0)}}>
       <option value="name">Campaña A-Z</option><option value="name-desc">Campaña Z-A</option>
       <option value="goal-desc">Objetivo mayor</option><option value="sales-desc">Ventas mayores</option>
       <option value="advance-desc">Avance mayor</option>
     </select></label>
   </div>
   <div className="goal-accordion-actions"><button type="button" onClick={()=>setExpandedCampaignIds(goalListFiltered.map(p=>p.id))}>Desplegar todas</button><span>·</span><button type="button" onClick={()=>setExpandedCampaignIds([])}>Plegar todas</button></div>
   <div className="goal-campaign-list">{!goalListFiltered.length&&<div className="report-choice-empty">No hay campañas para los filtros seleccionados.</div>}{goalListFiltered.slice(safeReportPage*reportPageSize,(safeReportPage+1)*reportPageSize).map(p=><CampaignGoalCard key={p.id} promo={p} salesLoading={salesStatus==="cargando"} salesAvailable={salesStatus==="real"} pharmaName={pharmaName} expanded={expandedCampaignIds.includes(p.id)} onToggle={()=>toggleCampaignExpanded(p.id)} singlePharmacy={effectivePharmacyIds.length===1}/>)}</div>
   <ListPagination total={goalListFiltered.length} page={safeReportPage} pageSize={reportPageSize}
      label="campañas" onPageChange={setReportPage}
      onPageSizeChange={n=>{setReportPageSize(n);setReportPage(0)}}/>
  </section>
  <DetalleVentas promotions={reportFilteredCampaigns} pharmacies={pharmacies} pharmacyScopeIds={effectivePharmacyIds} connected={promotionStoreStatus==="connected"} />
  <section className="card campaign-cn-panel">
   <div className="section-heading"><div><h2>CNs incluidos</h2></div><span className="count-label">{reportCNs.length} CNs</span></div>
   <div className="list-options"><label>Buscar CN <input type="search" placeholder="CN o descripción…" value={cnSearch} onChange={e=>{setCnSearch(e.target.value);setCnPage(0)}}/></label>
     <label>Ordenar <select value={cnSort} onChange={e=>{setCnSort(e.target.value);setCnPage(0)}}><option value="asc">CN ascendente</option><option value="desc">CN descendente</option></select></label></div>
   <div className="cn-chips">{orderedCNs.slice(safeCNPage*cnPageSize,(safeCNPage+1)*cnPageSize).map(cn=><span key={cn} className="cn-chip" title={reportSelected.find(p=>p.cnDescriptions?.[cn])?.cnDescriptions?.[cn]||"Nombre no disponible"}><strong>{cn}</strong><span>{reportSelected.find(p=>p.cnDescriptions?.[cn])?.cnDescriptions?.[cn]||"Nombre no disponible"}</span></span>)}
     {!orderedCNs.length&&<span className="empty-inline">No hay CNs para la búsqueda.</span>}</div>
   <ListPagination total={orderedCNs.length} page={safeCNPage} pageSize={cnPageSize} label="CNs"
     onPageChange={setCnPage} onPageSizeChange={n=>{setCnPageSize(n);setCnPage(0)}}/>
  </section>
 </>:<section className="card report-empty-state"><Package size={27}/><h2>Selecciona alguna campaña para ver su seguimiento</h2><p>Puedes marcar una, varias o todas las que aparezcan en los filtros.</p></section>}
 {salesStatus==="cargando"&&<div className="fm-loading-message"><LoadingStatus label="Calculando ventas y objetivos de las promociones…"/></div>}
  {salesStatus==="error"&&<p role="alert" className="fm-inline-status">{salesError||"No se pudieron consultar las ventas"}</p>}
</>}
{page==="farmacias"&&<>
 <ReportPageHeader title="Maestro de establecimientos" updatedAt={pharmacyLastUpdated}
   onRefresh={()=>void refreshPharmacies()} refreshing={pharmacyApiStatus==="cargando"}
   actions={<div className="pharmacy-header-actions">
     {pharmacyBackendConfigured&&pharmacyApiStatus!=="connected"&&
      <button className="btn btn-secondary" onClick={()=>nav("accesos")}><ShieldCheck size={17}/> Iniciar sesión</button>}
     <button className="btn btn-primary" onClick={()=>startPharmacy()}
      disabled={pharmacyBackendConfigured&&pharmacyApiStatus!=="connected"}><Plus size={17}/> Nueva farmacia</button>
   </div>}/>
 <ReportFilterBar showPeriod={false} showPharmacies={false}>
  <label className="fm-unified-filter"><span>Buscar farmacia</span>
   <input type="search" placeholder="Código, nombre o ciudad…" value={search}
    onChange={e=>setSearch(e.target.value)}/></label>
 </ReportFilterBar><div className="kpi-grid small-kpis"><Kpi icon={Store} title="Farmacias" loading={pharmacyApiStatus==="cargando"} value={pharmacies.length} caption="Farmacias operativas"/><Kpi icon={CheckCircle2} title="Activas" loading={pharmacyApiStatus==="cargando"} value={pharmacies.filter(f=>f.active).length} caption="En funcionamiento"/><Kpi icon={Users} title="Inactivas" loading={pharmacyApiStatus==="cargando"} value={pharmacies.filter(f=>!f.active).length} caption=""/></div><div className="full-width-grid"><div className="card list-card"><div className="section-heading"><div><h2>Farmacias y almacén central</h2></div></div><ListTable rows={pharmacyApiStatus==="cargando"?[]:currentPharmacies} rowKey={f=>f.id} label="farmacias" defaultSort={{key:"name",direction:"asc"}} loading={pharmacyApiStatus==="cargando"} loadingLabel="Sincronizando maestro de farmacias…"
  onRowClick={startPharmacy} emptyText="No hay farmacias con esos filtros"
  columns={[
    {key:"name",label:"Nombre público",filterMode:"multi",value:f=>f.name,render:f=><div className="pharma-cell"><span className="store-mini"><Store size={16}/></span><strong>{f.name}</strong></div>},
    {key:"id",label:"ID",value:f=>Number(f.id),render:f=><span className="id-code">{f.id}</span>},
    {key:"type",label:"Tipo",filterMode:"multi",value:f=>f.establishmentType==="almacen"?"Almacén":"Farmacia",
     render:f=><strong>{f.establishmentType==="almacen"?"Almacén":"Farmacia"}</strong>},
    {key:"code",label:"Código visible",filterMode:"multi",value:f=>f.displayCode||f.sourceCode||"",render:f=><span className="id-code">{f.displayCode||f.sourceCode||"—"}</span>},
    {key:"database",label:"Base de datos",value:f=>f.sourceDatabase||"",render:f=>f.sourceDatabase||"—"},
    {key:"active",label:"Estado",filterMode:"multi",value:f=>f.active?"Activa":"Inactiva",render:f=><Pill status={f.active?"Activa":"Inactiva"}/>},
    {key:"users",label:"Usuarios",value:f=>f.establishmentType==="almacen"?"—":users.filter(u=>u.role==="superadmin"||u.pharmacies.includes(f.id)).length},
    {key:"actions",label:"",value:()=>"",sortable:false,searchable:false,render:()=> <Pencil size={16} className="muted"/>}
  ]}/></div></div></>}
    {page==="promociones-objetivos"&&(
     objectiveLocation?.invalid||objectiveRestoreError?
      <section className="card" style={{padding:24}}>
       <h2>No se pueden recuperar los objetivos de la promoción</h2>
       <p role="alert">{objectiveRestoreError||"El identificador de la promoción no es válido."}</p>
       <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        {promotionStoreStatus==="error"&&<button type="button" className="btn btn-secondary"
         onClick={()=>void retryPromotions()}>Reintentar conexión</button>}
        <button type="button" className="btn btn-secondary" onClick={()=>nav("promociones")}>Volver a promociones</button>
       </div>
      </section>:
     objectiveLocation?.id&&(!objectiveCampaign||
      String(objectiveCampaign.id)!==objectiveLocation.id||
      objectiveMonth!==preferredObjectiveMonth(objectiveCampaign,objectiveLocation.month,new Date()))?
      <LoadingStatus label="Recuperando los objetivos guardados de la promoción…"/>:
      <ObjetivosPromociones key={tenantContext.client.slug+":"+objectiveSession} clientSlug={tenantContext.client.slug}
      pharmacies={pharmacies} canManage={(objectiveCampaign?canEditPromotions:canCreatePromotions)&&canOpenSection("promociones-objetivos")}
      editingPromotion={objectiveCampaign} objectiveMonth={objectiveMonth}
      onObjectiveMonthChange={month=>{
       setObjectiveMonth(month);setObjectiveSession(n=>n+1);
       const route=objectiveEditorRoute(window.location.pathname,window.location.search);
       if(route?.id&&objectiveCampaign?.id===route.id)
        window.history.replaceState({page:"promociones-objetivos"},"",
         objectiveEditorUrl(route.id,month));
      }}
      onCreatePromotion={continuePlannerToDrawer}
      onSaveObjectives={saveObjectivesFromPlanner} onBack={returnFromPlanner}/>
    )}

    {page==="usuarios"&&<EquipoCliente client={tenantContext.client.slug} pharmacies={tenantContext.pharmacies} managerRole={tenantContext.role}/>}
    {page==="perfiles"&&["gestor","administrador","superadministrador"].includes(role)&&
      <PerfilesGlobales client={tenantContext.client.slug} role={role}/>}
     {page==="proveedores"&&<ProveedoresMaestro key={tenantContext.client.slug} clientSlug={tenantContext.client.slug}
      canEditMaster={["gestor","administrador","superadministrador"].includes(role)}
      canMergeMaster={["administrador","superadministrador"].includes(role)}/>}
    {page==="clientes"&&<ClientesPanel onUpdated={()=>loadContext(tenantContext.client.slug)}/>}
    {page==="fuentes"&&<FuentesMaestras/>}
    {page==="estado"&&<PharmacyState key={tenantContext.client.slug} clientSlug={tenantContext.client.slug}/>}
    {page==="solicitudes"&&<SolicitudesDemo/>}
    {page==="genericos"&&<Genericos key={tenantContext.client.slug} clientSlug={tenantContext.client.slug} pharmacies={tenantContext.pharmacies} demo={tenantContext.client.demo}/>}
    {page==="acciones"&&<CentroTrabajo key={tenantContext.client.slug} clientSlug={tenantContext.client.slug}
      pharmacies={tenantContext.pharmacies} userEmail={sessionUser?.email} tenantRole={tenantContext.role}
      canOpenSection={canOpenSection}/>}
    {DEMO_MODULES.has(page)&&page!=="genericos"&&<ModuloDemo key={tenantContext.client.slug+":"+page} module={page}
      pharmacies={tenantContext.pharmacies} clientSlug={tenantContext.client.slug}
      analysisMonths={tenantContext.client.analysisMonths}
      tenantRole={tenantContext.role}
      onNavigate={nav} canNavigate={id=>visibleNav.some(item=>item.id===id)}/>} 
    {REAL_SECTIONS.has(page)&&<OperativaReal key={tenantContext.client.slug+":"+page}
      section={page} clientSlug={tenantContext.client.slug} userEmail={sessionUser?.email}
      tenantRole={tenantContext.role}
      pharmacies={tenantContext.pharmacies}/>}
    {page==="stock-sin-recepciones"&&<StockSinRecepciones key={tenantContext.client.slug} clientSlug={tenantContext.client.slug} pharmacies={tenantContext.pharmacies}/>}
    {page==="picking-list"&&<PickingList key={tenantContext.client.slug} clientSlug={tenantContext.client.slug} role={role}/>}
     {DOCUMENT_SCREENS.has(page)&&<PantallasReales key={tenantContext.client.slug+":"+page}
      section={page} clientSlug={tenantContext.client.slug} pharmacies={tenantContext.pharmacies}/>}
    {page==="accesos"&&<AccessAdmin onAuthenticated={()=>window.dispatchEvent(new Event("farmawao-auth-changed"))}/>}
     {page==="ajustes"&&<div className="fm-production-settings">
      <div className="page-header"><h1>Ajustes</h1></div>

      <ConfiguracionAnalisisVentas clientSlug={tenantContext.client.slug}
       initialMonths={tenantContext.client.analysisMonths}
       onSaved={()=>loadContext(tenantContext.client.slug)}/>
      <ConfiguracionPrecios clientSlug={tenantContext.client.slug} pharmacies={tenantContext.pharmacies}/>
      <ConfiguracionDiasStock clientSlug={tenantContext.client.slug} pharmacies={tenantContext.pharmacies}/>
       <ConfiguracionPreparador clientSlug={tenantContext.client.slug}/>
     </div>}
   </React.Suspense>
   </main>
   <footer className="app-footer"><span>© 2026 Farmetrica</span></footer>
  </div>
  {passwordModal&&<React.Suspense fallback={null}><CambiarContrasena onClose={()=>setPasswordModal(false)}/></React.Suspense>}
  {reportModal&&<div className="report-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setReportModal(null)}}>
   <section className="report-modal" role="dialog" aria-modal="true" aria-labelledby="report-modal-title">
    <div className="report-modal-top">
     <div><h2 id="report-modal-title">Filtrar campañas</h2></div>
     <button className="icon-btn report-modal-close" ref={reportCloseRef} onClick={()=>setReportModal(null)} aria-label="Cancelar y cerrar filtros" title="Cerrar sin aplicar"><X size={23}/></button>
    </div>
    <div className="report-modal-body">
     <div className="report-modal-filters">
      <Field label="Estado"><select value={reportModal.status} onChange={e=>updateDraftScope(e.target.value,reportModal.month)}>
       <option value="Activa">Activas</option><option value="Finalizada">Archivadas</option><option value="Borrador">Borradores</option><option value="Todos">Todos los estados</option>
      </select></Field>
      <Field label="Mes y año"><input type="month" value={reportModal.month}
       onChange={e=>updateDraftScope(reportModal.status,e.target.value)}
       aria-label="Seleccionar mes y año de campañas en seguimiento"/></Field>
      <button type="button" className="fm-promotion-all-periods"
       aria-pressed={!reportModal.month&&reportModal.year==="Todos"}
       onClick={()=>updateDraftScope(reportModal.status,"")}>Ver todos los meses</button>
      {reportModal.year!=="Todos"&&!reportModal.month&&
       <small className="fm-report-year-legacy">Filtro de enlace antiguo: año {reportModal.year}.
        Selecciona un mes o pulsa «Ver todos los meses» para cambiarlo.</small>}
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
       <span className="report-choice-body"><strong>{p.name}</strong><small>{dateES(p.start)} — {p.end?dateES(p.end):promotionDurationMode(p)==="stock"?"Hasta agotar stock":"Sin fecha de fin"} · {p.cns.length} CN · {Object.keys(p.targets||{}).length} farmacias</small></span><Pill status={p.status}/>
      </label>)}
      {!draftVisible.length&&<div className="report-choice-empty">No hay campañas para los filtros seleccionados. Prueba con otro estado, mes y año o búsqueda.</div>}
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
  {editingPromo&&<div className="drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setEditingPromo(null)}}><div className="drawer"><div className="drawer-top"><div><h2>{editingPromo==="nuevo"?"Nueva campaña":"Editar promoción"}</h2><p>Configura productos y objetivos de venta por farmacia.</p></div><button className="icon-btn" aria-label="Cerrar" onClick={()=>setEditingPromo(null)}><X size={21}/></button></div><form onSubmit={savePromo} className="drawer-content">
   {(promoForm.retroactive||promoForm.simulatorDraft&&promoForm.status==="Finalizada")&&<div className="note data-note"><CircleHelp size={16}/>
     Promoción retroactiva: los tickets se consultarán al guardar, sin modificar las ventas originales. Los objetivos son opcionales, pero es necesario elegir el tipo de oferta.</div>}
   <Field label="Nombre de promoción"><input required placeholder="Ej.: Especial hidratación" value={promoForm.name} onChange={e=>setPromoForm({...promoForm,name:e.target.value})}/></Field>
   <Field label="Descripción"><textarea rows="3" placeholder="¿En qué consiste esta campaña?" value={promoForm.description} onChange={e=>setPromoForm({...promoForm,description:e.target.value})}/></Field>
   <div className="promotion-duration-picker" role="group" aria-label="Duración de campaña">
    <label className={promotionDurationMode(promoForm)==="dates"?"chosen":""}>
     <input type="radio" name="promotion-duration" value="dates"
      checked={promotionDurationMode(promoForm)==="dates"}
      onChange={()=>setPromoForm({...promoForm,durationMode:"dates"})}/>
     <span>Por fechas</span>
    </label>
    <label className={promotionDurationMode(promoForm)==="stock"?"chosen":""}>
     <input type="radio" name="promotion-duration" value="stock"
      checked={promotionDurationMode(promoForm)==="stock"}
      onChange={()=>setPromoForm({...promoForm,durationMode:"stock",end:"",endRaw:""})}/>
     <span>Hasta agotar stock</span>
    </label>
   </div>
   <div className="field-row"><Field label="Fecha de inicio"><input type="date" required value={promoForm.start} onChange={e=>setPromoForm({...promoForm,start:e.target.value})}/></Field>
    {promotionDurationMode(promoForm)==="dates"&&<Field label="Fecha de fin"><input type="date" required
     min={promoForm.start||undefined} value={promoForm.end||""}
     onChange={e=>setPromoForm({...promoForm,end:e.target.value})}/></Field>}</div>
   {promoForm.simulatorDraft&&<div className="fm-promotion-proposal" role="group" aria-label="Asignación mensual de la propuesta">
    <div className="fm-promotion-proposal-head">
     <Target size={18} aria-hidden="true"/>
     <div><strong>Objetivos simulados</strong>
      <small>{quantity(sum(promoForm.targets))} unidades propuestas · {Object.keys(promoForm.targets).length} farmacias</small>
     </div>
    </div>
    {!goalProposalMonths.length?
     <p className="fm-promotion-proposal-hint" role="status">
      Indica las fechas de inicio y fin para decidir a qué mes corresponden estos objetivos.
     </p>:
     goalProposalMonths.length===1?
      <div className="fm-promotion-proposal-single" role="status">
       <CheckCircle2 size={17} aria-hidden="true"/>
       La propuesta se asignará a <strong>{new Date(selectedProposalMonth+"-01T12:00:00Z").toLocaleDateString("es-ES",{month:"long",year:"numeric",timeZone:"UTC"})}</strong>.
      </div>:
      <fieldset className="fm-promotion-proposal-fieldset">
       <legend>¿A qué mes aplicamos los objetivos simulados?</legend>
       <div className="fm-promotion-proposal-months">
        {goalProposalMonths.map(month=>{
         const range=objectiveMonthDates(promoForm,month);
         return <label key={month} className={"fm-promotion-proposal-month"+(selectedProposalMonth===month?" is-selected":"")}>
          <input type="radio" name="proposal-objective-month"
           value={month} checked={selectedProposalMonth===month}
           onChange={()=>setFormObjectiveMonth(month)}/>
          <span className="fm-promotion-proposal-month-text">
           <strong>{new Date(month+"-01T12:00:00Z").toLocaleDateString("es-ES",{month:"long",year:"numeric",timeZone:"UTC"})}</strong>
           {range&&<small>{dateES(range.from)} – {dateES(range.to)}</small>}
          </span>
         </label>;
        })}
       </div>
       <small className="fm-promotion-proposal-hint">Los demás meses quedarán sin objetivos. Puedes configurarlos posteriormente desde «Editar objetivos».</small>
      </fieldset>}
    <small className="fm-promotion-proposal-footnote">Se conservarán las unidades y los porcentajes de la simulación, sin repartirlos ni recalcularlos.</small>
   </div>}
   <Field label="Estado"><select value={promoForm.status} onChange={e=>setPromoForm({...promoForm,status:e.target.value})}><option>Activa</option><option>Borrador</option><option value="Finalizada">Archivada</option></select>
    <small className="fm-promotion-publication-hint">Activa: visible para las farmacias participantes desde que se publica, aunque empiece más adelante. Borrador: solo gestores y administradores. Las fechas delimitan las ventas, no la visibilidad.</small></Field>
    {promoForm.status==="Finalizada"&&<div className="field-row"><Field label="Fecha real de finalización"><input type="date" min={promoForm.start||undefined} max={civilToday(new Date(),reportTimeZone)} value={promoForm.closedOn||""} onChange={e=>setPromoForm({...promoForm,closedOn:e.target.value})}/></Field><Field label="Motivo del cierre (opcional)"><input value={promoForm.closedReason||""} onChange={e=>setPromoForm({...promoForm,closedReason:e.target.value})} placeholder="Promoción terminada"/></Field></div>}
    <Field label="Tipo de promoción"><select value={promoForm.type||"sin_clasificar"} onChange={e=>setPromoForm({...promoForm,type:e.target.value,discountPercent:PROMOTION_TYPES.find(t=>t.id===e.target.value)?.needsPercent?promoForm.discountPercent:""})}>{PROMOTION_TYPES.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
    {PROMOTION_TYPES.find(t=>t.id===promoForm.type)?.needsAmount&&<Field label="Importe de descuento (€)"><input type="number" min="0.01" step="0.01" value={promoForm.discountAmount||""} onChange={e=>setPromoForm({...promoForm,discountAmount:e.target.value})}/></Field>}
    {promoForm.type==="precio_especial"&&<Field label="Precio especial por unidad (€)"><input type="number" min="0" step="0.01" value={promoForm.specialPrice??""} onChange={e=>setPromoForm({...promoForm,specialPrice:e.target.value})}/></Field>}
    {promoForm.importWarnings?.length>0&&<div className="note data-note"><CircleHelp size={16}/> Pendiente de revisar: {promoForm.importWarnings.join(" · ")}</div>}
    {PROMOTION_TYPES.find(t=>t.id===promoForm.type)?.needsPercent&&<Field
     label={promoForm.type==="segunda_porcentaje"?"Descuento aplicado a la segunda unidad (%)":"Porcentaje de descuento (%)"}
     hint={promoForm.type==="segunda_porcentaje"?"Ej.: 50 = 50 % de descuento. Por cada pareja del ticket, el descuento se aplica a la unidad de menor precio.":null}>
     <input type="number" min="0.01" max="100" step="0.01" placeholder="Ej.: 50" value={promoForm.discountPercent} onChange={e=>setPromoForm({...promoForm,discountPercent:e.target.value})}/></Field>}
   <div className="form-divider"/><div className="field-heading"><div><strong>CN</strong><small>Introduce un CN por línea o sepáralos por comas o espacios. Solo seis números, sin puntos.</small></div><span className="soft-counter">{cnParsed.length} CNs</span></div><textarea rows="5" className="cn-area" placeholder={"184579\n188456\n192334"} value={cnText} onChange={e=>setCnText(e.target.value)}/>{cnParsed.some(cn=>!isValidCN(cn))?<div className="parse-info cn-format-error"><CircleHelp size={15}/> Hay CNs incorrectos. Cada CN debe tener exactamente 6 dígitos, sin puntos ni letras.</div>:<div className="parse-info"><CheckCircle2 size={15}/> CNs válidos de 6 dígitos. Eliminamos automáticamente los duplicados.</div>}
   {Object.keys(promoForm.cnDescriptions||{}).length>0&&<div className="import-cn-catalog"><strong>Productos incluidos</strong>{Object.entries(promoForm.cnDescriptions).slice(0,22).map(([cn,description])=><div key={cn}><code>{cn}</code><span>{description}</span></div>)}{Object.keys(promoForm.cnDescriptions).length>22&&<small>Mostrando 22 de {Object.keys(promoForm.cnDescriptions).length} descripciones</small>}</div>}
    <div className="form-divider"/><div className="field-heading"><div><strong>Farmacias participantes</strong><small>Selecciona las farmacias incluidas en la promoción.</small></div><span className="soft-counter">{Object.keys(promoForm.targets).length} elegidas</span></div>
   <div className="pharmacy-picker">{pharmacies.filter(f=>f.active||f.id in promoForm.targets).map(f=><label key={f.id} className={"pharmacy-choice "+(f.id in promoForm.targets?"chosen":"")}><input type="checkbox" checked={f.id in promoForm.targets} onChange={()=>togglePromoPharmacy(f.id)}/><span className="choice-check">{f.id in promoForm.targets&&<Check size={14}/>}</span><span>{f.name}</span><small>{f.id}</small></label>)}</div>
   {configuredDrawerMonths.length>0&&
      <div className="target-list">
       <div className="target-head"><strong>Objetivos mensuales configurados</strong></div>
       {configuredDrawerMonths.map(month=><div className="target-row" key={month}>
        <strong>{new Date(month+"-01T12:00:00Z").toLocaleDateString("es-ES",{month:"long",year:"numeric",timeZone:"UTC"})}</strong>
        <span>{quantity(sum(promoForm.monthlyObjectives[month]?.targets))} uds.</span>
       </div>)}
       <label>Mes que estás editando
        <select value={activeDrawerMonth} onChange={e=>setFormObjectiveMonth(e.target.value)}>
         {configuredDrawerMonths.map(month=><option key={month} value={month}>
          {new Date(month+"-01T12:00:00Z").toLocaleDateString("es-ES",{month:"long",year:"numeric",timeZone:"UTC"})}
         </option>)}
        </select>
       </label>
       <small>Las unidades de cada mes se guardan de manera independiente. Los porcentajes históricos solo son una referencia.</small>
      </div>}
     {Object.keys(drawerTargets||{}).length>0&&<div className="target-list">
    <div className="target-head"><strong>Objetivos por farmacia {activeDrawerMonth?"· "+activeDrawerMonth:""}</strong></div>
    {Object.entries(drawerTargets||{}).map(([id,value])=><div className="target-row" key={id}>
     <div><strong>{pharmaName(id)}</strong><small>{id}</small></div>
     <div className="numeric-input"><input type="number" min="0" step="1" value={value}
      onChange={e=>{
       const next=e.target.value;
       if(!activeDrawerMonth){
        setPromoForm(prev=>({...prev,targets:{...prev.targets,[id]:next}}));
       }else{
        setPromoForm(prev=>({...prev,
         monthlyObjectives:{...prev.monthlyObjectives,
          [activeDrawerMonth]:{...prev.monthlyObjectives[activeDrawerMonth],
           targets:{...prev.monthlyObjectives[activeDrawerMonth].targets,[id]:next}}},
         targets:configuredDrawerMonths.length===1?{...prev.targets,[id]:next}:prev.targets
        }));
       }
      }}
      aria-label={"Objetivo "+pharmaName(id)}/><span>uds.</span></div>
    </div>)}
    <div className="target-total"><span>Objetivo total</span><strong>{quantity(sum(drawerTargets))} uds.</strong></div>
   </div>}
   {promoSaveError&&<p role="alert" className="fm-manage-feedback">{promoSaveError}</p>}
   <FormActions onCancel={()=>{if(!savingPromo)setEditingPromo(null)}} disabled={savingPromo} label={savingPromo?"Guardando…":editingPromo==="nuevo"?"Crear campaña":"Guardar cambios"}/>
   {editingPromo!=="nuevo"&&<div className="drawer-extra"><button type="button" className="btn btn-secondary" onClick={()=>{const p={...promoForm};setEditingPromo(null);copyPromo(p)}}><Copy size={16}/> Duplicar promoción</button><button type="button" className="btn btn-secondary" onClick={()=>exportPromo(promoForm)}><ArrowDownToLine size={16}/> Descargar ficha de promoción</button></div>}
  </form></div></div>}
  {editingUser&&<div className="drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setEditingUser(null)}}><div className="drawer"><div className="drawer-top"><div><h2>{editingUser==="nuevo"?"Nuevo usuario":"Editar usuario"}</h2><p>Asigna un rol y define las farmacias disponibles.</p></div><button className="icon-btn" onClick={()=>setEditingUser(null)} aria-label="Cerrar"><X/></button></div><form onSubmit={saveUser} className="drawer-content"><Field label="Nombre completo"><input required value={userForm.name} onChange={e=>setUserForm({...userForm,name:e.target.value})}/></Field><Field label="Correo electrónico"><input type="email" required value={userForm.email} onChange={e=>setUserForm({...userForm,email:e.target.value})}/></Field><Field label="Rol"><select value={userForm.role} onChange={e=>setUserForm({...userForm,role:e.target.value})}><option value="farmacia">Personal de farmacia</option><option value="gestor">Gestor de farmacias</option><option value="superadmin">Superadministrador</option></select></Field><Field label="Estado"><select value={String(userForm.active)} onChange={e=>setUserForm({...userForm,active:e.target.value==="true"})}><option value="true">Activo</option><option value="false">Inactivo</option></select></Field><div className="form-divider"/><div className="field-heading"><div><strong>Farmacias asignadas</strong><small>{userForm.role==="superadmin"?"Este rol tiene acceso a toda la red.":"Marca las farmacias a las que podrá acceder."}</small></div></div>{userForm.role!=="superadmin"&&<div className="pharmacy-picker">{pharmacies.map(f=><label key={f.id} className={"pharmacy-choice "+(userForm.pharmacies.includes(f.id)?"chosen":"")}><input type="checkbox" checked={userForm.pharmacies.includes(f.id)} onChange={()=>setUserForm({...userForm,pharmacies:userForm.pharmacies.includes(f.id)?userForm.pharmacies.filter(x=>x!==f.id):[...userForm.pharmacies,f.id]})}/><span className="choice-check">{userForm.pharmacies.includes(f.id)&&<Check size={14}/>}</span><span>{f.name}</span><small>{f.id}</small></label>)}</div>}<div className="note small-note"><ShieldCheck size={16}/> Estas asignaciones son solo visuales hasta habilitar autenticación y autorización en el servidor.</div><FormActions onCancel={()=>setEditingUser(null)}/></form></div></div>}
  {editingPharmacy&&<div className="drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setEditingPharmacy(null)}}><div className="drawer"><div className="drawer-top"><div><h2>{editingPharmacy==="nuevo"?"Nueva farmacia":"Editar farmacia"}</h2><p>El identificador se asigna automáticamente a las farmacias nuevas.</p></div><button className="icon-btn" onClick={()=>setEditingPharmacy(null)} aria-label="Cerrar"><X/></button></div><form onSubmit={savePharmacy} className="drawer-content">{editingPharmacy!=="nuevo"&&<Field label="ID de farmacia"><input disabled value={pharmacyForm.id}/></Field>}<Field label="Nombre público"><input required placeholder="Farmacia Plaza Mayor" value={pharmacyForm.name} onChange={e=>setPharmacyForm({...pharmacyForm,name:e.target.value})}/></Field><Field label="Ciudad (opcional)"><input value={pharmacyForm.city} onChange={e=>setPharmacyForm({...pharmacyForm,city:e.target.value})}/></Field><Field label="Código de origen (ABA / EUR / BUE…)"><input required placeholder="ABA" maxLength="16" value={pharmacyForm.sourceCode||""} onChange={e=>setPharmacyForm({...pharmacyForm,sourceCode:e.target.value})}/></Field><Field label="Host/IP SQL Server"><input placeholder="Vacío para servidor local" value={pharmacyForm.sourceHost||""} onChange={e=>setPharmacyForm({...pharmacyForm,sourceHost:e.target.value})}/></Field><Field label="Base de datos de origen"><input required value={pharmacyForm.sourceDatabase||""} onChange={e=>setPharmacyForm({...pharmacyForm,sourceDatabase:e.target.value})}/></Field><div className="note small-note"><ShieldCheck size={16}/> Guarda solo el servidor. No introduzcas contraseñas aquí.</div><Field label="Estado"><select value={String(pharmacyForm.active)} onChange={e=>setPharmacyForm({...pharmacyForm,active:e.target.value==="true"})}><option value="true">Activa</option><option value="false">Inactiva</option></select></Field><FormActions onCancel={()=>setEditingPharmacy(null)} label={savingPharmacy?"Guardando…":"Guardar cambios"} disabled={savingPharmacy}/></form>
  {editingPharmacy!=="nuevo"&&<React.Suspense fallback={null}><PoliticaReposicionFarmacia
   clientSlug={tenantContext?.client?.slug||"ampedia"} pharmacyId={pharmacyForm.id}
   canEdit={pharmacyApiStatus==="connected"}/></React.Suspense>}
 </div></div>}
  {toast&&<div className="toast"><CheckCircle2 size={18}/>{toast}<button onClick={()=>setToast("")}><X size={16}/></button></div>}
  {tenantContext.modules?.asistente===true&&
   <React.Suspense fallback={null}><AsistenteDemo key={tenantContext.client.slug} section={title}/></React.Suspense>}

 </div>
}
function GoalProgressBar({goal,sold,loading=false,available=true}){
 if(!loading&&!available)return <div className="goal-progress"><span className="fm-inline-status">Sin datos de ventas disponibles</span><small>Objetivo: {quantity(goal)} uds.</small></div>;
 if(loading)return <div className="goal-progress" role="status" aria-label="Cargando avance de ventas"><SkeletonLine width="100%" height="14px"/><SkeletonLine width="65%" height="13px"/></div>;
 const pct=goal>0?Math.round(sold/goal*100):null;
 const width=pct===null?0:Math.max(0,Math.min(100,pct));
 const remaining=goal>0?Math.max(0,goal-sold):null;
 const tone=pct===null?"empty":pct>=100?"done":pct>=80?"near":pct>=50?"mid":"low";
 const detail=pct===null?"Sin objetivo":remaining>0?"Faltan "+quantity(remaining)+" uds.":pct>100?"Superado en "+quantity(sold-goal)+" uds.":"Objetivo cumplido";
 return <div className={"goal-progress goal-"+tone}>
  <div className="goal-track-wrap">
   <div className="goal-track" role="progressbar" aria-label={pct===null?"Sin objetivo":"Cumplimiento del objetivo"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={width} aria-valuetext={pct===null?"Sin objetivo":pct+" por ciento, "+quantity(sold)+" de "+quantity(goal)+" unidades"}>
    <div className="goal-track-fill" style={{width:width+"%"}}/>
    <span className="goal-target-line"/>
   </div>
   <span className={"goal-pct "+(pct!==null&&pct>=100?"is-done":"")}>{pct===null?"—":pct+"%"}</span>
  </div>
  <div className="goal-progress-meta"><span>{quantity(sold)} / {quantity(goal)} uds.</span><span>{detail}</span></div>
 </div>;
}
function CampaignGoalCard({promo,pharmaName,expanded,onToggle,singlePharmacy=false,salesLoading=false,salesAvailable=true}){
 const goal=sum(promo.targets),sold=sum(promo.sales),entries=Object.entries(promo.targets||{});
 const campaignPercent=goal>0?percent(sold,goal):null;
 return <article className={"goal-campaign-card "+(expanded?"goal-campaign-open":"goal-campaign-closed")}>
  <button type="button" className="goal-campaign-heading goal-campaign-toggle" aria-expanded={expanded} onClick={onToggle} aria-label={(expanded?"Plegar ":"Desplegar ")+promo.name}>
   <span className="goal-campaign-title"><span className="goal-icon"><Tag size={17}/></span><span className="goal-title-copy"><strong>{promo.name}</strong><small>{entries.length} {entries.length===1?"farmacia":"farmacias"} · {promo.cns.length} CN · {promo.id}</small></span></span>
   <span className="goal-campaign-side"><span className={"goal-accordion-pct "+(campaignPercent!==null&&campaignPercent>=100?"achieved":"")}>{salesLoading?<SkeletonLine width="60px" height="19px"/>:!salesAvailable?"Sin datos":campaignPercent===null?"Sin objetivo":campaignPercent+"%"}</span><Pill status={promo.status}/><ChevronDown size={18} className={"goal-chevron "+(expanded?"expanded":"")}/></span>
  </button>
  {expanded&&<div className="goal-campaign-expanded">
   {singlePharmacy?
    <div className="goal-campaign-total goal-single-pharmacy"><div className="goal-group-label"><span>{entries.length?pharmaName(entries[0][0]):"Farmacia sin objetivo"}</span><span className="goal-100-label">META 100 % <span className="goal-flag"/></span></div><GoalProgressBar goal={goal} sold={sold} loading={salesLoading} available={salesAvailable}/></div>
    :<>
     <div className="goal-campaign-total"><div className="goal-group-label"><span>Objetivo total de la promoción</span><span className="goal-100-label">META 100 % <span className="goal-flag"/></span></div><GoalProgressBar goal={goal} sold={sold} loading={salesLoading} available={salesAvailable}/></div>
     <div className="goal-farmacies-list">{entries.map(([id,value])=><div key={id} className="goal-farm-row"><div className="goal-farm-name"><Store size={14}/><span>{pharmaName(id)}</span></div><GoalProgressBar goal={Number(value)||0} sold={Number(promo.sales?.[id]||0)} loading={salesLoading} available={salesAvailable}/></div>)}{!entries.length&&<p className="goal-no-pharmacies">No hay farmacias con objetivos para esta selección.</p>}</div>
    </>}
  </div>}
 </article>;
}
createRoot(document.getElementById("root")).render(<App/>);