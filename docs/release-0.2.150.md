# SAS 0.2.150 — conexión RustDesk desde el equipo técnico

Esta versión corrige la dirección del flujo de control alterno incorporado en 0.2.149.

- SAS Cliente obtiene el ID local mediante el comando oficial `--get-id` de RustDesk o HopToDesk.
- El ID se renueva al iniciar, cada 60 segundos y después de reanudar Windows.
- El servidor valida el ID y no publica rutas de ejecutables, contraseñas ni otros secretos del cliente.
- El espacio de soporte muestra **Abrir en RustDesk** cuando el equipo remoto reporta un ID válido.
- El enlace `rustdesk://<id>` se abre en el equipo del técnico; la conexión ya no se inicia al revés desde el equipo atendido.
- La ruta nativa de SAS permanece disponible durante las pruebas comparativas.

Validación prevista para `testing`:

1. Instalar RustDesk tanto en el equipo atendido como en el equipo del técnico.
2. Confirmar que SAS Administrador muestre el cliente 0.2.150 conectado.
3. Abrir una sesión SAS y pulsar **Abrir en RustDesk**.
4. Verificar movimiento, clic izquierdo, clic derecho, teclado y reconexión tras suspensión.
