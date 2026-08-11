# Integración de RustDesk en SAS

SAS mantiene la consola, los tickets, la autorización del cliente, la auditoría y Fisher. RustDesk aporta el motor nativo de captura, vídeo, puntero, teclado, portapapeles, transferencia de archivos, servicio persistente y escritorio elevado.

La primera etapa usa RustDesk como proceso AGPL separado y administrado por SAS. Esto permite validar el control remoto real antes de reemplazar o personalizar progresivamente su interfaz.

## Versión fijada

- Repositorio original: `https://github.com/rustdesk/rustdesk`
- Fork editable de SAS: `https://github.com/jcmartinezalv/rustdesk`
- Submódulo: `vendor/rustdesk`
- Versión: `1.4.9`
- Revisión: `6c578292e8ebbbec708b76986ba8c4bc7c509747`
- Licencia: GNU AGPL versión 3

## Configuración del cliente SAS

```dotenv
SAS_REMOTE_ENGINE=rustdesk
SAS_RUSTDESK_PATH=C:\Program Files\RustDesk\RustDesk.exe
```

`SAS_REMOTE_ENGINE=auto` selecciona RustDesk cuando está instalado, después HopToDesk y finalmente el motor SAS existente.

El estado se consulta en `GET http://127.0.0.1:37655/remote-engine/status`. El inicio se solicita con `POST /remote-engine/launch`:

```json
{
  "provider": "rustdesk",
  "remoteId": "123456789",
  "mode": "desktop"
}
```

`mode` acepta `desktop` y `files`. SAS genera únicamente `--connect <id>` o `--file-transfer <id>`. Las contraseñas quedan prohibidas en argumentos para impedir que aparezcan en la lista de procesos de Windows.

## Límite de seguridad

El arranque del proveedor no sustituye el consentimiento de SAS. La autorización, el alcance, la vinculación con el ticket y el cierre de la sesión continúan gobernados por SAS. En la siguiente etapa el ID del proveedor se asociará al equipo y el lanzamiento sólo podrá originarse desde una sesión remota autorizada.
