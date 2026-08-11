# Entrega SAS / Fisher 0.2.2

Esta entrega integra la revisión visual, de lenguaje, alertas y accesibilidad de la consola web, el consentimiento remoto, el panel local de Windows y la aplicación Android.

## Actualización de Windows 11

1. No desinstalar la versión actual.
2. Ejecutar `SAS-Windows11-Setup-0.2.2.exe` como administrador.
3. El instalador respalda y conserva configuración, datos y certificados existentes.
4. Al terminar, validar el estado del servidor, el agente local y una consulta de WhatsApp.

El ejecutable no tiene firma comercial. Windows puede mostrar una advertencia de SmartScreen; debe verificarse el SHA-256 incluido antes de ejecutarlo.

## Android

- `Fisher-Android-0.2.2-debug.apk`: firmado para pruebas internas.
- `Fisher-Android-0.2.2-release-unsigned.apk`: artefacto de distribución que todavía requiere firma.

La firma Android no requiere comprar un certificado comercial. Se puede crear gratuitamente una clave privada propia y conservarla para todas las actualizaciones futuras.

## Validaciones completadas

- Manifiesto de Windows: 169 archivos y 169 hashes correctos.
- Runtime Node.js incluido: v24.18.0, verificado contra el SHA-256 oficial.
- Instalador NSIS: integridad correcta y preflight no elevado aprobado.
- Android: versión 0.2.2, código 2, SDK objetivo 37.
- Suite del sistema: 167 pruebas aprobadas.
