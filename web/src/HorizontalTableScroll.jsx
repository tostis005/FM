import React,{useEffect,useRef,useState} from "react";

// Barra horizontal arriba Y abajo: ambas controlan exactamente la misma tabla.
// No duplica la tabla ni sus filas y funciona con filtros y columnas dinámicas.
export default function HorizontalTableScroll({children,className="table-scroll",label="tabla",...rest}){
 const content=useRef(null),top=useRef(null);
 const [width,setWidth]=useState(0);
 useEffect(()=>{
  const root=content.current;
  if(!root)return;
  const measure=()=>setWidth(root.scrollWidth);
  measure();
  const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(measure):null;
  if(observer){observer.observe(root);if(root.firstElementChild)observer.observe(root.firstElementChild);}
  window.addEventListener("resize",measure);
  return()=>{observer?.disconnect();window.removeEventListener("resize",measure)};
 },[children]);
 const syncTop=()=>{if(content.current&&top.current)content.current.scrollLeft=top.current.scrollLeft};
 const syncBottom=()=>{if(content.current&&top.current)top.current.scrollLeft=content.current.scrollLeft};
 return <div className="fm-dual-scroll">
  <div ref={top} className="fm-dual-scroll-top" role="region" tabIndex={0}
   aria-label={"Desplazamiento superior de "+label} onScroll={syncTop}>
   <div style={{width:Math.max(1,width),height:1}}/>
  </div>
  <div ref={content} className={className} role="region" tabIndex={0}
   aria-label={"Tabla desplazable de "+label} onScroll={syncBottom} {...rest}>
   {children}
  </div>
 </div>;
}
