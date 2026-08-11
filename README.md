# SAS Support Platform

SAS es una plataforma abierta de soporte técnico, automatización y control remoto. El proyecto se distribuye bajo [GNU AGPL versión 3](LICENSE): puede usarse, estudiarse y modificarse, y las versiones derivadas o utilizadas como servicio de red deben ofrecer su código fuente correspondiente bajo la misma licencia.

La identidad y experiencia SAS se mantienen como proyecto propio. Los componentes derivados de RustDesk, HopToDesk u otros proyectos conservarán su procedencia, copyright, licencia e historial de modificaciones. Consulta [la estrategia de publicación](docs/OPEN-SOURCE-PUBLICATION.md).

Antes de publicar o crear una versión ejecuta:

```powershell
npm test
npm run audit:publication
```

Base inicial para un sistema de soporte tecnico con:

- Tickets creados y actualizados desde WhatsApp.
- Respuesta automatizada de Fisher por WhatsApp Cloud API.
- Registro de agentes cliente instalados en Windows.
- Emparejamiento por código entre solicitudes de WhatsApp y el equipo Windows afectado.
- Sesiones de soporte remoto con codigo y consentimiento del cliente.
- Servidor preparado para HTTP `80` y HTTPS `443`.

## Ejecutar en desarrollo

Si `node` no esta en el PATH, usa el Node incluido por Codex o instala Node.js 20+.

```powershell
node src/server.js
```

Variables principales en `.env`:

```text
HTTP_PORT=80
HTTPS_PORT=443
ENABLE_HTTP=true
ENABLE_HTTPS=true
WHATSAPP_VERIFY_TOKEN=change-me
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
PUBLIC_BASE_URL=https://tu-dominio.com
AGENT_SHARED_SECRET=change-agent-secret
CONSOLE_SHARED_TOKEN=
```

## Instalacion final en Windows 11

El artefacto principal es `dist\SAS-Windows11-Setup-<version>.exe`. Solicita UAC, valida Windows 11 x64, incluye Node.js, respalda instalaciones anteriores y registra servidor, agente restringido y desinstalador.

Antes de ejecutarlo, compara su SHA-256 con el archivo `.sha256.txt` o el manifiesto JSON. El EXE no tiene firma Authenticode; esta condición no bloquea SAS, pero mantiene deshabilitados los helpers nativos de captura y entrada.

Como alternativa sin conexión, extrae `sas-windows11-final-<fecha>.zip` y ejecuta `INSTALAR-SAS.cmd`. Consulta `docs\windows-11-pro-mvp-deployment.md` para instalación, actualización, respaldo y desinstalación.

La integridad del paquete puede comprobarse sin instalar ni solicitar privilegios:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-windows11-final-package.ps1 -PackagePath <carpeta-extraida> -InstallerExe <instalador.exe>
```

## SAS Cliente para Windows

El instalador `SAS-Cliente-Setup-<version>.exe` es compatible con Windows 10 y Windows 11 de 64 bits, además de Windows Server 2016 o posterior. Detecta versión, arquitectura y PowerShell antes de vincular el equipo. Windows 7, 8, 8.1 y ediciones de 32 bits se rechazan con una explicación clara porque el runtime seguro actual ya no las soporta.

Consulta `docs\windows-client-compatibility.md` para la matriz de compatibilidad y el comportamiento de instalación.

## Endpoints iniciales

- `GET /health`: estado del servicio.
- `GET /api/tickets`: lista de tickets.
- `POST /api/tickets`: crea un ticket manual.
- `GET /api/remote-sessions`: lista sesiones remotas.
- `POST /api/remote-sessions`: crea una sesion remota.
- `GET /api/agents`: lista agentes cliente registrados.
- `GET /api/admin/storage`: muestra estado de base local, backups y conteos.
- `GET /api/admin/readiness`: evalua preparacion de produccion.
- `GET /api/admin/installations`: resume manifiestos y checklists post-instalacion.
- `GET /api/audit/export?format=csv|json`: exporta auditoria como evidencia.
- `POST /api/admin/backup`: genera respaldo manual auditado.
- `POST /api/agents/register`: registra agente cliente.
- `POST /api/agents/heartbeat`: mantiene vivo agente cliente.
- `POST /api/agent/diagnose`: ejecuta diagnostico automatico inicial.
- `GET /webhooks/whatsapp`: verificacion del webhook de Meta.
- `POST /webhooks/whatsapp`: recepcion y respuesta a mensajes de WhatsApp.

## WhatsApp Cloud API

Configura en Meta Developers:

- Callback URL: `https://tu-dominio.com/webhooks/whatsapp`
- Verify token: el mismo valor de `WHATSAPP_VERIFY_TOKEN`
- Access token: `WHATSAPP_ACCESS_TOKEN`
- Phone Number ID: `WHATSAPP_PHONE_NUMBER_ID`

## Siguiente fase

1. Configurar credenciales externas seleccionadas: WhatsApp, OpenAI/Gemini y FCM.
2. Realizar la prueba UAC presencial del instalador NSIS final.
3. Evaluar SQLite/PostgreSQL cuando el volumen productivo lo requiera.
4. Adquirir firma Authenticode si el presupuesto lo permite; no es un bloqueo operativo.
## Simulaciones offline de Fisher

Para validar ocho categorias de Fisher, respuestas, escalamiento de seguridad y el ciclo seguro de sesiones remotas sin WhatsApp real, servidor publico ni equipos de cliente:

```powershell
npm run simulate:fisher
```

Los reportes se guardan en `output/reports/offline-fisher-simulations.json` y `.md`.
## Persistencia local

El servidor guarda datos en `data/sas-db.json` y expone paneles simples de almacenamiento, instalaciones y preparacion de produccion en Registro:

- Tickets y mensajes.
- Sesiones remotas.
- Agentes cliente.
- Auditoria.
- Base de conocimiento.

Los backups manuales se generan con:

```powershell
Invoke-WebRequest -Uri http://localhost:3110/api/admin/backup -Method POST -Headers @{ 'x-sas-role'='admin'; 'x-sas-actor'='admin' }
```

En instalacion Windows, los datos quedan dentro de `C:\SAS\Server\data`.

## Paro local del agente

En el equipo cliente, se puede finalizar cualquier sesion activa creando el archivo de paro local:

```powershell
C:\SAS\Client\stop-agent-sessions.ps1
```

Para revisar el estado del agente instalado:

```powershell
C:\SAS\Client\agent-status.ps1
```

El agente detecta `sas-agent-stop.flag`, cierra sus sesiones activas en el servidor y borra el archivo.

## Seguridad y antivirus

Para reducir falsos positivos en antivirus y EDR, SAS incluye documentacion y herramientas de allowlist:

- `docs/antivirus-allowlist.md`: rutas, procesos, puertos, hashes y comportamiento esperado.
- `docs/security-manifest.md`: manifiesto de comportamiento del agente y servidor.
- `docs/code-signing-plan.md`: plan de firma digital para produccion.
- `docs/unsigned-restricted-production.md`: perfil productivo restringido cuando no hay firma de codigo.
- `scripts/generate-allowlist.ps1`: genera inventario SHA256 para paquetes o instalaciones.
- SAS Cliente 0.2.71 integra ClamAV 1.5.3 x64, firmas iniciales y FreshClam; no requiere instalar ClamAV por separado.
- La vigilancia ligera observa Descargas, Escritorio y temporales, procesa una cola en segundo plano y nunca elimina archivos automáticamente.

En produccion se recomienda firmar instaladores, scripts y binarios antes de activar control remoto real. Si la firma no esta disponible, usar el perfil restringido sin firma para operar con tickets, WhatsApp, Fisher, auditoria, diagnosticos y vista remota, manteniendo deshabilitados los helpers nativos y el control real.

## SAS Capture Helper

El cliente Windows puede usar `tools\sas-capture-helper\bin\Release\SasCaptureHelper.exe` para capturar frames JPEG optimizados bajo consentimiento remoto aprobado.

Compilar helper:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-capture-helper.ps1
```

Crear paquete portable con helper, manifest y allowlist:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-portable.ps1
```

Crear paquete portable para produccion restringida sin firma:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-portable.ps1 -UnsignedRestrictedProduction
```

En produccion se debe firmar `SasCaptureHelper.exe` antes de generar el allowlist final.


## Firma y verificacion de paquetes

Inventariar archivos firmables:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\sign-release.ps1 -PackagePath dist\paquete -AuditOnly
```

Verificar firmas:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verify-signatures.ps1 -PackagePath dist\paquete -OutputPath dist\paquete\signature-report.json
```

Cuando exista certificado de Code Signing:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-portable.ps1 -SignPackage -CertificateThumbprint THUMBPRINT
```

## Let's Encrypt para HTTPS

Let's Encrypt se usa para el certificado TLS del servidor SAS, consola, webhook WhatsApp y enlaces de consentimiento. No sirve para firmar ejecutables ni scripts.

Solicitar certificado con dominio publico y win-acme:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\request-letsencrypt-cert.ps1 -Domain soporte.tu-dominio.com -Email admin@tu-dominio.com -WacsPath C:\tools\win-acme\wacs.exe
```

Renovar:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\renew-letsencrypt-cert.ps1 -WacsPath C:\tools\win-acme\wacs.exe
```

Requisitos: dominio real apuntando al servidor, puerto 80 accesible para validacion HTTP-01 o DNS-01 configurado, y puerto 443 para HTTPS.

## Simular WhatsApp local

Para probar el webhook sin Meta/WhatsApp real:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\simulate-whatsapp-message.ps1 -ServerUrl http://127.0.0.1:3110 -From 5215559002000 -Message "Necesito soporte remoto por AnyDesk"
```

El flujo crea o reutiliza ticket abierto del cliente, ejecuta diagnostico Fisher y, si aplica, genera sesion remota con enlace `/remote/consent/{codigo}`.












