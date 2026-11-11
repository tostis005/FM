import React,{useEffect,useMemo,useState} from "react";
import {Save,Trash2,Plus,RefreshCcw} from "lucide-react";
import "./configuracionTransferidor.css";

async function request(slug,path,options={}){
 const r=await fetch(path,{credentials:"same-origin",cache:"no-store",...options,headers:{
  "Content-Type":"application/json","X-Farmetrica-Cliente":slug,...options.headers}});
 const result=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(result.error||"No se han podido guardar los datos");
 return result;
}
const number=n=>new Intl.NumberFormat("es-ES").format(Number(n)||0);
export default function ConfiguracionStockTransferidor({clientSlug,pharmacies=[]}){
 const [policy,setPolicy]=useState({minDays:4,targetDays:7,families:[],articles:[]});
 const [names,setNames]=useState([]);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(""),[notice,setNotice]=useState("");
 const [familyForm,setFamilyForm]=useState({pharmacyId:"",familyId:"",days:"30"});
 const [articleForm,setArticleForm]=useState({pharmacyId:"",cn:"",units:"100"});
 const available=useMemo(()=>pharmacies.filter(p=>p.establishmentType!=="almacen"&&p.active!==false),[pharmacies]);
 const families=useMemo(()=>names.filter(f=>f.segment==="PARAFARMACIA"),[names]);
 const getName=id=>names.find(f=>String(f.id)===String(id))?.name||"Familia "+id;
 const getPharmacy=id=>available.find(p=>String(p.id)===String(id))?.name||"Farmacia "+id;
 async function reload(){
  const [p,f]=await Promise.all([
   request(clientSlug,"/api/tenant/transferidor-politica"),
   request(clientSlug,"/api/tenant/familias-globales")]);
  setPolicy(p);setNames(f.items||[]);
 }
 useEffect(()=>{
  let alive=true;setLoading(true);setError("");setNotice("");
  Promise.all([request(clientSlug,"/api/tenant/transferidor-politica"),
   request(clientSlug,"/api/tenant/familias-globales")])
  .then(([p,f])=>{if(alive){setPolicy(p);setNames(f.items||[])}})
  .catch(e=>{if(alive)setError(e.message)})
  .finally(()=>{if(alive)setLoading(false)});
  return()=>{alive=false};
 },[clientSlug]);
 const act=async(fn,success)=>{
  setBusy(true);setError("");setNotice("");
  try{await fn();await reload();setNotice(success)}
  catch(e){setError(e.message)}
  finally{setBusy(false)}
 };
 async function submitGlobal(e){
  e.preventDefault();
  const minDays=Number(policy.minDays),targetDays=Number(policy.targetDays);
  if(!Number.isInteger(minDays)||!Number.isInteger(targetDays)||minDays<1||targetDays<=minDays||targetDays>365)
   return setError("El objetivo debe ser mayor que el mínimo (máximo 365 días).");
  await act(()=>request(clientSlug,"/api/tenant/transferidor-politica",
   {method:"PUT",body:JSON.stringify({minDays,targetDays})}),"Cobertura global del transferidor actualizada.");
 }
 async function submitFamily(e){
  e.preventDefault();
  const days=Number(familyForm.days);
  if(!familyForm.pharmacyId||!familyForm.familyId||!Number.isInteger(days)||days<1||days>365)
   return setError("Elige una farmacia, una familia y entre 1 y 365 días.");
  await act(()=>request(clientSlug,"/api/tenant/transferidor-politica/familias",
   {method:"PUT",body:JSON.stringify({...familyForm,days})}),"Exposición de familia guardada.");
 }
 async function submitArticle(e){
  e.preventDefault();
  const units=Number(articleForm.units);
  if(!articleForm.pharmacyId||!/^\d{6}$/.test(articleForm.cn)||!Number.isInteger(units)||units<1||units>999999)
   return setError("Elige farmacia, CN de 6 cifras y unidades de exposición.");
  await act(()=>request(clientSlug,"/api/tenant/transferidor-politica/articulos",
   {method:"PUT",body:JSON.stringify({...articleForm,units})}),"Exposición de artículo guardada.");
 }
 async function remove(type,entry){
  await act(()=>request(clientSlug,"/api/tenant/transferidor-politica/"+type,
   {method:"DELETE",body:JSON.stringify(type==="familias"?
    {pharmacyId:entry.pharmacyId,familyId:entry.familyId}:{pharmacyId:entry.pharmacyId,cn:entry.cn})}),
   "Excepción eliminada: vuelve a aplicarse el nivel superior.");
 }
 return <section className="card fm-transfer-settings">
  <div className="fm-transfer-settings-heading">
   <div><h2>Stock del transferidor</h2>
    <p>Reglas para reposición entre farmacias, independientes de los 30 días de compras del preparador.</p>
   </div>
   <button type="button" className="btn btn-secondary btn-sm" onClick={()=>act(async()=>reload(),"Configuración actualizada")} disabled={busy}>
    <RefreshCcw size={15}/> Actualizar</button>
  </div>
  {loading?<p role="status">Cargando reglas de stock…</p>:<>
   <form className="fm-transfer-settings-global" onSubmit={submitGlobal}>
    <div className="fm-transfer-settings-title"><strong>1. Regla global de rotación</strong><small>Para todas las farmacias</small></div>
    <label>Días mínimos para activar transferencia
     <input type="number" min="1" max="364" step="1" required value={policy.minDays}
      onChange={e=>setPolicy(x=>({...x,minDays:e.target.value}))}/>
    </label>
    <label>Días objetivo después de la transferencia
     <input type="number" min="2" max="365" step="1" required value={policy.targetDays}
      onChange={e=>setPolicy(x=>({...x,targetDays:e.target.value}))}/>
    </label>
    <button className="btn btn-primary" disabled={busy} type="submit"><Save size={16}/>Guardar</button>
   </form>
   <p className="fm-transfer-settings-example">Ejemplo sin exposición: por debajo de 4 días de stock, el transferidor busca unidades para alcanzar los 7 días. No se lanza una transferencia mientras se mantiene el mínimo.</p>
   <div className="fm-transfer-settings-section">
    <div className="fm-transfer-settings-title"><strong>2. Exposición por farmacia y familia</strong><small>Días adicionales de exposición, no sustitutivos de los 4/7 días</small></div>
    <form className="fm-transfer-settings-form" onSubmit={submitFamily}>
     <label>Farmacia
      <select required value={familyForm.pharmacyId} onChange={e=>setFamilyForm(x=>({...x,pharmacyId:e.target.value}))}>
       <option value="">Seleccionar</option>
       {available.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
     <label>Familia global
      <select required value={familyForm.familyId} onChange={e=>setFamilyForm(x=>({...x,familyId:e.target.value}))}>
       <option value="">Seleccionar</option>
       {families.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
      </select></label>
     <label>Días extra
      <input type="number" min="1" max="365" step="1" required value={familyForm.days}
       onChange={e=>setFamilyForm(x=>({...x,days:e.target.value}))}/></label>
     <button className="btn btn-primary" type="submit" disabled={busy||!families.length}><Plus size={16}/>Guardar</button>
    </form>
    <div className="fm-transfer-settings-records">
     {policy.families.length===0?<p>Sin excepciones familiares. Se aplica únicamente la regla global.</p>:
      policy.families.map(r=><div key={r.pharmacyId+"|"+r.familyId}>
       <span><strong>{getPharmacy(r.pharmacyId)}</strong> · {getName(r.familyId)}</span>
       <strong>{number(r.days)} días extra</strong>
       <button type="button" className="btn btn-secondary btn-sm" disabled={busy}
        onClick={()=>remove("familias",r)} aria-label={"Eliminar exposición de "+getName(r.familyId)}>
        <Trash2 size={14}/></button>
      </div>)}
    </div>
   </div>
   <div className="fm-transfer-settings-section">
    <div className="fm-transfer-settings-title"><strong>3. Exposición por farmacia y artículo (CN)</strong><small>Las unidades de CN sustituyen solo la exposición de familia para ese producto</small></div>
    <form className="fm-transfer-settings-form" onSubmit={submitArticle}>
     <label>Farmacia
      <select required value={articleForm.pharmacyId} onChange={e=>setArticleForm(x=>({...x,pharmacyId:e.target.value}))}>
       <option value="">Seleccionar</option>
       {available.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
     <label>Código nacional
      <input type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required placeholder="151130"
       value={articleForm.cn} onChange={e=>setArticleForm(x=>({...x,cn:e.target.value}))}/></label>
     <label>Unidades extra
      <input type="number" min="1" max="999999" step="1" required value={articleForm.units}
       onChange={e=>setArticleForm(x=>({...x,units:e.target.value}))}/></label>
     <button className="btn btn-primary" type="submit" disabled={busy}><Plus size={16}/>Guardar</button>
    </form>
    <div className="fm-transfer-settings-records">
     {policy.articles.length===0?<p>Sin excepciones por producto.</p>:
      policy.articles.map(r=><div key={r.pharmacyId+"|"+r.cn}>
       <span><strong>{getPharmacy(r.pharmacyId)}</strong> · CN {r.cn}</span>
       <strong>{number(r.units)} uds. extra</strong>
       <button type="button" className="btn btn-secondary btn-sm" disabled={busy}
        onClick={()=>remove("articulos",r)} aria-label={"Eliminar exposición CN "+r.cn}><Trash2 size={14}/></button>
      </div>)}
    </div>
   </div>
   <p className="fm-transfer-settings-example">Ejemplo: 100 unidades de exposición + 4 días de rotación para activar la propuesta. La transferencia busca alcanzar 100 unidades + 7 días. Solo se proponen unidades sobrantes de otra farmacia después de respetar allí su propio objetivo y exposición.</p>
  </>}
  {notice&&<p className="fm-settings-success" role="status">{notice}</p>}
  {error&&<p className="fm-generic-detail-error" role="alert">{error}</p>}
 </section>;
}
