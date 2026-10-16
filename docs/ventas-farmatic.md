# Ventas reales de Farmatic · FARMAWAO (octubre 2026)

## Fuente y correspondencia

La base de datos PostgreSQL contiene las importaciones de SQL Server en `farmatic.lineaventa`.
No mover, truncar ni recrear esta tabla. Sus campos relevantes son
`farmacia_origen` (código textual), `codigo` (CN de seis cifras, texto),
`fechahora`, `cantidad`, `descripcion`.

La API relaciona `upper(trim(lineaventa.farmacia_origen))` con
`public.farmacias.codigo_origen`; internamente sigue usando `farmacias.id`
(entero 1–5). Correspondencia maestra existente:
1=ABA, 2=EUR, 3=BUE, 4=EST, 5=POL.
Esto permite usar más adelante el mismo ID en la autorización por farmacia.

## Requisitos de despliegue

El frontend web se despliega al actualizar `main`. La API **no** se despliega con
el workflow del frontend: hay que activar el backend con el workflow manual
`Activar backend de farmacias (manual)` una vez configurada la autenticación
Microsoft Entra. Consultar `docs/despliegue-farmacias.md`.
El backend necesita `DATABASE_URL` del PostgreSQL existente, y se ejecuta
dentro de la red de Docker del VPS. No se envían claves de PostgreSQL al frontend.

La API exige JWT válido y `ADMIN_OIDS` para los endpoints de ventas y maestro.
No publicar las rutas de ventas sin autenticación.
El acceso con Google y permisos por farmacia requiere su propia configuración
OAuth, perfiles autorizados y reglas de acceso del servidor; NO está activo aún.

## API solo agregada (sin tickets ni clientes)

- `GET /api/ventas/cobertura`: líneas y primer/último registro por farmacia.
- `GET /api/ventas/catalogo?desde=2026-10-01&hasta=2026-10-31`:
  primeros 50 CNs reales por unidades netas de octubre.
- `POST /api/ventas/seguimiento`: cuerpo
  `{"promotions":[{"id":"P1","start":"2026-10-01","end":"2026-10-31","cns":["877399"]}]}`.
  Respuesta con unidades netas por ID numérico de farmacia y promoción.
  Fechas inclusivas por día y venta neta: se restan devoluciones.

No se devuelven tickets, identificadores de clientes ni de vendedores.
Se utilizan consultas parametrizadas y ventanas de fechas acotadas.

## Estado de la demo

- Botón «Importar Excel»: marcador de posición hasta recibir el fichero de entrada.
- Tipos de promoción: catálogo inicial editable a futuro, con parámetro X %.
- Activación: exige CNs, tipo y objetivos enteros positivos en cada farmacia
  participante; si el tipo lleva porcentaje, también lo exige.
- Objetivos: se editan manualmente. El incremento del 5 % solo se aplica al
  pulsar «Aplicar», sobre los objetivos actualmente escritos. No hay todavía
  cálculo desde tres meses de ventas.
- Botón «Ejemplo con 20 CNs reales»: crea un borrador de 20 CNs obtenidos del
  catálogo de ventas de octubre, si la API está conectada. No se afirma que
  pertenezcan a un mismo proveedor: no hay maestro de artículos/proveedores
  conectado en esta iteración.
- Las promociones y usuarios siguen siendo un prototipo guardado en el
  navegador; las ventas no se guardan en localStorage, se leen de PostgreSQL.
- La exportación de tickets y simulaciones comerciales 2×1 / 3×2 se aplaza
  hasta recibir el Excel de ejemplo. No alterar nunca las ventas reales:
  cualquier ajuste documental se debe representar por separado y con trazabilidad.

## Verificación en el VPS (ejecutar con permisos de lectura)

```sql
SELECT f.id, f.nombre, f.codigo_origen,
       count(v.*) AS lineas,
       min(v.fechahora) AS primera, max(v.fechahora) AS ultima
FROM public.farmacias f
LEFT JOIN farmatic.lineaventa v
  ON upper(btrim(v.farmacia_origen::text))=f.codigo_origen
GROUP BY f.id, f.nombre, f.codigo_origen
ORDER BY f.id;
```

No se han leído datos del VPS desde este chat. Las cifras solo se podrán
confirmar en la web cuando la API autenticada esté desplegada y conectada.


## PostgreSQL y Google son independientes

PostgreSQL se aloja en la misma máquina de Contabo que FARMAWAO y está en el
servicio Docker `db`. La API utiliza su `DATABASE_URL` privada (dentro de
Docker, hostname `db`; `localhost` apuntaría al contenedor API, NO a PostgreSQL).

El proceso de API **ya no necesita** Google OAuth ni Microsoft Entra para arrancar
o comprobar PostgreSQL. El endpoint público `GET /api/health/database` devuelve
únicamente si puede consultar `farmatic.lineaventa`, sin registros ni métricas.
El workflow despliega exclusivamente la API si su conexión privada y la tabla
Farmatic están preparadas; no reconstruye PostgreSQL ni la web y guarda una copia
de seguridad del código anterior.

**Seguridad:** hasta configurar Google y entrar como administrador, las rutas
`/api/farmacias`, `/api/ventas/*`, `/api/admin/*` y el detalle de tickets
devuelven 401/403. Que la API tenga conexión interna no hace público el contenido
de las ventas. Google solo verifica la identidad: la aplicación no recibe ni
almacena la contraseña de Google.

Al verificar un despliegue, comprobar:
```sh
curl -fsS https://TU_HOST/api/health/database
# {"status":"ok","database":"connected"}
```
El resultado anterior es el esperado, no una afirmación de que el VPS
esté configurado hasta confirmar la ejecución del workflow.
