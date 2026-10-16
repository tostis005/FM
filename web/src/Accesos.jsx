import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, KeyRound, LockKeyhole, Mail, Plus, ShieldCheck, Trash2 } from "lucide-react";

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin", cache: "no-store",
    ...options, headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || "Error HTTP " + response.status);
  return data;
}
const EMPTY_DOMAIN = { domain: "", pharmacyId: "", active: true };
const EMPTY_ACCOUNT = { email: "", name: "", role: "farmacia", pharmacies: [], active: true };
const ROLES = [
  ["farmacia", "Personal de farmacia"], ["gestor", "Gestor de farmacias"],
  ["colaborador", "Colaborador externo"], ["administrador", "Administrador"],
];
function GoogleSignIn({ clientId, onCredential, onError }) {
  const buttonRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    if (!clientId) return;
    const render = () => {
      if (cancelled || !buttonRef.current || !window.google?.accounts?.id) return;
      buttonRef.current.replaceChildren();
      window.google.accounts.id.initialize({
        client_id: clientId, callback: response => onCredential(response.credential),
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        type: "standard", theme: "outline", size: "large",
        text: "signin_with", shape: "rectangular", width: 285,
      });
    };
    if (window.google?.accounts?.id) render();
    else {
      let script = document.getElementById("google-identity-services");
      if (!script) {
        script = document.createElement("script");
        script.id = "google-identity-services";
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", render);
      script.addEventListener("error", onError);
      return () => { cancelled = true; script.removeEventListener("load", render); script.removeEventListener("error", onError); };
    }
    return () => { cancelled = true; };
  }, [clientId, onCredential, onError]);
  return <div ref={buttonRef} className="access-google-button" aria-label="Iniciar sesión con Google"/>;
}

export default function AccessAdmin({ onAuthenticated }) {
  const [config, setConfig] = useState(null);
  const [user, setUser] = useState(null);
  const [domains, setDomains] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [pharmacies, setPharmacies] = useState([]);
  const [domainForm, setDomainForm] = useState(EMPTY_DOMAIN);
  const [accountForm, setAccountForm] = useState(EMPTY_ACCOUNT);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeRequested, setCodeRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function refresh() {
    const data = await api("/api/auth/me");
    setUser(data.user || null);
    if (data.user?.role === "administrador") {
      const [ds, us, fs] = await Promise.all([
        api("/api/admin/domains"), api("/api/admin/accounts"), api("/api/farmacias"),
      ]);
      setDomains(ds); setAccounts(us); setPharmacies(fs);
    } else { setDomains([]); setAccounts([]); }
    onAuthenticated?.();
  }
  useEffect(() => {
    let running = true;
    Promise.all([api("/api/auth/config"), api("/api/auth/me")])
      .then(async ([settings]) => { if (running) setConfig(settings); if (running) await refresh(); })
      .catch(() => { if (running) setError("La API de acceso todavía no está disponible en el servidor. La lista solo podrá gestionarse cuando configuremos Google y despleguemos el backend."); });
    return () => { running = false; };
  }, []);
  async function action(work, success) {
    setError(""); setMessage(""); setBusy(true);
    try { await work(); setMessage(success); await refresh(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  const googleCallback = async credential => action(
    () => api("/api/auth/google", { method: "POST", body: JSON.stringify({ credential }) }),
    "Sesión iniciada correctamente",
  );
  const googleError = () => setError("No se ha podido cargar el inicio de sesión Google.");
  async function requestCode(event) {
    event.preventDefault();
    await action(async () => {
      await api("/api/auth/request-code", { method: "POST", body: JSON.stringify({ email }) });
      setCodeRequested(true);
    }, "Si el correo está autorizado, recibirás un código válido durante 10 minutos.");
  }
  async function verifyCode(event) {
    event.preventDefault();
    await action(() => api("/api/auth/verify-code", {
      method: "POST", body: JSON.stringify({ email, code }),
    }), "Sesión iniciada con código");
  }
  async function saveDomain(event) {
    event.preventDefault();
    await action(() => api("/api/admin/domains", {
      method: "PUT", body: JSON.stringify(domainForm),
    }), "Dominio guardado");
    setDomainForm(EMPTY_DOMAIN);
  }
  async function saveAccount(event) {
    event.preventDefault();
    await action(() => api("/api/admin/accounts", {
      method: "PUT", body: JSON.stringify(accountForm),
    }), "Cuenta guardada");
    setAccountForm(EMPTY_ACCOUNT);
  }
  const administrator = user?.role === "administrador";
  return <div className="access-management">
    <div className="page-header">
      <div><h1>Accesos y dominios</h1><p>Controla qué correos pueden entrar y a qué farmacias pertenecen.</p></div>
      {user && <button className="btn btn-secondary" onClick={() => action(
        () => api("/api/auth/logout", { method: "POST" }), "Sesión cerrada",
      )}>Cerrar sesión</button>}
    </div>
    <div className="access-explainer">
      <ShieldCheck size={19}/>
      <span>Un dominio permitido autoriza el inicio de sesión. Los permisos se asignan en el servidor: el correo verificado por sí solo no concede acceso a todas las farmacias. Una cuenta desactivada no podrá entrar, aunque su dominio esté permitido.</span>
    </div>
    {error && <div className="access-alert access-alert-error" role="alert">{error}</div>}
    {message && <div className="access-alert" role="status"><CheckCircle2 size={16}/>{message}</div>}
    {!config && <section className="card access-section"><p>Comprobando el acceso al backend…</p></section>}
    {config && !user && <section className="card access-section">
      <h2>Iniciar sesión</h2>
      <p>Utiliza tu cuenta Google autorizada, incluso si no termina en gmail.com. Los colaboradores con una cuenta individual también podrán solicitar un código por correo electrónico.</p>
      {config.googleClientId ? <GoogleSignIn clientId={config.googleClientId} onCredential={googleCallback} onError={googleError}/> :
        <p className="access-hint">Google pendiente de configurar en el servidor.</p>}
      {config.emailCodesAvailable && <form onSubmit={codeRequested ? verifyCode : requestCode} className="access-code-login">
        <label>Correo autorizado
          <input type="email" required placeholder="persona@ejemplo.com" value={email} onChange={e=>{setEmail(e.target.value);setCodeRequested(false);setCode("");}}/>
        </label>
        {codeRequested && <label>Código de 6 dígitos
          <input type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" required placeholder="000000" value={code} onChange={e=>setCode(e.target.value)}/>
        </label>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          <KeyRound size={16}/>{codeRequested?"Verificar código":"Enviar código"}
        </button>
        {codeRequested && <button type="button" className="btn btn-secondary" disabled={busy} onClick={requestCode}>Reenviar código</button>}
      </form>}
      {!config.emailCodesAvailable && <p className="access-hint">El acceso mediante códigos estará disponible cuando se configure el servicio de correo saliente (SMTP).</p>}
    </section>}
    {user && !administrator && <section className="card access-section">
      <h2>Cuenta autorizada</h2>
      <p><strong>{user.email}</strong> · {user.role}</p>
      <p>Tu cuenta puede iniciar sesión, pero solo un administrador puede gestionar dominios y correos. Las farmacias y los permisos efectivos dependen de las asignaciones autorizadas.</p>
    </section>}
    {administrator && <>
      <section className="card access-section">
        <div className="section-heading"><div><h2>Dominios permitidos</h2><p>El administrador decide qué dominios se aceptan y su farmacia predeterminada.</p></div><span className="count-label">{domains.length} dominios</span></div>
        <form className="access-form-grid" onSubmit={saveDomain}>
          <label>Dominio
            <input required placeholder="farmaciaejemplo.es" value={domainForm.domain} onChange={e=>setDomainForm({...domainForm,domain:e.target.value})}/>
          </label>
          <label>Farmacia vinculada
            <select value={domainForm.pharmacyId ?? ""} onChange={e=>setDomainForm({...domainForm,pharmacyId:e.target.value})}>
              <option value="">Sin asignar</option>{pharmacies.map(p=><option key={p.id} value={p.id}>{p.name} ({p.sourceCode})</option>)}
            </select>
          </label>
          <label className="access-checkbox"><input type="checkbox" checked={domainForm.active} onChange={e=>setDomainForm({...domainForm,active:e.target.checked})}/> Habilitado</label>
          <button type="submit" className="btn btn-primary" disabled={busy}><Plus size={16}/> Guardar dominio</button>
        </form>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Dominio</th><th>Farmacia</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>{domains.map(d=><tr key={d.domain}>
            <td><strong>@{d.domain}</strong></td>
            <td>{pharmacies.find(p=>p.id===d.pharmacyId)?.name || "Sin asignar"}</td>
            <td>{d.active?"Habilitado":"Bloqueado"}</td>
            <td><button className="btn btn-secondary btn-sm" onClick={()=>setDomainForm(d)}>Editar</button>
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={()=>action(
                () => api("/api/admin/domains/"+encodeURIComponent(d.domain),{method:"DELETE"}), "Dominio eliminado",
              )}><Trash2 size={14}/> Eliminar</button></td>
          </tr>)}</tbody></table>{!domains.length&&<p className="access-hint">Todavía no hay dominios añadidos. Ningún dominio tendrá acceso automático.</p>}</div>
      </section>
      <section className="card access-section">
        <div className="section-heading"><div><h2>Correos autorizados individualmente</h2><p>Para cuentas Gmail, dominios externos y colaboradores; el permiso individual tiene preferencia sobre el dominio.</p></div><span className="count-label">{accounts.length} cuentas</span></div>
        <form className="access-form-grid" onSubmit={saveAccount}>
          <label>Correo electrónico
            <input type="email" required placeholder="colaborador@gmail.com" value={accountForm.email} onChange={e=>setAccountForm({...accountForm,email:e.target.value})}/>
          </label>
          <label>Nombre (opcional)
            <input placeholder="Nombre y apellidos" value={accountForm.name} onChange={e=>setAccountForm({...accountForm,name:e.target.value})}/>
          </label>
          <label>Rol
            <select value={accountForm.role} onChange={e=>setAccountForm({...accountForm,role:e.target.value})}>
              {ROLES.map(([id,label])=><option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label className="access-checkbox"><input type="checkbox" checked={accountForm.active} onChange={e=>setAccountForm({...accountForm,active:e.target.checked})}/> Cuenta activa</label>
          <div className="access-full">
            <strong>Farmacias autorizadas</strong>
            <div className="access-pharmacy-checks">{pharmacies.map(f=><label key={f.id}>
              <input type="checkbox" checked={accountForm.pharmacies.includes(String(f.id))} onChange={e=>
                setAccountForm(prev=>({...prev,pharmacies:e.target.checked?[...prev.pharmacies,String(f.id)]:prev.pharmacies.filter(p=>p!==String(f.id))}))}/>
              {f.name}
            </label>)}</div>
            <small>Se requiere al menos una farmacia para las cuentas activas que no sean administradoras.</small>
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy}><Mail size={16}/> Guardar correo autorizado</button>
          <button className="btn btn-secondary" type="button" onClick={()=>setAccountForm(EMPTY_ACCOUNT)}>Limpiar formulario</button>
        </form>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Correo</th><th>Rol</th><th>Farmacias</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>{accounts.map(u=><tr key={u.email}>
            <td><strong>{u.email}</strong><small>{u.name}</small></td>
            <td>{ROLES.find(([id])=>id===u.role)?.[1]||u.role}</td>
            <td>{u.role==="administrador"?"Todas":u.pharmacies.map(id=>pharmacies.find(f=>f.id===id)?.name||id).join(", ")||"—"}</td>
            <td>{u.active?"Activa":"Bloqueada"}</td>
            <td><button className="btn btn-secondary btn-sm" onClick={()=>setAccountForm(u)}>Editar</button>
              <button className="btn btn-secondary btn-sm" disabled={busy||u.email===user.email} onClick={()=>action(
                () => api("/api/admin/accounts/"+encodeURIComponent(u.email),{method:"DELETE"}), "Cuenta desactivada",
              )}><LockKeyhole size={14}/> Bloquear</button></td>
          </tr>)}</tbody></table>{!accounts.length&&<p className="access-hint">Sin correos añadidos todavía.</p>}</div>
      </section>
    </>}
  </div>;
}
