# Operacion diaria SAS Support

## Tecnico

1. Abrir consola SAS:

```text
http://localhost:3110
```

2. Revisar tickets, agentes y sesiones remotas.
3. Para soporte remoto:
   - Crear sesion.
   - Asignar agente.
   - Compartir enlace de consentimiento.
   - Activar vista en vivo si el cliente autorizo.
   - Solicitar control interactivo solo si es necesario.

## Cliente

Panel local del agente:

```powershell
C:\SAS\Client\open-agent-panel.ps1
```

Detener sesiones activas:

```powershell
C:\SAS\Client\stop-agent-sessions.ps1
```

Revisar estado:

```powershell
C:\SAS\Client\agent-status.ps1
```

## Administrador Windows

Reiniciar agente:

```powershell
C:\SAS\Client\restart-agent-task.ps1
```

Ver logs:

```powershell
C:\SAS\Client\agent-logs.ps1
```

## Reglas de seguridad

- No hay control de mouse/teclado sin consentimiento separado.
- El cliente puede finalizar la sesion desde la pagina de consentimiento o desde el panel local.
- Las acciones quedan auditadas.
- El agente no ejecuta comandos arbitrarios; solo lista blanca.

## Diagnostico productivo rapido

```powershell
.\scripts\get-production-status.ps1 -LocalOnly
.\scripts\get-production-status.ps1 -RemoteOnly -BaseUrl https://setinfo.sytes.net -HostName setinfo.sytes.net
```

Usar `-LocalOnly` para separar servidor vivo de problemas externos de NAT, DDNS o proveedor.

## Monitor y reinicio productivo

```powershell
.\scripts\monitor-production.ps1 -LocalOnly
.\scripts\monitor-production.ps1 -LocalOnly -RestartOnFail
.\scripts\restart-production-task.ps1
```

El monitor guarda `output\production-monitor-report.json`. Usar `-RestartOnFail` solo cuando la tarea programada productiva ya este instalada y se quiera recuperacion automatica ante estado `fail`.

## Verificacion de tarea programada

```powershell
.\scripts\verify-production-task.ps1
.\scripts\verify-production-task-elevated.ps1
```

El verificador normal puede quedar limitado por permisos de Windows. Si no puede consultar Task Scheduler pero el servicio esta vivo, ejecutar el verificador elevado y revisar `output\production-task-verification.json`.

## Reporte offline de operacion

```powershell
npm run ops:report
```

Genera `output\production-operations-report.json` y `output\production-operations-report.md` leyendo los reportes existentes sin ejecutar pruebas reales. Usarlo cuando se este fuera de oficina o antes de una prueba real para revisar evidencia, pendientes requeridos, reportes viejos y plan de accion con responsable/comando sugerido.


## Semaforo de produccion

```powershell
npm run semaforo:produccion
npm run release:gate
```

Genera `output\semaforo-produccion-report.json`, `output\semaforo-produccion-report.md` y el historial `output\semaforo-produccion-history.*`, ademas de los archivos `release-gate-report.*` por compatibilidad. Usarlo antes de pruebas reales para confirmar si produccion esta en Verde, Amarillo o Rojo y comparar avances entre ejecuciones.




## Interfaz para tecnicos

La consola usa nombres cortos para operacion diaria: Casos, Remoto, Prueba, Equipos, Soluciones y Estado. Las acciones avanzadas quedan plegadas en Mas opciones, Detalle avanzado o controles similares.
