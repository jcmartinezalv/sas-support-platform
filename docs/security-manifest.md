# Manifiesto de seguridad SAS

Producto: SAS Support Platform
Version: 0.3
Fecha: 2026-06-30

## Componentes

- Servidor web SAS.
- Consola web de operadores.
- Agente Windows SAS Support Client Agent.
- Motor portátil ClamAV 1.5.3, FreshClam y definiciones integradas en SAS Cliente.
- SAS Capture Helper (`SasCaptureHelper.exe`) para captura JPEG autorizada y firmable.
- Perfil de produccion restringida sin firma para operar sin helpers nativos cuando no exista Code Signing.
- Webhook WhatsApp Cloud API.
- Base de conocimiento y auditoria.

## Comportamiento declarado

El agente Windows puede:

- Registrarse contra el servidor SAS.
- Enviar heartbeat periodico.
- Consultar sesiones remotas asignadas.
- Ejecutar comandos de diagnostico en lista blanca.
- Capturar pantalla cuando existe consentimiento aprobado.
- Usar `SasCaptureHelper.exe` si esta disponible para generar frames JPEG redimensionados.
- Mostrar panel local en 127.0.0.1.
- Cerrar sesiones si detecta archivo de paro local.
- Vigilar archivos nuevos o modificados en Descargas, Escritorio y temporales mediante una cola secuencial en segundo plano.
- Actualizar las definiciones con FreshClam y reportar detecciones al servidor sin exponer la ruta completa.

El agente Windows no debe:

- Ejecutar comandos arbitrarios.
- Descargar codigo dinamico para ejecutarlo.
- Usar capturadores no documentados o no firmados en produccion.
- Desactivar antivirus o firewall.
- Tomar control remoto sin consentimiento.
- Ocultar procesos, archivos o actividad.
- Eliminar, mover o poner en cuarentena archivos de forma automática.

## Comandos permitidos actualmente

- system_info
- network_info
- disk_info
- process_snapshot
- service_snapshot
- screenshot_preview

## Eventos interactivos actuales

- mouse_move
- mouse_click
- key_press

Estado: simulacion. No ejecutan mouse ni teclado real.

## Captura optimizada

Desde la version 0.9 el agente puede usar `tools\\sas-capture-helper\\bin\\Release\\SasCaptureHelper.exe` como componente local de captura. Este helper:

- No abre puertos.
- No queda residente.
- Solo produce JSON con JPEG base64, resolucion, calidad y fecha.
- Debe firmarse y agregarse a allowlist en produccion.
- Reduce peso de frames frente al fallback PNG de PowerShell.

## Requisitos antes de control real

- Firma digital.
- Consentimiento general y consentimiento de control.
- Indicador local visible.
- Revocacion inmediata.
- Auditoria completa.
- Allowlist documentado.


## Revocacion inmediata

Cuando el cliente rechaza consentimiento, rechaza control o cierra la sesion:

- Se detiene la vista en vivo.
- Se cancelan comandos pendientes.
- Se cancelan eventos interactivos pendientes.
- El agente deja de recibir eventos interactivos de esa sesion.
- Los resultados tardios no reactivan comandos ni eventos cancelados.

Esto evita que una accion previamente encolada sobreviva a una revocacion del cliente.



## Produccion restringida sin firma

Cuando `SAS_UNSIGNED_RESTRICTED_PRODUCTION=true`, el agente declara y aplica un perfil limitado:

- No usa `SasCaptureHelper.exe` aunque exista en desarrollo.
- No usa `SasInputHelper.exe` aunque exista en desarrollo.
- Reporta `unsignedRestrictedProduction=true` al servidor.
- Reporta captura optimizada y helper de control como no disponibles.
- Bloquea control real incluso si alguien intenta activar `SAS_ENABLE_REAL_INPUT=true`.
- Mantiene tickets, diagnosticos, pantalla remota por fallback, consentimiento, auditoria, panel local y paro inmediato.

Este modo permite produccion inicial sin firma, pero no debe presentarse como control remoto completo. Para control real se requiere firma valida, preflight aprobado y laboratorio controlado.

## Proteccion de consola

Cuando `CONSOLE_SHARED_TOKEN` esta configurado, los endpoints internos que usan permisos requieren `x-sas-console-token` o `Authorization: Bearer TOKEN`. En desarrollo puede quedar vacio para pruebas locales, pero en produccion debe configurarse antes de exponer la consola.


## Exportacion de auditoria

La consola permite exportar auditoria en CSV o JSON desde Registro. Cada exportacion genera un evento `audit.export` con actor, formato y limite solicitado. Este flujo sirve para evidencia tecnica y revisiones de seguridad sin abrir manualmente `data\\sas-db.json`.

