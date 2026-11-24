import React,{useEffect,useMemo,useState} from "react";
import {ListPagination} from "./ListTable.jsx";
import {LoadingPanel} from "./LoadingState.jsx";
import {ReportPageHeader} from "./ReportControls.jsx";
import {makeVademecumRows} from "./genericVademecumRows.js";
const money=n=>n==null?"—":Number(n).toLocaleString("es-ES",{style:"currency",currency:"EUR",maximumFractionDigits:4});
const pct=n=>n==null?"—":(100*Number(n)).toLocaleString("es-ES",{maximumFractionDigits:2})+" %";
const normalize=s=>String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
export default function GenericVademecum({status,metaLoading,metaError,request,clientSlug,refresh,onRefresh}){
 const names=(status?.laboratories||[]).map(l=>l.name);
 const [lab,setLab]=useState(""),[data,setData]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [search,setSearch]=useState(""),[page,setPage]=useState(0),[size,setSize]=useState(50),[sort,setSort]=useState("name"),[direction,setDirection]=useState(1);
 const selected=names.includes(lab)?lab:"";
 useEffect(()=>{
  setData([]);setError("");setPage(0);
  if(!selected){setBusy(false);return;}
  const controller=new AbortController();setBusy(true);
  request(clientSlug,"/api/genericos/ofertas/vademecum?laboratorio="+encodeURIComponent(selected),{signal:controller.signal})
   .then(v=>{if(!controller.signal.aborted)setData(v.items||[])})
   .catch(e=>{if(!controller.signal.aborted)setError(e.message)})
   .finally(()=>{if(!controller.signal.aborted)setBusy(false)});
  return()=>controller.abort();
 },[clientSlug,selected,refresh]);
 const rows=useMemo(()=>makeVademecumRows(data,selected),[data,selected]);
 const columns=[selected,...names.filter(n=>n!==selected)].filter(Boolean);
 const visible=useMemo(()=>{
  const q=normalize(search);
  return rows.filter(r=>normalize(r.cn+" "+r.name+" "+(r.dcpf||"")).includes(q)).sort((a,b)=>{
   if(sort==="name"||sort==="cn")return direction*String(a[sort]).localeCompare(String(b[sort]),"es",{numeric:true});
   const x=a.cells[sort]?.net,y=b.cells[sort]?.net;
   if(x==null||y==null)return x==null&&y==null?0:x==null?1:-1;
   return direction*(x-y)||a.cn.localeCompare(b.cn);
  });
 },[rows,search,sort,direction]);
 const safePage=Math.min(page,Math.max(0,Math.ceil(visible.length/(size||1))-1));
 const changeSort=key=>{setSort(key);setDirection(sort===key?-direction:1);setPage(0)};
 const palette={best:["#d7efdf","#18583c"],second:["#fff2bf","#735600"],third:["#ffe1be","#8b470f"],worst:["#fbd9dd","#8a2635"]};
 return <div className="fm-gof">
  <ReportPageHeader title="Genéricos · Vademécum por laboratorio" description="Comparativa de tarifas vigentes por presentación equivalente (DCPF)" refreshing={busy||metaLoading} onRefresh={onRefresh}/>
  <section className="card fm-gof-picker">
   <div className="fm-gof-filters">
    <label>Laboratorio con tarifa<select value={selected} onChange={e=>{setLab(e.target.value);setSearch("");setSort("name");setDirection(1)}}>
     <option value="">Selecciona un laboratorio</option>{names.map(n=><option key={n}>{n}</option>)}
    </select></label>
    <label>Buscar CN, producto o conjunto<input value={search} onChange={e=>{setSearch(e.target.value);setPage(0)}} placeholder="CN o descripción"/></label>
   </div>
   {(error||metaError)&&<p role="alert" className="fm-gof-message fm-gof-error">{error||metaError}</p>}
   {metaLoading||busy?<LoadingPanel kind="table" label="Consultando vademécum y tarifas…" rows={5}/>:
    !selected?<p className="fm-gof-hint">Elige un laboratorio de las tarifas importadas.</p>:<>
     <h3>{selected} · {rows.length.toLocaleString("es-ES")} referencias</h3>
     <p className="fm-gof-hint">El descuento se aplica sobre el PVL. El color y la posición comparan el precio neto sin IVA, no solo el porcentaje. Si hay varios CN equivalentes de otro laboratorio, se muestra el de menor neto.</p>
     <div style={{display:"flex",flexWrap:"wrap",gap:8,margin:"12px 0"}}>
      {Object.entries({best:"Mejor precio",second:"Segundo",third:"Tercero",worst:"Peor"}).map(([key,label])=><span key={key} style={{background:palette[key][0],color:palette[key][1],padding:"5px 9px",borderRadius:5,fontWeight:600}}>{label}</span>)}
      <span>— Sin tarifa comparable · empates comparten posición</span>
     </div>
     <div className="fm-gof-catalog-scroll"><table className="fm-gof-catalog-table">
      <thead><tr>{[["cn","CN"],["name","Producto"],...columns.map(n=>[n,n+" · Dto. / neto"])].map(([key,label])=><th key={key}><button className="smart-sort" type="button" onClick={()=>changeSort(key)}>{label} {sort===key?(direction===1?"▲":"▼"):"↕"}</button></th>)}</tr></thead>
      <tbody>{(size?visible.slice(safePage*size,(safePage+1)*size):visible).map(row=><tr key={row.cn}>
       <td>{row.cn}</td><td><strong>{row.name}</strong>{row.dcpf&&<small> · DCPF {row.dcpf}</small>}</td>
       {columns.map(n=>{const c=row.cells[n],colors=c&&palette[c.tone];return <td key={n} className="fm-gof-num" style={colors?{background:colors[0],color:colors[1]}:undefined} title={c?"CN "+c.cn+" · PVL "+money(c.pvl)+" · posición "+(c.rank??"sin comparación"):"Sin tarifa equivalente"}>
        {c?<><strong>{pct(c.discount)}</strong><small style={{display:"block"}}>{money(c.net)}{c.rank!=null?" · #"+c.rank:""}</small></>:"—"}</td>})}
      </tr>)}
      {!visible.length&&<tr><td colSpan={columns.length+2}>No hay referencias para estos filtros.</td></tr>}</tbody>
     </table></div>
     <ListPagination total={visible.length} page={safePage} pageSize={size} pageSizes={[25,50,100,0]} onPageChange={setPage} onPageSizeChange={n=>{setSize(n);setPage(0)}} label="referencias"/>
    </>}
  </section>
 </div>;
}
