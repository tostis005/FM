import React,{useEffect,useRef} from "react";
import "./sectionTabs.css";

// The same visual primitive supports actual route links and local views.
// Links retain normal browser behavior for Ctrl/Cmd click and new tabs.
export default function SectionNavigation({items=[],active,label,onNavigate,hideSingle=false}){
 const ref=useRef(null);
 useEffect(()=>{
  const nav=ref.current,selected=nav?.querySelector(".is-active");
  if(!nav||!selected)return;
  const n=nav.getBoundingClientRect(),s=selected.getBoundingClientRect();
  if(s.left<n.left)nav.scrollLeft+=s.left-n.left-4;
  else if(s.right>n.right)nav.scrollLeft+=s.right-n.right+4;
 },[active]);
 if(!items.length||hideSingle&&items.length<2)return null;
 return <nav className="fm-section-tabs" aria-label={label} ref={ref}>
  {items.map(({id,label,href})=>{
   const current=active===id,props={className:"fm-section-tab"+(current?" is-active":""),"aria-current":current?"page":undefined};
   return href?<a key={id} href={href} {...props} onClick={e=>{
    if(e.button===0&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey){e.preventDefault();onNavigate(id);}
   }}>{label}</a>:<button key={id} type="button" {...props} onClick={()=>onNavigate(id)}>{label}</button>;
  })}
 </nav>;
}
