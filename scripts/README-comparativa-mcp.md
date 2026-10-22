# Comparar Qwen, Llama y Gemma usando el MCP real de Farmétrica

**Esto es una herramienta de diagnóstico, NO cambia el asistente ni la rama main.**

El script `scripts/comparar-modelos-mcp.mjs` se ejecuta **dentro del contenedor API**
y realiza, para cada modelo y para cada pregunta:

1. Obtiene `tools/list` del MCP temporal existente.
2. Ejecuta `leer_modelo_temporal` con el enlace revocable (sin pasarlo al modelo).
3. Entrega al modelo un resumen del catálogo semántico autorizado y la pregunta.
4. El modelo genera **su propio** plan JSON de consulta.
5. Ejecuta el plan **sin sustituirlo** usando `consultar_datos_temporales` en el MCP real.
6. Entrega las filas de PostgreSQL al mismo modelo para redactar la respuesta.
7. Imprime plan, filas reales (máximo 10), respuesta, tiempos y diferencias respecto
   al resultado esperado para medir calidad. No inventa cifras ante errores.

Se repiten **las mismas tres preguntas** para todos los modelos: ventas por farmacia
del 22/10/2026, ranking de vendedores del 01/01 al 22/10/2026 y compras por proveedor
del 01/10 al 22/10/2026. Un enlace temporal vigente debe autorizar la cuenta Ampedia
si se quieren usar sus datos.

## Ejecutar en el VPS Ubuntu

Copia **todo el bloque junto**. La contraseña/enlace se solicita sin eco y no queda
dentro del script público. No copies el token en tickets ni conversaciones.

```bash
set -e
umask 077

echo "===== DESCARGAR MODELOS (solo si faltan) ====="
docker exec farmawao-ollama-1 ollama pull llama3.2:1b
docker exec farmawao-ollama-1 ollama pull gemma3:1b

echo "===== DESCARGAR BENCHMARK ====="
ARCHIVO=$(mktemp /tmp/farmetrica-mcp-XXXXXX.mjs)
trap 'unset FM_TEMP_LINK; rm -f "$ARCHIVO"' EXIT
curl -fLsS --retry 2 \
  https://raw.githubusercontent.com/tostis005/FM/test/comparativa-modelos-mcp/scripts/comparar-modelos-mcp.mjs \
  -o "$ARCHIVO"

echo "===== AUTORIZACION TEMPORAL ====="
read -r -s -p "Pega el enlace temporal de Ampedia: " FM_TEMP_LINK
printf '\n'
export FM_TEMP_LINK

echo "===== COMPARAR CON DATOS REALES ====="
docker exec -i -e FM_TEMP_LINK farmawao-api-1 node --input-type=module - < "$ARCHIVO"

echo "===== FIN ====="
```

Para incluir también el modelo anterior 1.7B:

```bash
export FM_MODELS="qwen3:0.6b,qwen3:1.7b,llama3.2:1b,gemma3:1b"
```

Se define antes de ejecutar el bloque y se debe añadir `-e FM_MODELS` al comando
`docker exec` para pasarlo al contenedor.

## Consideraciones

- Se usa `http://127.0.0.1:8000/api/consulta-temporal/mcp` **dentro del contenedor API**;
  no se depende de navegación web ni de un cliente MCP externo.
- El enlace siempre va únicamente en el argumento de las herramientas RPC,
  nunca a Ollama, la respuesta visible, GitHub ni archivos compartidos.
- El benchmark imprime filas comerciales reales en el terminal; revisar antes de compartir.
- Una respuesta sin filas no es un error; el modelo debe explicarlo.
- Un plan incorrecto se marca como tal: el benchmark no corrige el plan por detrás.
- La métrica `consultas MCP + respuestas` mide éxito técnico, **no exactitud del
  texto**. Revisa importes, períodos y nombres antes de elegir modelo.
- El tiempo en CPU puede ser elevado; con los modelos actuales hay que ejecutar
  modelos secuencialmente. No ejecutar con usuarios utilizando el asistente.
- Este código no se ha probado todavía con datos reales de Ampedia porque no se ha
  introducido un enlace temporal válido en esta conversación.

## Ejecutar una prueba aislada sin repetir toda la comparativa

El benchmark usa **num_thread=2** en las dos llamadas a Ollama, igual que el
asistente de producción; no cambia la cuota de CPU de Docker.

Se puede restringir el modelo y la pregunta antes de ejecutar el bloque:
```bash
export FM_MODELS="gemma3:1b"
export FM_TEST_CASES="1"
```
En la invocación al contenedor también hay que añadir las variables:
```bash
docker exec -i -e FM_TEMP_LINK -e FM_MODELS -e FM_TEST_CASES farmawao-api-1 node --input-type=module - < "$ARCHIVO"
```

Los casos 1, 2 y 3 corresponden a ventas por farmacia, vendedores y compras
por proveedor. Solo ejecuta la consulta MCP cuando el plan del modelo coincide
con la intención de la prueba y supera la validación local. Evita confundir
**0 filas de una fuente equivocada** con ausencia real de datos.
