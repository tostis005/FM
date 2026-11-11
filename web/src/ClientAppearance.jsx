import React,{useEffect,useState} from "react";
import {ChevronDown,ImagePlus,Palette,RotateCcw,Save} from "lucide-react";
import {clientAppearanceStyle,normalizeClientAppearance,DEFAULT_APPEARANCE,contrastText} from "./tenantAppearance.js";
import "./clientAppearance.css";

// Solo se muestra desde Administración > Clientes, protegida también por API.
export default function ClientAppearance({client,initial,onSaved}){
 const [open,setOpen]=useState(false);
 const [form,setForm]=useState(()=>normalizeClientAppearance(initial));
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[success,setSuccess]=useState("");
 useEffect(()=>setForm(normalizeClientAppearance(initial)),[initial?.brandName,initial?.logoUrl,initial?.primaryColor,initial?.secondaryColor,initial?.menuMode]);
 const customLogo=Boolean(form.logoUrl);
 const previewStyle=clientAppearanceStyle(form);
 const field=(name,value)=>{setForm(prev=>({...prev,[name]:value}));setSuccess("");};
 function receiveLogo(event){
  const file=event.target.files?.[0];
  if(!file)return;
  if(!["image/png","image/jpeg","image/webp"].includes(file.type)||file.size>330000){
   setError("Selecciona un PNG, JPG o WebP de hasta 330 KB.");event.target.value="";return;
  }
  setError("");
  const reader=new FileReader();
  reader.onload=()=>field("logoUrl",String(reader.result||""));
  reader.onerror=()=>setError("No se pudo leer el archivo.");
  reader.readAsDataURL(file);event.target.value="";
 }
 async function save(event){
  event.preventDefault();setError("");setSuccess("");setBusy(true);
  try{
   const response=await fetch("/api/admin/clientes/"+encodeURIComponent(client)+"/apariencia",{
    method:"PUT",credentials:"same-origin",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(form)
   });
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(result.error||"No se pudo guardar la apariencia");
   setForm(normalizeClientAppearance(result.appearance));
   setSuccess("Apariencia guardada para todos los usuarios del cliente.");
   onSaved?.();
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <div className="fm-client-appearance">
  <button type="button" className="fm-appearance-toggle" onClick={()=>setOpen(v=>!v)}
   aria-expanded={open} aria-controls={"fm-appearance-"+client}>
   <Palette size={17}/><span>Identidad visual y colores</span>
   <span className="fm-appearance-swatches" aria-hidden="true">
    <i style={{background:form.primaryColor}}/><i style={{background:form.secondaryColor}}/>
   </span><ChevronDown className={open?"expanded":""} size={17}/>
  </button>
  {open&&<div id={"fm-appearance-"+client} className="fm-appearance-layout">
   <form className="fm-appearance-form" onSubmit={save}>
    <p>Personaliza el logotipo y dos colores de marca. El resto de tonos se adapta automáticamente; las demás empresas mantienen su propio tema.</p>
    <label>Nombre visible en la aplicación
     <input maxLength={80} value={form.brandName} placeholder="Farmetrica (por defecto)"
      onChange={e=>field("brandName",e.target.value)}/>
    </label>
    <label>URL HTTPS del logo
     <input type="url" value={form.logoUrl.startsWith("data:")?"":form.logoUrl}
      placeholder={form.logoUrl.startsWith("data:")?"Logo subido desde archivo":"https://.../logo.png"}
      onChange={e=>field("logoUrl",e.target.value)}/>
    </label>
    <div className="fm-appearance-upload">
     <label className="btn btn-secondary btn-sm"><ImagePlus size={15}/> Subir logo PNG, JPG o WebP
      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={receiveLogo} hidden/>
     </label>
     {customLogo&&<button type="button" className="btn btn-secondary btn-sm" onClick={()=>field("logoUrl","")}>Quitar logo</button>}
    </div>
    <div className="fm-appearance-colors">
     <label>Color principal
      <div className="fm-appearance-color-input">
       <input type="color" value={form.primaryColor} onChange={e=>field("primaryColor",e.target.value.toUpperCase())}/>
       <input aria-label="Hexadecimal principal" value={form.primaryColor} maxLength={7} pattern="#[0-9a-fA-F]{6}"
        onChange={e=>field("primaryColor",e.target.value)}/>
      </div>
     </label>
     <label>Color secundario / cabeceras
      <div className="fm-appearance-color-input">
       <input type="color" value={form.secondaryColor} onChange={e=>field("secondaryColor",e.target.value.toUpperCase())}/>
       <input aria-label="Hexadecimal secundario" value={form.secondaryColor} maxLength={7} pattern="#[0-9a-fA-F]{6}"
        onChange={e=>field("secondaryColor",e.target.value)}/>
      </div>
     </label>
    </div>
    <label>Estilo del menú lateral
     <select value={form.menuMode} onChange={e=>field("menuMode",e.target.value)}>
      <option value="claro">Blanco y limpio (recomendado)</option>
      <option value="oscuro">Fondo oscuro corporativo</option>
     </select>
    </label>
    {error&&<p className="fm-appearance-error" role="alert">{error}</p>}
    {success&&<p className="fm-appearance-success" role="status">{success}</p>}
    <div className="fm-appearance-actions">
     <button className="btn btn-secondary btn-sm" type="button" onClick={()=>{setForm({...DEFAULT_APPEARANCE});setSuccess("");}}><RotateCcw size={15}/> Predeterminados</button>
     <button className="btn btn-primary btn-sm" type="submit" disabled={busy}><Save size={15}/>{busy?"Guardando…":"Guardar identidad"}</button>
    </div>
   </form>
   <div className="fm-appearance-preview" style={previewStyle}>
    <strong className="fm-appearance-preview-title">Vista previa</strong>
    <div className="fm-appearance-mini-app">
     <div className={"fm-appearance-mini-sidebar "+(form.menuMode==="oscuro"?"dark":"light")}>
      <div className="fm-appearance-mini-logo">
       {customLogo&&<img src={form.logoUrl} alt="" onError={e=>{e.currentTarget.style.visibility="hidden"}}/>}
       <strong>{form.brandName||"Farmetrica"}</strong>
      </div>
      <div className="fm-appearance-mini-nav">Inicio</div>
      <div className="fm-appearance-mini-nav selected">Promociones</div>
      <div className="fm-appearance-mini-nav">Seguimiento</div>
      <div className="fm-appearance-mini-nav">Configuración</div>
     </div>
     <div className="fm-appearance-mini-main">
      <div className="fm-appearance-mini-top">Promociones</div>
      <div className="fm-appearance-mini-card">
       <div className="fm-appearance-mini-header">Campañas activas</div>
       <div className="fm-appearance-mini-row"><span>Campaña de ejemplo</span><span>Activa</span></div>
       <div className="fm-appearance-mini-row"><span>Otra promoción</span><span>Borrador</span></div>
      </div>
      <div className="fm-appearance-mini-button" style={{color:contrastText(form.primaryColor)}}>Nueva campaña</div>
     </div>
    </div>
    <small>Los textos y estados de error mantienen contraste legible. Los colores propios de alertas no cambian.</small>
   </div>
  </div>}
 </div>;
}
