# FARMÉTRICA · Fuente de datos compartida y configuración por cliente (14/11/2026)

## Decisión revisada
Para Ampedia y las dos demostraciones comerciales, **una única importación de datos y ninguna copia de movimientos**. Los tres clientes tendrán identidades y configuraciones distintas, pero los esquemas demo consultarán datos del origen a través de vistas read-only y siempre se limitarán a las farmacias habilitadas para cada demo.

Para clientes reales futuros se mantiene la opción de base de datos PostgreSQL **independiente por cliente**; esta fase no la crea ni altera el destino actual del sincronizador. La idea de una "base de configuración" es correcta **lógicamente**: hoy vive sobre todo en el esquema `farmetrica` dentro de la misma BD. Moverla físicamente a otra BD **no es trivial** y se pospone.

## Inventario de lo que existe
| Lugar | Ejemplos | Naturaleza |
|---|---|---|
| `ampedia` | Ventas, recepciones, artículos, documentos y snapshots | Datos ERP reales |
| Esquemas demo | `ventas`, `compras`, `articulos`, `proveedores`, `productos`, `stock` | Vistas enlazadas; no copias de grandes tablas |
| `farmetrica` | `clientes`, `usuario_clientes`, `farmacias`, `cliente_modulos`, `cliente_apariencia`, `preparador_configuracion_cliente`, `transferidor_configuracion_cliente` | Configuración separada por `cliente_slug` |
| `farmetrica` | `dashboard_consolidados_mensuales`, `ventas_panorama_mensual`, `proveedores_unificados`, `familias_globales`, tareas, promociones, perfiles | Datos derivados, maestros compartidos o actividad; **no son sólo configuración** |
| `public` | `acceso_cuentas`, `farmacias` heredado, `stock_farmacia` | Compatibilidad técnica; inventariar antes de extraer |
| API `server.js` | Un único `pg.Pool` `DATABASE_URL` | Aún no hace routing a DB física distinta |

El código ya implementa pertenencia por tenant, módulos, perfiles, apariencia visual y configuración parcial por cliente. Existe `demo_origen_slug` y un creador de demos con vistas de lectura. Este creador **no clona todo el modelo documental**, por lo que no cabe prometer que todas las pantallas equivalen hoy a producción.

## La topología de las 3 experiencias
```
    FarmetricaSync -> esquema ampedia: datos ERPs actualizados
                                |
                 +--------------+--------------+
                 |              |              |
             Ampedia        Demo Grupo     Demo Individual
           esquema real     vistas origen   vistas origen
                 |              |              |
                 +--------------+--------------+
                                |
          farmetrica: clientes / farmacias / permisos / marca /
             módulos / reglas / personalizaciones por slug
```

- Ampedia: mismas farmacias, nombres, módulos, rutas y cálculos de siempre; no cambiar importador.
- Demo Grupo: todas las farmacias elegidas, alias y códigos visibles ficticios. Datos reales consultados por vistas.
- Demo Individual: catálogo de farmacias del mismo dataset pero exactamente una marcada activa. Debe restringirse **en contexto de API** (`allowedPharmacyIds`) y no sólo ocultarse en el menú. Cada agregación, filtro, exportación, informe, IA y caché debe respetar el subconjunto.
- Por seguridad la edición de demo debe mantener un camino administrativo que muestre tanto las farmacias activas como las deshabilitadas, para permitir reactivación.

**Advertencia:** cambiar sólo los nombres de farmacias **no anonimiza** cifras, artículos, proveedores, empleados o patrones comerciales. La demo enlazada se considera privada, limitada a destinatarios autorizados; no es apta automáticamente para prospects externos ni para difusión pública. Antes de ampliar acceso, revisar campos, exports, CSV, MCP, texto libre, metadatos y permisos contractuales; utilizar sintéticos para los datos que no puedan compartirse.

## Personalizaciones: cómo añadirlas sin forks
1. **Marca y experiencia:** reutilizar `cliente_apariencia` (nombre, logo, colores), nombres y farmacias de `farmetrica.farmacias`.
2. **Licencias y acceso:** reutilizar `cliente_modulos`, asignaciones por usuario, perfiles y secciones. Los permisos son verificaciones de backend, no sólo menú.
3. **Parámetros:** reutilizar tablas dedicadas a cobertura de preparador, política de transferidor, exposiciones, análisis de ventas, etc. Cada una se filtra por `cliente_slug`.
4. **Variantes funcionales:** usar `cliente_personalizaciones` (migración 064) como registro **inactivo** hasta implementar soporte en cada módulo. Ejemplo futuro: `transferidor` variantes `estandar` o `con_reserva`, con un contrato tipado, validación de parámetros y pruebas de regresión. Ausencia de variante significa comportamiento histórico. No aceptar SQL ni JavaScript de clientes.
5. **Perfiles:** hoy `farmetrica.perfiles` son globales; si las farmacias necesitan perfiles distintos por cliente habrá que añadir perfiles específicos o clonables sin modificar plantillas globales.

## Separación física futura de configuración y datos
PostgreSQL no permite `JOIN` directo entre dos bases independientes. Actualmente muchas consultas cruzan `farmetrica.farmacias`/`farmetrica` maestros con `ampedia` movimientos dentro de **la misma transacción y conexión**. Extraer el esquema `farmetrica` como base física de configuración no es sólo cambiar `DATABASE_URL`:

- Crear un **plano de control** con clientes, sesiones, módulos, permisos y destino de datos. El backend verifica el cliente y selecciona el pool de datos de una lista permitida de alias de conexión secretos.
- Dejar en el **plano de datos** tablas de movimientos, documentos, snapshots, agregados e índices necesarios para calcular cada reporte.
- Introducir en las consultas un pequeño contexto de farmacias autorizadas resuelto por API; no hacer `JOIN` a tablas del control en otra BD. Mantener un catálogo técnico local versionado si el SQL del ERP lo requiere.
- Decidir qué tablas `farmetrica` de negocio deben trasladarse o sincronizarse por cliente; no mover a ciegas `familias_globales`, `ventas_panorama_mensual`, `preparador_pedidos_realizados`, catálogos y caches.
- Desplegar por etapas con pruebas E2E, sin fallback silencioso al pool de Ampedia. Aislar secretos, backups, restauración y borrado por cliente.

## Cambios de esta rama (seguros y parciales)
- Nuevo `064` **aditivo**: registro de modo de almacenamiento futuro y variantes por cliente; ninguna conexión, importación o algoritmo cambia al crear las tablas.
- `tenantScopedPharmacyIds`: en demos las farmacias deshabilitadas salen de `allowedPharmacyIds` y del contexto operativo. Ampedia conserva comportamiento heredado.
- Ruta superadmin de catálogo completo de farmacias demo, incluyendo inactivas, para administrarlas sin alterar origen.
- Panel de clientes: nombre, código visible (p. ej. `PER`) y checkbox de visibilidad para cada farmacia demo; se impide quitar la última farmacia activa.
- En las respuestas API de demos, los campos identificadores de farmacia se sustituyen por sus alias configurados; los códigos ERP reales se conservan únicamente para consultas internas.
- La creación de nuevas demos permite elegir todas las farmacias o una sola. `065` aprovisiona la demo individual de Ampedia de manera idempotente y enlaza vistas de tablas documentales; sin copiar movimientos.
- Se aclara en la interfaz la distinción entre «nuevo esquema dentro de la BD» y «demo con vistas a datos reales». Se evita decir que ya se crea una BD física independiente.

## Pendiente antes de crear/demo comercial
1. Auditar exhaustivamente las pantallas y APIs que consultan ventas, compras, transferidor, preparador, stock, rentabilidad, dashboards, caché, exportaciones, asistente y MCP. Localizar SQL que no filtra por las farmacias activas; corregirlo de forma compatible.
2. Validar igualdad de resultados de Demo Grupo frente a Ampedia en mismo período, salvo nombres/permisos; Demo Individual debe producir métricas calculadas para una sola farmacia.
3. Ampliar las vistas/catálogo derivados para que los módulos modernos de documentos y analítica tengan la misma cobertura de datos; comparar índices y planes para medir coste de las vistas.
4. El script aditivo `065` prepara `demo_individual` con exactamente una farmacia activa, por defecto la primera de Ampedia, y repara vistas documentales faltantes de las demos existentes. No crea usuarios ni credenciales para terceros. Comprobar el resultado en staging y producción antes de habilitar accesos externos.
5. Añadir gestión tipada y en UI de variantes por cliente, comenzando por transferidor y preparador; el cálculo actual sigue siendo predeterminado.
6. Para futuro cliente real, diseñar router de BDs y migrador idempotente antes de conectar el sincronizador de ese cliente.

## Verificaciones y rollback
- Ejecutar CI: unitarias de ámbito demo, migración `064` dos veces, integración PostgreSQL de clientes y smoke de frontend.
- No modificar `main` ni despliegue de producción hasta revisión, copia de seguridad y tests. La demo enlazada NO es anonimización comercial completa: otros campos pueden conservar datos confidenciales.
- Revertir código/UI detiene el cambio de ámbito; la migración 064 es aditiva y no obliga a borrar tablas.
- Las demos enlazadas consultan el **mismo dataset real**: su rendimiento no es automáticamente gratuito. Medir actividad y concurrencia en PostgreSQL antes de compartir accesos.
