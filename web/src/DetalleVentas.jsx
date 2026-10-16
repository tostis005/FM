import React,{useEffect,useState} from "react";
import {ArrowDownToLine,Filter,Search,Ticket,RefreshCcw} from "lucide-react";
import {loadTicketLines} from "./farmaciasApi.js";
import {exportLabSalesExcel} from "./exportaciones.js";

const num=n=>new Intl.NumberFormat("es-ES",{maximumFractionDigits:3}).format(Number(n)||0);
const money=n=>new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(Number(n)||0);
const date=n=>new Intl.DateTimeFormat("es-ES",{dateStyle:"short",timeStyle:"medium",timeZone:"Europe/Madrid"}).format(new Date(n));
const validDate=s=>/^20\d\d-\d\d-\d\d$/.test(s||"");
const INITIAL={pharmacyId:"",cn:"",ticket:"",start:"",end:""};

export default function DetalleVentas({promotions,pharmacies,connected}){
  const [promoId,setPromoId]=useState("");
  const [draft,setDraft]=useState(INITIAL);
  const [applied,setApplied]=useState(INITIAL);
  const [result,setResult]=useState({rows:[],total:0,status:"idle",error:""});
  const [page,setPage]=useState(0);
  const [exporting,setExporting]=useState(false);
  const promo=promotions.find(p=>p.id===promoId);
  useEffect(()=>{
    if(promotions.length && !promotions.some(p=>p.id===promoId)){
      setPromoId(promotions[0].id);setDraft(INITIAL);setApplied(INITIAL);setPage(0);
    }
    if(!promotions.length)setPromoId("");
  },[promotions.map(p=>p.id).join("|")]);
  const filters=promo?{
    cns:promo.cns||[],start:applied.start||promo.start,end:applied.end||promo.end,
    farmaciaId:applied.pharmacyId||null,ticket:applied.ticket||null,
    cn:applied.cn||null,
  }:null;
  const eligible=Boolean(connected&&filters?.cns.length&&validDate(filters.start)&&validDate(filters.end)&&filters.start<=filters.end);
  useEffect(()=>{
    if(!eligible){setResult({rows:[],total:0,status:"idle",error:""});return;}
    let cancelled=false;
    setResult(prev=>({...prev,status:"loading"}));
    loadTicketLines({...filters,offset:page*100,limit:100})
      .then(x=>{if(!cancelled)setResult({rows:x.rows||[],total:x.total||0,status:"ready",error:""});})
      .catch(err=>{if(!cancelled)setResult({rows:[],total:0,status:"error",error:err.message});});
    return()=>{cancelled=true;};
  },[connected,promoId,page,applied.start,applied.end,applied.pharmacyId,applied.ticket,applied.cn,(promo?.cns||[]).join(",")]);
  function applyFilters(e){
    e.preventDefault();setApplied({...draft});setPage(0);
  }
  async function download(){
    if(!eligible||!promo||exporting)return;
    setExporting(true);
    try{
      const records=[];
      let total=0;
      for(let offset=0;offset<10000;offset+=500){
        const r=await loadTicketLines({...filters,offset,limit:500});
        total=r.total;
        records.push(...r.rows);
        if(records.length>=total)break;
      }
      if(total>10000){
        const ok=window.confirm("Hay "+num(total)+" líneas. Esta descarga contiene solo las 10.000 primeras; para un informe completo habrá que dividir el periodo. ¿Continuar?");
        if(!ok)return;
      }
      await exportLabSalesExcel(promo,records);
    }catch(e){setResult(prev=>({...prev,error:"No se pudo exportar: "+e.message}));}
    finally{setExporting(false);}
  }
  return <section className="card lab-detail-panel">
    <div className="section-heading">
      <div><h2>Detalle de ventas para laboratorio</h2><p>Tickets reales de Farmatic, por promoción. Datos originales de venta, sin descuentos promocionales simulados.</p></div>
      <button className="btn btn-primary" type="button" onClick={download} disabled={!eligible||exporting||result.status==="loading"}>
        <ArrowDownToLine size={17}/>{exporting?"Preparando Excel…":"Exportar formato laboratorio"}
      </button>
    </div>
    <div className="note data-note"><Ticket size={17}/> El vendedor se muestra por su ID de Farmatic; para mostrar nombres reales es necesario conectar el maestro de vendedores. En la exportación se conserva el mismo identificador.</div>
    {!connected&&<div className="access-alert access-alert-error">Para consultar tickets y exportarlos necesitas iniciar sesión como administrador y que la API de PostgreSQL esté activa.</div>}
    <form className="lab-detail-filters" onSubmit={applyFilters}>
      <label>Promoción
        <select value={promoId} onChange={e=>{setPromoId(e.target.value);setDraft(INITIAL);setApplied(INITIAL);setPage(0)}}>
          {!promotions.length&&<option value="">Selecciona una promoción</option>}
          {promotions.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label>Farmacia
        <select value={draft.pharmacyId} onChange={e=>setDraft({...draft,pharmacyId:e.target.value})}>
          <option value="">Todas las farmacias</option>
          {pharmacies.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label>CN
        <select value={draft.cn} onChange={e=>setDraft({...draft,cn:e.target.value})}>
          <option value="">Todos los CNs</option>
          {(promo?.cns||[]).map(cn=><option key={cn} value={cn}>{cn}</option>)}
        </select>
      </label>
      <label>Fecha desde
        <input type="date" value={draft.start} onChange={e=>setDraft({...draft,start:e.target.value})}/>
      </label>
      <label>Fecha hasta
        <input type="date" value={draft.end} onChange={e=>setDraft({...draft,end:e.target.value})}/>
      </label>
      <label>Ticket / documento
        <input value={draft.ticket} onChange={e=>setDraft({...draft,ticket:e.target.value})} placeholder="D000123/2026" maxLength={60}/>
      </label>
      <button type="submit" className="btn btn-secondary"><Filter size={16}/> Aplicar filtros</button>
    </form>
    {promo&&!validDate(promo.end)&&<div className="access-alert access-alert-error">La promoción no tiene fecha final concreta («fin de existencias»). Indica un periodo explícito en los filtros antes de consultar.</div>}
    {result.error&&<div className="access-alert access-alert-error">{result.error}</div>}
    <div className="lab-detail-count">{result.status==="loading"?"Consultando…":num(result.total)+" líneas de venta"} {result.total>0&&" · Página "+(page+1)}</div>
    <div className="table-scroll"><table className="data-table lab-detail-table">
      <thead><tr><th>Farmacia</th><th>Vendedor ID</th><th>IdVenta</th><th>Ticket</th><th>Fecha y hora</th><th>CN</th><th>Descripción</th><th>PVP</th><th>Unidades</th><th>Bruto</th><th>Descuento</th><th>Neto</th><th>% Dto.</th></tr></thead>
      <tbody>{result.rows.map((v,i)=><tr key={v.pharmacyCode+"-"+v.saleId+"-"+v.lineId+"-"+i}>
        <td>{v.pharmacyName||v.pharmacyCode}</td><td>{v.sellerId||"—"}</td><td>{v.saleId}</td><td>{v.ticket||"—"}</td>
        <td>{date(v.at)}</td><td>{v.cn}</td><td>{v.description}</td><td>{money(v.pvp)}</td>
        <td>{num(v.quantity)}</td><td>{money(v.gross)}</td><td>{money(v.lineDiscount)}</td>
        <td>{money(v.net)}</td><td>{Number(v.gross)?Math.round(Math.abs(Number(v.lineDiscount)/Number(v.gross))*1000)/10:0}%</td>
      </tr>)}</tbody>
    </table>{!result.rows.length&&<p className="lab-detail-empty">{connected?"Sin ventas para la promoción y filtros elegidos.":"Detalle disponible al conectar PostgreSQL y autenticarte."}</p>}</div>
    {result.total>100&&<div className="lab-detail-pagination">
      <button type="button" className="btn btn-secondary btn-sm" disabled={page<=0||result.status==="loading"} onClick={()=>setPage(p=>Math.max(0,p-1))}>Anterior</button>
      <span>{page+1} / {Math.ceil(result.total/100)}</span>
      <button type="button" className="btn btn-secondary btn-sm" disabled={(page+1)*100>=result.total||result.status==="loading"} onClick={()=>setPage(p=>p+1)}>Siguiente</button>
    </div>}
  </section>;
}
