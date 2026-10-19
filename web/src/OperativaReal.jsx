import React,{useEffect,useMemo,useState} from "react";
import {AlertTriangle,ArrowDownToLine,ArrowRightLeft,ClipboardList,Package,Plus,ShoppingCart,Users} from "lucide-react";
import OperativaPreview,{PREVIEW_SECTIONS} from "./OperativaPreview.jsx";
import "./operativaReal.css";

const MAP={"compras-preparador":"pedidos","compras-pendientes":"pedidos","compras-pedidos":"pedidos",
 "oportunidades-seguimiento":"oportunidades","alertas":"trabajo","mi-trabajo":"trabajo",
 "stock-traspasos":"traspasos","rentabilidad-retorno":"resultados"};
export const REAL_SECTIONS=new Set(Object.keys(MAP));
const ESTADOS={
 nueva:"Nueva",en_estudio:"En estudio",en_curso:"En curso",aplicada_parcialmente:"Aplicada parcialmente",
 aplicada:"Aplicada",descartada:"Descartada",pospuesta:"Pospuesta",
 borrador:"Borrador",pendiente_aprobacion:"Pendiente de aprobación",
 aprobado:"Aprobado",exportado:"Exportado",cancelado:"Cancelado",
 pendiente:"Pendiente",resuelta:"Resuelta",
 propuesta:"Propuesta",en_revision:"En revisión",aprobada:"Aprobada",realizada:"Realizada"
};
const NUM=n=>new Intl.NumberFormat("es-ES").format(n);
const EUR=n=>new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(n);
const TITLE=id=>PREVIEW_SECTIONS[id]?.title||"Operativa";
const E=(e)=>String(e?.message||"No se pudo completar la operación.");
const defaultNeed=()=>({id:crypto.randomUUID(),articulo:"",nombre:"",necesidad:1,asignaciones:[]});
const pending=n=>Number(n.necesidad||0)-(n.asignaciones||[]).reduce((s,a)=>s+Number(a.unidades||0),0);
const safeStr=v=>String(v??"");
const safeCSV=v=>{const raw=safeStr(v);return '"'+(/^[\s]*[=+@-]/.test(raw)?"'"+raw:raw).replaceAll('"','""')+'"';};
function exportPlan(plan){
 const rows=[["Artículo","Descripción","Necesidad","Proveedor","Asignado","Coste unitario","Pendiente"]];
 for(const n of plan.lineas||[]){
  if(!(n.asignaciones||[]).length)rows.push([n.articulo,n.nombre,n.necesidad,"",0,"",pending(n)]);
  for(const a of n.asignaciones||[])rows.push([n.articulo,n.nombre,n.necesidad,a.proveedor,a.unidades,a.coste??"",pending(n)]);
 }
 const csv="\ufeff"+rows.map(line=>line.map(safeCSV).join(";")).join("\r\n");
 const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
 const a=document.createElement("a");a.href=url;a.download="farmetrica-plan-"+plan.id.slice(0,8)+".csv";
 document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function Table({headers,rows,empty="Todavía no hay registros para esta farmacia."}){
 return <div className="fm-preview-scroll" tabIndex={0} role="region" aria-label="Tabla de registros">
 <table className="fm-preview-table"><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead>
 <tbody>{rows.length?rows.map((r,i)=><tr key={i}>{r.map((v,j)=><td key={j}>{v}</td>)}</tr>):
  <tr><td colSpan={headers.length}>{empty}</td></tr>}</tbody></table></div>;
}
function Cards({entries}){return <div className="fm-preview-kpis">
 {entries.map(([k,v])=><article className="card fm-preview-kpi" key={k}><span>{k}</span><strong>{v}</strong></article>)}
 </div>}
function FormField({label,children}){return <label className="fm-op-field"><span>{label}</span>{children}</label>}
function SelectStatus({value,onChange,values,disabled}){return <select aria-label="Estado" value={value} disabled={disabled}
 onChange={e=>onChange(e.target.value)}>{values.map(s=><option key={s} value={s}>{ESTADOS[s]||s}</option>)}</select>}
function Button({children,onClick,disabled,primary=false}){return <button type="button"
 className={"btn "+(primary?"btn-primary":"btn-secondary")} disabled={disabled} onClick={onClick}>{children}</button>}
export default function OperativaReal({section,pharmacies=[],clientSlug,userEmail=""}){
 const resource=MAP[section], [pharmacy,setPharmacy]=useState(String(pharmacies[0]?.id||""));
 const [mode,setMode]=useState("loading"),[example,setExample]=useState(false);
 const [items,setItems]=useState([]),[scope,setScope]=useState({});
 const [error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
 const [responsibles,setResponsibles]=useState([]),[related,setRelated]=useState({oportunidades:[],pedidos:[]});
 const [selected,setSelected]=useState(""),[events,setEvents]=useState([]),[comment,setComment]=useState("");
 const [name,setName]=useState(""),[detail,setDetail]=useState(""),[amount,setAmount]=useState("0"),[owner,setOwner]=useState("");
 const [priority,setPriority]=useState("media"),[impact,setImpact]=useState("ahorro_potencial");
 const [kind,setKind]=useState("alerta"),[destination,setDestination]=useState("");
 const [article,setArticle]=useState(""),[units,setUnits]=useState("1");
 const [draft,setDraft]=useState(null),[newNeed,setNewNeed]=useState(defaultNeed);
 const [allocArticle,setAllocArticle]=useState(""),[allocProvider,setAllocProvider]=useState(""),
  [allocUnits,setAllocUnits]=useState("1"),[allocCost,setAllocCost]=useState("");
 const [policy,setPolicy]=useState({cobertura_saludable:90,intervalo_pedidos:7,plazo_entrega:2,stock_seguridad:0});
 useEffect(()=>{setPharmacy(String(pharmacies[0]?.id||""));},[clientSlug,pharmacies.map(p=>p.id).join(",")]);
 const headers={"x-farmetrica-cliente":clientSlug,"content-type":"application/json"};
 async function api(path,method="GET",body){
  const result=await fetch(path,{method,credentials:"same-origin",cache:"no-store",headers,
   ...(body?{body:JSON.stringify(body)}:{})});
  const data=await result.json().catch(()=>({}));
  if(!result.ok){const e=new Error(data.error||"Error al consultar la operativa");e.code=data.code;e.status=result.status;throw e;}
  return data;
 }
 async function query(recurso=resource,params={}){
  const search=new URLSearchParams({recurso,farmacia:pharmacy,...params});
  return api("/api/operativa?"+search);
 }
 async function refresh(){
  if(!pharmacy)return setMode("demo");
  setMode("loading");setError("");
  try{
   const result=await query();
   setScope(result.scope||{});setItems(result.items||[]);setMode("ready");
   if(["oportunidades","trabajo"].includes(resource)){
    const resp=await api("/api/operativa/responsables?farmacia="+encodeURIComponent(pharmacy)).catch(()=>({items:[]}));
    setResponsibles(resp.items||[]);
   }
   if(section==="mi-trabajo"){
    const [opp,orders]=await Promise.all(["oportunidades","pedidos"].map(key=>query(key).catch(()=>({items:[]}))));
    setRelated({oportunidades:(opp.items||[]).filter(x=>x.responsable===userEmail&&
      !["aplicada","descartada"].includes(x.estado)),
      pedidos:(orders.items||[]).filter(x=>x.estado==="pendiente_aprobacion")});
   }
   if(resource==="pedidos"){
    const policies=await query("politicas").catch(()=>({items:[]}));
    if(policies.items?.[0])setPolicy(policies.items[0]);
   }
  }catch(e){
   if(e.code==="migration_required"){setMode("demo");return;}
   setError(E(e));setMode("error");
  }
 }
 useEffect(()=>{setSelected("");setDraft(null);setExample(false);void refresh();},[section,clientSlug,pharmacy]);
 async function save(method,recurso,body={},id){
  setBusy(true);setNotice("");setError("");
  try{
   const path="/api/operativa"+(method==="PATCH"?"/"+recurso+"/"+id:"");
   const result=await api(path,method,{...body,recurso,farmacia:pharmacy});
   setNotice("Cambios guardados.");await refresh();
   return result.item;
  }catch(e){setError(E(e));return null;}finally{setBusy(false);}
 }
 async function update(item,estado,extra={}){
  return save("PATCH",resource,{revision:item.revision,estado,...extra},item.id);
 }
 async function history(item){
  setSelected(item.id);setEvents([]);setError("");
  try{const json=await query(resource,{eventos:item.id});setEvents(json.items||[]);}
  catch(e){setError(E(e));}
 }
 function addNeed(){
  const key=newNeed.articulo.trim(),label=newNeed.nombre.trim(),qty=Number(newNeed.necesidad);
  if(!key||!label||!Number.isSafeInteger(qty)||qty<0)return setError("Completa identificador, descripción y necesidad.");
  if(draft.lineas.some(n=>n.articulo===key))return setError("Este artículo ya figura en el pedido.");
  setDraft(d=>({...d,lineas:[...d.lineas,{...newNeed,articulo:key,nombre:label,necesidad:qty}]}));
  setNewNeed(defaultNeed());setError("");
 }
 function editNeed(id,key,value){
  setDraft(d=>({...d,lineas:d.lineas.map(n=>{
   if(n.id!==id)return n;
   const qty=Number(value),assigned=n.asignaciones.reduce((s,a)=>s+a.unidades,0);
   return {...n,[key]:key==="necesidad"?Math.max(assigned,Number.isFinite(qty)?Math.trunc(qty):0):value};
  })}));
 }
 function allocate(){
  const units=Number(allocUnits),cost=allocCost===""?null:Number(allocCost);
  if(!allocArticle||!allocProvider.trim()||!Number.isSafeInteger(units)||units<0||
   (cost!==null&&(!Number.isFinite(cost)||cost<0)))return setError("Proveedor, cantidad o coste inválido.");
  const line=draft.lineas.find(n=>n.id===allocArticle);
  if(!line)return setError("Selecciona el artículo.");
  const other=line.asignaciones.filter(a=>a.proveedor!==allocProvider.trim());
  if(other.reduce((s,a)=>s+a.unidades,0)+units>line.necesidad)return setError("El reparto supera la necesidad.");
  setDraft(d=>({...d,lineas:d.lineas.map(n=>n.id===allocArticle?
   {...n,asignaciones:[...other,...(units>0?[{proveedor:allocProvider.trim(),unidades:units,coste:cost}]:[])]}:n)}));
  setAllocProvider("");setAllocCost("");setAllocUnits("1");setError("");
 }
 const orders=useMemo(()=>items.filter(p=>section==="compras-pedidos"?
   !["borrador"].includes(p.estado):section==="compras-pendientes"?
   p.lineas.some(n=>pending(n)>0):true),[items,section]);
 const canEdit=scope.canEdit,canApprove=scope.canApprove;
 const statInput={fontSize:13};
 if(mode==="loading")return <section className="card fm-preview-panel" role="status">Cargando operativa…</section>;
 if(mode==="demo"||example)return <div>
  {mode==="ready"&&<div className="fm-op-example-return"><Button onClick={()=>setExample(false)}>Volver a datos guardados</Button></div>}
  <OperativaPreview section={section} pharmacies={pharmacies}/></div>;
 if(mode==="error")return <section className="card fm-preview-panel"><h2>Datos no disponibles</h2>
  <p role="alert">{error}</p><Button onClick={refresh}>Reintentar</Button>
  <Button onClick={()=>setExample(true)}>Ver ejemplo de demo</Button></section>;
 const title=TITLE(section);
 return <div className="fm-operativa-preview fm-operativa-real">
   <div className="fm-preview-heading">
    <div className="page-header"><div><h1>{title}</h1></div></div>
    <div className="fm-op-tools">
     <label>Farmacia<select aria-label="Farmacia" value={pharmacy} onChange={e=>setPharmacy(e.target.value)}>
      {pharmacies.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
     <Button onClick={()=>setExample(true)}>Ver ejemplo de demo</Button>
    </div>
   </div>
   {error&&<div className="fm-op-message fm-op-error" role="alert">{error}</div>}
   {notice&&<div className="fm-op-message" role="status">{notice}</div>}
   {resource==="pedidos"&&<>
    <Cards entries={[["Planes",NUM(items.length)],["Pendientes de aprobación",NUM(items.filter(n=>n.estado==="pendiente_aprobacion").length)],
     ["Necesidades sin asignar",NUM(items.reduce((s,p)=>s+p.lineas.reduce((v,n)=>v+pending(n),0),0))+" uds."],
     ["Pedidos aprobados",NUM(items.filter(x=>x.estado==="aprobado").length)]]}/>
    <section className="card fm-preview-panel">
     <div className="fm-preview-panel-head"><h2><ShoppingCart size={18}/> Planes de compra</h2>
      {canEdit&&<Button onClick={()=>setDraft({nombre:"Plan de reposición",lineas:[],id:null})}><Plus size={15}/> Nuevo borrador</Button>}</div>
     <Table headers={["Plan","Estado","Referencias","Pendientes","Fecha","Acciones"]}
       rows={orders.map(p=>[p.nombre,ESTADOS[p.estado]||p.estado,p.lineas.length,
        p.lineas.reduce((s,n)=>s+pending(n),0),new Date(p.actualizado_en).toLocaleDateString("es-ES"),
        <div className="fm-op-row-actions" key={p.id}>
         {canEdit&&["borrador","pendiente_aprobacion"].includes(p.estado)&&
          <Button onClick={()=>{setDraft(structuredClone(p));setSelected(p.id);}}>Editar</Button>}
         <Button onClick={()=>exportPlan(p)}><ArrowDownToLine size={14}/> CSV</Button>
         {canEdit&&p.estado==="borrador"&&<Button disabled={busy} onClick={()=>update(p,"pendiente_aprobacion")}>Solicitar aprobación</Button>}
         {canApprove&&p.estado==="pendiente_aprobacion"&&<Button disabled={busy} onClick={()=>update(p,"aprobado")}>Aprobar</Button>}
         {canEdit&&p.estado==="aprobado"&&<Button disabled={busy} onClick={()=>update(p,"exportado")}>Marcar exportado</Button>}
         {canEdit&&["borrador","pendiente_aprobacion","aprobado"].includes(p.estado)&&
          <Button disabled={busy} onClick={()=>update(p,"cancelado")}>Cancelar</Button>}
         <Button onClick={()=>history(p)}>Historial</Button>
        </div>])}/>
    </section>
    {canEdit&&draft&&<section className="card fm-preview-panel">
     <div className="fm-preview-panel-head"><h2>{draft.id?"Editar":"Nuevo"} plan de compra</h2>
      <Button onClick={()=>setDraft(null)}>Cerrar</Button></div>
     <div className="fm-op-fields"><FormField label="Nombre del plan"><input value={draft.nombre}
      onChange={e=>setDraft(d=>({...d,nombre:e.target.value}))}/></FormField></div>
     <Table headers={["Artículo","Necesidad","Asignado","Pendiente","Proveedores","Quitar"]}
      rows={draft.lineas.map(n=>[<b key={n.id}>{n.nombre}</b>,
       <input type="number" aria-label={"Necesidad "+n.nombre} min="0" key={n.id+"q"}
        value={n.necesidad} onChange={e=>editNeed(n.id,"necesidad",e.target.value)} style={{width:70}}/>,
       n.necesidad-pending(n),<strong key={n.id+"p"}>{pending(n)}</strong>,
       n.asignaciones.map(a=>a.proveedor+": "+a.unidades).join(" · ")||"—",
       <Button key={n.id+"d"} onClick={()=>setDraft(d=>({...d,lineas:d.lineas.filter(x=>x.id!==n.id)}))}>Quitar</Button>
      ])}/>
     <div className="fm-op-fields">
      <FormField label="Código de artículo"><input value={newNeed.articulo}
       onChange={e=>setNewNeed(n=>({...n,articulo:e.target.value}))}/></FormField>
      <FormField label="Descripción"><input value={newNeed.nombre}
       onChange={e=>setNewNeed(n=>({...n,nombre:e.target.value}))}/></FormField>
      <FormField label="Necesidad (uds.)"><input type="number" min="0" value={newNeed.necesidad}
       onChange={e=>setNewNeed(n=>({...n,necesidad:e.target.value}))}/></FormField>
      <div className="fm-op-field-action"><Button onClick={addNeed}>Añadir artículo</Button></div>
     </div>
     <h3>Asignación a proveedores</h3>
     <div className="fm-op-fields">
      <FormField label="Artículo"><select value={allocArticle} onChange={e=>setAllocArticle(e.target.value)}>
       <option value="">Seleccionar</option>{draft.lineas.map(n=><option value={n.id} key={n.id}>{n.nombre}</option>)}
      </select></FormField>
      <FormField label="Proveedor"><input value={allocProvider} onChange={e=>setAllocProvider(e.target.value)}/></FormField>
      <FormField label="Unidades (0 para quitar)"><input type="number" min="0" value={allocUnits}
       onChange={e=>setAllocUnits(e.target.value)}/></FormField>
      <FormField label="Coste unitario, opcional"><input type="number" min="0" step="0.01" value={allocCost}
       onChange={e=>setAllocCost(e.target.value)}/></FormField>
      <div className="fm-op-field-action"><Button onClick={allocate}>Asignar / modificar</Button></div>
     </div>
     <p className="fm-op-fine">Si quitas una asignación, las unidades siguen en Pendientes de asignar. El pedido no se envía automáticamente al ERP.</p>
     <div className="fm-preview-actions"><Button primary disabled={busy||!draft.lineas.length}
      onClick={async()=>{
       const payload={nombre:draft.nombre,lineas:draft.lineas};
       const saved=draft.id?await save("PATCH","pedidos",{...payload,revision:draft.revision},draft.id):
        await save("POST","pedidos",payload);
       if(saved)setDraft(null);
      }}>Guardar borrador</Button></div>
    </section>}
    <section className="card fm-preview-panel"><div className="fm-preview-panel-head"><h2>Política de reposición</h2></div>
     <div className="fm-op-fields">{[["cobertura_saludable","Máxima cobertura saludable"],
      ["intervalo_pedidos","Intervalo de pedido (días)"],["plazo_entrega","Plazo de entrega (días)"],
      ["stock_seguridad","Stock de seguridad (uds.)"]].map(([key,label])=>
      <FormField key={key} label={label}><input type="number" min="0" disabled={!canApprove} value={policy[key]}
        onChange={e=>setPolicy(v=>({...v,[key]:e.target.value}))}/></FormField>)}</div>
     {Number(policy.cobertura_saludable)<Number(policy.intervalo_pedidos)+Number(policy.plazo_entrega)&&
      <div className="fm-op-message">La cobertura máxima no alcanza el intervalo de compra más el plazo de suministro.</div>}
     {canApprove&&<div className="fm-preview-actions"><Button disabled={busy} onClick={()=>save("POST","politicas",policy)}>Guardar parámetros</Button></div>}
    </section>
   </>}
   {resource==="oportunidades"&&<>
    <Cards entries={[["Oportunidades",NUM(items.length)],["Abiertas",NUM(items.filter(x=>!["aplicada","descartada"].includes(x.estado)).length)],
     ["Ahorro potencial",EUR(items.filter(x=>x.impacto_tipo==="ahorro_potencial").reduce((s,x)=>s+Number(x.importe_potencial),0))],
     ["Capital liberable",EUR(items.filter(x=>x.impacto_tipo==="capital_liberable").reduce((s,x)=>s+Number(x.importe_potencial),0))]]}/>
    <section className="card fm-preview-panel"><div className="fm-preview-panel-head"><h2>Oportunidades y episodios</h2></div>
     <Table headers={["Oportunidad","Episodio","Impacto","Importe potencial","Responsable","Prioridad","Estado","Historial"]}
      rows={items.map(x=>[x.titulo,x.episodio,x.impacto_tipo.replaceAll("_"," "),EUR(x.importe_potencial),
       <select aria-label={"Responsable "+x.titulo} value={x.responsable||""} key={x.id+"a"} disabled={!canEdit||busy}
        onChange={e=>save("PATCH",resource,{revision:x.revision,responsable:e.target.value},x.id)}>
        <option value="">Sin asignar</option>{responsibles.map(r=><option value={r.email} key={r.email}>{r.email}</option>)}
       </select>,x.prioridad,
       <SelectStatus key={x.id} value={x.estado} disabled={!canEdit||busy||["aplicada","descartada"].includes(x.estado)}
        values={["nueva","en_estudio","en_curso","aplicada_parcialmente","aplicada","descartada","pospuesta"]}
        onChange={s=>update(x,s)}/>,
       <Button key={x.id+"h"} onClick={()=>history(x)}>Historial</Button>])}/>
    </section>
    {canEdit&&<section className="card fm-preview-panel"><div className="fm-preview-panel-head"><h2>Nueva oportunidad manual</h2></div>
     <div className="fm-op-fields">
      <FormField label="Título"><input value={name} onChange={e=>setName(e.target.value)}/></FormField>
      <FormField label="Acción recomendada"><input value={detail} onChange={e=>setDetail(e.target.value)}/></FormField>
      <FormField label="Impacto"><select value={impact} onChange={e=>setImpact(e.target.value)}>
       {[["ahorro_potencial","Ahorro potencial"],["mejora_margen","Mejora de margen"],
        ["capital_liberable","Capital liberable"],["riesgo","Riesgo"]].map(([v,n])=><option value={v} key={v}>{n}</option>)}
      </select></FormField>
      <FormField label="Importe estimado"><input type="number" min="0" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></FormField>
      <FormField label="Prioridad"><select value={priority} onChange={e=>setPriority(e.target.value)}>
       {["critica","alta","media","baja"].map(v=><option key={v}>{v}</option>)}</select></FormField>
      <FormField label="Responsable"><select value={owner} onChange={e=>setOwner(e.target.value)}>
       <option value="">Sin asignar</option>{responsibles.map(r=><option key={r.email}>{r.email}</option>)}
      </select></FormField>
     </div><div className="fm-preview-actions"><Button primary disabled={busy||!name.trim()} onClick={async()=>{
      const saved=await save("POST",resource,{titulo:name,accion:detail,importe_potencial:amount,
       impacto_tipo:impact,prioridad,responsable:owner||null});
      if(saved){setName("");setDetail("");setAmount("0");}
     }}>Crear oportunidad</Button></div>
    </section>}
   </>}
   {resource==="trabajo"&&<>
    <Cards entries={[["Pendientes",String(items.filter(x=>x.estado==="pendiente").length)],
     ["En curso",String(items.filter(x=>x.estado==="en_curso").length)],
     ["Críticas",String(items.filter(x=>x.prioridad==="critica").length)],
     ["Asignadas a mí",String(items.filter(x=>x.responsable===userEmail).length)]]}/>
    <section className="card fm-preview-panel"><div className="fm-preview-panel-head"><h2>{section==="alertas"?"Alertas":"Tareas y alertas asignadas"}</h2></div>
     <Table headers={["Tipo","Asunto","Prioridad","Responsable","Estado","Historial"]}
      rows={items.filter(x=>section==="alertas"?x.tipo==="alerta":x.responsable===userEmail).map(x=>[
       x.tipo,x.titulo,x.prioridad,
       <select key={x.id+"r"} value={x.responsable||""} disabled={!canEdit||busy} aria-label={"Responsable "+x.titulo}
        onChange={e=>save("PATCH",resource,{revision:x.revision,responsable:e.target.value},x.id)}>
        <option value="">Sin asignar</option>{responsibles.map(r=><option key={r.email}>{r.email}</option>)}</select>,
       <SelectStatus key={x.id} disabled={!canEdit||busy} value={x.estado}
        values={["pendiente","en_curso","resuelta","descartada","pospuesta"]} onChange={s=>update(x,s)}/>,
       <Button key={x.id+"h"} onClick={()=>history(x)}>Historial</Button>])}/>
    </section>
    {section==="mi-trabajo"&&<section className="card fm-preview-panel">
     <div className="fm-preview-panel-head"><h2>Oportunidades asignadas</h2></div>
     <Table headers={["Oportunidad","Importe potencial","Estado"]} rows={related.oportunidades.map(x=>[x.titulo,EUR(x.importe_potencial),ESTADOS[x.estado]])}/>
     <div className="fm-preview-panel-head" style={{marginTop:22}}><h2>Pedidos para aprobación</h2></div>
     <Table headers={["Plan","Líneas","Estado"]} rows={related.pedidos.map(x=>[x.nombre,x.lineas.length,ESTADOS[x.estado]])}/>
    </section>}
    {canEdit&&<section className="card fm-preview-panel"><div className="fm-preview-panel-head"><h2>Nueva alerta o tarea</h2></div>
     <div className="fm-op-fields"><FormField label="Tipo"><select value={kind} onChange={e=>setKind(e.target.value)}>
      {["alerta","tarea","inventario","aprobacion"].map(t=><option key={t} value={t}>{t}</option>)}</select></FormField>
      <FormField label="Título"><input value={name} onChange={e=>setName(e.target.value)}/></FormField>
      <FormField label="Descripción"><input value={detail} onChange={e=>setDetail(e.target.value)}/></FormField>
      <FormField label="Prioridad"><select value={priority} onChange={e=>setPriority(e.target.value)}>
       {["critica","alta","media","baja"].map(v=><option key={v}>{v}</option>)}</select></FormField>
      <FormField label="Responsable"><select value={owner} onChange={e=>setOwner(e.target.value)}>
       <option value="">Sin asignar</option>{responsibles.map(r=><option key={r.email} value={r.email}>{r.email}</option>)}</select></FormField>
     </div><div className="fm-preview-actions"><Button primary disabled={busy||!name.trim()}
      onClick={async()=>{const result=await save("POST","trabajo",{tipo:kind,titulo:name,
       descripcion:detail,prioridad,responsable:owner||null});if(result){setName("");setDetail("");}}}>Crear tarea</Button></div>
    </section>}
   </>}
   {resource==="traspasos"&&<>
    <Cards entries={[["Propuestas",String(items.length)],["En revisión",String(items.filter(x=>x.estado==="en_revision").length)],
     ["Unidades propuestas",NUM(items.reduce((s,x)=>s+x.unidades,0))],
     ["Valor propuesto",EUR(items.reduce((s,x)=>s+Number(x.valor),0))]]}/>
    <section className="card fm-preview-panel"><div className="fm-preview-panel-head"><h2>Redistribución de inventario</h2></div>
     <Table headers={["Artículo","Origen","Destino","Unidades","Valor","Estado","Historial"]}
      rows={items.map(x=>[x.descripcion||x.articulo,
       pharmacies.find(p=>Number(p.id)===x.origen_farmacia_id)?.name||x.origen_farmacia_id,
       pharmacies.find(p=>Number(p.id)===x.destino_farmacia_id)?.name||x.destino_farmacia_id,
       x.unidades,EUR(x.valor),
       <SelectStatus key={x.id} disabled={!canEdit||busy||["realizada","descartada"].includes(x.estado)}
        value={x.estado} values={["propuesta","en_revision","aprobada","realizada","descartada"]}
        onChange={s=>update(x,s)}/>,
       <Button key={x.id+"h"} onClick={()=>history(x)}>Historial</Button>])}/>
    </section>
    {canEdit&&<section className="card fm-preview-panel"><div className="fm-preview-panel-head"><h2>Nueva propuesta</h2></div>
     <div className="fm-op-fields">
      <FormField label="Farmacia destino"><select value={destination} onChange={e=>setDestination(e.target.value)}>
       <option value="">Seleccionar</option>{pharmacies.filter(p=>String(p.id)!==pharmacy).map(p=>
        <option key={p.id} value={p.id}>{p.name}</option>)}</select></FormField>
      <FormField label="Artículo"><input value={article} onChange={e=>setArticle(e.target.value)}/></FormField>
      <FormField label="Descripción"><input value={name} onChange={e=>setName(e.target.value)}/></FormField>
      <FormField label="Unidades"><input type="number" min="1" value={units} onChange={e=>setUnits(e.target.value)}/></FormField>
      <FormField label="Valor del stock"><input type="number" min="0" step="0.01" value={amount}
        onChange={e=>setAmount(e.target.value)}/></FormField>
     </div><div className="fm-preview-actions"><Button primary disabled={busy||!destination||!article.trim()} onClick={async()=>{
      const created=await save("POST",resource,{destino_farmacia_id:destination,
       articulo:article,descripcion:name,unidades:units,valor:amount});
      if(created){setArticle("");setName("");setAmount("0");}
     }}>Crear propuesta</Button></div>
    </section>}
   </>}
   {resource==="resultados"&&<>
    <Cards entries={[["Ahorro verificado",EUR(items.filter(x=>x.tipo==="ahorro_verificado").reduce((s,x)=>s+Number(x.importe),0))],
     ["Mejora de margen",EUR(items.filter(x=>x.tipo==="margen_verificado").reduce((s,x)=>s+Number(x.importe),0))],
     ["Capital liberado",EUR(items.filter(x=>x.tipo==="capital_liberado").reduce((s,x)=>s+Number(x.importe),0))],
     ["Resultados contrastados",String(items.length)]]}/>
    <section className="card fm-preview-panel"><div className="fm-preview-panel-head"><h2>Resultados contrastados</h2></div>
     <Table headers={["Tipo","Importe","Periodo base","Periodo posterior","Método","Evidencia"]}
      rows={items.map(x=>[x.tipo.replaceAll("_"," "),EUR(x.importe),
       x.inicio_base+" – "+x.fin_base,x.inicio_comparacion+" – "+x.fin_comparacion,x.metodo,x.evidencia])}
      empty="Todavía no se ha verificado ningún ahorro. Aplicar una oportunidad no equivale a verificarlo."/>
    </section>
   </>}
   {selected&&<section className="card fm-preview-panel"><div className="fm-preview-panel-head"><h2>Historial y trazabilidad</h2>
    <Button onClick={()=>setSelected("")}>Cerrar</Button></div>
    <Table headers={["Fecha","Operación","Responsable","Detalle"]}
     rows={events.map(x=>[new Date(x.creado_en).toLocaleString("es-ES"),x.evento,x.actor,
      x.detalles?.comentario||x.detalles?.estado||"Registrado"])}/>
    {canEdit&&<div className="fm-preview-actions"><input placeholder="Comentario" aria-label="Comentario"
     value={comment} onChange={e=>setComment(e.target.value)}/>
     <Button disabled={busy||!comment.trim()} onClick={async()=>{
      const original=items.find(x=>x.id===selected);if(!original)return;
      const saved=await save("PATCH",resource,{revision:original.revision,comentario:comment},original.id);
      if(saved){setComment("");await history(saved);}
     }}>Registrar comentario</Button></div>}
   </section>}
  </div>;
}
