# Primera prueba en Windows · Farmétrica Sync 0.2

> **Preproducción, no producción.** No modifica bases Farmatic si la identidad SQL es de solo lectura. El SELECT es configurable: TI debe revisar las consultas antes de habilitarlas.

## Preparar

1. Obtener la publicación Windows autocontenida (script `scripts/publicar-win-x64.ps1` en un equipo con SDK .NET 10, o descargar el artefacto de GitHub Actions cuando el flujo haya terminado con éxito).
2. Copiar el directorio de publicación a un Windows Server compatible. Ejecutar `scripts/instalar-servicio.ps1 -Source 'C:\Ruta\win-x64'` en PowerShell elevado. Hacer copia de seguridad del servidor y acordar mantenimiento con TI.
3. Abrir `http://127.0.0.1:5080` **desde el propio servidor** y crear contraseña administradora.
4. Configurar PostgreSQL (host, base, esquema, usuario, contraseña TLS). Pulsar «Probar conexión».
5. Dar de alta **Farmatic** con servidor SQL local, base de datos/Linked Server y permisos mínimos de lectura. Pulsar «Probar».
6. Crear las consultas para una única farmacia y una entidad pequeña: **SELECT de carga completa** y **SELECT incremental**. Ambas deben exponer exactamente las columnas del contrato (`origen_id` y las de la entidad).
7. Habilitar trabajo; pulsar **Carga completa**. El incremental horario permanece pausado hasta que la carga completa finaliza bien.
8. Verificar recuento y muestras en PostgreSQL. Confirmar que solo se ha sustituido `farmacia_codigo` de esa farmacia.
9. Esperar el ciclo o pulsar **Ejecutar** para el incremental. Insertar/corregir una fila controlada en un origen de prueba y comprobar la actualización sin duplicados.
10. Provocar un fallo de conectividad **solo en preproducción**, revisar Historial/Alertas y comprobar reintentos. Reiniciar el servicio y validar la continuidad.

## Consultas conceptuales

Los nombres de tablas son **marcadores**, no identificadores verificados en Farmatic. Adaptar una consulta por entidad y versión real:

**Completa (ejemplo líneas venta)**
```sql
SELECT CAST(IdLinea AS varchar(100)) AS origen_id,
       Fecha AS fecha, CAST(IdArticulo AS varchar(100)) AS articulo_id,
       Cantidad AS unidades, Precio AS precio_unitario,
       Importe AS importe, CAST(NumTicket AS varchar(100)) AS numero_ticket
FROM {{TABLE:dbo.TablaVentasReal}}
```

**Incremental**
```sql
SELECT CAST(IdLinea AS varchar(100)) AS origen_id,
       Fecha AS fecha, CAST(IdArticulo AS varchar(100)) AS articulo_id,
       Cantidad AS unidades, Precio AS precio_unitario,
       Importe AS importe, CAST(NumTicket AS varchar(100)) AS numero_ticket
FROM {{TABLE:dbo.TablaVentasReal}}
WHERE UltimaModificacion > @desde AND UltimaModificacion <= @hasta
```

Si no existe `UltimaModificacion` fiable, no activar incremental sobre fecha comercial: emplear cargas completas en tablas pequeñas o implementar Change Tracking/CDC.

**Volumen:** no hay límite fijo de 100.000 filas; la lectura se realiza en streaming y la escritura por lotes dentro de una transacción. Los borrados físicos no se transmiten por incrementales. Las fotografías completas se bloquean cuando detectan cero filas o descensos de más del 50% respecto a un destino con al menos 20 filas. Las consultas no se suministran preconfiguradas porque dependen del esquema Farmatic del cliente.


## Prueba de volumen (v0.3)

- Crear una consulta completa con al menos 120.000 filas en SQL Server de pruebas. Definir `Filas por lote = 5000`.
- Comprobar que termina sin error, verificar `COUNT(*)` por farmacia y que el historial muestra más de 100.000 filas.
- Repetir la carga completa con los mismos registros y comprobar que no hay duplicados.
- Hacer incremental con nuevos registros y cambios sobre existentes, comprobar el UPSERT y el checkpoint.
- Simular un fallo antes de completar una carga completa: debe conservarse el recuento anterior en PostgreSQL y no adelantarse el checkpoint.
- Medir disco temporal y WAL de PostgreSQL para un histórico representativo, así como latencia y locks.
- El tamaño del lote evita saturar RAM, **pero la ejecución completa sigue siendo una única transacción**; una interrupción reintenta la consulta entera.
