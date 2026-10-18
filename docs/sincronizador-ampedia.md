# Sincronización de ventas de Ampedia (octubre de 2026)

## Qué es el origen de datos real
La aplicación desplegada desde **este repositorio, `tostis005/FM`**, tiene dos servicios en el VPS:
- `web`: React/Vite con nginx; la compilación y publicación se hacen en GitHub Actions `deploy.yml`.
- `api`: Node/Express, conectada al PostgreSQL privado mediante `DATABASE_URL`.

El sincronizador externo alimenta `ampedia.ventas` con el contrato estandarizado:
`farmacia_codigo`, `origen_id`, `fecha`, `articulo_id`, `unidades`,
`precio_unitario`, `importe`, `numero_ticket`, `descuento_linea`,
`descuento_operacion`, `sincronizado_en`.

La API **no consulta la estructura interna de Farmatic**. El esquema se obtiene de
`farmetrica.clientes.esquema_datos` y la pertenencia del usuario, nunca de un nombre
de esquema libre enviado por el navegador. Las farmacias se relacionan mediante
`farmetrica.farmacias.codigo_origen` ↔ `ventas.farmacia_codigo`.

## Dónde comprobar la llegada real de datos

Con una sesión de administrador: **Farmétrica → Sincronización**
(ruta `/sincronizacion`). La API `GET /api/ventas/sincronizacion`:
- comprueba conexión, existencia de la tabla y columnas obligatorias;
- muestra recuento de líneas, las recibidas en 90 min / 24 h y última recepción;
- agrupa por farmacia autorizada, y muestra 20 líneas recientes;
- solo lee datos, no activa el servicio ni escribe en ventas;
- refresca automáticamente cada 60 s.

**Importante:** recibir cero filas nuevas no significa necesariamente un fallo:
cuando no existen ventas nuevas, las cargas incrementales pueden terminar bien sin
escribir; si el sincronizador omite duplicados, tampoco actualiza
`sincronizado_en`. Para comprobar que el proceso se ejecuta, revisar sus logs en
el equipo origen. El estado de PostgreSQL sí confirma las filas realmente escritas.

SQL equivalente de lectura en el PostgreSQL del VPS (solo con acceso autorizado):

```sql
SELECT farmacia_codigo, COUNT(*) AS lineas,
       MAX(sincronizado_en) AS ultima_recepcion,
       MAX(fecha) AS ultima_fecha_venta
FROM ampedia.ventas
GROUP BY farmacia_codigo
ORDER BY ultima_recepcion DESC;

SELECT farmacia_codigo,origen_id,fecha,articulo_id,unidades,importe,sincronizado_en
FROM ampedia.ventas
ORDER BY sincronizado_en DESC NULLS LAST
LIMIT 20;
```

## Correspondencias y límites

`articulo_id` identifica el artículo del sistema origen. **No se puede asumir
que sea el CN de seis cifras usado en promociones históricas.** Los seguimientos
comparan identificadores de forma exacta; hasta configurar una correspondencia
explícita, un seguimiento vacío **no demuestra ausencia de ventas**.

La tabla de sincronización no incluye descripción del producto, nombre del
vendedor ni importe bruto original. La API no los inventa: el detalle mostrará
esos campos como no disponibles. `importe` y los descuentos se conservan tal
como los produjo la integración.

Al dar de alta clientes nuevos, `tenant.js` aprovisiona su propia tabla `ventas`
y almacenamiento de promociones. No se necesitan cambios de SQL para modificar
qué esquema utiliza un cliente: se selecciona desde
`farmetrica.clientes.esquema_datos` con permisos.

## Conservación de promociones importadas

La migración **009_promociones_cliente.sql** crea tablas aditivas en `ampedia`:
- `fm_promociones`, almacén JSONB del contenido de promociones importadas,
  códigos, objetivos, advertencias, descripción y fuente.
- `fm_promocion_revisiones`, copia de la versión anterior cuando se guarda
  una modificación.

La migración se ejecuta **después** del cambio de esquema al desplegar desde
GitHub Actions; no borra nada de `localStorage` ni modifica `ventas`.
Las nuevas promociones o importaciones Excel hechas como administrador se
guardan también en PostgreSQL. Para promocionar las campañas que ya existían
en el navegador, abrir **Promociones → Guardar locales**: añade únicamente
IDs que todavía no existen en PostgreSQL. El botón **Copia local** descarga un
respaldo anterior a la conciliación, sin enviarlo a terceros.

El código no puede recuperar datos de `localStorage` de otros navegadores
desde el servidor: deben abrirse esos navegadores y transferir sus campañas
explícitamente. Si una importación no pudo guardarse en PostgreSQL, se
mantiene en el navegador y se muestra el aviso correspondiente.

## Publicación

El repositorio correcto es `tostis005/FM`. La rama `main` ejecuta
`.github/workflows/deploy.yml`: tests, migraciones aditivas y actualización
de servicios Docker del VPS Contabo. No se utiliza GitHub Pages ni Vercel.

El pipeline valida que la web y la API respondan, pero no puede afirmar que
hayan llegado ventas sin consultar `ampedia.ventas`. Para eso sirve la
pantalla autenticada. 
