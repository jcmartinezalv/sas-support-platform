# SAS 0.2.15

- Sustituye la confirmación basada en `window.prompt` por una ventana propia compatible con el navegador integrado, Chrome y pantallas móviles.
- Muestra claramente la frase exacta requerida y mantiene deshabilitada la instalación hasta que coincida.
- Regenera después de cada actualización los reportes de configuración, monitor, tarea programada, dominio y prueba de producción.
- Evita que una instalación saludable aparezca bloqueada únicamente porque la carpeta `output` se excluye correctamente del paquete.
- Conserva respaldo, reversión automática, SHA-256, recibo durable del programador y evidencia de instalación.
- Incluye la aplicación Android interna alineada con la versión 0.2.15.