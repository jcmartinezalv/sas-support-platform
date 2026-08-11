# Guia rapida para cliente: detener soporte remoto

Si tienes una sesion remota activa con SAS y quieres detenerla inmediatamente, usa cualquiera de estas opciones.

## Opcion 1: pagina de autorizacion

En la pagina donde autorizaste el soporte remoto, presiona:

```text
Finalizar sesion
```

## Opcion 2: desde Windows

Ejecuta PowerShell y corre:

```powershell
C:\SAS\Client\stop-agent-sessions.ps1
```

Esto crea el archivo:

```text
C:\SAS\Client\sas-agent-stop.flag
```

El agente SAS lo detecta, cierra las sesiones activas y borra el archivo.

## Revisar estado

```powershell
C:\SAS\Client\agent-status.ps1
```

## Notas

- Este mecanismo no apaga Windows.
- No elimina el agente.
- Solo finaliza sesiones remotas activas.
- Todas las acciones quedan registradas en auditoria del servidor SAS.
