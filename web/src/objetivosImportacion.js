// Conciliación explícita de objetivos Excel con promociones FARMAWAO.
// Nunca importamos "vendidas" del Excel: esas cifras vienen de Farmatic/PostgreSQL.
const pharmacyIds = { ABADIA:"1", BUENAVISTA:"3", EUROPA:"2", VALDEMARIAS:"5" };
const clean = value => String(value ?? "").trim().replace(/\s+/g," ");
const key = value => clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]/g,"");
function offerKey(value){
  const s=key(value).replace(/DESCUENTO/g,"DTO");
  const x=s.match(/^(\d+)X(\d+)/);
  if(x)return "x"+x[1]+"_"+x[2];
  const p=s.match(/(\d{1,3})(?:DTO|UD)/);
  const second=/2AUD|2UD|SEGUNDA|2UNIDAD|2UDEN|EN2/.test(s);
  if(p&&s.includes("DTO"))return (second?"second_pct:":"pct:")+p[1];
  return s;
}
function offerComparable(a,b) {
  if(key(a)===key(b))return true;
  const aKey=offerKey(a),bKey=offerKey(b);
  // Solo para sufijos aclaratorios (p.ej. "3x2 regalo menor importe" y "3x2").
  if(aKey.startsWith("x")&&bKey.startsWith("x"))return aKey===bKey;
  if(aKey.startsWith("second_pct:")&&bKey.startsWith("second_pct:"))return aKey===bKey;
  // "20% DTO" y "20% DTO INCLUIDOS DUPLOS" son la misma condición.
  if(aKey.startsWith("pct:")&&bKey.startsWith("pct:"))return aKey===bKey;
  if(aKey===bKey)return true;
  // Importaciones antiguas pueden tener "50% 2ª UD" en vez de "50% DTO 2ª UD".
  if(/^(\d{1,3})/.test(key(a)) && /^(\d{1,3})/.test(key(b))) {
    const percA=key(a).match(/^(\d{1,3})/)[1],percB=key(b).match(/^(\d{1,3})/)[1];
    if(percA===percB && (/2AUD|2UD|SEGUNDA/.test(key(a))) && (/2AUD|2UD|SEGUNDA/.test(key(b))))return true;
  }
  return false;
}
function objectiveQuantity(value) {
  if(value===null || value===undefined || clean(value)==="")return null;
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>0?n:null;
}
export function extractObjectiveRecords(rows,year=2026) {
  const records=[],warnings=[];
  let pharmacy=null;
  (rows||[]).forEach((row,i)=>{
    if(Number(row?.[0])===year && key(row?.[1])==="OCTUBRE") {
      pharmacy=pharmacyIds[key(row?.[2])]||null;
      if(!pharmacy)warnings.push("Farmacia desconocida en fila "+(i+1)+": "+clean(row?.[2]));
      return;
    }
    if(!pharmacy || !clean(row?.[1]) || !clean(row?.[2]) || !clean(row?.[3]))return;
    const qty=objectiveQuantity(row?.[4]);
    if(qty===null)return; // Sin objetivo no significa cero ventas ni debe borrar datos.
    records.push({lab:clean(row[1]),range:clean(row[2]),offer:clean(row[3]),pharmacy,qty,row:i+1});
  });
  return {records,warnings};
}
function matchScore(p,r) {
  const lab=key(p.laboratory||p.subtitle),lab2=key(r.lab);
  const range=key(p.range||p.name),range2=key(r.range);
  const offer=p.originalOffer||p.name;
  if(!range||!range2||!offerComparable(offer,r.offer))return -1;
  const exactRange=range===range2;
  const extended=range.length>=4&&range2.length>=4&&
    (range.includes(range2)||range2.includes(range));
  if(!exactRange&&!extended)return -1;
  const sameLab=lab===lab2;
  // El catálogo Farmatic previo usa a veces la marca como laboratorio;
  // permitirlo solo para gamas claramente relacionadas.
  if(!sameLab&&!extended)return -1;
  return (exactRange?12:5)+(sameLab?8:0)+(key(offer)===key(r.offer)?4:1);
}
export function applyObjectiveRows(campaigns,rows,year=2026) {
  const {records,warnings}=extractObjectiveRecords(rows,year);
  const patch=new Map();
  let unmatched=0,ambiguous=0;
  for(const record of records) {
    const candidates=campaigns.map((p,index)=>({p,index,score:matchScore(p,record)}))
      .filter(x=>x.score>=0).sort((a,b)=>b.score-a.score);
    if(!candidates.length){unmatched++;continue;}
    if(candidates.length>1 && candidates[0].score===candidates[1].score &&
        candidates[0].p.id!==candidates[1].p.id){ambiguous++;continue;}
    const found=candidates[0];
    const entry=patch.get(found.index)||{};
    if(entry[record.pharmacy]!==undefined && entry[record.pharmacy]!==record.qty){
      ambiguous++;continue;
    }
    entry[record.pharmacy]=record.qty;
    patch.set(found.index,entry);
  }
  const promotions=campaigns.map((p,index)=>{
    const targets=patch.get(index);
    return targets ? {
      ...p,
      targets:{...(p.targets||{}),...targets},
      objectivesSource:"Excel objetivos octubre 2026",
    }:p;
  });
  return {promotions,assigned:[...patch.values()].reduce((sum,x)=>sum+Object.keys(x).length,0),
    unmatched,ambiguous,warnings};
}
