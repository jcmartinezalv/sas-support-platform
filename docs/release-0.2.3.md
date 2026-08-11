# SAS 0.2.3

Fecha: 2026-07-15

## Cambios principales

- Bandeja completa de conversacion WhatsApp dentro de Casos, con respuesta del tecnico desde SAS.
- Separacion visual entre mensajes del cliente, respuestas de SAS y notas internas.
- Evidencias de imagen, audio, video y documento registradas con metadatos seguros.
- Comandos contextuales: la palabra ayuda dentro de un problema ya no abre el menu por error.
- Cierre en dos pasos: resuelto y confirmacion explicita del cliente.
- Prioridad urgente automatica para incidentes de seguridad.
- Notificaciones WhatsApp para asignacion, consentimiento, inicio, control, fin remoto y cierre.
- Deduplicacion por identificador de Meta y validacion HMAC del webhook con WHATSAPP_APP_SECRET.
- Respuestas de Fisher sin categorias internas ni porcentajes de confianza.

## Validacion

- 175 pruebas automaticas aprobadas.
- Sintaxis de servidor, agente y consola validada.
- El App Secret real de Meta debe agregarse a la configuracion productiva antes de considerar completa la firma del webhook en operacion.
