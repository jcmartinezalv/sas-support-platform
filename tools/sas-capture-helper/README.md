# SAS Capture Helper

Componente local para capturar frames autorizados de pantalla en Windows.

Objetivos:

- Evitar scripts dinamicos de captura durante operacion normal.
- Producir JPEG redimensionado para reducir peso de frames.
- Permitir firma digital y allowlist por hash/editor.
- Mantener salida JSON simple para el agente Node.

Uso esperado:

```powershell
.\SasCaptureHelper.exe --quality 62 --max-width 1280
```

Salida: JSON con `mimeType`, `imageBase64`, `width`, `height`, `quality`, `maxWidth` y `capturedAt`.

Seguridad:

- Solo debe ejecutarse despues del consentimiento remoto aprobado.
- No recibe comandos arbitrarios.
- No abre puertos ni mantiene servicio residente.
- Debe firmarse antes de distribuir a clientes.
