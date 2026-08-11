# Control interactivo nativo de Windows

SAS conserva un motor propio de control remoto. La implementación toma como referencia patrones de arquitectura observables en RustDesk y HopToDesk —canal de entrada con estado, liberación al desconectar y separación de permisos— sin copiar código AGPL.

Referencias revisadas:

- RustDesk: https://github.com/rustdesk/rustdesk
- HopToDesk: https://gitlab.com/hoptodesk/hoptodesk/

## Flujo actual

1. `public/remote-workspace.html` captura puntero, botones, rueda, teclado y texto Unicode.
2. `src/remote/remote-session-store.js` valida cada mensaje, comprueba permisos y mantiene el orden de eventos importantes.
3. `client/agent-client.js` entrega la orden por el canal interactivo del usuario. El broker de SYSTEM queda como respaldo y para UAC/Ctrl+Alt+Supr.
4. `tools/sas-input-helper/SasInputHelper.exe` se conecta al escritorio de entrada activo. El canal normal sólo se acepta en `WinSta0\\Default`; `WinSta0\\Winlogon` se acepta exclusivamente desde el broker SYSTEM autorizado durante UAC. El helper conserva el estado de teclas y botones mientras vive el canal persistente.
5. Al terminar, desconectar, ocultar la ventana o perder la captura del puntero se envía `release_input` para soltar teclas y botones atascados.

## Eventos soportados

Mouse:

- `mouse_move`: posición absoluta, incluyendo origen del monitor y resolución nativa.
- `mouse_move_relative`: desplazamiento relativo.
- `mouse_button`: `down` y `up` independientes para izquierdo, derecho y central.
- `mouse_click` y `mouse_double_click`: compatibilidad y diagnóstico.
- `mouse_wheel`: rueda vertical y horizontal.
- El arrastre se forma con `mouse_button down`, movimientos y `mouse_button up`.

Teclado:

- `key_down`, `key_up` y `key_press`.
- Ctrl, Alt, Shift, Windows, navegación, bloqueo, función F1–F24, teclado numérico, volumen e impresión de pantalla.
- `text_input` utiliza Unicode para acentos, ñ y texto de otras distribuciones.
- `secure_attention` usa el broker privilegiado para Ctrl+Alt+Supr.
- `release_input` libera todo el estado conservado.

Portapapeles de texto:

- `clipboard_set` y `clipboard_get` se ejecutan en el helper nativo, no mediante PowerShell.
- Límite actual: 200,000 caracteres por operación.
- La huella SHA-256 local evita interpretar como contenido nuevo el texto recién recibido.
- SAS audita operación, técnico, ticket, equipo, sesión y longitud, pero no guarda el texto en la persistencia ni en la auditoría.

## Coordenadas y monitores

El navegador calcula coordenadas relativas sobre la imagen visible, descontando las bandas creadas por “Ajustar”. El agente convierte esas coordenadas con `monitorOriginX`, `monitorOriginY`, `nativeWidth` y `nativeHeight`. Esto permite monitores con origen negativo y resoluciones/DPI diferentes sin asumir que la pantalla principal comienza en `(0,0)`.

El perfil nativo `input-v9-pointer-recovery` usa `SetCursorPos` como movimiento primario, porque aplica coordenadas de píxel exactas en el escritorio interactivo, y conserva `SendInput` absoluto sobre el escritorio virtual como respaldo. Botones y teclado siguen usando `SendInput` marcado con el identificador propio de SAS. Para clics con coordenadas, la comprobación de integridad se hace contra la ventana raíz situada bajo el punto mediante `WindowFromPoint`, no sólo contra la ventana en primer plano. Si el destino tiene mayor integridad, la orden se rechaza antes de inyectarse y el agente la reintenta por el broker autorizado. Las transiciones de botones se serializan de extremo a extremo; una liberación defensiva envía `up` para los tres botones y permite recuperar una entrega interrumpida sin requerir entrada física. El agente retira y relanza automáticamente un helper persistente cuya revisión sea anterior a la requerida.

El diagnóstico publica `inputProfile`, `inputMarker`, `integrity.targetSource`, `integrity.targetWindowHandle` y el PID del destino. Un clic normal debe indicar `targetSource: pointer_window`; si aparece `uipi_target_higher_integrity`, la entrega correcta es la ruta elevada.

## Saturación y orden

Los movimientos pendientes se compactan porque sólo importa la posición más reciente. Clics, transiciones de botones, teclas, rueda y liberación nunca se eliminan silenciosamente. Si hay 256 eventos importantes pendientes, el servidor devuelve un error de saturación en vez de perder una liberación o un clic.

## Permisos

Cada sesión mantiene permisos independientes:

- `screen`
- `input`
- `uac`
- `clipboard`
- `fileUpload`
- `fileDownload`

El cierre de la sesión revoca todos. El servidor vuelve a validar consentimiento, estado, agente, tipo, forma y límites de cada mensaje, incluso si el transporte WebRTC está activo.

## Compilación y validación

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\build-input-helper.ps1 -Configuration Release
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\build-privileged-desktop-broker.ps1 -Configuration Release
npm.cmd test
npm.cmd run check
```

No se deben automatizar clics reales durante las pruebas unitarias. La prueba final de entrada requiere un equipo Windows controlado, autorización visible y verificación manual de: clic izquierdo/derecho/central, doble clic, arrastre, rueda, atajos, ñ/acentos, portapapeles en ambos sentidos, cambio de monitor y liberación al cerrar la ventana.

Como control comparativo, el estado local detecta instalaciones de HopToDesk y RustDesk sin cargar ni enlazar su código dentro de SAS. RustDesk se reporta sólo como referencia diagnóstica: si controla el mismo destino y SAS no, se revisan sesión, escritorio e integridad del broker; si ambos fallan, se revisan UAC, escritorio seguro y políticas de Windows.

## Pendiente posterior

- Sincronización automática opcional de portapapeles con imágenes, HTML y RTF.
- Transferencia de archivos por bloques con pausa, cancelación, reanudación y checksum final.
- Confirmación visual automatizada de que la aplicación destino recibió el evento, sin registrar teclas ni contenido confidencial.
