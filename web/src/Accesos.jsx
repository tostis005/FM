import React,{useEffect,useState} from "react";
import {ShieldCheck,Building2,Users,ArrowRight} from "lucide-react";
import {LoadingStatus} from "./LoadingState.jsx";
export default function AccessAdmin({onAuthenticated}){
 const [user,setUser]=useState(null),[clients,setClients]=useState([]),
  [error,setError]=useState(""),[loading,setLoading]=useState(true);
 useEffect(()=>{
  let active=true;
  async function load(){
   try{
    const [me,all]=await Promise.all([
     fetch("/api/auth/me",{credentials:"same-origin",cache:"no-store"}).then(r=>r.json()),
     fetch("/api/admin/clientes",{credentials:"same-origin",cache:"no-store"})
      .then(async r=>r.ok?r.json():[])]);
    if(active){setUser(me.user);setClients(all);onAuthenticated?.()}
   }catch(e){if(active)setError(e.message)}finally{if(active)setLoading(false)}
  }
  load();return()=>{active=false}
 },[]);
 return <div className="fm-management">
  <div className="page-header"><h1>Seguridad y accesos</h1></div>
  {loading&&<LoadingStatus label="Consultando permisos…"/>}
  {error&&<p role="alert" className="fm-manage-feedback">{error}</p>}
  <section className="card fm-manage-client">
   <div className="section-heading"><h2><ShieldCheck size={19}/> Acceso por cliente</h2></div>
   <p>Los dominios corporativos se autorizan desde Administración → Clientes.
    La configuración de métodos de acceso (Google o correo y contraseña),
    roles y farmacias se realiza desde Configuración → Usuarios de cada cliente.</p>
   <p>Las cuentas Gmail personales pueden acceder con Google cuando están autorizadas
    individualmente. Los dominios Workspace autorizados conservan su acceso corporativo.
    Las cuentas con contraseña reciben una invitación segura para activarse.</p>
   <div className="fm-manage-domain-list">{clients.map(client=><div
    className="fm-manage-domain-item" key={client.slug}>
    <Building2 size={18}/><strong>{client.name}</strong>
    <span>Dominios y módulos administrados por cliente</span>
   </div>)}</div>
   {user?.role==="superadministrador"&&<button className="btn btn-primary"
    onClick={()=>window.location.assign("/clientes")}>
    <Users size={16}/> Gestionar clientes y dominios <ArrowRight size={16}/></button>}
  </section>
 </div>;
}
