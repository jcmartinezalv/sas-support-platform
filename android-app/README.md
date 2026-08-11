# Fisher para Android

Cliente móvil de supervisión para la API `/api/mobile/v1`. Incluye autenticación por dispositivo, tablero operativo, actividad segura y consultas de solo lectura a Fisher.

## Compilar

Requiere Android Studio con JDK 17, Android SDK 37 y conexión para resolver dependencias. Abra esta carpeta como proyecto y ejecute `app` en un dispositivo Android 8.0 (API 26) o posterior.

El servidor debe publicar HTTPS con un certificado confiable. La app bloquea HTTP sin cifrar y no contiene secretos ni credenciales pregrabadas.
