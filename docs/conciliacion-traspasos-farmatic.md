# Conciliación de ventas, compras y traspasos en Farmatic

## Origen real y semántica

En Farmatic, **las recepciones** proceden de `Recep` + `LINEARECEP`;
`Recep.XProv_IdProveedor` es el código del proveedor. Los movimientos que
coinciden con `proveedores_maestro.ignorar_informes` se excluyen ya de
compras, recepciones analíticas, costes asociados y márgenes estimados.

Las **ventas/salidas documentadas** proceden de `Venta` + `LineaVenta`.
`Venta.XClie_IdCliente` es el código del *cliente* de la operación y
`Venta.TipoVenta` solo se conserva como `tipo_venta:<código>`, sin
presuponer que un valor concreto represente un traspaso. Un mismo número en
el maestro de proveedores y en el de clientes **no significa** la misma
persona jurídica ni la misma farmacia.

## Mapeos que sí permiten excluir salidas internas

En **Configuración → Proveedores → Traspasos salientes**:

1. Marcar en el maestro `Ignorar proveedor en informes` para la farmacia receptora.
2. Seleccionar la farmacia que genera la salida, el proveedor interno y el
   `XClie_IdCliente` que el ERP utiliza para registrar envíos a esa farmacia.
3. Realizar la **vista previa** de movimientos por tipo documental para comprobar
   que el ID elegido representa exclusivamente traspasos, no clientes normales.
4. Confirmar expresamente la correspondencia.

Solo con proveedor ignorado **y** mapeo vigente las vistas analíticas de
ventas dejan de incluir las salidas asociadas al cliente ERP indicado. La
exclusión opera en la vista `fm_ventas_analitica`, no sobre las tablas
originales, y se revierte al borrar el mapeo o desmarcar el proveedor.

**Advertencia:** si un mismo `XClie_IdCliente` se utiliza para ventas reales,
no debe asignarse a un mapeo. Hay que identificar primero la semántica real
en Farmatic. Un traspaso también puede estar registrado como ajuste de
stock o movimiento no comercial y no aparecer en `Venta`; no se presupone
que todas las salidas internas sean ventas.

## Conciliación de unidades (no es una ecuación de stock)

Las métricas se deben comparar en el **mismo período y mismas farmacias**:

- Ventas comerciales netas = unidades en `fm_ventas_analitica` tras descontar
  las salidas internas verificadas.
- Compras comerciales netas = unidades recibidas con proveedores **no**
  marcados como ignorados.
- Unidades de recepción excluidas = todas las unidades recibidas menos las
  incluidas comercialmente.
- Unidades salientes excluidas = unidades de líneas de ventas documentales
  originales menos las de la vista comercial.

La diferencia `ventas - compras` **no equivale** a unidades perdidas. Pueden
intervenir stock inicial/final, devoluciones, unidades bonificadas, ajustes,
caducidades, pérdidas, traspasos y ventanas de sincronización incompletas.
Por farmacia, los traspasos producen una salida en una y una entrada en
otra; en consolidado deben neutralizarse sin considerar los precios internos
como ventas ni compras comerciales.

La auditoría `.github/workflows/auditar-brecha-traspasos.yml` realiza
una comparación **solo lectura** de los totales del último año, de las
recepciones excluidas y de la cobertura de CN, sin divulgar operaciones
individuales.

## Códigos nacionales y seguimiento de promociones

`LineaVenta.Codigo` y `LINEARECEP.XArt_IdArticu` son identificadores
internos de artículo. El SELECT estándar de `Articu` del sincronizador
**no trae un CN verificado**: no se puede equiparar un código local de
seis dígitos con un CN por el formato de su texto.

Hasta comprobar la cobertura en `articulos.codigo_nacional` y
`fm_producto_correspondencias.codigo_nacional_normalizado`, las
promociones comparadas únicamente con `articulo_id` pueden **subcontar o
atribuir incorrectamente las ventas**. Hay que disponer de una tabla de
correspondencias validada por farmacia antes de sustituir el cálculo.
