# Despliegue final en Windows 11 Pro

## Objetivo

Instalar SAS en Windows 11 x64 con el dominio `setinfo.sytes.net`, HTTPS 443, certificado Let's Encrypt y tareas programadas del servidor y agente.

## Artefacto recomendado

Use `dist\SAS-Windows11-Setup-<version>.exe`. El instalador:

- solicita privilegios de administrador mediante UAC;
- valida Windows 11 x64;
- incluye Node.js, por lo que no necesita instalar Node, Chocolatey ni winget;
- respalda configuración, datos, certificados y manifiestos existentes;
- prepara `.env.production`;
- registra SAS y, cuando corresponde, el agente restringido;
- registra una desinstalación estándar de Windows.

Antes de ejecutarlo, compare el SHA-256 con `SAS-Windows11-Setup-<version>.exe.sha256.txt` o su manifiesto JSON.

El EXE actual no tiene firma Authenticode. Windows puede mostrar SmartScreen; confirme el hash únicamente si el archivo proviene del paquete entregado. La falta de certificado no bloquea la operación: captura e inyección nativas quedan deshabilitadas mediante el perfil restringido.

## Alternativa ZIP sin conexión

Si el EXE no puede utilizarse, extraiga completamente `sas-windows11-final-<fecha>.zip` y ejecute:

```text
INSTALAR-SAS.cmd
```

El ZIP contiene el mismo runtime y scripts. `DESINSTALAR-SAS.cmd` retira tareas y reglas, y conserva respaldo salvo que se solicite purga explícita.

## Requisitos externos

- Acceso de administrador local.
- Reserva DHCP o IP local estable.
- NAT TCP 80/443 hacia el equipo cuando se exponga públicamente.
- DDNS `setinfo.sytes.net` apuntando a la IP pública.
- Puerto 80 temporalmente disponible cuando Let's Encrypt lo requiera.

## Actualizaciones y respaldo

Ejecute de nuevo el instalador sobre `C:\SAS\Server`. Antes de copiar la versión nueva se guardan `.env`, `.env.production`, `data`, `certs` y manifiestos en:

```text
C:\SAS\Backups\before-install-<fecha>
```

También puede usarse `scripts\update-server-deployment.ps1` para una actualización administrativa controlada.

## Validación autónoma del paquete

Esta comprobación no instala, no altera servicios y no requiere elevación:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-windows11-final-package.ps1 `
  -PackagePath dist\sas-windows11-final-<fecha> `
  -InstallerExe dist\SAS-Windows11-Setup-<version>.exe
```

Valida archivos requeridos, conteo, todos los hashes, ausencia de estado privado, Node incluido, preflight y manifiesto del EXE. El reporte queda en `output\windows11-installer-validation-report.json`.

## Validación posterior

```powershell
cd C:\SAS\Server
.\scripts\test-production-smoke.ps1 -BaseUrl https://setinfo.sytes.net
```

TLS y `/health` deben aprobar. Los avisos por WhatsApp u otros proveedores sin credenciales pueden permanecer como `warn`.

## Desinstalación

Use Aplicaciones instaladas > SAS Support Platform o `Desinstalar-SAS.exe`. La desinstalación estándar respalda datos y configuración antes de retirar tareas, firewall y archivos. No use purga de datos sin un respaldo verificado.

