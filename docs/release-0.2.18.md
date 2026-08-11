# SAS 0.2.18

- Añade **Iniciar soporte rápido** desde la consola con modalidades atendida y desatendida.
- Permite habilitar el modo desatendido únicamente desde el panel local del cliente Windows.
- Usa contraseña exclusiva por equipo derivada con `scrypt`, nunca expuesta por API.
- Separa el permiso de pantalla del permiso de teclado y mouse; el segundo permanece bloqueado salvo autorización local explícita.
- Limita el acceso desatendido a administradores y supervisores, bloquea durante 15 minutos después de cinco fallos y audita cada intento.
- Cambiar o deshabilitar la política cierra inmediatamente las sesiones desatendidas del equipo.
- Detecta cambios de nombre conservando la identidad, historial y vinculación del equipo.
- Corrige la alerta de renombre para que sólo se muestre en fichas de equipos.
- Corrige el constructor para integrar y validar el cliente Windows de la misma versión que el servidor.
- Incluye Android alineado con la versión 0.2.18.