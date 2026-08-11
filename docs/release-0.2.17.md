# SAS 0.2.17

- Conserva una identidad estable del cliente Windows aunque se cambie el nombre del equipo.
- Migra automáticamente el identificador guardado en la credencial existente, sin perder historial, vínculo ni autorización.
- Registra y muestra nombre anterior, nombre actual, fecha e historial; evita duplicados y falsas alertas por mayúsculas.
- Corrige el orden de empaquetado para que la descarga del cliente incluida en cada actualización tenga exactamente la misma versión que el servidor.
- Valida como archivo obligatorio `downloads\SAS-Cliente-Setup.exe` antes de aprobar un paquete final.
- Incluye las correcciones del actualizador 0.2.15 y reemplaza el paquete 0.2.16, que no fue instalado en SERVER.
- Incluye la aplicación Android interna alineada con la versión 0.2.17.