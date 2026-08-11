# Let's Encrypt para SAS Server

Let's Encrypt sirve para emitir certificados SSL/TLS publicamente confiables para HTTPS.

Uso en SAS:

- Consola web publica.
- Webhook de WhatsApp Cloud API.
- Enlaces de consentimiento remoto con `https://tu-dominio.com`.

No sirve para:

- Firmar `SasCaptureHelper.exe`.
- Firmar scripts PowerShell.
- Reemplazar un certificado Code Signing OV/EV.

## Requisitos

- Dominio real, por ejemplo `soporte.tu-dominio.com`.
- Registro DNS A/AAAA apuntando al servidor SAS.
- Puerto 80 accesible desde Internet para validacion HTTP-01, o configurar DNS-01 con proveedor DNS.
- Puerto 443 abierto para HTTPS.
- Cliente ACME disponible. En este proyecto puede usarse `tools\win-acme\wacs.exe` portable o win-acme instalado en PATH.
- PowerShell ejecutado como Administrador para que win-acme pueda usar selfhosting en puerto 80.

## Solicitar certificado con win-acme

```powershell
powershell -ExecutionPolicy Bypass -File scripts\test-domain-readiness.ps1 -Domain setinfo.sytes.net
powershell -ExecutionPolicy Bypass -File scripts\request-letsencrypt-cert.ps1 -Domain setinfo.sytes.net -Email admin@tu-dominio.com
```

El script copia los PEM resultantes a:

```text
certs\server.key
certs\server.crt
```

Variables recomendadas para SAS:

```text
PUBLIC_BASE_URL=https://soporte.tu-dominio.com
ENABLE_HTTP=false
HTTP_PORT=80
ENABLE_HTTPS=true
HTTPS_PORT=443
TLS_KEY_PATH=certs/server.key
TLS_CERT_PATH=certs/server.crt
```

## Renovacion

Let's Encrypt usa certificados de vida corta. Automatiza renovacion y reinicio controlado del servidor.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\renew-letsencrypt-cert.ps1 -WacsPath C:\tools\win-acme\wacs.exe
```

Usar `-RestartTask` cuando la tarea productiva ya exista para recargar TLS al terminar. El script copia la llave y el certificado completo a `certs\server.key` y `certs\server.crt`, evitando `chain-only`.

## Recomendacion operativa

- Mantener NAT/firewall TCP 80 disponible, pero no necesariamente ocupado por SAS. Durante emision o renovacion HTTP-01, el puerto 80 debe estar libre para win-acme.
- Publicar WhatsApp webhook solo con HTTPS valido.
- Monitorear vencimiento.
- Para firma de codigo usar `docs\release-signing.md`, no Let's Encrypt.

## IP dinamica y DDNS

Para setinfo.sytes.net, el registro DDNS debe apuntar siempre a la IP publica actual. Antes de emitir o renovar, ejecutar scripts\test-domain-readiness.ps1 -Domain setinfo.sytes.net. Si la IP publica cambio y el DDNS no actualizo, esperar la actualizacion antes de solicitar el certificado.


