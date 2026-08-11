# Checklist de prueba real cliente Windows

## 0. Arranque local

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-local-stack.ps1
```

## 1. Preflight recomendado

Ejecutar primero:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-client-preflight.ps1 -BuildHelpers
```

El reporte queda en:

```text
output\client-preflight-report.json
```

La consola web lo muestra en Pruebas > Preflight cliente Windows mediante `GET /api/client-preflight`.

Debe validar:

- Windows y PowerShell disponibles.
- Compilador .NET Framework `csc.exe` para helpers.
- Archivos principales del agente cliente.
- `SasCaptureHelper.exe` compilado.
- `SasInputHelper.exe` compilado.
- Firma Authenticode de `SasCaptureHelper.exe` y `SasInputHelper.exe`.
- `SAS_ENABLE_REAL_INPUT` desactivado o no configurado para prueba normal.
- `real_input_lab_ready` en pass solo cuando el helper de control este firmado.
- Servidor respondiendo en `/health`.
- Panel local del agente respondiendo en `http://127.0.0.1:37655`.

## 2. Paquete portable

Generar paquete de prueba:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-portable.ps1
```

El paquete queda en `dist\sas-support-portable-FECHA-HORA` con:

- `manifest.json`
- `sas-allowlist.json`
- `signature-report.json`
- `QUICKSTART.txt`

## 3. Prueba funcional

1. Instalar o ejecutar cliente en equipo de prueba con `SAS_ENABLE_REAL_INPUT=false`.
2. Confirmar panel local `http://127.0.0.1:37655`.
3. Crear ticket y sesion remota.
4. Aprobar consentimiento general desde el cliente.
5. Asignar agente y activar vista Baja latencia.
6. Probar Vista balanceada y Vista calidad.
7. Solicitar control, aprobar y enviar eventos simulados.
8. Presionar paro local.
9. Presionar Cerrar prueba desde la consola.
10. Confirmar que la sesion queda `closed` y que Auditoria registra `remote.close`.

## 4. Seguridad

No activar entrada real hasta tener:

- Firma digital valida en `SasInputHelper.exe`.
- Allowlist revisado.
- Prueba antivirus/EDR.
- Consentimiento general y consentimiento de control aprobados.
- Paro local verificado.
- Preflight `real_input_guard` revisado por tecnico.