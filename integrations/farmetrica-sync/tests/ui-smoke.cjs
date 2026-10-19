/* Smoke test estático del panel, sin dependencias ni servidor real.
 * Ejecutar con: node tests/ui-smoke.cjs
 */
const assert = require('node:assert/strict');

const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname,'../src/FarmetricaSync/wwwroot/app.js'),'utf8');
const templateCode = fs.readFileSync(path.join(__dirname, '../src/FarmetricaSync/Core/SqlTemplates.cs'), 'utf8');
const backendCode = fs.readFileSync(path.join(__dirname, '../src/FarmetricaSync/Program.cs'), 'utf8');
assert.match(templateCode,/v\.DescuentoLinea/);
assert.match(templateCode,/v\.DescuentoOpera/);
assert.match(templateCode,/@desde/);
assert.match(templateCode,/@hasta/);
assert.match(backendCode,/\/jobs\/preview/);
assert.match(backendCode,/\/pharmacies\/test-draft/);
assert.match(backendCode,/\/destination\/test-draft/);
assert.match(src,/Probar conexión \(sin guardar\)/);
assert.match(src,/Ver primeros 100/);
assert.match(src,/Usar plantilla estándar/);
assert.match(src,/<details class="fm-advanced">/);
assert.match(src,/Herramientas de mantenimiento/);
assert.doesNotMatch(src,/panel\('Cómo empezar'/);
assert.doesNotMatch(src,/panel\('Formato mínimo del SELECT'/);



const connectorSource=fs.readFileSync(path.join(__dirname,'../src/FarmetricaSync/Connectors/FarmaticConnector.cs'),'utf8');
assert.doesNotMatch(connectorSource,/AdaptSourceSqlAsync/);
assert.match(connectorSource,/ResolveSql\(pharmacy, job\.Sql\)/);
assert.doesNotMatch(templateCode,/r\.Descuento2\s*\)/);
assert.match(templateCode,/r\.XVend_IdVendedor/);
assert.match(templateCode,/r\.Actualizado/);
assert.match(templateCode,/r\.Demorada/);
assert.match(src,/Actualizar desde esquema y guardar/);
assert.match(src,/Actualizar tabla compras en PostgreSQL/);
assert.match(src,/Relanzar compras fallidas/);
assert.match(src,/updateAllPurchaseSchemas/);
assert.match(backendCode,/\/jobs\/compras\/update-schema-all/);
assert.match(backendCode,/\/jobs\/compras\/retry-failed/);
assert.match(backendCode,/\/entities\/compras\/migrate-postgresql/);
const tunnelSource=fs.readFileSync(path.join(__dirname,'../src/FarmetricaSync/Data/SshForward.cs'),'utf8');
const postgresSource=fs.readFileSync(path.join(__dirname,'../src/FarmetricaSync/Data/PostgresDestination.cs'),'utf8');
assert.match(postgresSource,/DROP COLUMN IF EXISTS/);
assert.match(postgresSource,/ApplyPurchasesSchemaAsync/);
assert.match(postgresSource,/RetireStockAsync/);
assert.ok(postgresSource.includes('DROP TABLE {stock} RESTRICT'));
assert.match(src,/Retirar tabla stock antigua de PostgreSQL/);
assert.match(src,/Actualizar desde esquema \(\$\{articleJobs.length\} artículos\)/);
assert.match(backendCode,/\/jobs\/articulos\/update-schema-all/);
assert.match(backendCode,/\/entities\/stock\/retire-postgresql/);
assert.match(templateCode,/a\.StockActual\) AS stock_actual/);
assert.doesNotMatch(templateCode,/new\("farmatic", "stock"/);
assert.match(templateCode,/new\("farmatic", "familias"/);
assert.match(templateCode,/\{\{TABLE:dbo\.Familia\}\}/);
assert.match(templateCode,/\{\{TABLE:dbo\.FamiliaAux\}\}/);
assert.match(templateCode,/\{\{TABLE:dbo\.SuperFamilia\}\}/);
assert.match(templateCode,/fa\.IdFamilia = f\.IdFamilia/);
assert.match(templateCode,/sf\.IdSuperFamilia = fa\.IdSuperFamilia/);
assert.match(src,/Preparar familias/);
assert.match(src,/createFamilyJobs/);
assert.match(src,/createVendorJobs/);
assert.match(src,/Preparar vendedores/);
assert.match(src,/\/jobs\/vendedores\/create-missing/);
assert.match(backendCode,/\/jobs\/vendedores\/create-missing/);
assert.match(templateCode,/\{\{TABLE:dbo\.Vendedor\}\}/);

assert.match(backendCode,/\/jobs\/familias\/create-missing/);
assert.match(tunnelSource,/FingerPrintSHA256/);
assert.match(tunnelSource,/ForwardedPortLocal\("127\.0\.0\.1"/);
assert.match(tunnelSource,/client\.ConnectAsync\(ct\)/);
assert.match(postgresSource,/Pooling = !localPort\.HasValue/);
assert.match(backendCode,/\/destination\/test-ssh-draft/);
assert.match(backendCode,/MapFallbackToFile\("index\.html"\)/);
assert.match(backendCode,/worker\.GetLiveRuns\(\)\.Concat\(c\.Runs\)/);
assert.match(src,/popstate/);
assert.match(src,/\/historial/);
assert.match(src,/\.setInterval\?/);
const workerCode=fs.readFileSync(path.join(__dirname,'../src/FarmetricaSync/Core/SyncWorker.cs'),'utf8');
assert.match(workerCode,/GetLiveRuns/);
assert.match(workerCode,/Provisional = p\.Phase/);
assert.match(workerCode,/SyncSchedule\.IsDue\(job, state, p, now\)/);
assert.doesNotMatch(workerCode,/successful \? job\.EveryMinutes : job\.RetryMinutes/);
assert.match(workerCode,/lastReportedBatches/);
assert.match(workerCode,/InnerException/);
assert.match(workerCode,/LastProgressUtc = DateTimeOffset\.UtcNow/);
assert.match(workerCode,/Math\.Max\(lastReportedRows, rows\)/);
assert.match(src,/state\.page==='dashboard'\)attempt\(reload\)/);
assert.match(src,/filas leídas \(provisionales\)/);
const farmaticConnector = fs.readFileSync(path.join(__dirname,'../src/FarmetricaSync/Connectors/FarmaticConnector.cs'),'utf8');
assert.match(farmaticConnector,/sourceRows % 250 == 0/);
const interfaceSource = fs.readFileSync(path.join(__dirname,'../src/FarmetricaSync/Connectors/ISourceConnector.cs'),'utf8');
assert.match(interfaceSource,/Action<long>\? onSourceRows/);
assert.match(src,/setPeriodPreset/);
assert.match(src,/applyModeTemplate/);
assert.match(src,/suggestedReplayMinutes/);
assert.match(src,/onchange="F.applyModeTemplate\(\)"/);
const configStore=fs.readFileSync(path.join(__dirname,'../src/FarmetricaSync/Data/ConfigStore.cs'),'utf8');
assert.match(configStore,/NormalizeForMode\(pharmacy.SystemType, entity.Name, job.Mode, job.Sql\)/);
assert.match(configStore,/Volatile\.Read\(ref _config\)/);
assert.match(configStore,/Volatile\.Write\(ref _config, next\)/);
assert.doesNotMatch(configStore,/lock \(_gate\) return selector/);
assert.match(backendCode,/api\/ping/);
assert.match(backendCode,/IPAddress\.IsLoopback\(ip\)/);
assert.match(backendCode,/solo permite el panel en localhost/);

assert.match(backendCode,/credentials\.AdminSalt, credentials\.AdminHash/);
assert.match(backendCode,/c\.Runs\.Take\(100\)/);
assert.match(src,/reloadPending/);
assert.match(src,/AbortSignal\.timeout/);
assert.match(src,/state\.loginPending/);
assert.match(postgresSource,/SET LOCAL lock_timeout = '5s'/);
assert.match(postgresSource,/ON COMMIT PRESERVE ROWS/);
assert.match(postgresSource,/tx = await conn\.BeginTransactionAsync\(ct\)/);
const stageReadAt=postgresSource.indexOf('await foreach (var batch in rawBatches');
const snapshotTxAt=postgresSource.indexOf('tx = await conn.BeginTransactionAsync(ct);',stageReadAt);
assert.ok(snapshotTxAt>stageReadAt,'Snapshot transaction should open after all batches have staged.');

assert.match(backendCode,/NormalizeForMode\(p.SystemType, entity.Name, r.Mode, r.Sql\)/);

assert.match(src,/dailyAtLocal:/);
assert.match(src,/j_daily_at/);
assert.match(src,/j_daily_time/);
assert.doesNotMatch(src,/Reintentar después de un error \(minutos\)/);
assert.match(postgresSource,/onProgress\?\.Invoke/);

const data={
 destination:{host:'',port:5432,database:'',username:'',schema:'farmetrica',sslMode:'VerifyFull',passwordPresent:false},
 mail:{enabled:false,host:'',port:587,username:'',passwordPresent:false,from:'',to:''},
 pharmacies:[],jobs:[],runs:[],states:[],
 entities:['ventas','compras','articulos','proveedores','familias'].map((name,i)=>({id:String(i),name,description:'',columns:[{name:'origen_id',type:'text'}]}))
};
const dom={'#app':{innerHTML:''},'#toast':{textContent:'',className:'',style:{}}};
const fakeDoc={querySelector(s){return dom[s]||{focus(){}};},getElementById(){return {value:'',checked:false};}};
const fakeLocation={pathname:'/'};
const fakeWindow={scrollTo(){},location:fakeLocation,history:{pushState(_s,_t,path){fakeLocation.pathname=path;}},addEventListener(name,cb){if(name==='popstate')this.onPopstate=cb;},setInterval(cb){this.onRefresh=cb;}};
const context={
 document:fakeDoc,
 window:fakeWindow,
 fetch:async()=>({ok:true,status:200,json:async()=>data}),
 clearTimeout(){},setTimeout(cb){ if(cb) cb();return 1;},console
};
vm.createContext(context);
vm.runInContext(src,context);
async function run(){
await new Promise(resolve=>setImmediate(resolve));
function contains(value){assert.ok(dom['#app'].innerHTML.includes(value),`No aparece: ${value}`);}
contains('Panel de sincronización');
for(const [id,label] of [
 ['pharmacies','Farmacias'],['jobs','Consultas SQL'],['entities','Entidades de datos'],
 ['destination','Destino PostgreSQL'],['mail','Avisos por correo'],['history','Historial de ejecuciones']
]){context.window.F.go(id);contains(label);}
context.window.F.go('pharmacies');context.window.F.edit('pharmacy','new');contains('p_code');contains('p_trust');
context.window.F.go('entities');context.window.F.edit('entity','new');contains('e_columns');
context.window.F.go('jobs');context.window.F.edit('job','new');contains('j_sql');contains('j_fullSql');contains('j_batch');contains('Carga completa');contains('j_period');contains('j_retry');
context.window.F.go('history');contains('Historial de ejecuciones');
assert.equal(fakeLocation.pathname,'/historial');
const exampleLive={jobId:'test-job',pharmacyCode:'ABC',entityName:'ventas',startedUtc:new Date().toISOString(),status:'running',mode:'incremental',rows:12500,batches:3,phase:'Leyendo y preparando lotes',provisional:true};
data.runs=[exampleLive];
context.window.F.go('dashboard');
assert.equal(fakeLocation.pathname,'/resumen');
context.window.F.go('history');await new Promise(resolve=>setImmediate(resolve));
contains('12');contains('Leyendo y preparando lotes');contains('filas leídas (provisionales)');
const historyContext={...context,window:{...fakeWindow,location:{pathname:'/historial'}}};
const freshDom={'#app':{innerHTML:''},'#toast':{textContent:'',className:'',style:{}}};
historyContext.document={...fakeDoc,querySelector(s){return freshDom[s]||{focus(){}};}};
vm.createContext(historyContext);
vm.runInContext(src,historyContext);
await new Promise(resolve=>setImmediate(resolve));
assert.match(freshDom['#app'].innerHTML,/Historial de ejecuciones/);
console.log('OK: navegación por rutas, recarga de historial y progreso real en tablas.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
