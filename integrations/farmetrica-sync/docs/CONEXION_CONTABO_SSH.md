# Farmétrica Sync — PostgreSQL en Docker/Contabo mediante SSH (v0.6)

Farmétrica Sync puede iniciar un túnel dentro del servicio Windows, sin DBeaver ni publicar PostgreSQL en Internet.

## Configuración en la pestaña PostgreSQL

Abre http://127.0.0.1:5080 y entra en PostgreSQL:

- Marca Conectar a través de túnel SSH.
- Servidor SSH: IP/dominio del VPS Contabo; Puerto SSH: según DBeaver (habitualmente 22).
- Usuario SSH: cuenta autorizada del VPS.
- Autenticación SSH: contraseña o clave privada (ruta local legible en el servidor Windows, no en tu portátil).
- Huella digital SSH SHA256: huella verificada del servidor, previamente cotejada fuera de banda.
- Servidor PostgreSQL: host visto desde Contabo, normalmente 127.0.0.1 si Docker publica el puerto en loopback; en otros despliegues puede ser un hostname diferente.
- Puerto PostgreSQL: habitualmente 5432, o puerto publicado por Docker.
- Base de datos, usuario y contraseña PostgreSQL: independientes de las credenciales SSH.
- Esquema: farmetrica.
- SSL PostgreSQL: Disable únicamente con SSH habilitado y huella SSH correcta. Con PostgreSQL TLS propio puede conservarse SSL según la configuración de certificados.

Pulsa Probar solo SSH primero, sin contraseña PostgreSQL. Luego Probar conexión completa (SSH + PostgreSQL), que sí necesita la contraseña PostgreSQL.

## Huella digital de servidor

Desde la consola confiable del VPS Contabo:

    sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256

La salida contiene SHA256:.... Si SSH negocia otra clave, comprueba la huella de esa clave (por ejemplo RSA). Nunca aceptar automáticamente una huella recibida por una red que no hayas verificado.

## Contraseña PostgreSQL

No se puede recuperar la contraseña actual desde el hash guardado por PostgreSQL.
El contenedor Docker puede conservar la variable POSTGRES_PASSWORD del arranque, aunque puede haber quedado desactualizada si alguien cambió la contraseña.

    docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}"
    docker inspect NOMBRE_CONTENEDOR --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^POSTGRES_PASSWORD='

Mantén la salida en una terminal privada; no compartas ni pegues las contraseñas en un chat o ticket. Si falta o falla la contraseña, crea un usuario exclusivo para el sincronizador con permisos limitados al esquema farmetrica, sin cambiar el usuario de la aplicación web.

## Seguridad y comportamiento

- El túnel escucha únicamente en 127.0.0.1 de Windows, usando un puerto local efímero por operación.
- La contraseña PostgreSQL, la SSH y la frase de paso de la clave se guardan cifradas como el resto de los secretos de Farmétrica Sync.
- Para claves privadas se guarda su ruta local, no su contenido; limita los permisos de archivo a la cuenta del servicio Windows.
- SSH.NET 2026.0.0 gestiona el túnel. No es necesario mantener DBeaver abierto.
- La huella SHA256 del servidor se exige y compara estrictamente en cada conexión.
- Si falla SSH o PostgreSQL durante una ejecución, se cancela y no se avanza el cursor incremental hasta completar la escritura.
- Pruebas reales SSH + Docker + PostgreSQL pendientes antes de habilitar la producción.
