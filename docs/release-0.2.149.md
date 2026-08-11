# SAS 0.2.149 — integración inicial de RustDesk

## Objetivo

Esta versión prepara una prueba controlada del motor RustDesk sin sustituir la consola, el consentimiento, la auditoría ni el flujo de tickets de SAS.

## Cambios

- RustDesk y HopToDesk comparten un adaptador de proveedor remoto.
- `SAS_REMOTE_ENGINE=auto` prioriza RustDesk cuando está instalado.
- SAS inicia escritorio o transferencia de archivos con los argumentos oficiales del proveedor.
- Las contraseñas están prohibidas en la línea de comandos.
- El instalador de cliente puede conservar la selección del motor durante actualizaciones.
- Se incluye un instalador opcional de RustDesk 1.4.9 con verificación SHA-256.
- El fork `jcmartinezalv/rustdesk` queda enlazado como submódulo reproducible.

## Prueba de oficina

1. Instalar RustDesk con `scripts\install-rustdesk-engine.ps1` como administrador.
2. Instalar o actualizar SAS Cliente con `-RemoteEngine rustdesk`.
3. Consultar `http://127.0.0.1:37655/remote-engine/status` y confirmar `selected: rustdesk`.
4. Lanzar una conexión con `POST /remote-engine/launch` usando un ID de laboratorio y sin contraseña en el cuerpo.
5. Validar movimiento, clic izquierdo, clic derecho, teclado, portapapeles y UAC.

La firma de código permanece fuera de esta fase de validación funcional.
