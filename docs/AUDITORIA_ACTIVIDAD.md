# Auditoría y actividad (primera versión)

Auditoría (sección independiente del menú lateral). Solo administrador del cliente y superadministrador, sin demos. Datos aislados por cliente y actor autenticado. No hay eventos retroactivos.

- Eventos fiables de servidor: inicio de sesión por membresía activa, intento denegado y cambios seleccionados de API, entrega autorizada de documentos; categoría Tarifas determina criticidad. Documento se registra antes de enviar bytes (si el registro falla, no se entrega). El registro no acredita que el usuario guardó el archivo ni que lo reenvió.
- Eventos de interfaz: navegación deduplicada por usuario/sección/bloque de 10 minutos, exportación solicitada mediante funciones compartidas CSV/Excel/ZIP. Se limitan solicitudes del navegador; no son evidencia infalible. No se inspeccionan clics, filtros, teclado, archivos o consultas individuales. No se capturan datos clínicos, IP ni contenido.
- Permiso de descarga de documentos: operación existente proveedores/exportar en perfiles; cuentas sin perfil mantienen el comportamiento histórico. La lectura de fichas se mantiene independiente. Validar perfiles actuales antes de desplegar.
- Retención inicial: 90 días para login/navegación, 12 meses resto; borrado diario. Sin preservación de incidentes ni protección frente a administradores directos de BD en esta versión. Acordar política de conservación con cliente antes de activar.
- Alertas informativas calculadas al consultar (5 tarifas, 10 solicitudes de exportación, 5 denegaciones por usuario/día Madrid), sin puntuación de empleados ni decisiones automatizadas. No hay aún configuración de umbrales ni flujo de revisión persistente. Exportación de auditoría de la página visible mediante CSV.
- Pendiente: inventario de exportadores que no usan helpers compartidos, pruebas de integración PostgreSQL y navegador con roles reales, fallos de autenticación no atribuibles, exportación completa, controles de conservación por incidente. Validar privacidad, permisos y política antes de producción.

## Habilitación por cliente
Administración → Clientes → Secciones del menú → Auditoría. Solo superadministradores pueden cambiarla. Se conserva la habilitación de clientes reales existentes, los clientes nuevos nacen deshabilitados y las demos no pueden activarla. Al desactivar se bloquean las consultas del panel y deja de recogerse actividad nueva; los registros previos conservan la retención. El permiso de consulta sigue reservado a administradores y superadministradores, independientemente del catálogo de perfiles operativos.

## Delegación por perfil
Auditoría se sitúa inmediatamente encima de Configuración. El permiso Ver Auditoría se activa expresamente en Configuración → Perfiles y permite consultar/exportar el registro completo del cliente, no solo las farmacias asignadas. No lo heredan los demás roles por activar todos los módulos. Solo administradores y superadministradores pueden concederlo; los administradores conservan el acceso cuando el cliente lo tiene activo. Demos y clientes deshabilitados permanecen bloqueados en el servidor.
