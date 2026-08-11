# Guia antivirus y EDR para SAS Support Platform

Esta guia prepara SAS para reducir falsos positivos en antivirus, EDR y herramientas corporativas de seguridad.

## Objetivo

SAS debe comportarse como software empresarial transparente: instalado en rutas estables, con procesos identificables, logs visibles, archivos firmables, dominio conocido, puertos documentados, consentimiento verificable y acciones auditadas.

## Riesgos de deteccion esperados

Los antivirus pueden marcar o poner en observacion funciones legitimas de soporte remoto:

- Captura de pantalla bajo consentimiento.
- Agente en segundo plano con heartbeat.
- Tarea programada de inicio con Windows.
- Comunicacion persistente con servidor SAS.
- Comandos de diagnostico del sistema.
- Control interactivo futuro de mouse/teclado.
- Scripts PowerShell de instalacion y operacion.
- Builds portables o no firmados.

## Controles ya definidos en SAS

- Consentimiento general antes de comandos remotos.
- Consentimiento adicional antes de control interactivo.
- Lista blanca de comandos permitidos.
- Registro de auditoria en servidor.
- Panel local del agente en `127.0.0.1`.
- Archivo local de paro de emergencia.
- Eventos interactivos en modo simulacion hasta activar control real.
- Logs operativos en carpeta dedicada.

## Rutas recomendadas para allowlist

Servidor:

```text
C:\SAS\Server
C:\SAS\Server\logs
C:\SAS\Server\data
C:\SAS\Server\certs
```

Cliente/agente:

```text
C:\SAS\Client
C:\SAS\Client\logs
C:\SAS\Client\client\agent-client.js
C:\SAS\Client\tools\sas-capture-helper\bin\Release\SasCaptureHelper.exe
C:\SAS\Client\tools\clamav\clamscan.exe
C:\SAS\Client\tools\clamav\freshclam.exe
C:\SAS\Client\tools\clamav\database
C:\SAS\Client\sas-agent-stop.flag
```

## Procesos esperados

Durante esta fase Node.js ejecuta los componentes:

```text
node.exe src\server.js
node.exe client\agent-client.js
powershell.exe scripts\start-server.ps1
powershell.exe start-client.ps1
SasCaptureHelper.exe --quality 62 --max-width 1280
clamscan.exe --database=C:\SAS\Client\tools\clamav\database <archivo>
```

En produccion se recomienda empaquetar y firmar ejecutables propios para que el editor sea visible y la reputacion mejore. Si no hay firma de codigo, usar el perfil `-UnsignedRestrictedProduction` para operar sin helpers nativos no firmados.

## Tareas programadas esperadas

```text
SAS Support Server
SAS Support Client Agent
```

## Puertos y red

Servidor:

- TCP 80: HTTP.
- TCP 443: HTTPS y webhook WhatsApp.
- TCP 3110: desarrollo local.

Agente cliente:

- Salida HTTPS hacia `PUBLIC_BASE_URL`.
- Panel local solo loopback: `127.0.0.1:37655`.

No se requiere exponer puertos entrantes en el equipo cliente.

## Dominios esperados

Produccion:

```text
https://tu-dominio.com
https://graph.facebook.com
```

Desarrollo local:

```text
http://localhost:3110
http://127.0.0.1:37655
```

## Hashes para allowlist

Generar hashes SHA256 despues de construir el paquete final:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\generate-allowlist.ps1 -RootPath C:\SAS\Client
powershell -ExecutionPolicy Bypass -File scripts\generate-allowlist.ps1 -RootPath C:\SAS\Server
```

El archivo generado incluye ruta, tamano, fecha y hash SHA256.

## Firma digital recomendada

Antes de produccion:

1. Comprar o emitir certificado Code Signing de la empresa.
2. Firmar instaladores, scripts PowerShell y ejecutables.
3. Usar timestamp RFC3161.
4. Conservar la misma identidad de editor entre versiones.
5. Evitar empaquetadores que ofusquen o compriman de forma sospechosa.

Ejemplo de firma en Windows SDK:

```powershell
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a archivo.exe
```

## Practicas que debemos evitar

- Inyeccion en procesos.
- Hooks globales innecesarios.
- Ofuscacion de scripts o JavaScript.
- Descargar y ejecutar codigo dinamico desde internet.
- Ejecutar comandos arbitrarios recibidos del servidor.
- Auto-elevacion oculta.
- Desactivar antivirus, firewall o politicas del equipo.
- Ocultar ventanas, procesos o rutas sin documentacion.

## Proceso recomendado con antivirus

1. Generar paquete firmado.
2. Generar hashes con `generate-allowlist.ps1`.
3. Probar en Windows Defender limpio.
4. Probar en al menos un EDR corporativo.
5. Enviar muestra a Microsoft Defender Security Intelligence si hay deteccion.
6. Preparar excepciones por editor, hash, ruta y dominio.
7. Mantener changelog de seguridad por version.

## Informacion para mesa de seguridad del cliente

SAS Support Platform:

- Proposito: soporte tecnico remoto con tickets y consentimiento.
- Editor: pendiente de firma corporativa.
- Rutas: `C:\SAS\Server`, `C:\SAS\Client`.
- Puertos servidor: 80/443.
- Puerto local cliente: 127.0.0.1:37655.
- Acciones sensibles: captura de pantalla mediante helper firmable, diagnostico de sistema, control interactivo futuro.
- Mitigaciones: consentimiento, auditoria, lista blanca, paro local.

## Estado actual

En esta version el control interactivo real no esta activado. Los eventos de mouse/teclado se reciben y registran en modo simulacion. La captura optimizada usa `SasCaptureHelper.exe` cuando esta compilado; si no existe, el agente conserva fallback PowerShell para laboratorio.



## Perfil sin firma recomendado

Si todavia no existe certificado Code Signing, el perfil aceptable para produccion inicial es `Produccion restringida sin firma`.

En este perfil:

- No distribuir `SasCaptureHelper.exe` ni `SasInputHelper.exe` dentro del cliente instalado.
- Mantener `SAS_CAPTURE_HELPER_PATH=` y `SAS_INPUT_HELPER_PATH=` vacios.
- Mantener `SAS_ENABLE_REAL_INPUT=false`.
- Activar `SAS_UNSIGNED_RESTRICTED_PRODUCTION=true`.
- Documentar ante el cliente que la vista remota puede ser menos fluida porque usa fallback sin helper nativo.

Validacion:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\test-client-preflight.ps1 -UnsignedRestrictedProduction -OutputPath output\client-preflight-unsigned-restricted.json
```

El resultado esperado es `pass`. Las firmas de helpers no se exigen porque los helpers quedan fuera del flujo productivo.
