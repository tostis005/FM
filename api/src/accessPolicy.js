// Política única para acceso Google e invitaciones de clientes.
export const DOMAIN=/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const normalizeDomain=value=>String(value||"").trim().toLowerCase().replace(/^@/,"");
export const normalizeEmail=value=>String(value||"").trim().toLowerCase();
export const emailDomain=email=>normalizeEmail(email).split("@")[1]||"";
export const CONSUMER_DOMAINS=new Set(["gmail.com","googlemail.com","outlook.com","hotmail.com",
 "yahoo.com","yahoo.es","icloud.com","live.com","proton.me","protonmail.com"]);
export function validClientDomain(domain){
 const d=normalizeDomain(domain);
 return d.length<=253&&DOMAIN.test(d)&&!CONSUMER_DOMAINS.has(d);
}
export function validInternalEmail(email,allowedDomains=[]){
 return EMAIL.test(normalizeEmail(email))&&
  allowedDomains.map(normalizeDomain).includes(emailDomain(email));
}
export function googleDomainAuthorized(email,hostedDomain,domain){
 return emailDomain(email)===normalizeDomain(domain)&&
  normalizeDomain(hostedDomain)===normalizeDomain(domain)&&validClientDomain(domain);
}

export function googleMembershipAuthorized(membership){
 // No basta con que Google haya verificado la identidad: además debe existir
 // una invitación individual o seguir activo el dominio Workspace del cliente.
 return Boolean(membership?.active&&membership.login_method==="google"&&
  (membership.individually_invited===true||membership.domain_allowed===true));
}
