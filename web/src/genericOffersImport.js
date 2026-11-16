import {sheetsFromExcel} from "./importarPromociones.js";

const text=x=>String(x??"").trim();
const fold=x=>text(x).normalize("NFD").replace(/[\u0300-\u036f]/g,"")
 .toLowerCase().replace(/[\s.%_]+/g,"");
const number=x=>typeof x==="number"?x:Number(text(x).replace(",","."));
const validCode=x=>/^[0-9]{6,7}$/.test(x);
const natural=x=>x===""||x==null?null:
 Number.isSafeInteger(number(x))&&number(x)>0?number(x):null;

/** Interpreta la tabla comercial recibida, NO las equivalencias clínicas.
 * La asociación CN -> DCPF se realiza únicamente en el servidor con AEMPS. */
export function parseGenericOfferSheets(sheets){
 const items=[],issues=[],tabs=[];
 for(const [laboratory,rows] of Object.entries(sheets||{})){
  if(!Array.isArray(rows)||!rows.length)continue;
  const head=(rows[0]||[]).map(fold);
  const at=(aliases,fallback)=>{const i=head.findIndex(v=>aliases.includes(v));return i<0?fallback:i};
  const code=at(["codigo","cn","codigonacional"],0),
   name=at(["articulo","descripcion","nombre"],1),
   pvl=at(["pvl"],2),discount=at(["dto","descuento"],3),
   net=at(["neto","precioneto"],4),iva=at(["iva"],5),puc=at(["puc"],6),
   min=at(["umin","minimo","unidadesminimas"],7),
   pack=at(["upack","pack"],8),box=at(["ucaja","caja"],9);
  if(!head.includes("puc")||!head.includes("codigo")){
   issues.push("Hoja "+laboratory+": faltan las cabeceras Código o Puc.");
   continue;
  }
  let count=0;
  for(let i=1;i<rows.length;i++){
   const r=rows[i]||[],cn=text(r[code]).replace(/\.0$/,"");
   if(!cn)continue;
   if(!validCode(cn)){issues.push(laboratory+" fila "+(i+1)+": CN no válido");continue}
   const nums=[r[pvl],r[discount],r[net],r[iva],r[puc]].map(number);
   if(nums.some(v=>!Number.isFinite(v))||nums[4]<=0){
    issues.push(laboratory+" fila "+(i+1)+": no se ha podido leer el precio");
    continue;
   }
   items.push({laboratory,cn,name:text(r[name])==="#NAME?"?"":text(r[name]),
    pvl:nums[0],discount:nums[1],net:nums[2],iva:nums[3],puc:nums[4],
    minimum:natural(r[min]),pack:natural(r[pack]),box:natural(r[box])});
   count++;
  }
  if(count)tabs.push({name:laboratory,count});
 }
 if(!items.length)throw Error("No hay ofertas válidas en el Excel. "+issues.slice(0,2).join(" "));
 if(issues.length)throw Error("Corrige las filas no reconocidas antes de importar: "+
  issues.slice(0,5).join("; ")+(issues.length>5?" y "+(issues.length-5)+" más.":""));
 return {items,tabs};
}
export async function readGenericOfferExcel(file){
 if(!file||!/\.xlsx$/i.test(file.name))throw Error("Selecciona un archivo .xlsx");
 if(file.size>8*1024*1024)throw Error("El Excel supera el tamaño máximo de 8 MB");
 const sheets=await sheetsFromExcel(await file.arrayBuffer());
 return parseGenericOfferSheets(sheets);
}