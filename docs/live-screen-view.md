# Vista en vivo controlada

SAS ya soporta una vista en vivo basica basada en capturas recurrentes. Despues de la primera prueba real se optimizo la fluidez del flujo actual y se agrego `SasCaptureHelper.exe` como componente local firmable para JPEG redimensionado.

## Flujo

1. El tecnico crea una sesion remota y asigna un agente Windows.
2. El cliente autoriza desde `/remote/consent/{codigo}`.
3. El tecnico activa `Vista fluida` o `Vista calidad` desde la consola.
4. El servidor genera comandos `screenshot_preview` periodicos para el agente. El modo fluido usa 1 segundo por frame, calidad 45 y ancho 960; calidad usa mayor resolucion y menor frecuencia.
5. El agente captura la pantalla principal con `SasCaptureHelper.exe` si esta disponible y envia el frame JPEG al servidor. Si el helper no existe, conserva fallback PowerShell para laboratorio.
6. La consola muestra el ultimo frame recibido y refresca durante sesiones con pantalla activa para reducir latencia percibida.
7. La consola calcula edad del frame, peso aproximado, resolucion y estado Reciente/Retrasada para medir fluidez.
8. El tecnico o el cliente pueden cerrar la sesion; al cerrar se detiene la vista en vivo.

## Seguridad

- La vista en vivo requiere consentimiento aprobado y agente asignado.
- El control de teclado/mouse requiere consentimiento adicional y opera en modo simulado por defecto; el modo real queda reservado a laboratorio firmado y preflight aprobado.
- El cliente tiene boton `Finalizar sesion`.
- El servidor guarda solo el ultimo frame recurrente para evitar crecimiento excesivo de la base JSON.
- La compresion JPEG se realiza con `SasCaptureHelper.exe`, un ejecutable separado que debe firmarse y agregarse a allowlist en produccion.
- La telemetria de fluidez ayuda a decidir si el problema esta en captura, polling, peso del frame o refresco de consola.
- Todas las acciones relevantes quedan auditadas.

## Siguiente fase

- Compresion de frames mediante componente firmado o libreria nativa controlada.
- Streaming WebRTC real.
- Canal de eventos para mouse/teclado con consentimiento adicional.
- Indicador visible en el agente Windows cuando hay sesion activa.
- Mejoras de transporte para reducir latencia y preparar streaming WebRTC real.





