# Prueba de oficina: control remoto SAS 0.2.143

## Preparación

1. En SAS Administrador seleccione el canal `testing` e instale `0.2.143`.
2. Confirme que SAS Cliente muestre `Conectado`, `SAS Input listo: true` y broker elevado disponible.
3. Abra una sesión autorizada y conserve el diagnóstico completo de cada caso. No ejecute RustDesk o HopToDesk al mismo tiempo que SAS durante la primera medición.

## Matriz funcional

| Caso | Acción | Resultado esperado |
|---|---|---|
| Escritorio normal | Clic, doble clic, arrastre, rueda y escribir `SAS-143 ñ á` en Bloc de notas | `desktop_pipe` o `interactive_broker`; sesión del helper igual a la consola activa; `WinSta0\\Default`; aceptados igual a solicitados |
| Aplicación elevada | Abrir una aplicación como administrador y controlarla | `privileged_broker`, `escalationReason: uipi_target_higher_integrity`, helper con integridad `system` |
| UAC | Provocar un aviso UAC y probar el control autorizado | `privileged_broker`, escritorio `WinSta0\\Winlogon`, integridad del helper `system` |
| Bloquear y desbloquear | Bloquear Windows, desbloquear y reanudar la sesión SAS | El bridge cambia o confirma la sesión activa; no usa un pipe de una sesión anterior |
| Suspender | Suspender, reanudar y esperar la reconexión | SAS Cliente deja `Iniciando`, vuelve a `Conectado` y renueva registro, WebRTC y estado del bridge |
| Hibernar | Hibernar, iniciar Windows y repetir clic/teclado | Mismo resultado que suspensión, sin reiniciar manualmente SAS Cliente |
| Cambio de usuario | Cambiar de usuario y volver a la sesión autorizada | El PID del helper puede cambiar; `processSessionId` debe coincidir con `activeConsoleSessionId` |

`GetLastInputInfo` sin cambio no demuestra por sí solo que la aplicación rechazó la entrada. La validación final del efecto sigue siendo visual.

## Comparación controlada

Si SAS falla, guarde primero su diagnóstico y cierre la sesión. Después pruebe el mismo equipo, usuario, aplicación y nivel de elevación con RustDesk o HopToDesk:

- Si el comparador funciona, revisar en SAS la ruta, sesión, escritorio e integridad del helper.
- Si ambos fallan, revisar UAC, escritorio seguro, sesión de Windows y políticas del equipo.
- Si el fallo aparece sólo después de suspender o hibernar, comparar el reinicio del servicio, la sesión activa y la renovación de red.

No compartir contraseñas desatendidas ni ejecutar ambos motores de control simultáneamente. RustDesk y HopToDesk permanecen como procesos externos aislados de SAS.

## Evidencia que se debe entregar

- Diagnóstico completo copiado desde SAS.
- Caso exacto y aplicación destino.
- Hora de suspensión/hibernación y hora en que SAS volvió a conectar.
- Resultado visual: clic, texto o ventana que respondió.
- Resultado del comparador, sólo cuando SAS haya fallado.
