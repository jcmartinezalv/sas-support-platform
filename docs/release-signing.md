# Flujo de firma y verificacion SAS

Este flujo prepara paquetes SAS para distribucion en ambientes con Microsoft Defender, SmartScreen y EDR corporativo.

## Orden recomendado

1. Compilar `SasCaptureHelper.exe`.
2. Construir el paquete portable o instalador.
3. Firmar ejecutables y scripts distribuibles.
4. Verificar firmas.
5. Generar `manifest.json` y `sas-allowlist.json` finales despues de firmar.
6. Probar instalacion en Windows limpio.
7. Validar con Defender/EDR.

## Inventariar archivos firmables

```powershell
powershell -ExecutionPolicy Bypass -File scripts\sign-release.ps1 -PackagePath dist\paquete -AuditOnly
```

## Firmar con certificado del store

```powershell
powershell -ExecutionPolicy Bypass -File scripts\sign-release.ps1 -PackagePath dist\paquete -CertificateThumbprint "THUMBPRINT"
```

## Firmar con archivo PFX

```powershell
$pwd = Read-Host "Password PFX" -AsSecureString
powershell -ExecutionPolicy Bypass -File scripts\sign-release.ps1 -PackagePath dist\paquete -CertificatePath C:\certs\sas-code-signing.pfx -CertificatePassword $pwd
```

## Verificar

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verify-signatures.ps1 -PackagePath dist\paquete -OutputPath dist\paquete\signature-report.json
```

Para bloquear liberacion si falta una firma valida:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verify-signatures.ps1 -PackagePath dist\paquete -RequireSigned
```

## Archivos criticos

- `tools\sas-capture-helper\bin\Release\SasCaptureHelper.exe`
- `scripts\install-client.ps1`
- `scripts\install-server.ps1`
- `scripts\start-client.ps1`
- `scripts\start-server.ps1`
- MSI/MSIX/EXE final cuando exista instalador productivo.
