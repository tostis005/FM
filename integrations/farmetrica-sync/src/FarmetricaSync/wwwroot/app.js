'use strict';
const state = { config: null, page: 'dashboard', editing: null, runFilters: {pharmacyId:'', entityId:'', status:''}, runPage:0, runResults:null };
const $ = sel => document.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
const date = v => v ? new Date(v).toLocaleString('es-ES', {dateStyle:'short',timeStyle:'short'}) : '—';
const status = v => `<span class="pill ${v==='ok'?'good':v==='error'?'bad':'wait'}">${esc(({ok:'Correcto',error:'Error',running:'Ejecutando',pending:'Pendiente'})[v] || v || 'Pendiente')}</span>`;
// El panel web tiene su propia ruta de API; nunca espera a las conexiones
// Farmatic/PostgreSQL. Las lecturas cortas y login tienen límite de espera,
// pero NO abortamos migraciones/cargas de escritura a mitad de una operación.
const req = async (url, method = 'GET', data) => {
  const seconds = method==='GET' ? (url==='/bootstrap-status'||url==='/ping'?8:15) : url==='/login'?20:0;
  const signal = seconds && typeof AbortSignal!=='undefined' && AbortSignal.timeout
    ? AbortSignal.timeout(seconds*1000) : undefined;
  let res;
  try {
    res=await fetch('/api'+url,{method,signal,credentials:'same-origin',
      headers:{'Content-Type':'application/json','X-Farmetrica-Request':'1'},
      body:data===undefined?undefined:JSON.stringify(data)});
  } catch(e) {
    if(e?.name==='TimeoutError'||e?.name==='AbortError')
      throw new Error('El panel ha tardado demasiado en responder. Comprueba el servicio Windows; no significa que la contraseña sea incorrecta.');
    throw new Error('No se puede contactar con Farmétrica Sync. Revisa que el servicio Windows esté iniciado.');
  }
  const body = await res.json().catch(()=>({}));
  if(!res.ok) {
    if(res.status===401 && url!='/login' && url!='/bootstrap-status' && state.config) {
      state.config=null;
      state.runResults=null;
      showAuth(true);
      throw new Error('La sesión ha caducado. Vuelve a iniciar sesión.');
    }
    throw new Error(body.error || `Error HTTP ${res.status}`);
  }
  return body;
};
const toast = (message, bad = false) => { const t = $('#toast'); t.textContent = message; t.className = bad ? 'error' : ''; t.style.display = 'block'; clearTimeout(toast.timer); toast.timer = setTimeout(()=>t.style.display='none',4200); };
const attempt = async fn => {try {await fn();} catch(e){toast(e.message,true);} };
// Una sola petición de configuración en vuelo: evita apilar peticiones GET
// cada 3 s si una se retrasa por carga del servidor.
let reloadPending=null;
async function reload(){
 if(reloadPending)return reloadPending;
 const promise=(async()=>{
   const config=await req('/config');
   state.config=config;
   render();
   if(state.page==='history')await F.loadRuns();
 })();
 reloadPending=promise;
 try{return await promise;}finally{if(reloadPending===promise)reloadPending=null;}
}
const val = (id) => document.getElementById(id)?.value || '';
const checked = id => document.getElementById(id)?.checked || false;
const fields = obj => Object.fromEntries(Object.entries(obj).map(([k,v])=>[k,esc(v)]));
const opt = (id,text,selected) => `<option value="${esc(id)}" ${String(id)===String(selected)?'selected':''}>${esc(text)}</option>`;
const f = (label,id,value='',extra='',type='text',help='') => `<div class="field"><label for="${id}">${esc(label)}</label><input id="${id}" type="${type}" value="${esc(value)}" ${extra}>${help?`<small>${esc(help)}</small>`:''}</div>`;
const select = (label,id,options,selected,help='') => `<div class="field"><label for="${id}">${esc(label)}</label><select id="${id}">${options.map(o=>opt(o[0],o[1],selected)).join('')}</select>${help?`<small>${esc(help)}</small>`:''}</div>`;
const textarea = (label,id,value='',help='',rows=8) => `<div class="field span2"><label for="${id}">${esc(label)}</label><textarea id="${id}" rows="${rows}">${esc(value)}</textarea>${help?`<small>${esc(help)}</small>`:''}</div>`;
const checkbox = (id,label,on) => `<label class="checkline"><input id="${id}" type="checkbox" ${on?'checked':''}>${esc(label)}</label>`;
const head = (name,subtitle='',button='') => `<div class="page-title"><div><h1>${esc(name)}</h1>${subtitle?`<p class="subtitle">${esc(subtitle)}</p>`:''}</div>${button}</div>`;
const panel = (title,content,subtitle='') => `<section class="panel"><div class="panel-head"><div><h2>${title}</h2>${subtitle?`<p>${subtitle}</p>`:''}</div></div>${content}</section>`;
const actions = (submitLabel='Guardar configuración', cancel=true) => `<div class="form-buttons">${cancel?'<button class="btn secondary" type="button" onclick="F.cancel()">Cancelar</button>':''}<button class="btn" type="submit">${esc(submitLabel)}</button></div>`;
const cfg = () => state.config;
const templateFor = (pharmacyId, entityId) => {
 const p=cfg().pharmacies.find(x=>x.id===pharmacyId);
 const e=cfg().entities.find(x=>x.id===entityId);
 return cfg().templates?.find(t=>t.systemType===p?.systemType && t.entity===e?.name);
};
const pgDraft = () => ({host:val('d_host'),port:+val('d_port'),database:val('d_db'),username:val('d_user'),password:val('d_password')||null,schema:val('d_schema'),sslMode:val('d_ssl'),sshEnabled:checked('d_ssh_enabled'),sshHost:val('d_ssh_host'),sshPort:+val('d_ssh_port'),sshUsername:val('d_ssh_user'),sshAuthMode:val('d_ssh_auth'),sshPassword:val('d_ssh_password')||null,sshPrivateKeyPath:val('d_ssh_key_path'),sshKeyPassphrase:val('d_ssh_key_passphrase')||null,sshHostKeySha256:val('d_ssh_fingerprint')});
const pharmacyDraft = () => ({code:val('p_code')||(cfg().pharmacies.find(p=>p.id===state.editing?.id)?.code||''),name:val('p_name'),systemType:val('p_system'),connectionMode:val('p_mode'),server:val('p_server'),database:val('p_db'),linkedServer:val('p_link'),authMode:val('p_auth'),username:val('p_user'),password:val('p_password')||null,countryCode:val('p_country').trim().toUpperCase()||'ES',timeZoneId:val('p_timezone'),trustServerCertificate:checked('p_trust'),enabled:checked('p_enabled')});
const mailDraft = () => ({enabled:checked('m_enabled'),host:val('m_host'),port:+val('m_port'),username:val('m_user'),password:val('m_password')||null,from:val('m_from'),to:val('m_to'),notifyRecovery:checked('m_recovery')});
const dayIso = d => new Date(d).toISOString().slice(0,10);
const syncPeriods = [[5,'Cada 5 minutos'],[15,'Cada 15 minutos'],[30,'Cada 30 minutos'],[60,'Cada hora'],[120,'Cada 2 horas'],[240,'Cada 4 horas'],[360,'Cada 6 horas'],[720,'Cada 12 horas'],[1440,'Cada día'],[2880,'Cada 2 días'],[10080,'Cada semana']];
const intervalLabel = mins => {const n=Number(mins)||60;return n%1440===0 ? n/1440+' día(s)' : n%60===0 ? n/60+' h' : n+' min';};
const nextSchedule = (j,s) => {
 if(!j.enabled)return 'Desactivada';
 if(j.mode==='incremental'&&j.fullSql&&!s?.lastFullSuccessUtc)return 'Tras carga inicial';
 if(s?.lastStatus==='running')return 'En ejecución';
 if(!s?.lastAttemptUtc)return 'Pendiente';
 const retry=s?.lastStatus!=='ok';
 const base=new Date(retry?s.lastAttemptUtc:(s.lastSuccessUtc||s.lastAttemptUtc)).getTime();
 return date(new Date(base+(retry?(j.retryMinutes||5):j.everyMinutes)*60000).toISOString())+(retry?' · reintento':'');
};


const nav = [['dashboard','◫','Resumen'],['pharmacies','▦','Farmacias'],['jobs','▤','Consultas SQL'],['entities','▧','Entidades'],['destination','◈','PostgreSQL'],['mail','✉','Alertas'],['history','◷','Historial']];
const pageRoutes={dashboard:'/resumen',pharmacies:'/farmacias',jobs:'/consultas',entities:'/entidades',destination:'/postgresql',mail:'/alertas',history:'/historial'};
const currentPageFromUrl=()=>Object.keys(pageRoutes).find(p=>pageRoutes[p]===window.location?.pathname?.replace(/\/$/,'') )||'dashboard';
state.page=currentPageFromUrl();
function shell(body){
  $('#app').innerHTML = `<div class="shell"><aside class="sidebar"><div class="logo"><img class="brand-icon" src="/assets/farmetrica-icon-64.png" alt="" width="40" height="40"><div><span class="logo-text">farmétrica</span><span class="logo-tag">SYNC CONNECTOR</span></div></div><nav class="nav">${nav.map(([id,icon,name])=>`<a class="nav-button ${state.page===id?'active':''}" href="${pageRoutes[id]}" onclick="F.go('${id}',event)"><span class="nav-icon">${icon}</span>${name}</a>`).join('')}</nav><div class="sidebar-foot"><span>Servicio de integración · v0.15.0</span><button onclick="F.logout()">Cerrar sesión ↗</button></div></aside><main class="page">${body}</main></div>`;
}
function render(){ if(!cfg()) return; const pages={dashboard,pharmacies,jobs,entities,destination,mail,history}; shell((pages[state.page]||dashboard)()); }
function dashboard(){
  const c=cfg(), enabled=c.jobs.filter(j=>j.enabled).length;
  const errors=c.states.filter(s=>s.lastStatus==='error').length;
  const runs=c.runs.slice(0,7);
  return head('Panel de sincronización','Supervisión de conectores, fuentes de datos y ejecución automática.')+
    `<div class="cards"><div class="metric"><div class="metric-label">Farmacias</div><div class="metric-number">${c.pharmacies.length}</div><div class="metric-foot">Orígenes configurados</div></div><div class="metric"><div class="metric-label">Consultas activas</div><div class="metric-number">${enabled}</div><div class="metric-foot">Ejecución programada</div></div><div class="metric"><div class="metric-label">Entidades</div><div class="metric-number">${c.entities.length}</div><div class="metric-foot">Estructuras de destino</div></div><div class="metric"><div class="metric-label">Incidencias</div><div class="metric-number">${errors}</div><div class="metric-foot">Consultas con último fallo</div></div></div>`+
    (!c.destination.host?`<div class="tip danger-note">Falta configurar el destino PostgreSQL. La sincronización permanecerá pendiente hasta completar la conexión.</div>`:'')+
    panel('Últimas sincronizaciones',runs.length?tableRuns(runs):'<div class="empty">Todavía no hay ejecuciones. Añade una farmacia, configura una consulta y actívala.</div>')+
    panel('Cómo empezar',`<div class="stack"><div class="item-card"><div><h3>1 · Configura PostgreSQL</h3><p>Servidor, esquema y credenciales de la base de datos central.</p></div><button class="btn secondary mini" onclick="F.go('destination')">Configurar</button></div><div class="item-card"><div><h3>2 · Añade una farmacia Farmatic</h3><p>SQL Server directo o Linked Server de vuestro servidor central.</p></div><button class="btn secondary mini" onclick="F.go('pharmacies')">Añadir</button></div><div class="item-card"><div><h3>3 · Prepara las consultas</h3><p>SQL con alias estandarizados para cada entidad y frecuencia de ejecución.</p></div><button class="btn secondary mini" onclick="F.go('jobs')">Consultas</button></div></div>`);
}
function tableRuns(runs){
  return `<div class="table-scroll"><table><thead><tr><th>Inicio / duración</th><th>Farmacia</th><th>Entidad</th><th>Tipo</th><th>Leídos</th><th>Altas</th><th>Cambios</th><th>Bajas</th><th>Ya presentes</th><th>Resultado</th><th>Avance / fase</th><th>Intervalo / detalle</th></tr></thead><tbody>${runs.map(r=>{const j=cfg().jobs.find(j=>j.id===r.jobId),p=cfg().pharmacies.find(p=>p.id===j?.pharmacyId),e=cfg().entities.find(e=>e.id===j?.entityId);const live=r.status==='running'||r.status==='queued';const ms=r.startedUtc?Math.max(0,((r.finishedUtc?new Date(r.finishedUtc):Date.now())-new Date(r.startedUtc))/1000).toFixed(1)+' s':'—';const idleSec=live&&r.lastProgressUtc?Math.max(0,Math.floor((Date.now()-new Date(r.lastProgressUtc).getTime())/1000)):0;const phase=live?'<div class="sync-live"><span class="sync-pulse" aria-hidden="true"></span><b>'+esc(r.phase||'En proceso')+'</b><small>'+esc(r.batches??0)+' lotes completados · '+esc(r.rows||0)+' filas leídas (provisionales)</small>'+(idleSec>120?'<small>Sin nuevo avance comunicado desde hace '+Math.floor(idleSec/60)+' min; revisa SQL Server, SSH y PostgreSQL si persiste.</small>':'')+'</div>':esc(r.phase||'—');return `<tr><td>${esc(date(r.startedUtc))}<div class="muted">${esc(ms)}</div></td><td>${esc(r.pharmacyCode||p?.code||'—')}</td><td>${esc(r.entityName||e?.name||'—')}</td><td>${r.mode==='snapshot'?'Completa (reconciliación)':'Incremental (altas y modificaciones)'}</td><td>${esc(r.rows||0)}${r.provisional?'*':''}</td><td>${esc(r.inserted||0)}</td><td>${esc(r.updated||0)}</td><td>${esc(r.deleted||0)}</td><td>${esc(r.duplicates||0)}</td><td>${status(r.status)}</td><td>${phase}</td><td class="muted">${esc(r.error|| (r.fromUtc&&r.untilUtc?date(r.fromUtc)+' → '+date(r.untilUtc):'—'))}</td></tr>`}).join('')}</tbody></table></div>`;
}
function pharmacies(){
 const list=cfg().pharmacies, e=state.editing?.kind==='pharmacy'?list.find(p=>p.id===state.editing.id):null, active=state.editing?.kind==='pharmacy';
 let out=head('Farmacias','Define cómo conecta el servicio a cada instalación de Farmatic.',`<button class="btn" onclick="F.edit('pharmacy','new')">＋ Nueva farmacia</button>`);
 out+=panel('Orígenes configurados',list.length?`<div class="table-scroll"><table><thead><tr><th>Código</th><th>Farmacia</th><th>Sistema</th><th>Conexión</th><th>Estado</th><th></th></tr></thead><tbody>${list.map(p=>`<tr><td><span class="code">${esc(p.code)}</span></td><td><b>${esc(p.name)}</b></td><td>Farmatic</td><td>${p.connectionMode==='linked'?'Linked Server':'Directa'} · ${esc(p.server)}</td><td>${status(p.enabled?'ok':'pending')}</td><td><div class="row-actions"><button class="btn mini secondary" onclick="F.testPharmacy('${p.id}')">Probar</button><button class="btn mini secondary" onclick="F.edit('pharmacy','${p.id}')">Editar</button><button class="btn mini danger" onclick="F.remove('pharmacy','${p.id}')">Eliminar</button></div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No hay farmacias configuradas todavía.</div>');
 if(active){let p=e||{code:'',name:'',systemType:'farmatic',countryCode:'ES',connectionMode:'linked',server:'.',database:'',linkedServer:'',authMode:'integrated',username:'',timeZoneId:'Romance Standard Time',trustServerCertificate:false,enabled:true};out+=panel(e?'Editar farmacia':'Nueva farmacia',`<form onsubmit="F.savePharmacy(event)"><div class="form-grid">${f('Código único','p_code',p.code,e?'disabled':'', 'text','Este código se utilizará en todas las tablas de PostgreSQL.')}${f('Nombre','p_name',p.name)}${select('Sistema de gestión','p_system',[['farmatic','Farmatic']],p.systemType)}${f('País de la farmacia (ISO: ES, PT, FR…)','p_country',p.countryCode||'ES','','text','La clasificación inicial por CN se aplica únicamente si el país es ES.')}${select('Conexión','p_mode',[['linked','Linked Server desde SQL Server central'],['direct','SQL Server directo']],p.connectionMode)}${f('Servidor SQL Server','p_server',p.server,'','text','Para la instancia local: . o .\\INSTANCIA')}${f('Base de datos de farmacia','p_db',p.database)}${f('Alias del Linked Server (solo si aplica)','p_link',p.linkedServer)}${select('Autenticación SQL','p_auth',[['integrated','Windows (cuenta del servicio)'],['sql','Usuario y contraseña SQL']],p.authMode)}${f('Usuario SQL (si aplica)','p_user',p.username)}${f('Contraseña SQL (si aplica)','p_password','','autocomplete="new-password"','password',p.passwordPresent?'Dejar vacía para mantener la existente.':'')}${f('Zona horaria de fechas de SQL Server','p_timezone',p.timeZoneId||'Romance Standard Time','','text','Windows: Romance Standard Time para España, UTC si la base guarda UTC.')}
 <div class="field span2">${checkbox('p_trust','Aceptar certificado SQL Server no verificado (solo red aislada y aprobada por TI)',p.trustServerCertificate)}</div><div class="field span2">${checkbox('p_enabled','Farmacia habilitada',p.enabled)}</div></div><div class="form-buttons"><button class="btn secondary" type="button" onclick="F.testPharmacyDraft()">✓ Probar conexión (sin guardar)</button><button class="btn" type="submit">${e?'Guardar cambios':'Crear farmacia'}</button></div></form>`);
 }
 return out;
}
function entities(){
 const list=cfg().entities, current=state.editing?.kind==='entity', e=current?list.find(x=>x.id===state.editing.id):null;
 let out=head('Entidades de datos','Contratos normalizados compartidos por todos los conectores.',`<button class="btn" onclick="F.edit('entity','new')">＋ Nueva entidad</button>`);
 out+=panel('Estructura de destino',`<div class="tip">Todas las entidades incluyen automáticamente <b>farmacia_codigo</b> y <b>sincronizado_en</b>. La columna <b>origen_id</b> es obligatoria. Clave única: (farmacia_codigo, origen_id).</div><div class="stack">${list.map(x=>`<div class="item-card"><div><h3>${esc(x.name)} <span class="code">${x.columns.length} columnas</span></h3><p>${esc(x.description)}</p><div class="column-line">${x.columns.map(c=>esc(c.name)+':'+esc(c.type)).join(' · ')}</div></div><div class="row-actions"><button class="btn mini secondary" onclick="F.edit('entity','${x.id}')">Editar</button><button class="btn mini danger" onclick="F.remove('entity','${x.id}')">Eliminar</button></div></div>`).join('')}</div>`);
 out+=panel('Existencias integradas en artículos',
   '<div class="tip">El stock actual, mínimo, máximo y lote óptimo se sincronizan con la entidad <b>articulos</b>. Ya no existe una entidad ni un planificador stock independiente. Una vez completadas las cargas de artículos puedes retirar la tabla PostgreSQL antigua; se comprobarán todos los artículos y cantidades antes de permitir el borrado.</div><div class="form-buttons"><button class="btn secondary" onclick="F.retireStockPg()">Retirar tabla stock antigua de PostgreSQL</button></div>');
 if(current){ const x=e||{name:'',description:'',columns:[{name:'origen_id',type:'text'}]};out+=panel(e?'Ampliar entidad':'Nueva entidad',`<form onsubmit="F.saveEntity(event)"><div class="form-grid">${f('Nombre de tabla','e_name',x.name,e?'disabled':'')}${f('Descripción','e_description',x.description)}${textarea('Columnas (una por línea, nombre:tipo)','e_columns',x.columns.map(c=>c.name+':'+c.type).join('\n'),'Tipos admitidos: text, numeric, timestamp, bool, integer. No se permite eliminar o cambiar columnas existentes.',7)}</div><div class="form-buttons"><button class="btn secondary" type="button" onclick="F.validateEntity()">Validar columnas</button><button class="btn" type="submit">Guardar entidad</button></div></form>`); }
 return out;
}
function jobs(){
 const list=cfg().jobs, editing=state.editing?.kind==='job', j=editing?list.find(x=>x.id===state.editing.id):null;
 const purchaseJobs=list.filter(x=>cfg().entities.some(e=>e.id===x.entityId&&e.name==='compras') && cfg().pharmacies.some(p=>p.id===x.pharmacyId&&p.systemType==='farmatic'));
 const editingPurchases=!!j && purchaseJobs.some(x=>x.id===j.id);
 const articleJobs=list.filter(x=>cfg().entities.some(e=>e.id===x.entityId&&e.name==='articulos') && cfg().pharmacies.some(p=>p.id===x.pharmacyId&&p.systemType==='farmatic'));
 const editingArticles=!!j && articleJobs.some(x=>x.id===j.id);
 const farmaticPharmacies=cfg().pharmacies.filter(p=>p.systemType==='farmatic');
 const familiesEntity=cfg().entities.find(e=>e.name==='familias');
 const familyConfigured=familiesEntity?list.filter(j=>j.entityId===familiesEntity.id).length:0;
 let out=head('Consultas SQL','Selecciona una farmacia, entidad, consulta y política de sincronización.',`<button class="btn" onclick="F.edit('job','new')">＋ Nueva consulta</button>`);
 if(familiesEntity && farmaticPharmacies.length)out+=panel('Familias y superfamilias',
    `<div class="tip">Una sola consulta une <b>Familia</b>, <b>FamiliaAux</b> y <b>SuperFamilia</b>. Carga completa diaria; relaciona familias.origen_id con articulos.familia por farmacia. Configuradas ${familyConfigured} de ${farmaticPharmacies.length} farmacias. Se preparan inicialmente desactivadas para revisar la vista previa.</div>
    <div class="form-buttons"><button class="btn secondary" onclick="F.createFamilyJobs()">＋ Preparar familias para todas las farmacias</button></div>`);
 if(purchaseJobs.length)out+=panel('Compras Farmatic · esquema común',
   `<div class="tip">Todas las farmacias usarán <b>el mismo SELECT de vRecep</b>, sin Descuento2. No cambia la periodicidad ni los cursores de los ${purchaseJobs.length} orígenes existentes. Para retirar la columna antigua de PostgreSQL hay una acción independiente, que no borra filas.</div>
     <div class="form-buttons">
       <button class="btn secondary" onclick="F.updateAllPurchaseSchemas()">↺ Actualizar desde esquema (${purchaseJobs.length} consultas)</button>
       <button class="btn secondary" onclick="F.migratePurchasesPg()">Actualizar tabla compras en PostgreSQL</button>
       <button class="btn" onclick="F.retryFailedPurchases()">Relanzar compras fallidas</button>
     </div>`);
 if(articleJobs.length)out+=panel('Artículos · catálogo y existencias en una sola carga',
    `<div class="tip">Los ${articleJobs.length} orígenes de artículos Farmatic pueden devolver desde <b>Articu</b> el catálogo junto con <b>stock_actual, stock_minimo, stock_maximo y lote_optimo</b>. No hace falta ninguna consulta separada de stock. La actualización mantiene los IDs, la periodicidad y el historial; se recomienda sincronización completa (snapshot) para detectar cambios de existencias.</div>
    <div class="form-buttons"><button class="btn secondary" onclick="F.updateAllArticleSchemas()">↺ Actualizar desde esquema (${articleJobs.length} artículos)</button></div>`);
 out+=`<div class="tip"><b>Primero carga completa, después incremental:</b> al definir ambas consultas, el servicio espera a que ejecutes una carga completa antes de iniciar el incremental automático. Utiliza la macro <span class="code">{{TABLE:dbo.MiTabla}}</span>: en conexión directa se convertirá a <span class="code">[BD].[dbo].[MiTabla]</span>; en Linked Server a <span class="code">[ALIAS].[BD].[dbo].[MiTabla]</span>. La consulta debe devolver los nombres de columna exactos (mediante AS).</div>`;
 out+=panel('Sincronizaciones configuradas',list.length?`<div class="table-scroll"><table><thead><tr><th>Farmacia</th><th>Entidad</th><th>Política de carga</th><th>Periodicidad</th><th>Próxima ejecución estimada</th><th>Lote</th><th>Última ejecución</th><th>Estado</th><th></th></tr></thead><tbody>${list.map(j=>{let p=cfg().pharmacies.find(p=>p.id===j.pharmacyId),e=cfg().entities.find(e=>e.id===j.entityId),s=cfg().states.find(s=>s.jobId===j.id);return `<tr><td>${esc(p?.code||'—')}</td><td>${esc(e?.name||'—')}</td><td>${j.mode==='snapshot'?'Completa (reconciliación)':'Incremental (solo altas)'}</td><td>${esc(intervalLabel(j.everyMinutes))}</td><td>${esc(nextSchedule(j,s))}</td><td>${esc(j.batchSize||5000)} filas</td><td>${esc(date(s?.lastAttemptUtc))}</td><td>${j.enabled&&j.mode==='incremental'&&j.fullSql&&!s?.lastFullSuccessUtc?'<span class="pill wait">Pendiente carga inicial</span>':status(j.enabled?s?.lastStatus||'pending':'pending')}</td><td><div class="row-actions"><button class="btn mini secondary" onclick="F.run('${j.id}')" ${j.enabled && !(j.mode==='incremental' && j.fullSql && !s?.lastFullSuccessUtc)?'':'disabled'}>Ejecutar</button><button class="btn mini secondary" onclick="F.runFull('${j.id}')" ${j.enabled && (j.fullSql || j.mode==='snapshot')?'':'disabled'}>Carga completa</button><button class="btn mini secondary" onclick="F.edit('job','${j.id}')">Editar</button><button class="btn mini danger" onclick="F.remove('job','${j.id}')">Eliminar</button></div></td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty">No hay consultas. Configura al menos una farmacia primero.</div>');
 if(editing){let x=j||{pharmacyId:cfg().pharmacies[0]?.id,entityId:cfg().entities[0]?.id,sql:'',fullSql:'',mode:'incremental',everyMinutes:60,retryMinutes:5,batchSize:5000,replayMinutes:180,safetyDelayMinutes:5,alertRecipients:'',initialFromUtc:'2020-01-01T00:00:00Z',enabled:false};
 const preset=templateFor(x.pharmacyId,x.entityId);
 if(!j && preset){x={...x,mode:preset.preferredMode||'incremental',sql:preset.preferredMode==='snapshot'?preset.fullSql:preset.sql,fullSql:preset.fullSql,replayMinutes:preset.suggestedReplayMinutes??180,everyMinutes:preset.suggestedEveryMinutes??60};}
 out+=panel(j?'Editar consulta':'Nueva consulta',`<form onsubmit="F.saveJob(event)"><div class="form-grid">${select('Farmacia','j_pharmacy',cfg().pharmacies.map(p=>[p.id,p.code+' — '+p.name]),x.pharmacyId).replace('<select id="j_pharmacy"','<select id="j_pharmacy" onchange="F.applyTemplate()"')}${select('Entidad de destino','j_entity',cfg().entities.map(e=>[e.id,e.name]),x.entityId).replace('<select id="j_entity"','<select id="j_entity" onchange="F.applyTemplate()"')}${select('Modo de sincronización','j_mode',[['incremental','Solo inserciones — incremental (@desde / @hasta)'],['snapshot','Carga completa — detectar altas, cambios y bajas']],x.mode,'La carga completa compara la foto con PostgreSQL, inserta nuevos, actualiza modificados y elimina los ausentes, todo de manera atómica.').replace('<select id="j_mode"','<select id="j_mode" onchange="F.applyModeTemplate()"')}${select('Periodicidad de sincronización','j_period',[['custom','Personalizado (minutos)'],...syncPeriods.map(([v,t])=>[String(v),t])],syncPeriods.some(([v])=>v===x.everyMinutes)?String(x.everyMinutes):'custom','Se ejecuta cuando transcurra este tiempo desde la última ejecución correcta.').replace('<select id="j_period"','<select id="j_period" onchange="F.setPeriodPreset()"')}${f('Intervalo exacto (minutos)','j_every',x.everyMinutes,'min="5" max="10080" step="1"','number','Puedes introducir cualquier valor entre 5 y 10080 minutos (7 días).')}${f('Reintentar después de un error (minutos)','j_retry',x.retryMinutes||5,'min="5" max="1440" step="1"','number','Por defecto cada 5 minutos si falla; independiente del intervalo habitual.')}${f('Filas por lote','j_batch',x.batchSize||5000,'min="100" max="20000" step="100"','number','Se procesan por lotes de hasta 20.000 filas. No hay límite de registros por carga: pueden ser millones.')}${f('Solapamiento de seguridad (minutos)','j_replay',x.replayMinutes??180,'min="0" max="43200"','number','Relee registros recientes para incluir inserciones con retraso. Claves de origen estables impiden duplicar datos.')}${f('Demora antes de cerrar la ventana (minutos)','j_delay',x.safetyDelayMinutes??5,'min="0" max="1440"','number','No procesa los minutos más recientes; el origen debe dar fechas fiables.')}${f('Destinatarios de alertas de esta fuente (opcional)','j_alerts',x.alertRecipients||'','','text','Emails separados por coma. Si se deja vacío, se usan los destinatarios SMTP comunes.')}${f('Fecha inicial de carga UTC','j_since',(x.initialFromUtc||'2020-01-01').slice(0,10),'','date')}${`<div class="field"><label>Estado</label>${checkbox('j_enabled','Activar sincronización automática',x.enabled)}</div>`}${textarea('SELECT de sincronización periódica','j_sql',x.sql,'En incremental: WHERE v.FechaHora >= @desde AND v.FechaHora < @hasta. Solo las filas nuevas por fecha; no modifica existentes.',10)}${textarea('SELECT de carga completa (manual)','j_fullSql',x.fullSql||'','Sin @desde/@hasta. Se ejecuta al pulsar Carga completa; sustituye atómicamente solo los registros de esta farmacia. Para trabajos de fotografía completa periódica, se utiliza el SELECT anterior.',10)}</div>
<div class="tip">${preset?`Plantilla precargada: <b>${esc(preset.title)}</b>. Puedes modificar las consultas libremente.`:'No hay plantilla predeterminada para esta entidad: introduce tu SELECT.'} La vista previa solo lee SQL Server: no guarda ni importa registros. ${preset?.note?'<br><strong>Importante:</strong> '+esc(preset.note):''}</div>
<div class="form-grid">${f('Probar desde (UTC)','j_preview_from',dayIso(Date.now()-30*86400000),'','date')}${f('Probar hasta (UTC, exclusivo)','j_preview_until',dayIso(Date.now()+86400000),'','date')}</div>
<div class="form-buttons"><button class="btn secondary" type="button" onclick="F.restoreTemplate()">↺ Usar plantilla estándar</button>${editingPurchases?'<button class="btn secondary" type="button" onclick="F.updatePurchaseSchema()">↺ Actualizar desde esquema y guardar</button>':''}${editingArticles?'<button class="btn secondary" type="button" onclick="F.updateArticleSchema()">↺ Actualizar desde esquema y guardar</button>':''}<button class="btn secondary" type="button" onclick="F.previewJob(val('j_mode')==='snapshot'?'snapshot':'incremental')">Ver primeros 100 · periódica</button><button class="btn secondary" type="button" onclick="F.previewJob('snapshot')">Ver primeros 100 · completa</button><button class="btn" type="submit">Guardar consulta</button></div>
<div id="previewResult" class="preview-result" aria-live="polite"></div></form>`);
 out+=panel('Formato mínimo del SELECT',`<pre class="sql-tip">-- Ejemplo estructural: sustituye TablaReal, campos y fechas\n-- por los nombres verificados en tu instalación de Farmatic.\nSELECT\n  CAST(IdFila AS varchar(100)) AS origen_id,\n  Fecha AS fecha,\n  CAST(Articulo AS varchar(100)) AS articulo_id,\n  Cantidad AS unidades,\n  Importe AS importe,\n  Precio AS precio_unitario,\n  CAST(Ticket AS varchar(100)) AS numero_ticket\nFROM {{TABLE:dbo.TablaReal}}\nWHERE FechaModificacion > @desde\n  AND FechaModificacion <= @hasta</pre>`);
 }
 return out;
}
function destination(){
 const d=cfg().destination;
 const sshEnabled=!!d.sshEnabled;
 const keyAuth=d.sshAuthMode==='privateKey';
 return head('Destino PostgreSQL','Conexión directa o túnel SSH seguro a Contabo / Docker.')+
 panel('Conexión de destino',`
 <form onsubmit="F.saveDestination(event)">
  <div class="form-grid">
   ${f('Servidor PostgreSQL (visto desde Contabo si usas SSH)','d_host',d.host,'','text','Con túnel suele ser 127.0.0.1 si Docker publica PostgreSQL en el propio VPS.')}
   ${f('Puerto PostgreSQL','d_port',d.port,'min="1" max="65535"','number')}
   ${f('Base de datos','d_db',d.database)}
   ${f('Esquema de Farmétrica','d_schema',d.schema,'','text','Por defecto: farmetrica.')}
   ${f('Usuario PostgreSQL','d_user',d.username)}
   ${f('Contraseña PostgreSQL','d_password','','autocomplete="new-password"','password',d.passwordPresent?'Dejar vacío conserva la contraseña anterior.':'')}
   ${select('SSL de PostgreSQL','d_ssl',[['VerifyFull','TLS: CA y nombre verificados'],['VerifyCA','TLS: CA verificada'],['Require','TLS requerido (sin verificar nombre)'],['Disable','Desactivar TLS interno (solo permitido con SSH)']],d.sslMode,'El túnel SSH cifra el transporte. SSL Disable solo está disponible al activar SSH.')}
   <div class="field span2">
      ${checkbox('d_ssh_enabled','Conectar a través de túnel SSH (Contabo)',sshEnabled).replace('<input id="d_ssh_enabled"','<input id="d_ssh_enabled" onchange="F.toggleSsh()"')}
   </div>
  </div>
  <div id="d_ssh_section" ${sshEnabled?'':'hidden'} class="ssh-settings">
   <h3>Acceso SSH al servidor Contabo</h3>
   <div class="form-grid">
    ${f('Servidor SSH (IP / dominio de Contabo)','d_ssh_host',d.sshHost||'')}
    ${f('Puerto SSH','d_ssh_port',d.sshPort||22,'min="1" max="65535"','number')}
    ${f('Usuario SSH','d_ssh_user',d.sshUsername||'')}
    ${select('Autenticación SSH','d_ssh_auth',[['password','Contraseña SSH'],['privateKey','Clave privada SSH']],d.sshAuthMode||'password').replace('<select id="d_ssh_auth"','<select id="d_ssh_auth" onchange="F.toggleSshAuth()"')}
    <div id="d_ssh_password_field" class="field" ${keyAuth?'hidden':''}>
      <label for="d_ssh_password">Contraseña SSH</label><input id="d_ssh_password" type="password" autocomplete="new-password" value="">
      <small>${d.sshPasswordPresent?'Deja vacío para mantener la anterior.':'Es la contraseña SSH, distinta de la de PostgreSQL.'}</small>
    </div>
    <div id="d_ssh_key_fields" ${keyAuth?'':'hidden'} class="field span2">
      ${f('Ruta de la clave privada en el servidor Windows','d_ssh_key_path',d.sshPrivateKeyPath||'','','text','El servicio Windows debe poder leer esta ruta y tener permisos restringidos.')}
      ${f('Frase de paso de la clave (si tiene)','d_ssh_key_passphrase','','autocomplete="new-password"','password',d.sshKeyPassphrasePresent?'Dejar vacío conserva la frase de paso.':'')}
    </div>
    ${f('Huella verificada del servidor SSH (SHA256)','d_ssh_fingerprint',d.sshHostKeySha256||'','','text','Obtenerla directamente de Contabo y cotejarla fuera del canal SSH antes de conectar. Formato SHA256:...')}
   </div>
   <div class="form-buttons">
     <button class="btn secondary" type="button" onclick="F.testSshDraft()">Probar solo SSH (sin contraseña PostgreSQL)</button>
   </div>
   <p class="muted">El túnel se establece automáticamente durante cada sincronización; escucha solo en 127.0.0.1 y se cierra al terminar.</p>
  </div>
  <div class="form-buttons">
   <button class="btn secondary" type="button" onclick="F.testDestinationDraft()">Probar conexión completa (SSH + PostgreSQL)</button>
   <button class="btn" type="submit">Guardar destino</button>
  </div>
 </form>`)+
 `<div class="tip danger-note">Las contraseñas se cifran en el servidor Windows. SSH solo acepta una huella SHA256 fijada previamente; no permite conectar a un servidor de identidad desconocida. No publiques PostgreSQL en Internet.</div>`;
}
function mail(){
 const m=cfg().mail;
 return head('Avisos por correo','Recibe incidencias cuando falle una ejecución automática.')+panel('Servidor SMTP / STARTTLS',`<form onsubmit="F.saveMail(event)"><div class="form-grid"><div class="field span2">${checkbox('m_enabled','Activar alertas automáticas',m.enabled)}</div>${f('Servidor SMTP','m_host',m.host)}${f('Puerto (STARTTLS)','m_port',m.port,'min="1" max="65535"','number')}${f('Usuario','m_user',m.username)}${f('Contraseña SMTP','m_password','','autocomplete="new-password"','password',m.passwordPresent?'Dejar vacía para conservar la contraseña.':'')}${f('Correo remitente','m_from',m.from)}${f('Destinatarios comunes (separados por comas)','m_to',m.to)}<div class="field span2">${checkbox('m_recovery','Notificar también cuando se recupere una fuente',m.notifyRecovery)}</div></div>${actions('Guardar avisos',false)}</form><button class="btn secondary" type="button" onclick="F.testMailDraft()">Enviar correo de prueba con estos datos</button>`)+`<div class="tip">Se envía como máximo un aviso por consulta y hora. Requiere SMTP con STARTTLS (por ejemplo, puerto 587). Puedes probar SMTP y definir destinatarios específicos en cada consulta.</div>`;
}
function history(){
 const c=cfg(), filters=state.runFilters, result=state.runResults, runs=result?.runs||c.runs, total=result?.total??c.runs.length;
 const filterControls=`<div class="form-grid compact-filters">${select('Farmacia','h_pharmacy',[['','Todas las farmacias'],...c.pharmacies.map(p=>[p.id,p.code+' · '+p.name])],filters.pharmacyId)}${select('Entidad','h_entity',[['','Todas las entidades'],...c.entities.map(e=>[e.id,e.name])],filters.entityId)}${select('Resultado','h_status',[['','Todos'],['ok','Correcto'],['error','Error'],['running','Ejecutando'],['queued','En cola']],filters.status)}</div><div class="row-actions" style="margin:12px 0"><button class="btn secondary" onclick="F.filterRuns()">Aplicar filtros</button><button class="btn secondary" onclick="F.clearRunFilters()">Limpiar</button><button class="btn secondary" onclick="F.exportRuns()">Exportar CSV</button></div>`;
 const pager=`<div class="row-actions" style="margin-top:14px;align-items:center"><button class="btn mini secondary" ${state.runPage<=0?'disabled':''} onclick="F.runPage(-1)">Anterior</button><span class="muted">${total?state.runPage*100+1:0}–${Math.min(total,(state.runPage+1)*100)} de ${total} ejecuciones</span><button class="btn mini secondary" ${(state.runPage+1)*100>=total?'disabled':''} onclick="F.runPage(1)">Siguiente</button></div>`;
 return head('Historial de ejecuciones','Consulta cada farmacia, entidad, registros importados e incidencias.',`<button class="btn secondary" onclick="F.loadRuns()">↻ Actualizar</button>`)+panel('Histórico por farmacia y fuente',filterControls+(runs.length?tableRuns(runs):'<div class="empty">No hay ejecuciones con estos filtros.</div>')+pager)+
 panel('Estado por consulta',`<div class="table-scroll"><table><thead><tr><th>Farmacia / Entidad</th><th>Último éxito</th><th>Registros leídos</th><th>Altas / cambios / bajas</th><th>Punto incremental</th><th>Última carga completa</th><th>Resultado</th></tr></thead><tbody>${c.jobs.map(j=>{let p=c.pharmacies.find(p=>p.id===j.pharmacyId),e=c.entities.find(e=>e.id===j.entityId),s=c.states.find(s=>s.jobId===j.id);return `<tr><td>${esc(p?.code||'—')} / ${esc(e?.name||'—')}</td><td>${esc(date(s?.lastSuccessUtc))}</td><td>${esc(s?.lastRows??'—')}</td><td>${esc(s?.lastInserted??0)} / ${esc(s?.lastUpdated??0)} / ${esc(s?.lastDeleted??0)}</td><td>${esc(date(s?.watermarkUtc))}</td><td>${esc(date(s?.lastFullSuccessUtc))}</td><td>${status(s?.lastStatus||'pending')}<div class="muted">${esc(s?.lastError||'')}</div></td></tr>`}).join('')}</tbody></table></div>`);
}
async function showAuth(forceLogin=false){
 // Impide que la actualización periódica de Resumen siga solicitando /config
 // mientras se muestra el login de una sesión realmente caducada.
 if(forceLogin)state.config=null;
 let initialized=true;
 try {const result=await req('/bootstrap-status'); initialized=result.initialized;}catch(e){$('#app').innerHTML=`<div class="auth"><div class="auth-card"><h1>No se puede conectar al servicio</h1><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Reintentar</button></div></div>`;return;}
 $('#app').innerHTML=`<div class="auth"><div class="auth-card"><div class="logo"><img class="brand-icon" src="/assets/farmetrica-icon-64.png" alt="" width="40" height="40"><div><span class="logo-text">farmétrica</span><span class="logo-tag">SYNC CONNECTOR</span></div></div><h1>${initialized?'Acceso al sincronizador':'Primera configuración'}</h1><p>${initialized?'Introduce la contraseña del administrador para gestionar las sincronizaciones.':'Crea una contraseña segura para proteger la configuración del servidor. Mínimo 12 caracteres.'}</p><form onsubmit="F.auth(event,${initialized})"><div class="field"><label>Contraseña de administrador</label><input id="auth_password" type="password" autocomplete="${initialized?'current-password':'new-password'}" minlength="${initialized?1:12}" required autofocus></div><button class="btn" type="submit">${initialized?'Entrar':'Crear administrador'}</button></form></div></div>`;
}
window.F={
 async auth(ev,initialized){ev.preventDefault();if(state.loginPending)return;
  state.loginPending=true;
  const submit=ev.target?.querySelector?.('button[type="submit"]');
  if(submit)submit.disabled=true;
  await attempt(async()=>{
   const password=val('auth_password');
   if(!initialized){await req('/bootstrap','POST',{password});toast('Administrador creado. Inicia sesión.');await showAuth();return;}
   await req('/login','POST',{password});
   await reload();
  });
  state.loginPending=false;
  if(submit)submit.disabled=false;
 },
 go(page,event){if(!pageRoutes[page])return;event?.preventDefault?.();if(window.location?.pathname!==pageRoutes[page])window.history?.pushState?.({},'',pageRoutes[page]);state.page=page;state.editing=null;render();window.scrollTo(0,0);if(page==='history')this.loadRuns();},
 edit(kind,id){state.editing={kind,id};render();setTimeout(()=>document.querySelector('.panel form input')?.focus(),0);},
 cancel(){state.editing=null;render();},
 refresh(){attempt(reload);},
 async logout(){await attempt(async()=>{await req('/logout','POST');state.config=null;await showAuth(true);});},
 async saveDestination(ev){ev.preventDefault();await attempt(async()=>{await req('/destination','PUT',pgDraft());await reload();toast('Destino PostgreSQL guardado.');});},
 async testDestination(){await attempt(async()=>{let r=await req('/destination/test','POST');toast(r.message);});},
 async testDestinationDraft(){await attempt(async()=>{let r=await req('/destination/test-draft','POST',{destination:pgDraft()});toast(r.message);});},
 async testSshDraft(){await attempt(async()=>{let r=await req('/destination/test-ssh-draft','POST',{destination:pgDraft()});toast(r.message);});},
 toggleSsh(){const on=checked('d_ssh_enabled');const section=document.getElementById('d_ssh_section');if(section)section.hidden=!on;const ssl=document.getElementById('d_ssl');if(ssl){if(on && ssl.value==='VerifyFull')ssl.value='Disable';if(!on && ssl.value==='Disable')ssl.value='VerifyFull';}},
 toggleSshAuth(){const key=val('d_ssh_auth')==='privateKey';const pw=document.getElementById('d_ssh_password_field'),k=document.getElementById('d_ssh_key_fields');if(pw)pw.hidden=key;if(k)k.hidden=!key;},
 async testPharmacyDraft(){await attempt(async()=>{let r=await req('/pharmacies/test-draft','POST',{pharmacy:pharmacyDraft(),existingPharmacyId:state.editing?.id==='new'?null:state.editing?.id});toast(r.message);});},
 async testMailDraft(){await attempt(async()=>{await req('/mail/test-draft','POST',mailDraft());toast('Correo SMTP de prueba enviado, sin guardar los datos.');});},
 applyTemplate(){
    if(state.editing?.kind!=='job' || state.editing.id!=='new') return;
    const t=templateFor(val('j_pharmacy'),val('j_entity'));
    const a=document.getElementById('j_sql'),b=document.getElementById('j_fullSql'),m=document.getElementById('j_mode');
    if(!a || !b || !m) return;
    const known=(cfg().templates||[]).some(x=>(x.sql===a.value||x.fullSql===a.value) && x.fullSql===b.value);
    if(a.value && !known && !confirm('¿Sustituir el SQL que has escrito por la nueva plantilla?')) return;
    m.value=t?.preferredMode||'incremental';
    a.value=t?(m.value==='snapshot'?t.fullSql:t.sql):'';
    b.value=t?.fullSql||'';
    const replay=document.getElementById('j_replay');
    if(replay && t) replay.value=t.suggestedReplayMinutes??180;
    const every=document.getElementById('j_every');
    if(every && t) every.value=t.suggestedEveryMinutes??60;
    const period=document.getElementById('j_period');
    if(period && t) period.value=syncPeriods.some(([v])=>v===t.suggestedEveryMinutes)?String(t.suggestedEveryMinutes):'custom';
 },
 applyModeTemplate(){
    const mode=val('j_mode');
    const previous=cfg().jobs.find(x=>x.id===state.editing?.id);
    const selection=document.getElementById('j_mode');
    if(previous && previous.mode!==mode){
       selection.value=previous.mode;
       toast('No se puede cambiar el modo de una consulta existente con estado. Mantén la consulta o crea otra configuración tras revisar su punto incremental.',true);
       return;
    }
    const t=templateFor(val('j_pharmacy'),val('j_entity')), sql=document.getElementById('j_sql');
    if(!t || !sql) return;
    const current=sql.value.trim();
    // Solo modificar SELECTs estándar: no tocar SQL personalizado.
    if(current===t.sql.trim() || current===t.fullSql.trim() || !current){
        if(mode==='incremental' && !/@desde\b/i.test(t.sql)){
            toast('Esta plantilla no tiene fecha técnica de altas para incremental. Conserva carga completa o escribe un SELECT seguro.',true);
            return;
        }
        sql.value=mode==='snapshot'?t.fullSql:t.sql;
    }
 },
 restoreTemplate(){
    const t=templateFor(val('j_pharmacy'),val('j_entity'));
    if(!t) return toast('No hay una plantilla para este sistema y entidad.',true);
    if(!confirm('¿Reemplazar ambas consultas por la plantilla '+t.title+'?'))return;
    const mode=t.preferredMode||'incremental';
    document.getElementById('j_mode').value=mode;
    document.getElementById('j_sql').value=mode==='snapshot'?t.fullSql:t.sql;
    document.getElementById('j_fullSql').value=t.fullSql;
    const replay=document.getElementById('j_replay');
    if(replay)replay.value=t.suggestedReplayMinutes??180;
    const every=document.getElementById('j_every'),period=document.getElementById('j_period');
    if(every)every.value=t.suggestedEveryMinutes??60;
    if(period)period.value=syncPeriods.some(([v])=>v===t.suggestedEveryMinutes)?String(t.suggestedEveryMinutes):'custom';
    toast('Plantilla estándar aplicada (aún sin guardar). '+(t.note||''));
 },
 async previewJob(mode){await attempt(async()=>{
    const e=document.getElementById('previewResult');
    if(!e) return;
    const sql=mode==='snapshot'?(val('j_mode')==='snapshot'?val('j_sql'):val('j_fullSql')):val('j_sql');
    if(!sql.trim()) throw new Error('La consulta seleccionada está vacía.');
    e.innerHTML='<p class="muted">Consultando SQL Server (máximo 100 filas)…</p>';
    const r=await req('/jobs/preview','POST',{pharmacyId:val('j_pharmacy'),entityId:val('j_entity'),sql,mode,
       fromUtc:val('j_preview_from')+'T00:00:00Z',untilUtc:val('j_preview_until')+'T00:00:00Z'});
    const columns=[...r.columns, ...new Set((r.rows||[]).flatMap(o=>Object.keys(o)).filter(k=>!r.columns.includes(k)))];
    e.innerHTML='<h3>Vista previa · '+esc(r.count)+' filas · '+esc(r.pharmacy)+' / '+esc(r.entity)+'</h3>'+
      (r.rows.length?'<div class="table-scroll"><table><thead><tr>'+columns.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+r.rows.map(row=>'<tr>'+columns.map(c=>'<td>'+esc(row[c]??'—')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'<div class="empty">La consulta no devuelve filas en este intervalo.</div>')+
      '<p class="muted">Vista previa: solo lectura, sin cambios en PostgreSQL.</p>';
 });},
 async saveMail(ev){ev.preventDefault();await attempt(async()=>{await req('/mail','PUT',mailDraft());await reload();toast('Configuración SMTP guardada.');});},
 async testMail(){await attempt(async()=>{await req('/mail/test','POST');toast('Correo de prueba enviado.');});},
 async loadRuns(){await attempt(async()=>{const f=state.runFilters;let qs=new URLSearchParams({skip:String(state.runPage*100),take:'100'});if(f.pharmacyId)qs.set('pharmacyId',f.pharmacyId);if(f.entityId)qs.set('entityId',f.entityId);if(f.status)qs.set('status',f.status);const response=await req('/runs?'+qs);state.runResults=response;if(cfg())cfg().states=response.states||cfg().states;if(state.page==='history')render();});},
 filterRuns(){state.runFilters={pharmacyId:val('h_pharmacy'),entityId:val('h_entity'),status:val('h_status')};state.runPage=0;this.loadRuns();},
 clearRunFilters(){state.runFilters={pharmacyId:'',entityId:'',status:''};state.runPage=0;this.loadRuns();},
 runPage(d){state.runPage=Math.max(0,state.runPage+d);this.loadRuns();},
 exportRuns(){const rr=state.runResults?.runs||cfg().runs;const cols=['startedUtc','finishedUtc','pharmacyCode','entityName','mode','status','rows','inserted','updated','deleted','duplicates','fromUtc','untilUtc','error'];const rows=[cols.join(';'),...rr.map(r=>cols.map(k=>'"'+String(r[k]??'').replaceAll('"','""')+'"').join(';'))];const b=new Blob(['\ufeff'+rows.join('\r\n')],{type:'text/csv;charset=utf-8;'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download='farmetrica-sync-historial.csv';a.click();URL.revokeObjectURL(u);},
 async savePharmacy(ev){ev.preventDefault();await attempt(async()=>{let id=state.editing.id;let data=pharmacyDraft();await req('/pharmacies'+(id==='new'?'':'/'+id),id==='new'?'POST':'PUT',data);state.editing=null;await reload();toast('Farmacia guardada.');});},
 async validateEntity(){await attempt(async()=>{
    const cols=val('e_columns').split('\n').map(x=>x.trim()).filter(Boolean);
    const seen=new Set();
    for(const spec of cols){
        const parts=spec.split(':').map(x=>x.trim());
        if(parts.length!==2 || !/^[a-z][a-z0-9_]{0,62}$/.test(parts[0]) || !['text','numeric','timestamp','integer','bool'].includes(parts[1]))
            throw new Error('Columna inválida: '+spec);
        if(seen.has(parts[0]))throw new Error('Columna repetida: '+parts[0]);
        seen.add(parts[0]);
    }
    if(!seen.has('origen_id'))throw new Error('Falta origen_id:text.');
    toast('Estructura válida. Puedes guardar la entidad y comprobar sus datos desde Consultas SQL.');
 });},
 async saveEntity(ev){ev.preventDefault();await attempt(async()=>{let id=state.editing.id;let old=cfg().entities.find(e=>e.id===id);let columns=val('e_columns').split('\n').map(s=>s.trim()).filter(Boolean).map(s=>{let parts=s.split(':');if(parts.length!==2)throw new Error('Cada línea debe tener formato nombre:tipo.');return {name:parts[0].trim(),type:parts[1].trim()};});let data={id:old?.id,name:val('e_name')||old?.name,description:val('e_description'),columns};await req('/entities'+(id==='new'?'':'/'+id),id==='new'?'POST':'PUT',data);state.editing=null;await reload();toast('Entidad guardada.');});},
 setPeriodPreset(){const preset=val('j_period');const field=document.getElementById('j_every');if(field && preset!=='custom')field.value=preset;},
 async createFamilyJobs(){
    if(!confirm('¿Crear consultas de familias en las farmacias Farmatic que todavía no las tengan? Se crean desactivadas, con carga completa diaria, sin modificar otras consultas.'))return;
    await attempt(async()=>{const r=await req('/jobs/familias/create-missing','POST');state.editing=null;await reload();toast(r.message);});
 },
 async updateArticleSchema(){
    const id=state.editing?.id;
    if(!id || id==='new')return;
    if(!confirm('¿Guardar el SELECT actualizado de Articu con catálogo y existencias? Se sustituye cualquier SQL personalizado de este trabajo. Se conservan la periodicidad, el historial y el ID.'))return;
    await attempt(async()=>{const res=await req('/jobs/'+id+'/update-schema','POST');state.editing=null;await reload();toast(res.message);});
 },
 async updateAllArticleSchemas(){
    if(!confirm('¿Actualizar y GUARDAR todos los SELECT de artículos Farmatic para que incluyan stock actual, mínimos, máximos y lote óptimo? Reemplaza consultas SQL personalizadas, pero conserva IDs, periodicidad e historial.'))return;
    await attempt(async()=>{const r=await req('/jobs/articulos/update-schema-all','POST');state.editing=null;await reload();toast(r.message);});
 },
 async retireStockPg(){
    if(!confirm('¿Retirar DEFINITIVAMENTE la tabla PostgreSQL antigua de stock? Se perderá su copia separada de datos. Solo se permitirá si TODOS los registros y sus cantidades coinciden con articulos. Haz primero una copia de seguridad y sincroniza artículos.'))return;
    await attempt(async()=>{const r=await req('/entities/stock/retire-postgresql','POST');await reload();toast(r.message);});
 },
 async updatePurchaseSchema(){
    const id=state.editing?.id;
    if(!id || id==='new')return;
    if(!confirm('¿Sustituir y guardar las consultas de compras de esta farmacia por el esquema común? Se conservarán periodicidad, modo, datos e historial. Se perderá cualquier edición SQL personalizada anterior.'))return;
    await attempt(async()=>{const res=await req('/jobs/'+id+'/update-schema','POST');state.editing=null;await reload();toast(res.message);});
 },
 async updateAllPurchaseSchemas(){
    if(!confirm('¿Actualizar y GUARDAR los SELECT de todos los orígenes de compras Farmatic? Se sustituirá cualquier SQL personalizado de compras. Se conservarán los trabajos, la periodicidad, los históricos y las marcas incrementales.'))return;
    await attempt(async()=>{const r=await req('/jobs/compras/update-schema-all','POST');state.editing=null;await reload();toast(r.message);});
 },
 async migratePurchasesPg(){
    if(!confirm('¿Actualizar farmetrica.compras en PostgreSQL? Se añadirán los campos comunes y se ELIMINARÁ la columna descuento_recepcion, incluidos sus valores antiguos. No se borrarán filas. Haz copia de seguridad si necesitas conservar esos descuentos.'))return;
    await attempt(async()=>{const r=await req('/entities/compras/migrate-postgresql','POST');await reload();toast(r.message);});
 },
 async retryFailedPurchases(){
    if(!confirm('¿Poner en cola solo las sincronizaciones de compras fallidas? Si alguna no completó su carga inicial, se ejecutará una carga completa.'))return;
    await attempt(async()=>{const r=await req('/jobs/compras/retry-failed','POST');await reload();toast(r.message);});
 },
 async saveJob(ev){ev.preventDefault();await attempt(async()=>{let id=state.editing.id;let data={pharmacyId:val('j_pharmacy'),entityId:val('j_entity'),sql:val('j_sql'),fullSql:val('j_fullSql'),mode:val('j_mode'),everyMinutes:+val('j_every'),retryMinutes:+val('j_retry'),batchSize:+val('j_batch'),initialFromUtc:val('j_since')+'T00:00:00Z',enabled:checked('j_enabled'),replayMinutes:+val('j_replay'),safetyDelayMinutes:+val('j_delay'),alertRecipients:val('j_alerts')};await req('/jobs'+(id==='new'?'':'/'+id),id==='new'?'POST':'PUT',data);state.editing=null;await reload();toast('Consulta guardada.');});},
 async testPharmacy(id){await attempt(async()=>{let r=await req('/pharmacies/'+id+'/test','POST');toast(r.message);});},
 async run(id){await attempt(async()=>{let r=await req('/jobs/'+id+'/run','POST');toast(r.queued?'Ejecución añadida a la cola.':'Esta consulta ya está en cola.');setTimeout(()=>attempt(reload),2500);});},
 async runFull(id){if(!confirm('¿Ejecutar una carga COMPLETA? Se reemplazarán los registros existentes de esta farmacia y entidad en PostgreSQL tras las verificaciones de seguridad.'))return;await attempt(async()=>{let r=await req('/jobs/'+id+'/run-full','POST');toast(r.queued?'Carga completa añadida a la cola.':'Esta consulta ya está en cola.');setTimeout(()=>attempt(reload),2500);});},
 async remove(kind,id){let labels={pharmacy:'la farmacia',entity:'la entidad',job:'la consulta'};if(!confirm('¿Eliminar '+labels[kind]+'? No elimina los registros de PostgreSQL.'))return;await attempt(async()=>{let path={pharmacy:'pharmacies',entity:'entities',job:'jobs'}[kind];await req('/'+path+'/'+id,'DELETE');state.editing=null;await reload();toast('Elemento eliminado.');});}
};
window.addEventListener?.('popstate',()=>{state.page=currentPageFromUrl();state.editing=null;if(cfg()){render();if(state.page==='history')F.loadRuns();}});
window.setInterval?.(()=>{
 if(!cfg() || document.hidden)return;
 if(state.page==='history'&&!document.activeElement?.closest?.('.compact-filters'))F.loadRuns();
 else if(state.page==='dashboard')attempt(reload);
},3000);
(async()=>{try{await reload();}catch(e){if(e.message.includes('401')||e.message.toLowerCase().includes('contraseña'))await showAuth(true);else if(!state.config)await showAuth();}})();
