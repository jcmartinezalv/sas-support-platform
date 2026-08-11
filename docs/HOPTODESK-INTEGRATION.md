# Integración de HopToDesk en SAS

SAS conserva tickets, autorización, auditoría, Fisher y su motor WebRTC. El proyecto adopta AGPL-3.0 para poder integrar o modificar componentes AGPL de motores remotos manteniendo visibles la procedencia, los cambios y el código fuente correspondiente.

## Funciones aprovechables

- escritorio remoto nativo y acceso desatendido;
- entrada de ratón y teclado en la sesión interactiva;
- portapapeles y transferencia de archivos;
- captura y codificación nativas;
- servicio persistente con proceso interactivo por sesión;
- conexión P2P con relevo cuando la ruta directa no es viable.

## Configuración

```dotenv
SAS_REMOTE_ENGINE=sas
SAS_HOPTODESK_PATH=C:\Program Files\HopToDesk\HopToDesk.exe
```

`SAS_REMOTE_ENGINE` acepta `sas`, `hoptodesk` o `auto`. El estado se consulta en `GET http://127.0.0.1:37655/remote-engine/status`. El adaptador local acepta `POST /remote-engine/launch` con `remoteId` y `mode` (`desktop` o `files`). No acepta contraseñas para evitar exponerlas en la lista de procesos de Windows.

La siguiente fase almacenará el ID como propiedad cifrada del equipo y permitirá seleccionar el proveedor por ticket. Mientras el motor permanezca como proceso separado se conservará su licencia y atribución propias. Cualquier código incorporado o derivado se publicará bajo AGPL-3.0 con historial de procedencia y avisos de modificación.
