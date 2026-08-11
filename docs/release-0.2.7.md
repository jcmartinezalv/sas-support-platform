# SAS 0.2.7

Fecha: 2026-07-15

## TinyURL y Bitly

- Integracion oficial con TinyURL `POST /create` y Bitly `POST /v4/shorten`.
- Modo automatico: TinyURL, Bitly y respaldo interno SAS.
- Tokens Bearer solo en configuracion; nunca se exponen en respuestas, auditoria o reportes.
- Tiempo limite configurable para evitar bloquear el envio por WhatsApp.
- Validacion estricta del dominio HTTPS devuelto por el proveedor.
- La consola informa el proveedor utilizado y cualquier respaldo interno.
- Solo se comparte la liga anonima temporal; no se envia nombre, telefono ni numero de ticket.

## Validacion

- Pruebas de TinyURL, Bitly, seleccion automatica, respuesta maliciosa y respaldo sin credenciales.
- Flujo de instalacion de un solo uso y compatibilidad interna conservados.
