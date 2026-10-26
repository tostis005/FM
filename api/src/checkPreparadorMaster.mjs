// Solo diagnóstico; no modifica datos ni exporta códigos de proveedor.
import pg from "pg";
import {readOperationalLaboratoryEvidence} from "./laboratoryActivity.js";
import {readMasterLaboratoryRules,groupLaboratoriesByMaster,exactMasterAliases} from "./laboratoryMasterGrouping.js";
import {normalizeLabName} from "./laboratoryIdentity.js";
const db=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,
 connectionTimeoutMillis:4500,query_timeout:35000,statement_timeout:35000});
const out={};
try{
 const [tenant,scope]=await Promise.all([
  db.query("SELECT esquema_datos FROM farmetrica.clientes WHERE slug=$1",["ampedia"]),
  db.query("SELECT id FROM farmetrica.farmacias WHERE cliente_slug=$1",["ampedia"])
 ]);
 const schema=tenant.rows[0]?.esquema_datos;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema||""))throw Error("Esquema no válido");
 const ctx={client:{slug:"ampedia",schema},pharmacies:scope.rows};
 const ids=scope.rows.map(r=>Number(r.id));
 const [raw,master]=await Promise.all([
  readOperationalLaboratoryEvidence(db,ctx,ids),
  readMasterLaboratoryRules(db,"ampedia")
 ]);
 const grouped=groupLaboratoriesByMaster(raw,master);
 const match=/CINFA|THINF|THINFILE|THINFA/i;
 out.pharmacies=ids.length;out.rawCount=raw.length;out.groupedCount=grouped.length;
 out.cinfaRaw=raw.filter(r=>match.test(r.name+" "+r.key)).map(r=>r.key).slice(0,15);
 out.cinfaGrouped=grouped.filter(r=>match.test(r.name+" "+r.key)).map(r=>r.key).slice(0,15);
 out.cinfaUnified=grouped.filter(r=>match.test(r.name+" "+r.key)).length===1;
 out.cinfaRawNames=raw.filter(r=>match.test(r.name+" "+r.key)).map(r=>r.name).slice(0,15);
 out.cinfaMaster=master.filter(r=>match.test(r.name+" "+r.laboratoryKey))
  .map(r=>({name:r.name,to:r.laboratoryKey,hidden:r.ignoreReports,coop:r.cooperative})).slice(0,15);
 out.suppliersFlagged=master.filter(r=>r.ignoreReports||r.cooperative||r.type==="cooperativa").length;
 const flagged=master.filter(r=>r.ignoreReports||r.cooperative||r.type==="cooperativa");
 const forbidden=new Set(flagged.flatMap(exactMasterAliases));
 const visibleFlagged=grouped.filter(x=>forbidden.has(normalizeLabName(x.name))
  ||forbidden.has(normalizeLabName(x.key?.slice(2))));
 out.flaggedStillVisible=visibleFlagged.length;
 out.flaggedStillVisibleNames=visibleFlagged.slice(0,10).map(x=>x.name);
 out.masterFlagTypes={ignored:master.filter(x=>x.ignoreReports).length,
  cooperatives:master.filter(x=>x.cooperative||x.type==="cooperativa").length};
 out.unmatchedFlaggedExamples=flagged.filter(x=>!raw.some(r=>
  exactMasterAliases(x).includes(normalizeLabName(r.name))))
   .slice(0,12).map(x=>x.name);
 const normalized=s=>String(s||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
 const blockedNames=new Set(master.filter(m=>m.cooperative||m.ignoreReports).map(m=>normalized(m.name)));
 const visibleNames=new Set(master.filter(m=>!m.cooperative&&!m.ignoreReports).map(m=>normalized(m.name)));
 out.blockedNamesStillShown=grouped.filter(x=>
  blockedNames.has(normalized(x.name))&&!visibleNames.has(normalized(x.name))).length;
}catch(e){out.error=e.code||e.name;out.detail=String(e.message||"").slice(0,120)}
finally{console.log("PREPARADOR_MASTER_AUDIT",JSON.stringify(out));await db.end()}
