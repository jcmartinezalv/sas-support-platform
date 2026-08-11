# Compatibilidad de SAS Cliente en Windows

## Sistemas admitidos

- Windows 11 de 64 bits.
- Windows 10 de 64 bits, desde build 10240.
- Windows Server 2016, 2019, 2022 y posteriores de 64 bits.
- Windows PowerShell 5.0 o posterior.

El instalador evalúa capacidades reales del equipo y ya no exige Windows 11. Incluye Node.js x64, registra el agente como tarea programada y mantiene el modo de producción restringida cuando el código no está firmado.

## Sistemas no admitidos

- Windows 7, Windows 8 y Windows 8.1.
- Windows de 32 bits.
- Versiones anteriores a PowerShell 5.0.

No se ofrece un runtime heredado para esos sistemas porque implicaría distribuir componentes sin soporte de seguridad. El instalador se detiene antes de copiar o vincular credenciales y muestra el requisito que falta.

## Validaciones registradas

La instalación guarda en `install-manifest.json` el producto, edición, build, arquitectura y versión de PowerShell detectados. `post-install-checklist.json` incluye el resultado `windows_compatibility`, y `test-client-preflight.ps1` vuelve a comprobarlo durante las pruebas técnicas.

## Alcance

La compatibilidad del cliente es independiente del servidor principal. El servidor SAS puede permanecer en Windows 11; los equipos atendidos pueden utilizar cualquiera de las versiones admitidas en esta matriz.
## Cambio de nombre del equipo

Desde SAS 0.2.16, el cliente guarda su identificador estable en `agent-identity.json`, junto a la credencial individual. Al cambiar el nombre de Windows, Fisher conserva la misma ficha, sesiones e historial; registra el nombre anterior, el nuevo y la fecha en la consola y en auditoría. El archivo se crea automáticamente usando el identificador de la credencial existente para migrar instalaciones anteriores sin duplicarlas.