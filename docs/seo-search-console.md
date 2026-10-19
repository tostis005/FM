# SEO técnico y Google Search Console

## Qué queda automático

La web pública usa páginas HTML pre-renderizadas (sin depender del login ni de la SPA
de analítica). Antes de cada `npm run build`, `web/generate-seo.mjs` genera o actualiza
las fichas públicas y `web/public/sitemap.xml`, recorriendo los `index.html`
efectivamente presentes bajo `/soluciones/`, `/integraciones/`, `/blog/`,
`/solicitar-demo/` y `/privacidad/`, además de la portada.

Se excluyen páginas con `noindex`, como `/privacidad/solicitud/`. Las páginas
internas `/dashboard`, `/ventas`, `/compras`, `/promociones`, usuarios,
clientes y API no se incluyen, requieren sesión y emiten cabeceras `noindex`
si llegan a devolverse. El acceso `/login` también tiene `noindex`.

En producción Nginx entrega `/sitemap.xml` con URLs absolutas utilizando el
protocolo y el host públicos de la petición. Sirve `/robots.txt` y anuncia allí
el sitemap. También convierte los `rel=canonical` relativos de las páginas
públicas en URL absolutas sin reescribir los enlaces de navegación.

No hay que editar Nginx por cada nueva ficha; sí debe tener un `index.html`
válido bajo uno de los directorios públicos soportados. El sitemap se actualizará
con el siguiente despliegue.

## Configuración externa necesaria en Google

1. Confirmar qué URL debe ser la principal (por ejemplo, dominio con o sin www)
   y redirigir permanentemente todas las variantes HTTP/HTTPS y www/no-www a
   esa misma URL mediante el proxy frontal. Como la aplicación recibe tráfico
   detrás de un proxy, el proxy debe enviar correctamente `X-Forwarded-Proto`.
   **No dejar dos dominios públicos idénticos sin redirección canónica.**
2. Publicar los cambios, y comprobar en el dominio real:
   - `https://DOMINIO/robots.txt` responde con una línea `Sitemap:` correcta.
   - `https://DOMINIO/sitemap.xml` responde HTTP 200 con XML válido y
     `<loc>https://DOMINIO/...</loc>`, sin el marcador interno de compilación.
   - La portada y una ficha comercial devuelven HTTP 200 sin login, su
     `rel="canonical"` es absoluto y coinciden con las URLs del sitemap.
   - `/login` lleva `X-Robots-Tag: noindex`; una página privada pide login y
     jamás expone contenido privado a un rastreador.
   - `/privacidad/solicitud/` permanece `noindex` y no está bloqueada en
     robots (los robots tienen que poder leer el noindex).
3. En **Google Search Console → Sitemaps**, introducir
   `https://DOMINIO/sitemap.xml` y enviarlo.
4. En **Inspección de URL**, inspeccionar la portada y solicitar indexación
   si procede; repetir en un número reducido de URLs de producto clave.
5. Revisar durante los días siguientes el informe **Indexación → Páginas**
   y corregir 404, redirecciones no deseadas, páginas duplicadas o bloqueadas.

La verificación DNS TXT demuestra la propiedad del dominio, pero no envía el
sitemap ni garantiza indexación. La solicitud en Search Console requiere
acceso a la propiedad de Google; no se automatiza desde el servidor.

## Verificaciones en el repositorio

Desde la raíz:

```sh
cd web
npm install
node generate-seo.mjs
node check-seo.mjs
node check-marketing.mjs
node check-public-links.mjs
npm run build
```

En GitHub Actions se ejecutan las mismas validaciones relevantes y, tras
desplegar, se revisan las URLs públicas del sitemap y la respuesta real de
`robots.txt`. No se publican datos de farmacias, usuarios ni reportes privados.
