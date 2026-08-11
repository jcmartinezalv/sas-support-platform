# Auditoría general de pendientes — 2026-07-18

## Completado

- WhatsApp real responde y está vinculado con el agente Windows.
- Servidor definitivo activo como `SERVER` en `192.168.50.1`.
- Actualización automática 0.2.13 descargada, verificada, respaldada e instalada.
- Recurso `\\192.168.50.1\SASUpdates$` disponible para publicación.
- Instaladores de servidor, cliente y Android desarrollados y probados.
- 201/201 pruebas automatizadas aprobadas.
- Evidencia productiva sin bloqueos.

## Pendientes antes de publicar 0.2.14

1. Construir y validar los artefactos 0.2.14.
2. Publicar primero en el canal de prueba.
3. Promover al canal estable sólo después de revisar hashes, instaladores y semáforo.
4. Aplicar en `SERVER` con autorización expresa.

## Pendientes externos no bloqueantes

- Validar `Preparación` desde una sesión administrativa iniciada.
- Comprar certificado Authenticode cuando el presupuesto lo permita.
- Configurar OpenAI, Gemini o FCM cuando se decida activar esos proveedores.
- Completar la verificación comercial de Meta si aún aparece “en proceso”.

La ausencia de firma comercial mantiene deshabilitados captura y control nativos en producción, por diseño.