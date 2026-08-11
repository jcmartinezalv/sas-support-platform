# Instalacion Windows

## Objetivo

Usar `80` y `443` para evitar problemas con puertos bloqueados en redes corporativas:

- `80`: HTTP y verificacion simple.
- `443`: HTTPS, webhook WhatsApp y comunicacion de agentes.

## Dependencias

Los scripts instalan o requieren:

- Node.js 20 o superior.
- OpenSSL para certificados locales.
- Chocolatey si se quiere instalacion automatica de Node/OpenSSL.
- PowerShell ejecutado como Administrador.

## Servidor

```powershell
.\scripts\install-server.ps1 `
  -InstallPath C:\SAS\Server `
  -PublicBaseUrl https://soporte.tuempresa.com
```

El instalador:

- Copia el proyecto a `C:\SAS\Server`.
- Crea `.env` con `AGENT_SHARED_SECRET`, `CONSOLE_SHARED_TOKEN` y `WHATSAPP_VERIFY_TOKEN`; si no se pasan parametros, genera secretos fuertes automaticamente.
- Genera `certs/server.key` y `certs/server.crt`.
- Abre reglas de firewall para `80` y `443`.
- Registra la tarea programada `SAS Support Server` al iniciar Windows.
- Revisa si `80` o `443` estaban ocupados antes de instalar.
- Genera `install-manifest.json`, `post-install-checklist.json` y `POST-INSTALL-CHECKLIST.txt`.

## Cliente

```powershell
.\scripts\install-client.ps1 `
  -InstallPath C:\SAS\Client `
  -ServerUrl https://soporte.tuempresa.com `
  -AgentSharedSecret "secreto-largo-agentes"
```

El cliente se registra en el servidor y envia heartbeat cada 30 segundos. Tambien genera `install-manifest.json`, `post-install-checklist.json` y `POST-INSTALL-CHECKLIST.txt` dentro de `C:\SAS\Client`.

Para produccion restringida sin firma:

```powershell
.\scripts\install-client.ps1 `
  -InstallPath C:\SAS\Client `
  -ServerUrl https://soporte.tuempresa.com `
  -AgentSharedSecret "secreto-largo-agentes" `
  -UnsignedRestrictedProduction
```

Ese perfil mantiene el agente operativo, pero deshabilita helpers nativos y control real hasta contar con firma valida.

## Seguridad minima

- Cambia siempre `AGENT_SHARED_SECRET` o deja que el instalador lo genere automaticamente y protege el archivo `.env`.
- Usa certificado real en produccion, no el certificado local generado por OpenSSL.
- WhatsApp debe usar HTTPS publico valido.
- El control remoto debe requerir consentimiento explicito antes de tomar acciones.
- El agente cliente no debe ejecutar comandos remotos hasta tener permisos, auditoria y lista blanca.




