# Plan de firma digital SAS

La firma digital es el paso mas importante para reducir falsos positivos en antivirus y EDR.

## Objetivo

Que Windows, Microsoft Defender, SmartScreen y plataformas EDR puedan identificar a SAS como software publicado por una entidad conocida y consistente.

## Archivos a firmar

En produccion se deben firmar:

- Instalador servidor.
- Instalador cliente.
- Ejecutable del agente Windows cuando exista empaquetado nativo.
- `SasCaptureHelper.exe`, porque realiza captura de pantalla autorizada.
- Ejecutable del servidor si se empaqueta.
- Scripts PowerShell distribuidos al cliente.
- MSI/MSIX final si se adopta ese formato.

## Certificado recomendado

- Code Signing OV o EV segun presupuesto y urgencia de reputacion.
- Emisor reconocido por Microsoft.
- Timestamp RFC3161 obligatorio.
- Custodia segura de la llave privada.

## Scripts del proyecto

- `scripts\sign-release.ps1`: firma archivos distribuibles dentro de un paquete.
- `scripts\verify-signatures.ps1`: genera reporte de firmas y puede bloquear liberacion si falta firma valida.
- `scripts\build-portable.ps1 -SignPackage -CertificateThumbprint THUMBPRINT`: compila helper, copia paquete, firma y genera hashes despues de firmar.

## Comando base

```powershell
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a archivo.exe
```

Para PowerShell:

```powershell
Set-AuthenticodeSignature -FilePath .\scripts\install-client.ps1 -Certificate $cert -TimestampServer "http://timestamp.digicert.com"
```

## Reglas de versionado

- Mantener el mismo nombre de producto.
- Mantener el mismo publisher.
- No cambiar rutas de instalacion sin necesidad.
- Publicar hashes por version.
- Conservar changelog de comportamiento sensible.

## Flujo antes de liberar

1. Compilar `SasCaptureHelper.exe` con `scripts\build-capture-helper.ps1`.
2. Construir paquete portable o instalador.
3. Firmar `SasCaptureHelper.exe`, scripts e instaladores.
4. Verificar firmas con `scripts\verify-signatures.ps1`.
5. Generar allowlist SHA256 despues de firmar.
6. Instalar en Windows limpio.
7. Validar Defender.
8. Validar al menos un EDR empresarial si esta disponible.
9. Enviar falsos positivos a vendors.
10. Publicar documentacion para el cliente.

## Vendors a considerar

- Microsoft Defender Security Intelligence.
- CrowdStrike.
- SentinelOne.
- Sophos.
- Bitdefender GravityZone.
- ESET Protect.
- Kaspersky Endpoint Security.
- Trend Micro.
- Fortinet FortiEDR.
- Palo Alto Cortex XDR.

## Criterio de salida

No activar control real de mouse/teclado en produccion hasta que:

- El agente este firmado.
- El instalador este firmado.
- El cliente pueda ver indicador local de sesion.
- El cliente pueda revocar sesion inmediatamente.
- El equipo de seguridad tenga allowlist y manifiesto.
