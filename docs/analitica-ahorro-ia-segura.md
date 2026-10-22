# Analítica económica e IA segura en FARMETRICA

## Objetivo
Responder a preguntas sobre facturación, precios realmente pagados a proveedores, existencias y ahorro potencial **sin calcular porcentajes ficticios** ni exponer la base de datos a terceros.

## Fuentes
- `{esquema}.fm_ventas_analitica`: ventas netas documentales; traspasos salientes sólo si están correctamente identificados mediante los mapeos ERP vigentes.
- `{esquema}.fm_recepciones_analitica`: recepciones netas y coste neto unitario documentado.
- `{esquema}.proveedores`: código y nombre de proveedor de **esa farmacia**.
- `farmetrica.proveedores_maestro`: indicadores manuales de cooperativa e ignorado, tras verificar código y nombre del catálogo local.
- `{esquema}.articulos`: última fotografía de stock y coste PMC, con fallback a PUC positivo.
- `farmetrica.op_politicas_reposicion`: cobertura objetivo explícita de cada farmacia.

## Endpoints existentes en esta propuesta
Todas las rutas requieren **cookie de sesión válida**, tenant habilitado y rol administrador/superadministrador con acceso a los módulos Ventas, Compras y Stock. No admiten SQL dinámico ni datos de pacientes.

- `GET /api/analytics/ahorro/resumen?desde=AAAA-MM-DD&hasta=AAAA-MM-DD&farmacias=1,2`: importes netos, cobertura de precios, canales verificados y fotografía de stock. No devuelve filas de venta individuales.
- `GET /api/analytics/ahorro/precios?desde=...&hasta=...&farmacias=...&limite=25`: compara únicamente PUC medios ponderados del mismo artículo ERP dentro de la misma farmacia, realmente comprado a ambos canales; devuelve un diferencial histórico agregado y las 25 mejores oportunidades para auditar.
- `GET /api/analytics/ahorro/stock?desde=...&hasta=...&farmacias=...`: capital sin ventas en el período y capital por encima de una cobertura **configurada** de inventario. No lo suma a ahorro recurrente.

Los períodos admiten hasta 367 días. Las consultas se hacen en transacciones PostgreSQL de `READ ONLY`, con `statement_timeout` y `lock_timeout`. No hay credenciales nuevas ni rutas públicas a PostgreSQL.

## Interpretación y límites de la estimación
1. El **diferencial de PUC** indica cuánto más se pagó históricamente a cooperativas que a proveedores no cooperativos identificados, **sobre las unidades compradas a cooperativa**. Requiere dos líneas observadas por canal para el indicador contrastado. Puede no ser repetible por condiciones comerciales, rappel, portes, mínimos, stock del proveedor y cambios de precio.
2. Un proveedor marcado como *no cooperativa* no queda demostrado por eso como laboratorio fabricante. No se incluye ningún proveedor con código o nombre local sin correspondencia confiable.
3. Las diferencias en el coste **no se proyectan** a artículos que no tengan ambos precios en recepciones: es una cota histórica respaldada, no un ahorro total universal.
4. El **capital liberable** es dinero en existencias que podría reducirse o rotarse; no es beneficio del ejercicio. El cálculo no ordena destruir ni transferir mercancía y debe revisar caducidades, continuidad asistencial, estacionalidad y suministro.
5. Si falta importe de una compra/venta o valoración de stock, se devuelve `null` y cobertura parcial, **nunca un cero inventado**.
6. Los movimientos internos entre farmacias deben estar correctamente mapeados en Farmatic; la exclusión por proveedor sigue las reglas existentes de `ignorar_informes`.

## IA presente y futura
El asistente **interno** existente en `/api/asistente/chat` puede usar la nueva herramienta `ahorro_economico`, siempre que `AI_ENABLED=true` y el modelo local estén operativos. El LLM no escribe SQL: sólo selecciona herramientas permitidas y recibe resultados agregados.

**Esta API no establece por sí sola una conexión de ChatGPT a la sesión del navegador.** Para conectar un asistente externo se debe crear y autorizar explícitamente un conector MCP/OAuth con consentimiento de cliente, alcance de solo lectura, scopes por farmacia, caducidad y revocación de tokens, auditoría, cuotas y rate limiting. No se deben enviar contraseñas de PostgreSQL, claves SSH, cookies del navegador ni secretos de GitHub a ChatGPT, ni crear un token estático o endpoint público para eludir la autenticación.

## Comprobaciones antes de activar en producción
- `node --test api/src/savingsAnalysis.test.js`: autorización, aislamiento, no sustituir valores ausentes por 0, transacciones de sólo lectura.
- `FM_SAVINGS_PG_TEST=1 DATABASE_URL=postgresql://... node --test api/src/savingsAnalysis.pg.test.js`: PostgreSQL 16 efímero con compras sintéticas; no consulta datos productivos.
- Validar tiempo de respuesta anual por farmacia, la calidad del maestro de proveedores y una muestra representativa de PUC/reintegros/bonificaciones frente a Facturas Farmatic.
- Verificar que no existen duplicados de proveedor normalizados (0005/5) ni colisiones de nombres que dupliquen importes.
- Activar en producción solamente con CI correcta, despliegue controlado y métricas revisadas.
