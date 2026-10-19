import React,{useEffect,useMemo,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {ChevronDown} from "lucide-react";
import {searchText} from "./listLogic.js";

// Portal: el desplegable no se recorta dentro del scroll horizontal de la tabla.
export function MultiSelectFilter({label,options=[],value=[],onChange,placeholder}){
  const [open,setOpen]=useState(false);
  const [query,setQuery]=useState("");
  const [position,setPosition]=useState({top:0,left:0,width:230});
  const trigger=useRef(null),menu=useRef(null);
  const unique=useMemo(()=>{
    const found=new Map();
    for(const option of options){
      const record=typeof option==="object"&&option!==null?option:{value:option,label:option};
      const key=String(record.value??"");
      if(!found.has(key))found.set(key,{value:key,label:String(record.label??record.value??"—")});
    }
    return [...found.values()].sort((a,b)=>a.label.localeCompare(b.label,"es",{numeric:true,sensitivity:"base"}));
  },[options]);
  const selected=(Array.isArray(value)?value:[]).map(String);
  const visible=unique.filter(x=>searchText(x.label+" "+x.value).includes(searchText(query).trim()));
  useEffect(()=>{
    if(!open)return;
    const relocate=()=>{
      if(!trigger.current)return;
      const b=trigger.current.getBoundingClientRect();
      const width=Math.max(215,Math.min(310,window.innerWidth-16));
      // La altura real del selector varía con los elementos y la búsqueda.
      // Evitar que «Listo» quede por debajo del viewport en móviles.
      const height=menu.current?.getBoundingClientRect().height||Math.min(340,window.innerHeight-16);
      const remainingBelow=window.innerHeight-b.bottom-8;
      const remainingAbove=b.top-8;
      const above=remainingBelow<height&&remainingAbove>remainingBelow;
      const top=above
        ?Math.max(8,b.top-height-5)
        :Math.max(8,Math.min(b.bottom+5,window.innerHeight-height-8));
      setPosition({top,
        left:Math.max(8,Math.min(b.left,window.innerWidth-width-8)),width});
    };
    const close=event=>{
      if(trigger.current?.contains(event.target)||menu.current?.contains(event.target))return;
      setOpen(false);
    };
    const escape=event=>{if(event.key==="Escape")setOpen(false);};
    relocate();
    document.addEventListener("pointerdown",close);
    document.addEventListener("keydown",escape);
    window.addEventListener("resize",relocate);
    window.addEventListener("scroll",relocate,true);
    return()=>{
      document.removeEventListener("pointerdown",close);
      document.removeEventListener("keydown",escape);
      window.removeEventListener("resize",relocate);
      window.removeEventListener("scroll",relocate,true);
    };
  },[open]);
  const toggle=v=>onChange(selected.includes(v)?selected.filter(x=>x!==v):[...selected,v]);
  return <>
    <button type="button" ref={trigger} className={"multi-filter-trigger "+(selected.length?"multi-filter-active":"")}
      aria-label={"Filtrar por "+label} aria-haspopup="dialog" aria-expanded={open}
      title={"Filtrar por "+label} onClick={()=>{setOpen(v=>!v);setQuery("");}}>
      <span>{!selected.length?(placeholder||"Filtrar "+label.toLocaleLowerCase("es")):selected.length===1?(unique.find(x=>x.value===selected[0])?.label||"1 seleccionado"):selected.length+" seleccionados"}</span><ChevronDown size={14}/>
    </button>
    {open&&createPortal(<div className="multi-filter-popover" ref={menu} role="dialog"
        aria-label={"Seleccionar "+label} style={{top:position.top,left:position.left,width:position.width}}>
      <div className="multi-filter-top"><strong>{label}</strong><button type="button" onClick={()=>setOpen(false)} aria-label={"Cerrar filtro de "+label}>×</button></div>
      {unique.length>7&&<input type="search" autoFocus className="multi-filter-search" placeholder="Buscar opción…"
        aria-label={"Buscar opciones de "+label} value={query} onChange={e=>setQuery(e.target.value)}/>}
      <div className="multi-filter-choices">
        {visible.map(option=><label key={option.value} className="multi-filter-choice">
          <input type="checkbox" checked={selected.includes(option.value)} onChange={()=>toggle(option.value)}/>
          <span title={option.label}>{option.label}</span>
        </label>)}
        {!visible.length&&<div className="multi-filter-empty">Sin coincidencias</div>}
      </div>
      <div className="multi-filter-bottom">
        <button type="button" onClick={()=>onChange([...new Set([...selected,...visible.map(x=>x.value)])])}
          disabled={!visible.length}>Seleccionar visibles</button>
        <button type="button" onClick={()=>onChange([])} disabled={!selected.length}>Limpiar</button>
        <button type="button" className="multi-filter-done" onClick={()=>setOpen(false)}>Listo</button>
      </div>
    </div>,document.body)}
  </>;
}
