// Exportación CSV consistente entre tablas. Excel español reconoce el BOM y ';'.
// Los valores se extraen de los datos, no del HTML renderizado.
export const csvCell=value=>{
 const raw=String(value??"").replace(/\r\n?/g,"\n");
 const safe=/^\s*[=+@-]/.test(raw) && !/^-\d+(?:[.,]\d+)?$/.test(raw.trim())?"'"+raw:raw;
 return '"'+safe.replace(/"/g,'""')+'"';
};
export function tableCSV(headers,rows){
 return "\ufeff"+[headers,...rows].map(row=>row.map(csvCell).join(";")).join("\r\n");
}
export function downloadTableCSV(filename,headers,rows){
 if(typeof document==="undefined")return;
 const name=String(filename||"farmetrica-registros").replace(/[^a-zA-Z0-9_-]+/g,"-");
 const url=URL.createObjectURL(new Blob([tableCSV(headers,rows)],{type:"text/csv;charset=utf-8"}));
 const anchor=document.createElement("a");
 anchor.href=url;anchor.download=name+".csv";
 document.body.appendChild(anchor);anchor.click();anchor.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
