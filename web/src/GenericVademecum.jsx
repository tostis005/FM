import React,{useEffect,useMemo,useState} from "react";
import {ListPagination} from "./ListTable.jsx";
import {useColumnTable,ColumnTableHead} from "./ColumnTable.jsx";
import HorizontalTableScroll from "./HorizontalTableScroll.jsx";
import {LoadingPanel} from "./LoadingState.jsx";
import {ReportPageHeader} from "./ReportControls.jsx";
import {makeVademecumRows} from "./genericVademecumRows.js";
const money=n=>n==null?"—":Number(n).toLocaleString("es-ES",{style:"currency",currency:"EUR",maximumFractionDigits:4});
const pct=n=>n==null?"—":(100*Number(n)).toLocaleString("es-ES",{maximumFractionDigits:2})+" %";
const normalize=s=>String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
export default function GenericVademecum({status,metaLoading,metaError,request,clientSlug,refresh,onRefresh}){
 const names=(status?.laboratories||[]).map(l=>l.name);
 const [lab,setLab]=useState(""),[data,setData]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [search,setSearch]=useState(""),[page,setPage]=useState(0),[size,setSize]=useState(50);
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
 const labs=[selected,...names.filter(n=>n!==selected)].filter(Boolean);
 const baseRows=useMemo(()=>{const q=normalize(search);return rows.filter(r=>normalize(r.cn+" "+r.name+" "+(r.dcpf||"")).includes(q))},[rows,search]);
 const columns=[{key:"cn",label:"CN",value:r=>r.cn},{key:"name",label:"Artículo",value:r=>r.name,filterText:r=>r.name+" "+(r.dcpf||"")},...labs.map(n=>({key:"lab:"+n,label:n,title:n+" · orden por precio neto; filtro por descuento o precio",value:r=>r.cells[n]?.net??null,filterText:r=>{const c=r.cells[n];return c?pct(c.discount)+" "+money(c.net)+" "+String(c.net??""):"—"}}))];
 const table=useColumnTable(baseRows,columns,{scope:selected,onChange:()=>setPage(0),defaultSort:{key:"name",direction:"asc"}});
 const visible=table.rows,safePage=size===0?0:Math.min(page,Math.max(0,Math.ceil(visible.length/size)-1));
 const palette={best:["#d7efdf","#18583c"],second:["#fff2bf","#735600"],third:["#ffe1be","#8b470f"],worst:["#fbd9dd","#8a2635"]};
 return <div className="fm-gof">
  <ReportPageHeader title="Genéricos · Vademécum por laboratorio" description="Comparativa de tarifas vigentes por presentación equivalente (DCPF)" refreshing={busy||metaLoading} onRefresh={onRefresh}/>
  <section className="card fm-gof-picker">
   <div className="fm-gof-filters">
    <label>Laboratorio con tarifa<select value={selected} onChange={e=>{setLab(e.target.value);setSearch("");setPage(0)}}>
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
     <HorizontalTableScroll className="fm-gof-vademecum-scroll" label="vademécum por laboratorio">
      <table className="fm-gof-catalog-table fm-gof-vademecum-table" style={{minWidth:76+340+labs.length*112}}>
       <colgroup><col style={{width:76}}/><col/>{labs.map(n=><col key={n} style={{width:112}}/>)}</colgroup>
       <ColumnTableHead table={table}/>
       <tbody>{(size?visible.slice(safePage*size,(safePage+1)*size):visible).map(row=><tr key={row.cn}>
        <td className="fm-vadem-cn">{row.cn}</td><td className="fm-vadem-name" title={row.name+(row.dcpf?" · DCPF "+row.dcpf:"")}>{row.name}</td>
        {labs.map(n=>{const c=row.cells[n],colors=c&&palette[c.tone];return <td key={n} className="fm-vadem-price" data-price-rank={c?.rank??undefined} data-price-tone={c?.tone??undefined} style={colors?{background:colors[0],color:colors[1]}:undefined} title={c?"CN "+c.cn+" · PVL "+money(c.pvl)+" · posición "+(c.rank??"sin comparación"):"Sin tarifa equivalente"}>
         {c?<><strong>{pct(c.discount)}</strong><span className="fm-vadem-net">{money(c.net)}</span></>:"—"}</td>})}
       </tr>)}
       {!visible.length&&<tr><td colSpan={columns.length}>No hay referencias para estos filtros.</td></tr>}</tbody>
      </table>
     </HorizontalTableScroll>
     <ListPagination total={visible.length} page={safePage} pageSize={size} pageSizes={[25,50,100,0]} onPageChange={setPage} onPageSizeChange={n=>{setSize(n);setPage(0)}} label="referencias"/>
    </>}
  </section>
 </div>;
}
