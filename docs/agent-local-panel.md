# Panel local del agente SAS

El agente Windows abre un panel local solo en el equipo del cliente:

```text
http://127.0.0.1:37655
```

Desde ahi el cliente puede:

- Ver si el agente esta conectado.
- Ver sesiones remotas activas.
- Finalizar sesiones activas sin usar la consola del tecnico.
- Ver si hay vista en vivo activa.
- Ver si el control remoto esta aprobado.
- Ver si el modo de control es simulado o real.
- Ver si los helpers nativos estan disponibles.

## Seguridad

- El panel solo escucha en `127.0.0.1`.
- No acepta conexiones desde otros equipos de la red.
- No permite ejecutar comandos.
- Solo muestra estado y permite detener sesiones.
- Debe mantenerse disponible aunque el servidor este temporalmente caido.
- Se actualiza automaticamente cada 5 segundos.

## Configuracion

Puerto configurable en `.env.client`:

```text
SAS_AGENT_LOCAL_PORT=37655
```

