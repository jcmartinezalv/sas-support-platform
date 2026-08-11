# Despliegue en Windows Server 2019 Standard

## Objetivo

Instalar SAS en un servidor Windows Server 2019 Standard usando el dominio `setinfo.sytes.net`, puertos 80/443, certificado Let's Encrypt y tarea programada productiva.

## Requisitos del servidor

- Windows Server 2019 Standard actualizado.
- PowerShell 5.1 o superior.
- Node.js 20 o superior.
- Acceso administrador local.
- IP local fija o reserva DHCP para el servidor.
- NAT del router:
  - TCP 80 hacia el servidor.
  - TCP 443 hacia el servidor.
- DDNS `setinfo.sytes.net` apuntando a la IP publica actual.

## Instalacion inicial recomendada

1. Copiar el paquete SAS al servidor, por ejemplo en `C:\SAS\Release`.
2. Abrir PowerShell como Administrador.
3. Preparar configuracion productiva:

```powershell
cd C:\SAS\Release
.\scripts\prepare-production-config.ps1 -PublicBaseUrl https://setinfo.sytes.net -WriteMainEnv
```

4. Emitir certificado Let's Encrypt:

```powershell
.\scripts\request-letsencrypt-elevated.ps1 -Domain setinfo.sytes.net -Email jcmtza@gmail.com
```

5. Registrar tarea productiva:

```powershell
.\scripts\install-production-task.ps1 -StartNow
```

6. Validar produccion:

```powershell
.\scripts\test-production-smoke.ps1 -BaseUrl https://setinfo.sytes.net
```

## Actualizaciones

Para actualizar sin perder configuracion, certificados ni base local:

1. Copiar nueva version a `C:\SAS\ReleaseNueva`.
2. Abrir PowerShell como Administrador.
3. Ejecutar:

```powershell
cd C:\SAS\ReleaseNueva
.\scripts\update-server-deployment.ps1 -SourcePath C:\SAS\ReleaseNueva -InstallPath C:\SAS\Server -TaskName "SAS Support Server Production" -StartAfterUpdate
```

El script:

- Detiene la tarea programada si existe.
- Respalda `.env`, `.env.production`, `data`, `certs` y manifiestos.
- Copia la nueva version.
- Restaura configuracion, datos y certificados.
- Reinicia la tarea programada.
- Genera checklist post-actualizacion.

## Validacion posterior a cada actualizacion

```powershell
cd C:\SAS\Server
.\scripts\test-production-smoke.ps1 -BaseUrl https://setinfo.sytes.net
```

Resultado esperado: `status` en `pass` o `warn` controlado por pendientes de WhatsApp/Google AI. Cualquier `fail` en TLS o health debe atenderse antes de operar con clientes.

## Respaldo minimo

Conservar respaldo de:

- `C:\SAS\Server\.env` o `.env.production`.
- `C:\SAS\Server\data`.
- `C:\SAS\Server\certs`.
- `C:\SAS\Server\install-manifest.json`.
- `C:\SAS\Server\post-install-checklist.json`.

Nunca enviar `.env` por chat ni correo sin cifrado.
