# Control interactivo y paro local

SAS ya separa el consentimiento de visualizacion del consentimiento de control interactivo.

## Control interactivo

- El tecnico puede solicitar permiso de control desde la consola.
- El cliente aprueba o rechaza desde `/remote/consent/{codigo}`.
- La decision queda en `controlConsent` y se audita.
- Todavia no se ejecutan eventos de mouse o teclado; esta fase solo prepara el permiso explicito.

## Paro local del agente

El agente Windows revisa un archivo de paro local:

```text
sas-agent-stop.flag
```

Ruta configurable:

```text
SAS_AGENT_STOP_FILE=C:\ruta\sas-agent-stop.flag
```

Si el archivo existe, el agente cierra sus sesiones activas en el servidor y borra el archivo.

## Proxima fase

- Interfaz local visible del agente con boton de detener.
- Canal de eventos de mouse/teclado bajo `controlConsent=approved`.
- Lista blanca estricta de acciones interactivas.
- Indicador permanente para el cliente cuando haya control activo.

## Panel de seguridad del cliente

La pagina `/remote/consent/{codigo}` funciona como panel de seguridad vivo durante toda la sesion.

Muestra:

- Estado del consentimiento general.
- Estado de la sesion.
- Estado de vista en vivo.
- Estado de control interactivo.
- Codigo de union.
- Registro visible del ultimo estado recibido.

Controles visibles:

- Autorizar soporte, solo antes de aprobar.
- Rechazar soporte, solo antes de aprobar.
- Autorizar control, solo cuando el tecnico lo solicita o cuando ya esta autorizado.
- Rechazar control, para revocar eventos interactivos pendientes.
- Finalizar sesion ahora, mientras la sesion no este cerrada.

El panel se refresca automaticamente cada 5 segundos para que el cliente vea cambios de estado sin recargar la pagina.
