# Soporte remoto: fase de captura

La sesion remota ya permite un primer acercamiento visual sin control de teclado/mouse.

## Flujo

1. Tecnico crea o selecciona un ticket.
2. Crea una sesion remota y asigna un agente Windows.
3. Cliente autoriza desde `/remote/consent/{codigo}`.
4. Tecnico solicita `screenshot_preview` desde la consola.
5. El agente captura la pantalla principal y devuelve una imagen PNG en base64.
6. El resultado queda asociado a la sesion y auditado.

## Seguridad

- La captura solo se solicita desde una sesion remota con agente asignado.
- El sistema mantiene consentimiento del cliente.
- No hay control de mouse o teclado todavia.
- El agente no ejecuta comandos arbitrarios; solo una lista blanca.

## Siguiente fase

- Captura recurrente con intervalo controlado.
- WebRTC o relay para streaming.
- Canal separado para eventos de teclado/mouse con permiso explicito.
- Boton visible para que el cliente finalice la sesion.
