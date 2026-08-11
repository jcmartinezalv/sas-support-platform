# SAS 0.2.8

Fecha: 2026-07-15

## Actualizador del equipo principal

- Canales stable, testing y client.
- Consulta automatica cada seis horas y consulta manual desde la consola.
- Descarga separada de la instalacion.
- Validacion de HTTPS, mismo origen, tamano, SHA-256 y manifiesto interno.
- Firma Ed25519 opcional, sin costo de certificado comercial.
- Permiso exclusivo system:update para administradores.
- Confirmacion escrita antes del reinicio.
- Tarea independiente de Windows para sobrevivir al cierre del servidor.
- Respaldo completo, prueba de version en /health y rollback automatico.
- Historial visible y auditoria del flujo.

## Validacion

- Pruebas de version semantica, firmas, origen, staging, interfaz y sintaxis PowerShell.
- El primer paso desde 0.2.7 sigue siendo una instalacion manual de arranque; despues se usa el actualizador.
