# Histórico de stock: fase documental

La pantalla **Stock → Histórico de stock** consulta dos fuentes persistentes del sincronizador actual:
- `fm_ventas_analitica`: ventas y devoluciones normalizadas desde `fm_ventas_cabeceras` y `fm_ventas_lineas`.
- `fm_recepciones_analitica`: recepciones y devoluciones, incluyendo exclusiones de proveedores marcados **Ignorar en informes**.

## Cálculo diario

Cada fila representa un día de movimientos documentados de una farmacia del cliente:
- **Unidades vendidas netas**: suma firmada de unidades en las líneas de ventas completas; una devolución resta.
- **Unidades recibidas netas**: suma firmada de unidades de recepciones completas, excluidos proveedores ignorados.
- **Variación documental**: unidades recibidas menos unidades vendidas.
- **Tickets y recepciones**: documentos distintos por sistema de origen y documento, nunca líneas.

El filtro por farmacia se aplica **antes** de agregar, y solo permite farmacias autorizadas.
Las cabeceras pendientes de líneas, anuladas o eliminadas se excluyen según las reglas de las vistas documentales.

## Lo que NO representa

La variación documental **no es** el inventario histórico: la conciliación de existencias necesita inventarios fechados y traspasos, ajustes, mermas y otros movimientos. No se reconstruye el pasado restando ventas del stock actual ni se fabrican tendencias de valoraciones. Cuando el sincronizador incorpore un histórico de inventario contrastable, se podrá añadir en una serie independiente, sin mezclar conceptos.

## Interfaz final

La pantalla ofrece filtros por fecha, búsqueda y farmacia, ordenación SQL sobre todos los registros, paginación, indicadores y tablas con scroll horizontal superior/inferior. No utiliza datos de ejemplo ni ofrece una acción de guardar ficticia.

**SQL nuevo**: no se crean ni modifican tablas; se reutilizan las vistas completas desplegadas. **Recalcular análisis**: no.
