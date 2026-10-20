-- El acceso Google explícito se autoriza usuario a usuario y no depende
-- del dominio. Las cuentas corporativas incorporadas por Workspace
-- siguen sujetas al dominio autorizado (y a su posterior revocación).
ALTER TABLE farmetrica.usuario_clientes
 ADD COLUMN IF NOT EXISTS google_invitado boolean NOT NULL DEFAULT false;
