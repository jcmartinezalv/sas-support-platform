# Captura remota nativa de Windows

SAS conserva dos rutas de captura independientes:

1. `SasDxgiCapture.exe`: ruta preferente basada en DXGI Desktop Duplication.
2. `SasCaptureHelper.exe`: respaldo GDI compatible y ruta disponible para el escritorio elevado mediante el broker existente.

El agente prueba DXGI primero en cada sesión. Si el ejecutable no existe, el controlador no permite duplicar la salida, se pierde el dispositivo, expira la espera o falla la codificación, cierra esa instancia y continúa con GDI. Una falla DXGI no debe interrumpir la pantalla remota.

## Datos publicados por frame

- `captureEngine`: `dxgi_desktop_duplication`, `gdi_compatible` o `gdi_privileged_desktop`.
- Resolución transmitida y resolución nativa.
- Origen del monitor, incluyendo coordenadas negativas.
- Calidad solicitada y ancho máximo.
- Motivo seguro de respaldo, sin imágenes ni datos confidenciales.
- Telemetría de tiempo, bytes, presión del canal y frames descartados.

## Seguridad

- Ambos ayudantes son locales y no abren puertos.
- Solo se invocan después del consentimiento de pantalla.
- Ningún frame se guarda en disco por el motor de captura.
- Los ejecutables deben firmarse antes de producción.
- El instalador restringido elimina ambos capturadores nativos.

## Compilación pendiente

El capturador DXGI requiere Visual Studio Build Tools con **Desarrollo para el escritorio con C++**:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\build-dxgi-capture.ps1 -Configuration Release
```

Después deben ejecutarse el preflight, todas las pruebas, la construcción del instalador y la firma. La prueba manual debe cubrir monitor principal/secundario, coordenadas negativas, cambio de resolución, bloqueo/desbloqueo, UAC y desconexión/reconexión del monitor.
