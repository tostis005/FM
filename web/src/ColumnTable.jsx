import React,{useMemo,useState} from "react";
import {filterSortRows} from "./listLogic.js";
import {MultiSelectFilter} from "./MultiSelectFilter.jsx";
import "./columnTable.css";
import {filterModeForColumn} from "./tableFilterModes.js";
// Cabeceras compartidas para tablas especiales (matrices, grupos de farmacias,
// detalle expandido). Mismo motor y selector que ListTable; filtrar antes de paginar.
export function useColumnTable(rows,columns,{scope="",onChange,defaultSort=null}={}){
 const [state,setState]=useState({scope,filters:{},sort:defaultSort});
 const active=state.scope===scope?state:{scope,filters:{},sort:defaultSort};
 const {filters,sort}=active;
 const change=patch=>{setState({...active,...patch});onChange?.()};
 const toggleSort=key=>change({sort:sort?.key!==key?{key,direction:"asc"}:sort.direction==="asc"?{key,direction:"desc"}:null});
 const changeFilter=(key,value)=>change({filters:{...filters,[key]:value}});
 const usable=columns.filter(c=>!c.disabled&&typeof c.value==="function");
 const filtered=useMemo(()=>filterSortRows(rows,usable,filters,sort),[rows,columns,filters,sort]);
 return {rows:filtered,source:rows,columns,filters,sort,toggleSort,changeFilter};
}
export function ColumnTableHead({table,grouped=false}){
 const {columns,source,filters,sort,toggleSort,changeFilter}=table;
 const groups=columns.reduce((out,col)=>{const group=col.group||"",last=out.at(-1);if(last?.group===group)last.cols.push(col);else out.push({group,cols:[col]});return out},[]);
 const label=c=>(c.group?c.group+" ":"")+c.label;
 const values=c=>(source||[]).flatMap(r=>c.filterValues?.(r)||[c.value(r)]);
 const options=c=>[...new Set(values(c))];
 const mode=c=>c.disabled||c.searchable===false||typeof c.value!=="function"?"none":filterModeForColumn({label:c.label,declared:c.filterMode,values:values(c)});
 return <thead className="fm-column-head">
  {grouped&&<tr className="fm-smart-group-row">{groups.map((g,i)=><th key={i} colSpan={g.cols.length} scope="colgroup">{g.group||""}</th>)}</tr>}
  <tr>{columns.map(c=><th key={c.key} scope="col" title={c.title||label(c)} aria-sort={sort?.key===c.key?(sort.direction==="asc"?"ascending":"descending"):"none"}>
   {c.sortable===false||c.disabled||typeof c.value!=="function"?<span className="smart-th-label">{c.label}</span>:<button type="button" className="smart-sort" aria-label={"Ordenar "+label(c)} onClick={()=>toggleSort(c.key)}><span>{c.label}</span><span className="smart-sort-arrow" aria-hidden="true">{sort?.key===c.key?(sort.direction==="asc"?"▲":"▼"):"↕"}</span></button>}
  </th>)}</tr>
  <tr className="smart-filter-row">{columns.map(c=><th key={c.key}>
   {mode(c)==="none"?<span className="smart-filter-blank"/>:mode(c)==="multi"?<MultiSelectFilter label={label(c)} options={options(c)} value={Array.isArray(filters[c.key])?filters[c.key]:[]} onChange={v=>changeFilter(c.key,v)} placeholder="Filtrar"/>:
   <input type="search" className="smart-column-filter" aria-label={"Buscar en "+label(c)} title={"Buscar en "+label(c)} placeholder="Filtrar" value={filters[c.key]||""} onChange={e=>changeFilter(c.key,e.target.value)}/>}
  </th>)}</tr>
 </thead>;
}
