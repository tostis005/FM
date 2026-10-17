# Farmétrica · Importación de promociones y exportación al laboratorio

## Documentos fuente analizados
- `PROMOCIONES ABADIA OCTUBRE 2026.xlsx`: hojas **RESUMEN** (65 entradas con contenido de laboratorio/gama), **LISTADO CN PROMOCIONES** (958 referencias, 44 grupos comerciales), **OBJETIVOS OCTUBRE 2026**, **TOP 10**, **INCENTIVOS**.
- `VICHY ROSTRO (AGOSTO 2026) DTO 40% EN 2ª UD.xlsx`: **Export** (14 columnas con tickets, farmacia y vendedor) y **Hoja1** (catálogo CN, descripción, PVP).

## Importación
La pantalla **Promociones → Importar Excel** procesa `.xlsx` en el navegador, con tamaño máximo de 15 MB, y exige **RESUMEN** y **LISTADO CN PROMOCIONES**. Concilia grupos de CN con promociones de RESUMEN solo si la correspondencia es suficientemente clara. Si hay diferencias de laboratorio, gama o fechas, crea borradores marcados para revisión y no mezcla referencias automáticamente.

La importación siempre genera **Borradores** con objetivo por farmacia vacío; nunca importa la hoja OBJETIVOS automáticamente. Activar exige al menos un CN, clasificación válida, fechas completas y objetivos positivos de todas las farmacias participantes (y porcentaje/importe cuando lo requiere el tipo).

**Antiduplicados:** huella semántica de laboratorio + gama + texto de oferta + inicio + fin; el nombre o nombre del archivo no determina unicidad. Reimportar la misma promoción omite duplicados; cuando el mismo identificador incorpora más CNs, los amplía conservando los objetivos editados. Los grupos inciertos se mantienen separados y etiquetados para revisión. El fichero aporta el año si su nombre incluye `20XX`.

Se incorporan doce ejemplos de promociones reales, con un subconjunto de CNs del Excel de octubre; al importar el fichero completo se amplía el listado de estos grupos.

**Limitación actual:** al igual que el módulo de promociones previo, los borradores y cambios de importación se guardan en el navegador (`localStorage`), no todavía como promociones compartidas en PostgreSQL. Por tanto, subir el archivo en un navegador no lo publica en todos los dispositivos. El backend real de ventas permanece protegido y exige configurar Google en el VPS.

## Tipos detectados
- 2×1 y 3×2;
- porcentajes sobre cualquier unidad, y sobre segunda unidad;
- descuentos fijos en euros, desde la primera unidad o segunda;
- 4+1 / 3+1;
- descuentos escalonados por cantidades;
- regalo por compra;
- sin clasificar cuando no existe una interpretación única.

Se conserva siempre el texto original para revisión. No se simulan descuentos sobre los tickets originales.

## Seguimiento real y exportación de laboratorio
Nueva tabla **Detalle de ventas para laboratorio** debajo del seguimiento de las promociones seleccionadas, con selector de promoción, farmacia, CN, desde/hasta y búsqueda de ticket. Endpoint `POST /api/ventas/detalle` protegido para administradores, con `offset/limit` y 500 líneas máximas por petición. Los datos proceden de `farmatic.lineaventa`, cruzada con `public.farmacias.codigo_origen` mediante `farmacia_origen`.

Campos originales: `idventa`, `idnlinea`, `fechahora`, `numerodoc`, `xvend_idvendedor`, `codigo`, `descripcion`, `pvp`, `cantidad`, `importebruto`, `descuentolinea`, `importeneto`.

**Exportar formato laboratorio** genera un archivo `.xlsx` con las hojas `Export` y `Hoja1`. En `Export` las columnas y orden reproducen el ejemplo Vichy: NOMBRE FARMACIA, VENDEDOR, IdVenta, NumeroDoc, FECHA, HORA, Codigo, Descripcion, Pvp, Cantidad, ImporteBruto, DescuentoLinea, ImporteNeto, %DTO LINEA. Los valores son los originales del ticket; %DTO LINEA se calcula como valor absoluto del cociente DescuentoLinea / ImporteBruto. La segunda hoja incluye CN, descripción y PVP.

La tabla de ventas dispone del **ID de vendedor**, pero aún no del nombre: Excel coloca `ID N` para no inventarlo. Conectar el maestro de vendedores de Farmatic permitirá sustituirlo.

**Privacidad y auditoría:** los tickets no se almacenan en el navegador; la API exige rol administrador y usa parámetros SQL. No se exponen datos de clientes. No se alteran importes/descuentos de Farmatic ni se representan ajustes teóricos como descuentos efectivamente aplicados. Si se implementan liquidaciones de laboratorio con descuentos simulados, deberán usar un cálculo explícito y auditado separado.

## Bloqueador para datos reales
La infraestructura existente de Contabo **todavía no tiene configurado `GOOGLE_CLIENT_ID`**, según la última comprobación automatizada. El workflow omite desplegar API si falta configuración. Hasta completar Google OAuth, secreto de sesión, correo de administrador y activar la API, el seguimiento NO podrá leer tickets de PostgreSQL. No se publicará una ruta anónima a los tickets.

## Pendiente para cierre funcional
1. Configurar Google/SMTP y desplegar la API en VPS.
2. Verificar los cinco códigos de farmacia (`ABA`, `EUR`, `BUE`, `EST`, `POL`) y CNs de ejemplo contra filas reales de octubre.
3. Persistir promociones compartidas y objetivos en PostgreSQL (actualmente prototipo local).
4. Validar con laboratorio ajustes comerciales teóricos y obtener tabla de vendedor para mostrar nombres.
5. Revisar manualmente grupos ambiguos, fechas de fin de existencias y tipos especiales del Excel.
