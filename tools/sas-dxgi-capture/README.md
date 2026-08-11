# SAS DXGI Capture

Capturador nativo preferente para Windows 8 o posterior basado en Desktop Duplication API.

- Captura la salida seleccionada directamente desde DXGI.
- Copia el frame a memoria de CPU y codifica JPEG con Windows Imaging Component.
- Conserva origen y resolución de cada monitor.
- Incorpora el cursor visible al frame.
- No abre puertos ni conserva imágenes en disco.
- Ante cualquier error, SAS Cliente vuelve automáticamente al capturador GDI existente.

La compilación requiere Visual Studio Build Tools con el componente C++ de escritorio. El ejecutable resultante debe quedar en `bin\\Release\\SasDxgiCapture.exe` y firmarse antes de publicar.
