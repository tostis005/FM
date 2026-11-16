import {sheetsFromExcel} from "./importarPromociones.js";

const clean=value=>String(value??"").trim();
const fold=value=>clean(value).normalize("NFD")
 .replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ");
const amount=value=>{
 const n=typeof value==="number"?value:Number(clean(value).replace(",","."));
 return Number.isSafeInteger(n)&&n>=0&&n<=999999?n:null;
};
const national=value=>clean(value).replace(/\.0$/,"");
const cnValid=value=>/^\d{6,7}$/.test(value);
const referenceValid=value=>cnValid(value)||/^\d{13}$/.test(value);

export function readOrderLinesFromSheets(sheets,pharmacies,type){
 if(!["medicacion","parafarmacia"].includes(type))throw Error("Elige medicación o parafarmacia.");
 const names=Object.keys(sheets||{});
 if(!names.length)throw Error("El Excel no contiene hojas con datos.");
 const preferred=names.sort((a,b)=>Number(/pedido/i.test(b))-Number(/pedido/i.test(a)));
 let selection=null;
 for(const sheet of preferred){
  const rows=(sheets[sheet]||[]).filter(row=>Array.isArray(row));
  for(let i=0;i<Math.min(12,rows.length);i++){
   const head=rows[i].map(fold);
   const cn=head.findIndex(v=>v==="cn"||/codigo nacional|ean/.test(v));
   const description=head.findIndex(v=>v==="articulo"||/descripcion|producto/.test(v));
   const unit=head.findIndex(v=>/^(unidades|cantidad|unidades a pedir|total pedir|pedir total|uds)$/.test(v));
   const pharmacyCols=pharmacies.map(p=>head.findIndex(v=>v==="pedir "+fold(p.name)||v===fold(p.name)));
   if(cn<0||description<0||(!pharmacyCols.some(n=>n>=0)&&unit<0))continue;
   selection={sheet,rows,headerIndex:i,cn,description,unit,pharmacyCols};
   break;
  }
  if(selection)break;
 }
 if(!selection)throw Error("No se ha encontrado una hoja de pedido con CN, artículo y unidades. Utiliza el Excel de Farmétrica o una plantilla con esas columnas.");
 const {rows,headerIndex,cn,description,unit,pharmacyCols}=selection;
 const lines=[],seen=new Set();
 for(const row of rows.slice(headerIndex+1)){
  if(!Array.isArray(row))continue;
  const code=national(row[cn]);
  if(!code||/comentarios generales|total\b/i.test(code))continue;
  if(!referenceValid(code))throw Error("Código CN/EAN no válido: "+code.slice(0,40));
  if(seen.has(code))throw Error("El Excel contiene una referencia duplicada: "+code);
  const name=clean(row[description]);
  if(!name||name.length>240)throw Error("Falta una descripción válida para "+code);
  const isNational=cnValid(code);
  if(isNational&&(Number(code.slice(0,6))<400000)!==(type==="parafarmacia"))
   throw Error("El CN "+code+" no corresponde a la categoría seleccionada.");
  const base={reference:code,cn:isNational?code:null,name,comment:""};
  if(type==="medicacion"){
   if(pharmacyCols.some(n=>n>=0)&&pharmacyCols.some(n=>n<0))
    throw Error("El Excel no contiene columnas de pedido para todas las farmacias autorizadas.");
   let unitsByPharmacy={};
   if(pharmacyCols.every(n=>n>=0)){
    for(let i=0;i<pharmacies.length;i++){
     const qty=amount(row[pharmacyCols[i]]);
     if(qty===null)throw Error("Cantidad no válida para "+code+" en "+pharmacies[i].name);
     unitsByPharmacy[String(pharmacies[i].id)]=qty;
    }
   }else{
    if(pharmacies.length!==1)throw Error("Para medicación, indica una columna «Pedir» por farmacia en el Excel.");
    const qty=amount(row[unit]);if(qty===null)throw Error("Cantidad no válida para "+code);
    unitsByPharmacy[String(pharmacies[0].id)]=qty;
   }
   if(Object.values(unitsByPharmacy).some(x=>x>0)){lines.push({...base,unitsByPharmacy});seen.add(code)}
  }else{
   const qty=amount(row[unit]);
   if(qty===null)throw Error("Cantidad no válida para "+code);
   if(qty>0){lines.push({...base,units:qty});seen.add(code)}
  }
  if(lines.length>5000)throw Error("El Excel supera el máximo de 5.000 líneas.");
 }
 if(!lines.length)throw Error("El Excel no contiene líneas con unidades positivas.");
 return {lines,sheet:selection.sheet,
  units:lines.reduce((sum,line)=>sum+(type==="parafarmacia"?line.units:
   Object.values(line.unitsByPharmacy).reduce((x,y)=>x+y,0)),0)};
}
export async function readLocalOrderExcel(file,pharmacies,type){
 if(!file||!/\.xlsx$/i.test(file.name||""))throw Error("Selecciona un archivo Excel .xlsx.");
 if(file.size>5*1024*1024)throw Error("El Excel supera los 5 MB.");
 return readOrderLinesFromSheets(await sheetsFromExcel(await file.arrayBuffer()),pharmacies,type);
}
