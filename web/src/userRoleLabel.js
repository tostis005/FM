// El rol efectivo lo determina el servidor para el cliente activo.
// auth/me sólo identifica el superadministrador a nivel global.
const ROLE_LABELS = {
 superadministrador:"Superadministrador",
 administrador:"Administrador",
 gestor:"Gestor",
 farmacia:"Personal de farmacia",
 colaborador:"Colaborador"
};

export function userRoleLabel(sessionUser, tenantContext) {
 const role = sessionUser?.role==="superadministrador"?"superadministrador":
  tenantContext?.role || sessionUser?.role;
 return ROLE_LABELS[role] || "Usuario";
}

export function userRoleAndProfileLabel(sessionUser, tenantContext) {
 const role = userRoleLabel(sessionUser,tenantContext);
 const profile = String(tenantContext?.profile?.name || "").trim();
 if (!profile) return role;
 const normalized = value => value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("es");
 const profileText=normalized(profile), roleText=normalized(role);
 // Evitar etiquetas duplicadas como «Gestor · Gestor de farmacias».
 if (profileText===roleText || profileText.startsWith(roleText+" ") ||
  (role==="Personal de farmacia" && profileText==="farmacia")) return role;
 return role + " · " + profile;
}
