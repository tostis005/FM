import React,{useMemo,useState,useEffect,useRef} from "react";

// Una sola entrada accesible para buscar y seleccionar laboratorios.
export default function LaboratoryPicker({laboratories=[],selected="",onSelect,loading=false}){
 const [query,setQuery]=useState("");
 const [open,setOpen]=useState(false),[active,setActive]=useState(0);
 const root=useRef(null),search=useRef(null);
 const chosen=laboratories.find(item=>item.key===selected);
 useEffect(()=>{if(!open)setQuery(chosen?.name||"")},[selected,chosen?.name,open]);
 const options=useMemo(()=>{
  const term=query.trim().toLocaleLowerCase("es");
  return laboratories.filter(item=>!term||item.name.toLocaleLowerCase("es").includes(term)).slice(0,120);
 },[laboratories,query]);
 function choose(item){
  setQuery(item.name);setOpen(false);setActive(0);
  onSelect(item.key);
 }
 function handleKey(e){
  if(e.key==="Escape"){setOpen(false);setQuery(chosen?.name||"");return}
  if(e.key==="ArrowDown"){e.preventDefault();setOpen(true);setActive(i=>Math.min(i+1,Math.max(options.length-1,0)))}
  if(e.key==="ArrowUp"){e.preventDefault();setOpen(true);setActive(i=>Math.max(i-1,0))}
  if(e.key==="Enter"&&open&&options.length){e.preventDefault();choose(options[active]||options[0])}
 }
 return <div className="fm-lab-combobox" ref={root}
  onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget)){setOpen(false);
    setQuery(chosen?.name||"")}}}>
  <input ref={search} type="search" role="combobox" aria-label="Seleccionar laboratorio"
   aria-autocomplete="list" aria-controls="fm-laboratorios-opciones" aria-expanded={open}
   aria-activedescendant={open&&options[active]?"fm-lab-opt-"+active:undefined}
   autoComplete="off" placeholder={loading?"Cargando laboratorios…":"Escribe el laboratorio y selecciónalo…"}
   value={query} onFocus={()=>{setOpen(true);setActive(0)}}
   onChange={e=>{setQuery(e.target.value);setOpen(true);setActive(0)}}
   onKeyDown={handleKey}/>
  {open&&<div className="fm-lab-dropdown" id="fm-laboratorios-opciones" role="listbox"
   aria-label="Laboratorios encontrados">
   {loading?<div className="fm-lab-dropdown-status" role="status">Cargando laboratorios…</div>:
    options.length===0?<div className="fm-lab-dropdown-status">No se han encontrado laboratorios.</div>:
    options.map((item,i)=><button type="button" role="option" id={"fm-lab-opt-"+i}
     aria-selected={i===active} key={item.key}
     className={"fm-lab-option"+(i===active?" active":"")}
     onMouseDown={e=>e.preventDefault()} onMouseEnter={()=>setActive(i)}
     onClick={()=>choose(item)}>{item.name}</button>)}
  </div>}
 </div>;
}
