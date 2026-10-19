# Farmétrica · activar el asistente local (Contabo)

## Estado de la integración

El asistente funciona con las sesiones de Farmétrica y con su selección de cliente. Se puede escribir una pregunta, recibir respuesta de **Ollama** y utilizar herramientas analíticas de solo lectura sobre ventas, compras, artículos y una estimación del capital en stock. El cálculo de margen real, las consultas SQL libres y las investigaciones causales amplias **todavía no están implementados**; el asistente debe indicarlo cuando falten datos. No se inventan cifras. El historial permanece en memoria de la pestaña.

La interfaz muestra solo «Asistente» y no necesita otro dominio ni puerto público. El backend comunica con contenedores internos por la red Docker.

## Arquitectura

- web: React existente, chat flotante, dictado con transcripción editable.
- api: Express existente, rutas GET /api/asistente/estado, POST /api/asistente/chat y POST /api/asistente/transcribir. Todas las rutas exigen sesión y cliente autorizado.
- PostgreSQL: consultas SQL fijas con identificador de esquema validado, filtros de farmacias autorizadas y transacciones READ ONLY de como máximo cinco segundos.
- ollama: servicio independiente, sin puerto publicado, un solo modelo y una petición simultánea.
- whisper: **opcional**, contenedor separado para transcripción local en español. Si está desactivado, el navegador puede ofrecer reconocimiento propio (según navegador/proveedor puede usar la nube).

## Requisitos previos

Comprobar la memoria y el disco libres. Con 8 GB RAM y 4 vCPU no activar IA y Whisper simultáneamente para muchos usuarios sin medir la carga. Se recomienda primero activar solo Ollama con un modelo de aproximadamente 1–2B y **un usuario a la vez**. La API aplica una petición de IA o transcripción concurrente por proceso, ocho peticiones por usuario cada diez minutos. Los límites Docker son topes, no reservas ni garantías. No publicar los puertos 11434 ni 8080 al exterior. Mantener una copia de seguridad verificada antes de recrear contenedores de producción.

El GitHub Actions de FM copia deploy/compose.asistente.yml a /opt/farmawao/compose.asistente.yml. Si no existe, **no iniciar los comandos hasta tener ese fichero**. La configuración normal se encuentra en /opt/farmawao/compose.yaml y compose.farmacias.yml; nunca borrar volúmenes PostgreSQL.

## Paso 1. Ollama

Entrar mediante SSH en Contabo con tu usuario administrativo y ejecutar:

~~~bash
cd /opt/farmawao
free -h
nproc
df -h
test -f compose.yaml && test -f compose.farmacias.yml && test -f compose.asistente.yml
docker compose -f compose.yaml -f compose.farmacias.yml -f compose.asistente.yml config --quiet
docker compose -f compose.yaml -f compose.farmacias.yml -f compose.asistente.yml up -d ollama
docker compose -f compose.yaml -f compose.farmacias.yml -f compose.asistente.yml exec ollama ollama pull qwen3:1.7b
docker compose -f compose.yaml -f compose.farmacias.yml -f compose.asistente.yml exec ollama ollama list
~~~

Si la memoria libre no es suficiente, **no continuar**. No instalar Ollama dentro del contenedor PostgreSQL ni del contenedor web.

## Paso 2. Activar la API

En /opt/farmawao/.env, añadir o actualizar:

~~~dotenv
AI_ENABLED=true
AI_MODEL=qwen3:1.7b
AI_VOICE_ENABLED=false
~~~

El origen de Ollama se configura internamente como http://ollama:11434 desde compose.farmacias.yml. Luego:

~~~bash
cd /opt/farmawao
docker compose -f compose.yaml -f compose.farmacias.yml -f compose.asistente.yml config --quiet
docker compose -f compose.yaml -f compose.farmacias.yml -f compose.asistente.yml up -d --build --no-deps api web
docker compose -f compose.yaml -f compose.farmacias.yml -f compose.asistente.yml ps
docker compose -f compose.yaml -f compose.farmacias.yml -f compose.asistente.yml logs --tail=60 api ollama
~~~

Después, iniciar sesión y abrir el asistente. La ruta /api/asistente/estado requiere sesión; una respuesta 401 sin iniciar sesión es correcta, no un fallo de Ollama. No habilitar el asistente en una demo pública sin validar las reglas de acceso y anonimización.

## Paso 3. Cambiar el modelo

Sin modificar código:

~~~bash
cd /opt/farmawao
docker compose -f compose.yaml -f compose.farmacias.yml -f compose.asistente.yml exec ollama ollama pull qwen3:0.6b
~~~

Cambiar AI_MODEL=qwen3:0.6b en /opt/farmawao/.env y aplicar:

~~~bash
docker compose -f compose.yaml -f compose.farmacias.yml -f compose.asistente.yml up -d --no-deps api
~~~

**Se cambia entre modelos compatibles con la API de Ollama**, no entre proveedores arbitrarios sin adaptar el conector. Los modelos deben estar descargados en el contenedor. Volver al modelo anterior también es cuestión de modificar AI_MODEL y recrear api. El rendimiento y la capacidad analítica varían por modelo.

## Paso 4 (opcional). Transcripción local

Cuando se haya confirmado memoria suficiente y el chat vaya estable:

~~~bash
cd /opt/farmawao
docker compose -f compose.yaml -f compose.farmacias.yml -f compose.asistente.yml --profile voice run --rm whisper download-ggml-model.sh base /models
docker compose -f compose.yaml -f compose.farmacias.yml -f compose.asistente.yml --profile voice up -d whisper
~~~

Cambiar AI_VOICE_ENABLED=true en /opt/farmawao/.env, luego:

~~~bash
docker compose -f compose.yaml -f compose.farmacias.yml -f compose.asistente.yml --profile voice up -d --no-deps api
docker compose -f compose.yaml -f compose.farmacias.yml -f compose.asistente.yml --profile voice logs --tail=60 whisper api
~~~

En modo local, el navegador graba audio con MediaRecorder y lo manda por HTTPS solo a la API de Farmétrica. La API convierte temporalmente el audio a WAV mediante ffmpeg, consulta whisper-server y elimina el WAV. El texto resultante se introduce en el compositor para que el usuario lo corrija antes de enviar. No se guardan audios en disco persistentemente. **El procesamiento simultáneo de voz y chat está limitado para proteger los recursos del VPS.**

Si se desactiva la voz local, el dictado basado en Web Speech API del navegador puede procesarse en servidores de terceros; está indicado en la interfaz. Para entornos con requisitos estrictos de privacidad es preferible activar únicamente la transcripción local o deshabilitar el dictado externo mediante una futura política de producto.

## Paso 5. Diagnosticar la web si no muestra la interfaz

1. En GitHub, comprobar el estado del último workflow **Build and deploy Farmetrica SaaS** de main; el merge por sí solo no demuestra que Contabo haya recibido la build.
2. Revisar que el job «Actualizar API y web en el VPS» y los checks posteriores hayan terminado sin errores.
3. Desde el servidor: docker compose -f compose.yaml -f compose.farmacias.yml ps; docker compose -f compose.yaml -f compose.farmacias.yml logs --tail=100 web api
4. Abrir Farmétrica con sesión y hacer recarga forzada del navegador (Ctrl+F5). El asistente no aparece en la página comercial ni en /login.

## Seguridad y límites conocidos

- La identidad del cliente y el esquema proceden únicamente del middleware tenant de Farmétrica, nunca del modelo.
- La IA solo puede invocar herramientas SQL preprogramadas. No puede ejecutar SQL libre, escribir, modificar promociones ni saltarse permisos.
- Se usa timeout de consultas y límites de tamaño, duración, concurrencia y velocidad de solicitudes.
- La estimación de capital en stock **no demuestra** que exista sobrestock; calcular riesgo o causas requiere modelos de negocio adicionales.
- El coste de compras puede ser nulo si las recepciones solo tienen cabeceras y no líneas con importes. No sustituir valores ausentes por números inventados.
- No se han ejecutado pruebas de carga en el VPS real; antes de habilitar a todos los clientes, evaluar CPU, RAM, disco y respuesta de login/reportes con sincronizadores activos.
