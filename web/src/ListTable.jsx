import React,{useMemo,useState} from "react";
import {filterSortRows,pageRows} from "./listLogic.js";
import {MultiSelectFilter} from "./MultiSelectFilter.jsx";
import {LoadingPanel,LoadingFrame} from "./LoadingState.jsx";

// Tablas consistentes para promociones, farmacias, usuarios y accesos.
// La búsqueda por cabecera, ordenación y paginación operan sobre todos los
// registros de la tabla, no sobre la página visible.
export const PAGE_SIZES=[10,25,50,100];
export function ListPagination({total,page,pageSize,onPageChange,onPageSizeChange,label="registros",loading=false}){
  const pages=Math.max(1,Math.ceil(total/pageSize));
  const current=Math.max(0,Math.min(page,pages-1));
  return <div className="list-pagination" aria-label={"Paginación de "+label}>
    <span className="list-page-count">{total?current*pageSize+1:0}–{Math.min((current+1)*pageSize,total)} de {total} {label}</span>
    <label className="list-page-size">Por página
      <select value={pageSize} onChange={e=>onPageSizeChange(Number(e.target.value))} aria-label={"Registros por página de "+label}>
        {PAGE_SIZES.map(n=><option value={n} key={n}>{n}</option>)}
      </select>
    </label>
    <div className="list-page-buttons">
      <button type="button" disabled={current===0||loading} onClick={()=>onPageChange(0)} aria-label="Primera página">«</button>
      <button type="button" disabled={current===0||loading} onClick={()=>onPageChange(current-1)}>Anterior</button>
      <span>Página {current+1} de {pages}</span>
      <button type="button" disabled={current>=pages-1||loading} onClick={()=>onPageChange(current+1)}>Siguiente</button>
      <button type="button" disabled={current>=pages-1||loading} onClick={()=>onPageChange(pages-1)} aria-label="Última página">»</button>
    </div>
  </div>;
}
export default function ListTable({rows,columns,rowKey,onRowClick,emptyText="No hay registros",label="registros",tableClass="",loading=false,loadingLabel="Cargando registros…"}){
  const [filters,setFilters]=useState({});
  const [sort,setSort]=useState(null);
  const [page,setPage]=useState(0);
  const [pageSize,setPageSize]=useState(10);
  const filtered=useMemo(()=>filterSortRows(rows,columns,filters,sort),[rows,columns,filters,sort]);
  const {page:safePage,items:slice}=pageRows(filtered,page,pageSize);
  const changeFilter=(key,value)=>{setFilters(p=>({...p,[key]:value}));setPage(0);};
  const changeSort=key=>{setSort(prev=>prev?.key!==key?{key,direction:"asc"}:prev.direction==="asc"?{key,direction:"desc"}:null);setPage(0);};
  return <>
    <LoadingFrame loading={loading&&rows.length>0} label={loadingLabel}>
    <div className="table-scroll" role="region" tabIndex={0} aria-label={"Tabla desplazable de "+label}>
      <table className={"data-table smart-table "+tableClass}>
        <thead>
          <tr>{columns.map(col=><th key={col.key} scope="col" aria-sort={sort?.key===col.key?(sort.direction==="asc"?"ascending":"descending"):"none"}>
            {col.sortable===false?<span className="smart-th-label">{col.label}</span>:
              <button className="smart-sort" type="button" onClick={()=>changeSort(col.key)} aria-label={"Ordenar "+col.label}>
                <span>{col.label}</span><span aria-hidden="true" className="smart-sort-arrow">{sort?.key===col.key?(sort.direction==="asc"?"▲":"▼"):"↕"}</span>
              </button>}
          </th>)}</tr>
          <tr className="smart-filter-row">{columns.map(col=><th key={col.key}>
            {col.searchable===false?<span className="smart-filter-blank"/>:
              col.filterMode==="multi"?<MultiSelectFilter label={col.label}
                options={typeof col.options==="function"?col.options(rows):col.options||
                  [...new Set(rows.flatMap(r=>col.filterValues?.(r)||[col.value(r)]))]}
                value={Array.isArray(filters[col.key])?filters[col.key]:[]}
                onChange={next=>changeFilter(col.key,next)}/>:
              <input className="smart-column-filter" type="search" value={filters[col.key]||""}
                aria-label={"Buscar en "+col.label} placeholder={"Filtrar "+col.label.toLowerCase()} title={"Buscar en "+col.label}
                onChange={e=>changeFilter(col.key,e.target.value)}/>}
          </th>)}</tr>
        </thead>
        <tbody>{loading&&!rows.length?<tr><td colSpan={columns.length}><LoadingPanel kind="table" label={loadingLabel} rows={Math.min(pageSize,5)}/></td></tr>:slice.map(row=><tr key={rowKey(row)} className={onRowClick?"click-row":undefined}
          tabIndex={onRowClick?0:undefined} aria-label={onRowClick?"Abrir registro":undefined}
          onKeyDown={onRowClick?e=>{if(e.target===e.currentTarget&&(e.key==="Enter"||e.key===" ")){e.preventDefault();onRowClick(row);}}:undefined}
          onClick={onRowClick?()=>onRowClick(row):undefined}>
          {columns.map(col=><td key={col.key}>{col.render?col.render(row):String(col.value(row)??"—")}</td>)}
        </tr>)}</tbody>
      </table>
      {!filtered.length&&!loading&&<div className="empty-state"><strong>{emptyText}</strong>{rows?.length>0&&<p>Prueba a borrar algún filtro de columna.</p>}</div>}
    </div>
    <p className="table-scroll-hint" aria-hidden="true">Desliza la tabla horizontalmente para ver más columnas →</p>
    <ListPagination total={filtered.length} page={safePage} pageSize={pageSize} onPageChange={setPage}
      onPageSizeChange={n=>{setPageSize(n);setPage(0)}} label={label} loading={loading}/>
    </LoadingFrame>
  </>;
}
