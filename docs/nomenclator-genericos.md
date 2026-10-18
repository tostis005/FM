# Genéricos: Nomenclátor oficial AEMPS

## Fuente y modelo
- Fuente: AEMPS, Nomenclátor de Prescripción, `https://listadomedicamentos.aemps.gob.es/prescripcion.zip`.
- Descripción técnica: `https://listadomedicamentos.aemps.gob.es/Desc_Tecnica_Nomenclator.pdf` (versión 15, agosto de 2025).
- ZIP con `Prescripcion.xml`, diccionarios DCSA/DCP/DCPF, laboratorios y otras tablas.
- Se usa `cod_nacion` → `cod_dcpf` como conjunto comparable de **mismo principio activo, dosis, forma y tamaño de envase**; `cod_dcp` y `cod_dcsa` se conservan para análisis futuros de niveles superiores. `sw_generico` identifica EFG de modo oficial. Un DCPF solo entra en Genéricos si contiene al menos un medicamento clasificado como genérico.
- **No agrupar solo por molécula para comparar PUC de envases diferentes.**
- La base del Nomenclátor se actualiza diariamente; el sistema comprueba el ZIP el día 4 de cada mes y lo importa solo si cambia su SHA-256. También puede ejecutarse en GitHub → Actions → Actualizar Nomenclator AEMPS (workflow_dispatch). La incorporación inicial se intenta automáticamente en el primer push a main de los archivos `deploy/nomenclator/**`.

## Persistencia y seguridad
- `farmetrica.nomenclator_presentaciones` contiene CN, descripciones y claves de equivalencia de referencia. Es global; nunca contiene ventas, compras, precios de compra ni datos personales de farmacias.
- `farmetrica.nomenclator_versiones` mantiene metadatos SHA, fecha fuente y fecha importación.
- `ampedia.ventas` y futuras `<esquema>.ventas`: sumas de unidades e importes por DCPF; solo farmacias autorizadas del cliente.
- `<esquema>.compras`: costes PUC **observados en compras**, ponderados por unidades; proveedor relacionado con la compra. Si no hay datos reales en la tabla, el panel no muestra costes ni ahorro simulado.
- `<esquema>.productos`, cuando existe y expone `id,cn`, sirve como correspondencia del identificador ERP al CN. Sin esta correspondencia, solo se cruzan `articulo_id` y `producto_id` si contienen directamente el CN.
- Rutas protegidas `/api/genericos/estado`, `/api/genericos/conjuntos` y `/api/genericos/conjuntos/:dcpf`. Siempre se valida sesión, habilitación del módulo, tenant y farmacias autorizadas.
- Importación atómica: download + validación ZIP/XML + mínimo 5.000 presentaciones y 1.000 EFG + comprobación de CN únicos; tabla temporal PostgreSQL y transacción. Si descarga, validación o importación falla, queda la última versión vigente (no poner a cero ni borrar datos). Nunca se imprimen precios de farmacia ni credenciales en logs.

## Pruebas y despliegue
- `python3 -m unittest discover -s deploy/nomenclator -p 'test_*.py'`.
- `node --check api/src/genericos.js`, `npm run build` en web.
- Migración 010 idempotente aplicada por `.github/workflows/deploy.yml`.
- El workflow `.github/workflows/nomenclator.yml` se despliega aparte y se programa mensualmente.
- En la interfaz `/genericos` los indicadores, tabla y gráfico muestran carga por separado, con versión y atribución visible. El desglose contiene CN oficiales y laboratorio comercializador, proveedor de compra y PUC real.

## Limitaciones que no deben ocultarse
- La fuente AEMPS no contiene **precios de compra de cada farmacia**. Para comparar laboratorios hacen falta las líneas de compras reales y su correspondencia producto-CN. No presentar como oferta real el menor precio histórico observado.
- El Nomenclátor de Prescripción no es exactamente el mismo producto que el Nomenclátor de Facturación del SNS, que añade financiación, agrupaciones homogéneas y precios oficiales. La agrupación actual por DCPF es clínica / de presentación; no se debe afirmar que implica sustitución farmacéutica regulatoria automática.
- Mantener la atribución a AEMPS y revisar las **condiciones de explotación y redistribución** del Nomenclátor antes de ampliar la explotación comercial o permitir descargas completas a terceros. La aplicación no expone el ZIP ni XML originales.
- Fuera de España se implementarán otros catálogos terminológicos; el núcleo comercial de productos/ventas/compras sigue siendo agnóstico del origen.
