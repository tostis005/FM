// Contrato único de análisis: articulos, proveedores, ventas, compras y stock.
// Los registros de ejemplo son deterministas y comparten CN, farmaciaId y proveedorId.
import {euro,decimal} from "./localeES.js";
export const money=n=>euro(n);
export const number=n=>decimal(n);
export const round=(n,d=2)=>Number((Number(n)||0).toFixed(d));
export const sum=(items,key)=>items.reduce((t,x)=>t+(Number(typeof key==="function"?key(x):x[key])||0),0);
export const monthAt=(date,shift=0)=>new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+shift,1)).toISOString().slice(0,7);
const CATALOG=[
 ["847100","Crema facial hidratante 50 ml","Dermocosmética",22.95,false,""],
 ["847101","Protector solar facial FPS 50","Dermocosmética",24.9,false,""],
 ["847102","Gel de higiene 500 ml","Higiene",8.75,false,""],
 ["847103","Champú dermoprotector 250 ml","Higiene",12.9,false,""],
 ["847104","Vitamina C 30 comprimidos","Complementos",15.9,false,""],
 ["847105","Magnesio 60 cápsulas","Complementos",17.5,false,""],
 ["847106","Termómetro digital","Parafarmacia",9.9,false,""],
 ["847107","Crema manos reparadora","Dermocosmética",7.8,false,""],
 ["847108","Pasta dentífrica 75 ml","Higiene",6.5,false,""],
 ["847109","Solución salina nasal 100 ml","OTC",8.95,false,""],
 ["847110","Apósito hidrocoloide 10 unidades","Parafarmacia",7.9,false,""],
 ["847111","Colirio lubricante 10 ml","OTC",12.2,false,""],
 ["847112","Omeprazol 20 mg 28 cápsulas A","Genéricos",4.65,true,"omeprazol20-28"],
 ["847113","Omeprazol 20 mg 28 cápsulas B","Genéricos",4.65,true,"omeprazol20-28"],
 ["847114","Atorvastatina 20 mg 28 comprimidos A","Genéricos",6.15,true,"atorvastatina20-28"],
 ["847115","Atorvastatina 20 mg 28 comprimidos B","Genéricos",6.15,true,"atorvastatina20-28"],
 ["847116","Amlodipino 5 mg 28 comprimidos A","Genéricos",4.2,true,"amlodipino5-28"],
 ["847117","Amlodipino 5 mg 28 comprimidos B","Genéricos",4.2,true,"amlodipino5-28"],
 ["847118","Losartán 50 mg 28 comprimidos A","Genéricos",5.45,true,"losartan50-28"],
 ["847119","Losartán 50 mg 28 comprimidos B","Genéricos",5.45,true,"losartan50-28"],
 ["847120","Crema solar corporal FPS 30","Dermocosmética",19.9,false,""],
 ["847121","Protector labial SPF 30","Dermocosmética",4.95,false,""],
 ["847122","Probiótico 20 cápsulas","Complementos",23.5,false,""],
 ["847123","Gel de ducha piel sensible","Higiene",10.6,false,""]
];
const PROVIDERS=[
 ["P01","Cooperativa Norte","Cooperativa"],
 ["P02","Distribución Centro","Mayorista"],
 ["P03","Laboratorios Delta","Laboratorio"],
 ["P04","Laboratorios Atlas","Laboratorio"],
 ["P05","Cooperativa Levante","Cooperativa"],
 ["P06","Distribución Salud","Mayorista"]
];
export function buildDemoTables(pharmacies=[],asOf=new Date()){
 const articulos=CATALOG.map(([cn,descripcion,familia,pvp,generico,grupoGenerico])=>({cn,descripcion,familia,pvp,generico,grupoGenerico}));
 const proveedores=PROVIDERS.map(([id,nombre,tipo])=>({id,nombre,tipo}));
 const ventas=[],compras=[],stock=[];
 for(let m=0;m<12;m++){
  const month=monthAt(asOf,m-11);
  for(let f=0;f<pharmacies.length;f++)for(let i=0;i<articulos.length;i++){
   const a=articulos[i],farmaciaId=String(pharmacies[f].id);
   const unidades=Math.max(0,Math.round((5+(i*7+f*4+m*3)%28)*(1+(m%5)*.08))-(i%9===0?6:0));
   const pedidas=Math.max(2,unidades+((i*3+f*2+m)%11)-4);
   const proveedorId=proveedores[(i+f+m)%proveedores.length].id;
   const puc=round(a.pvp*(a.generico?.61:.56)*(.90+((i*7+f*3+m*5)%15)/100),4);
   ventas.push({id:month+"|"+farmaciaId+"|"+a.cn,fecha:month+"-12",farmaciaId,cn:a.cn,unidades,importeNeto:round(unidades*a.pvp*(.91+((i+f+m)%5)*.015))});
   compras.push({id:month+"|"+farmaciaId+"|"+a.cn,fecha:month+"-10",farmaciaId,cn:a.cn,proveedorId,unidades:pedidas,puc,total:round(pedidas*puc)});
  }
 }
 for(let f=0;f<pharmacies.length;f++)for(let i=0;i<articulos.length;i++){
  const unidades=(i+f)%13===0?0:(i+f)%7===0?110+f*9:Math.max(1,8+(i*5+f*7)%61);
  stock.push({farmaciaId:String(pharmacies[f].id),cn:articulos[i].cn,unidades,fecha:monthAt(asOf)+"-15"});
 }
 return {articulos,proveedores,ventas,compras,stock};
}
// La capa de datos reales devolverá exactamente este formato, sin KPIs precalculados.
export function normalizeTables(raw){
 const use=(key,mapper)=>(Array.isArray(raw?.[key])?raw[key]:[]).map(mapper);
 return {
  articulos:use("articulos",a=>({cn:String(a.cn),descripcion:String(a.descripcion||a.cn),familia:String(a.familia||"Sin familia"),pvp:Number(a.pvp)||0,generico:Boolean(a.generico),grupoGenerico:String(a.grupoGenerico||"")})),
  proveedores:use("proveedores",p=>({id:String(p.id),nombre:String(p.nombre||p.id),tipo:String(p.tipo||"")})),
  ventas:use("ventas",v=>({id:String(v.id),fecha:String(v.fecha).slice(0,10),farmaciaId:String(v.farmaciaId),cn:String(v.cn),unidades:Number(v.unidades)||0,importeNeto:Number(v.importeNeto)||0})),
  compras:use("compras",v=>({id:String(v.id),fecha:String(v.fecha).slice(0,10),farmaciaId:String(v.farmaciaId),cn:String(v.cn),proveedorId:String(v.proveedorId),unidades:Number(v.unidades)||0,puc:Number(v.puc)||0,total:Number(v.total)||0})),
  stock:use("stock",v=>({farmaciaId:String(v.farmaciaId),cn:String(v.cn),unidades:Number(v.unidades)||0,fecha:String(v.fecha||"").slice(0,10)}))
 };
}
