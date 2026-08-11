# Control interactivo: simulacion y preparacion nativa

Esta fase agrega el canal de eventos interactivos para sesiones remotas. Por defecto sigue en simulacion. Tambien existe `SasInputHelper.exe` para ejecucion nativa Windows, desactivado salvo que `SAS_ENABLE_REAL_INPUT=true`.

## Flujo

1. El operador crea o toma una sesion remota.
2. El cliente aprueba el consentimiento general de soporte remoto.
3. El operador solicita control interactivo.
4. El cliente aprueba el consentimiento de control.
5. La consola puede encolar eventos `mouse_click`, `mouse_move` o `key_press`.
6. El agente Windows recibe los eventos mediante `/api/agents/poll` y los reporta a `/api/agents/event-results` como `simulated`.

## Seguridad actual

- El servidor rechaza eventos interactivos si no hay agente asignado.
- El servidor rechaza eventos interactivos si `controlConsent.decision` no es `approved`.
- El agente no mueve el mouse ni escribe teclado real por defecto.
- La ejecucion real requiere helper compilado, variable explicita y consentimiento de control aprobado.
- Todos los eventos quedan persistidos en `interactiveEvents` y auditados como `remote.event.queue` y `remote.event.result`.

## Siguiente fase

Antes de produccion se debe firmar `SasInputHelper.exe`, validar Defender/EDR, mostrar indicador local y repetir pruebas de revocacion inmediata.

