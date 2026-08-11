# Manual de Usuario SAS - Tickets, WhatsApp y Soporte Remoto

Version: 4.05 corrige la creacion de accesos
Fecha: 2026-07-12
Estado del producto: pruebas funcionales basicas

## 1. Objetivo del sistema

SAS es una plataforma para operar soporte tecnico desde tickets, WhatsApp, agente Fisher y sesiones remotas con consentimiento del cliente.

En esta etapa el sistema permite:

- Crear y administrar tickets desde la consola web.
- Recibir tickets desde el flujo preparado para WhatsApp Cloud API.
- Ejecutar diagnostico inicial con Fisher.
- Registrar agentes Windows.
- Crear sesiones remotas con codigo unico.
- Solicitar consentimiento del cliente.
- Ver capturas y vista en vivo mediante el agente Windows.
- Enviar comandos seguros de diagnostico.
- Probar eventos de mouse/teclado en modo simulacion.
- Consultar auditoria y base de conocimiento.
- Generar documentacion y hashes para allowlist antivirus/EDR.
- Cancelar colas pendientes cuando el cliente revoca consentimiento o cierra sesion.
- Mostrar al cliente un panel vivo de seguridad durante la sesion remota.
- Mostrar pistas contextuales de Siguiente en casos, sesiones remotas, equipos y soluciones.
- Usar vista remota fluida con perfil de baja latencia de 1 segundo, calidad 45 y ancho 960.
- Mostrar telemetria de fluidez: edad del frame, latencia, peso aproximado, intervalo, resolucion, perfil y estado Reciente/Lenta/Sin actualizar.
- Endurecer sesiones remotas con expiracion, limite de intentos y estados bloqueados.
- Usar `SasCaptureHelper.exe` como capturador JPEG optimizado y firmable cuando este compilado.
- Empaquetar el capturador dentro del cliente Windows y registrarlo en manifiesto/allowlist.
- Generar reporte de firmas Authenticode para paquetes y preparar firma digital antes de hashes finales.
- Preparar Let's Encrypt para HTTPS del servidor, webhook WhatsApp y enlaces de consentimiento.
- Operar SAS por HTTPS real en `https://setinfo.sytes.net` con certificado Let's Encrypt y smoke test productivo en `pass`.
- Preparar `SasInputHelper.exe` para control real Windows, desactivado por defecto, y mostrar sus capacidades en consola.
- Mejorar panel local del agente como indicador visible de sesion, vista en vivo, control, helpers disponibles y paro inmediato.
- Validar flujo completo de panel local: vista activa, control aprobado y cierre desde paro local.
- Validar flujo WhatsApp simulado: mensaje entrante, ticket, diagnostico Fisher, sesion remota y enlace de consentimiento.
- Usar comandos conversacionales por WhatsApp: ayuda, estado, enlace remoto, cancelar remoto, hablar con tecnico y cerrar ticket.
- Aprender resoluciones desde tickets y reutilizarlas en diagnosticos de Fisher.
- Investigar problemas con Google AI/Gemini en modo revisable antes de alimentar la base de conocimiento.
- Clasificar incidentes con una taxonomia central de 25 categorias operativas.
- Exigir fuentes, prerrequisitos, diagnostico, reversion, impacto y aprobacion humana en toda investigacion web.
- Consultar OpenAI mediante Responses API con busqueda web opcional y salida estructurada.
- Anonimizar correos, telefonos, contrasenas, tokens y API keys antes de enviar contexto.
- Elegir desde el caso entre Buscar con Google y Buscar con OpenAI; ambas propuestas quedan pendientes de revision.
- Comparar ambos proveedores sin fusionar automaticamente pasos contradictorios.
- Aplicar el mismo sanitizador de datos a Gemini y OpenAI antes de toda consulta externa.
- Mostrar proveedor, privacidad, administrador, impacto, prerrequisitos, comprobaciones, riesgos y reversion antes de aprobar.
- Solicitar confirmacion explicita al aprobar conocimiento externo o de consenso.
- Validar cliente Windows con `test-client-preflight.ps1` antes de pruebas reales.
- Mostrar el resultado del preflight Windows en la consola web de Pruebas.
- Mostrar paso actual y siguiente accion durante la prueba guiada.
- Cerrar prueba desde Pruebas guiadas con auditoria `remote.close`.
- Iniciar servidor y agente local con `scripts\start-local-stack.ps1` y reinicio robusto por puertos.
- Generar reporte de prueba guiada con avance, siguiente accion, auditoria y evidencia del flujo remoto.
- Usar una interfaz simplificada para operadores y tecnicos, con acciones avanzadas agrupadas en menus.
- Mostrar una franja superior de estado operativo: servidor, agente, preflight Windows, guia, reconexion y ultima revision.
- Ejecutar pruebas automatizadas basicas para proteger el estado online/offline de agentes y sus capacidades reportadas.
- Validar con pruebas automatizadas el flujo WhatsApp: ticket, diagnostico Fisher, sesion remota, enlace y cierre.
- Proteger soporte remoto con pruebas de consentimiento, control y cancelacion de acciones pendientes.
- Mostrar resumen de seguridad en cada sesion remota y ocultar sesiones expiradas en la vista principal.
- Mostrar Registro con nombres claros, actor, entidad y detalles clave en chips legibles.
- Guiar al operador con un panel Paso actual y una sola accion principal visible.
- Mostrar estados en lenguaje claro, por ejemplo Abierto, Cerrado, En linea y Completada.
- Mostrar diagnosticos de Fisher como tarjeta operativa, no como JSON tecnico.
- Reutilizar sesiones remotas abiertas del ticket antes de crear una nueva.
- Simular mensajes WhatsApp desde Atencion para validar ticket, Fisher y sesion remota sin Meta real.
- Preparar o reutilizar sesion remota cuando el mensaje del cliente pide soporte remoto.
- Operar en produccion restringida sin firma cuando no exista certificado Code Signing, manteniendo helpers nativos y control real deshabilitados.
- Revisar estado de base local y crear respaldos manuales desde Registro.
- Medir preparacion de produccion con checklist automatico en Registro.
- Proteger endpoints internos con `CONSOLE_SHARED_TOKEN` cuando la consola se exponga en produccion.
- Exportar auditoria en CSV o JSON desde Registro.
- Instalar servidor Windows con secretos fuertes automaticos, revision de puertos 80/443 y checklist post-instalacion.
- Instalar cliente Windows con checklist post-instalacion, manifest, panel local, paro inmediato y perfil restringido sin firma verificable.
- Consultar evidencia de instalacion servidor/cliente desde Registro sin abrir JSON manualmente.
- Usar tarjetas visuales mas claras en Atencion, metricas operativas con color y estados consistentes sin caracteres rotos.
- Ocultar botones repetidos o no accionables en Conexion y Guia para reducir ruido operativo.
- Mostrar acciones remotas avanzadas solo cuando hay consentimiento aprobado, equipo asignado y sesion vigente.
- Simplificar Guia ocultando laboratorio real y JSON tecnico dentro de menus plegables, mostrando solo pendientes principales.
- Mostrar Equipos y Soluciones con resumen visual, detalles tecnicos plegados y acciones solo cuando aplican.
- Evitar estados repetidos en la vista principal: Servidor queda en la franja operativa y metricas muestra trabajo pendiente.
- Mostrar informacion del equipo remoto en tarjetas amigables para sistema, red, discos, procesos y servicios, dejando JSON solo como detalle tecnico plegado.
- Compactar visualmente Atencion, Conexion y Registro: actividad reciente limitada, evidencia de sesiones cerradas plegada y eventos antiguos agrupados.
- Pulir botones, barra superior, foco de teclado y vista movil para que las acciones principales sean mas claras.
- Ejecutar auditoria local extremo a extremo con `npm run audit:e2e`: salud, WhatsApp simulado, ticket, Fisher, consentimiento, agente, vista fluida, diagnostico remoto y cierre.
- Conservar perfil real de pantalla fluida (`lowLatency`) al activar vista remota desde la consola.
- Mantener servidor y agente vivos al iniciar `scripts\start-local-stack.ps1 -Restart` fuera del sandbox y generar auditorias E2E con telefono unico por ejecucion.
- Mostrar pendientes de produccion como pasos guiados con prioridad, responsable y accion clara desde Registro.
- Proteger la interfaz simplificada con pruebas automaticas que evitan regresar a textos tecnicos confusos o romper identificadores de control remoto.
- Mostrar avisos visuales por situacion con colores: rojo para bloqueos o urgencias, amarillo para permisos o revisiones pendientes, azul para informacion accionable y verde para estados correctos.
- Mostrar resumen visual al inicio de cada pantalla: Casos, Remoto, Prueba, Equipos, Soluciones y Estado, con tarjetas de estado por color.
- Diagnosticar HTTPS local aunque Windows reporte el listener como IPv6 wildcard (::443), usando /health local como senal operativa.
- Consultar un centro de operacion productiva en Registro con reportes de smoke test, monitor, tarea programada, dominio, configuracion, manifest y checklist.
- Generar reporte offline de operacion productiva en JSON y Markdown con `npm run ops:report`, tolerando JSON UTF-8 con BOM de PowerShell y marcando evidencia vieja.
- Priorizar pendientes productivos con plan de accion, severidad, responsable y comando sugerido desde Registro y reporte offline.
- Evaluar Semaforo de produccion con decision Verde, Amarillo o Rojo combinando Preparacion y Operacion productiva.
- Consultar historial del semaforo de produccion para revisar avances, bloqueos, avisos y acciones repetidas.
- Usar una interfaz con nombres mas simples para tecnicos de primer nivel: Casos, Remoto, Prueba, Estado, Nuevo caso, Pedir ayuda a Fisher y Semaforo de produccion.
- Mostrar una tarjeta clara de Token requerido cuando Registro no puede cargar datos protegidos sin CONSOLE_SHARED_TOKEN.
- Mostrar Cargando eventos al cambiar filtros de Registro mientras llega la respuesta de la API.
- Avisar Servidor sin respuesta cuando una API falla y mostrar que SAS reintenta automaticamente.
- Mostrar estados vacios guiados en Atencion, Conexion, Equipos y Soluciones con siguiente accion sugerida.
- Registrar PID, rutas de logs, escucha de puertos y errores de salud en `output\local-stack-status.json` al iniciar el stack local.
- Avanzar la Guia con un boton automatico para crear/repetir prueba, aprobar consentimiento local, iniciar sesion, activar vista fluida, solicitar diagnostico, aprobar control, enviar Enter y cerrar con evidencia.
- Cancelar una sesion remota desde WhatsApp sin cerrar el ticket y mostrar estados con etiquetas claras para cliente y tecnico.
- Sugerir y encolar reparaciones automaticas controladas desde Fisher, con catalogo, riesgo, consentimiento remoto y auditoria.
- Clasificar reparaciones con motor de decision Fisher: automatico permitido, aprobacion tecnica, consentimiento remoto requerido o revision humana.
- Generar plan ejecutable de reparacion por ticket con endpoint `/api/tickets/{id}/repair-plan`, auditoria `fisher.repair_plan` y auto-encolado solo para bajo riesgo permitido.
- Registrar resultados de reparaciones en `repairOutcomes`, consultar `/api/repair-outcomes` y mostrar historial de exito/simulacion/falla en el plan Fisher.
- Ajustar ranking de reparaciones con aprendizaje operativo: promover acciones con exito real, degradar fallas repetidas e ignorar simulaciones como exito real.
- Confirmar manualmente resultados de reparaciones desde Registro como `resolved` o `unresolved`, auditando `repair.feedback` y usando esa senal con mayor peso en Fisher.
- Generar propuestas revisables de base de conocimiento desde reparaciones confirmadas con endpoint `/api/repair-outcomes/knowledge-proposals`.
- Medir en Preparacion si Fisher ya cuenta con conocimiento aprobado, propuestas revisables y reparaciones confirmadas para aprendizaje productivo.
- Generar configuracion productiva rapida con `scripts\prepare-production-config.ps1`, secretos fuertes y reporte sin exponer valores sensibles.
- Validar dominio real `setinfo.sytes.net`, DDNS, NAT 80/443 y preparar win-acme portable para emitir Lets Encrypt en PowerShell Administrador.
- Abrir emision TLS elevada con `scripts\request-letsencrypt-elevated.ps1` y arrancar SAS productivo con `scripts\start-production-server.ps1`.
- Validar produccion con `scripts\test-production-smoke.ps1`: certificado TLS, `/health`, webhook WhatsApp y readiness.
- Registrar SAS como tarea programada productiva con `scripts\install-production-task.ps1`, usando `.env.production`, TLS y arranque al iniciar Windows.
- Preparar despliegue en Windows Server 2019 Standard con `docs\windows-server-2019-deployment.md` y actualizaciones seguras mediante `scripts\update-server-deployment.ps1`.
- Generar instalador final para Windows 11 en EXE NSIS y ZIP sin conexión, con Node.js incluido, manifiestos SHA-256, respaldos y desinstalación segura.

## 2. Direcciones principales

En ambiente local de pruebas:

- Consola web: http://localhost:3110
- Panel local del agente: http://127.0.0.1:37655
- Salud del servidor: http://localhost:3110/health

En instalacion Windows final se usaran normalmente:

- HTTP: puerto 80
- HTTPS: puerto 443
- Webhook WhatsApp: https://tu-dominio.com/webhooks/whatsapp

## 3. Roles de usuario

La consola usa roles por encabezado interno durante esta etapa. En la interfaz se puede elegir el rol.

- admin: acceso completo a tickets, agentes, remoto, base de conocimiento y auditoria.
- supervisor: operacion y supervision, incluyendo aprobacion remota.
- technician: operacion de tickets y solicitud remota.
- ai_agent: acciones automatizadas limitadas.
- viewer: consulta sin cambios criticos.

Para las primeras pruebas usar admin. La consola local inicia en Admin durante esta fase para evitar errores de permisos en el flujo guiado.

## 4. Pantallas de la consola

La consola web tiene estas secciones principales:

- Tickets: lista, detalle, estado, prioridad, notas y diagnostico.
- Remoto: sesiones remotas, asignacion de agente, consentimiento, vista en vivo y comandos.
- Agentes: equipos Windows registrados y estado online/offline.
- Conocimiento: articulos y pasos de resolucion usados por Fisher.
- Pruebas: checklist operativo para validar servidor, agente, ticket, sesion, consentimiento, vista en vivo y control simulado.
- Auditoria: acciones relevantes registradas por el sistema.

## 4.1 Principio de interfaz SAS

La consola debe priorizar claridad operativa sobre cantidad de controles visibles. Para usuarios y tecnicos nuevos, la pantalla debe mostrar primero la accion principal y dejar las opciones tecnicas dentro de menus simples.

Criterios vigentes:

- Menus principales con nombres cortos: Atencion, Conexion, Guia, Equipos, Soluciones y Registro.
- Botones visibles solo para acciones comunes o urgentes.
- Acciones avanzadas agrupadas en Opciones Fisher, Diagnostico, Pantalla, Control o Mas acciones.
- Flujo guiado para pruebas y soporte remoto, evitando que el operador tenga que adivinar el siguiente paso.
- El panel Paso actual debe aparecer primero en la Guia y mostrar solo el boton recomendado para continuar. Cuando sea seguro en laboratorio local, el boton Avanzar automatico ejecuta el siguiente paso pendiente sin abrir pantallas adicionales.
- Los estados internos no deben mostrarse como codigos tecnicos cuando exista una etiqueta clara para el operador.
- Lenguaje simple orientado a soporte, no a desarrollo.
- Cuando una API o el servidor no responden, la franja superior debe mostrar Servidor sin respuesta, Reintentando y la ultima revision para que el tecnico no confunda una falla temporal con datos vacios.
- Cuando una vista no tenga datos, debe mostrar una tarjeta con titulo, explicacion corta y siguiente accion sugerida, no solo texto vacio.

## 5. Primer ingreso

1. Abrir http://localhost:3110.
2. Seleccionar rol admin.
3. Confirmar que la consola cargue las secciones Tickets, Remoto, Agentes, Conocimiento y Auditoria.
4. Abrir http://127.0.0.1:37655 para confirmar que el agente local esta registrado.
5. En la consola, entrar a Agentes y verificar que aparece el equipo Windows como online.

Si no aparece el agente, revisar que el servidor este corriendo y que el agente use el mismo AGENT_SHARED_SECRET.

## 6. Crear un ticket de prueba

1. En la pantalla Tickets, presionar Crear ticket demo.
2. Seleccionar el ticket creado en la lista.
3. Revisar el detalle del ticket.
4. Cambiar estado o prioridad si se desea.
5. Agregar una nota interna.
6. Presionar Diagnosticar con Fisher para ver sugerencias de resolucion.

Estados disponibles:

- open
- waiting_customer
- in_progress
- resolved
- closed

Prioridades disponibles:

- low
- normal
- high
- urgent

## 7. Flujo recomendado para soporte remoto

1. Crear o seleccionar un ticket.
2. Ejecutar diagnostico con Fisher si aplica.
3. Ir a la seccion Remoto.
4. Crear o usar la sesion remota asociada al ticket.
5. Asignar un agente Windows online.
6. Abrir el enlace de consentimiento.
7. El cliente aprueba el soporte remoto.
8. El operador inicia la sesion.
9. El operador activa Vista fluida, Vista calidad o solicita comandos de diagnostico.
10. Si se requiere control interactivo, presionar Pedir control.
11. El cliente aprueba el consentimiento adicional de control.
12. El operador puede enviar eventos simulados desde la vista en vivo.
13. Al terminar, cerrar la sesion.

## 8. Consentimiento del cliente

Cada sesion remota tiene un codigo unico y una pagina publica:

http://localhost:3110/remote/consent/{codigo}

Desde esa pagina el cliente puede:

- Aprobar el soporte remoto.
- Rechazar el soporte remoto.
- Aprobar o rechazar el control interactivo.
- Cerrar la sesion.

Regla principal: SAS no debe iniciar soporte remoto ni control interactivo sin consentimiento verificable.

## 9. Vista en vivo y capturas

La vista en vivo funciona mediante capturas periodicas solicitadas al agente Windows. La consola ofrece Fluida, Normal y Calidad. Fluida usa intervalo de 1 segundo, calidad 45 y ancho 960; Normal usa 2 segundos, calidad 62 y ancho 1280; Calidad usa 3 segundos, calidad 78 y ancho 1600. Desde la version 0.9 el agente usa `SasCaptureHelper.exe` si esta disponible para entregar JPEG redimensionado en lugar de PNG completo.

Flujo interno:

1. El operador activa Vista en vivo.
2. El servidor genera comandos screenshot_preview periodicos.
3. El agente captura la pantalla principal con `SasCaptureHelper.exe` si esta disponible; si no, usa fallback PowerShell de laboratorio.
4. El agente envia la imagen al servidor.
5. La consola muestra el ultimo frame disponible y refresca cada 2 segundos mientras la vista remota esta activa.

Notas importantes:

- Requiere consentimiento aprobado.
- Requiere agente asignado.
- Usa comandos de lista blanca.
- No ejecuta comandos arbitrarios del operador.
- La consola muestra Reciente cuando el ultimo frame esta dentro del margen esperado, Lenta cuando hay retraso moderado y Sin actualizar cuando el frame ya no representa el estado actual.
- Edad indica cuantos segundos han pasado desde el ultimo frame recibido. Latencia indica cuanto tardo el ciclo servidor-agente-servidor para entregar ese frame.
- Peso indica el tamano aproximado de la imagen recibida. Con `SasCaptureHelper.exe` el frame debe llegar como JPEG y pesar mucho menos que PNG completo.

### Capturador SAS Capture Helper

El helper se encuentra en `tools\\sas-capture-helper` y se compila con:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\\build-capture-helper.ps1
``` 

Salida esperada del helper:

- `mimeType`: normalmente `image/jpeg`.
- `width` y `height`: resolucion enviada a consola.
- `quality` y `maxWidth`: parametros usados.
- `imageBase64`: frame codificado para el servidor.

En produccion debe firmarse y agregarse a allowlist antivirus/EDR. El instalador cliente copia `tools` hacia `C:\\SAS\\Client`, configura `SAS_CAPTURE_HELPER_PATH` y registra el helper en `install-manifest.json`. El paquete portable tambien compila el helper antes de generar `manifest.json` y `sas-allowlist.json`.

## 10. Comandos de diagnostico disponibles

Desde la seccion Remoto se pueden solicitar comandos seguros:

- Sistema: informacion del equipo, usuario, sistema operativo, memoria y CPU.
- Red: interfaces de red del equipo.
- Discos: unidades, espacio libre y tamano.
- Procesos: snapshot de procesos activos.
- Servicios: snapshot de servicios Windows.
- Pantalla: captura puntual de pantalla.

Los resultados quedan registrados en la sesion y en la auditoria.

## 11. Control interactivo actual

El control interactivo esta en modo simulacion segura.

Que ya se puede probar:

- Solicitar control desde la consola.
- Autorizar control desde la pagina del cliente.
- Hacer click sobre la imagen de vista en vivo.
- Enviar tecla Enter simulado.
- Ver que el evento llegue al agente y vuelva como simulated.

Preparacion nativa agregada:

- `SasInputHelper.exe` permite `mouse_move`, `mouse_click` y `key_press` con lista blanca de teclas.
- El agente solo lo usa si `SAS_ENABLE_REAL_INPUT=true`.
- En instalacion normal permanece desactivado por defecto.

Que todavia no hace por defecto:

- No mueve el mouse real.
- No escribe teclado real.
- No controla ventanas reales del cliente.

Este modo es intencional para validar seguridad, consentimiento, auditoria y comunicacion antes de activar control real.

## 12. Panel local del agente

El agente Windows expone un panel solo en el equipo local:

http://127.0.0.1:37655

Permite revisar:

- Identidad del equipo.
- URL del servidor.
- Ultimo contacto con el servidor.
- Sesiones activas.
- Archivo de paro local.

Tambien permite finalizar sesiones activas desde el equipo cliente.

## 13. Paro local de emergencia

En el equipo cliente se puede finalizar cualquier sesion activa con:

C:\SAS\Client\stop-agent-sessions.ps1

Tambien se puede crear el archivo:

C:\SAS\Client\sas-agent-stop.flag

El agente detecta ese archivo, cierra las sesiones activas en el servidor y borra el archivo.

## 14. WhatsApp Cloud API

Para conectar WhatsApp se requiere configurar Meta Developers:

- Callback URL: https://tu-dominio.com/webhooks/whatsapp
- Verify token: mismo valor de WHATSAPP_VERIFY_TOKEN
- Access token: WHATSAPP_ACCESS_TOKEN
- Phone Number ID: WHATSAPP_PHONE_NUMBER_ID

El flujo preparado permite:

1. Recibir mensaje entrante.
2. Identificar telefono del cliente.
3. Crear ticket nuevo o actualizar ticket abierto.
4. Responder acuse por WhatsApp si las credenciales estan configuradas.
5. Alimentar el diagnostico de Fisher.
6. Detectar comandos cortos del cliente y operar el ticket.

Comandos disponibles por WhatsApp:

- ayuda: muestra acciones disponibles.
- estado: devuelve estado, prioridad, ultima actualizacion y sesion remota.
- enlace remoto: crea o recupera la liga segura de consentimiento.
- cancelar remoto: cierra la sesion remota abierta sin cerrar el ticket.
- hablar con tecnico: marca el ticket para atencion humana.
- cerrar ticket: cierra el ticket y sesiones remotas abiertas asociadas.

Si el mensaje no coincide con un comando, Fisher lo trata como descripcion del problema y ejecuta diagnostico. La auditoria registra cada mensaje como whatsapp.message e incluye el comando detectado cuando aplica.

Durante pruebas locales se puede usar la consola sin conectar Meta:

1. Abrir Atencion.
2. En el panel Fisher abrir Simular WhatsApp.
3. Escribir telefono y mensaje del cliente.
4. Presionar Enviar a Fisher.
5. Revisar el ticket creado, diagnostico y sesion remota preparada.

El simulador usa `/api/dev/whatsapp-simulate` y el mismo servicio conversacional que el webhook real. Esto permite probar el flujo completo antes de abrir dominio, puertos 80/443 y configuracion final de WhatsApp Cloud API.
## 15. Instalación final en Windows 11

El método recomendado es ejecutar como administrador `dist\SAS-Windows11-Setup-<version>.exe`.

El instalador valida Windows 11 x64, incluye Node.js, copia SAS a `C:\SAS\Server`, prepara configuración productiva, registra las tareas necesarias y crea el desinstalador. Antes de ejecutarlo debe verificarse el SHA-256 con el archivo o manifiesto que acompaña al EXE.

Si ya existe una instalación, guarda `.env`, `.env.production`, `data`, `certs` y manifiestos bajo `C:\SAS\Backups`. La desinstalación normal también conserva un respaldo.

Alternativa ZIP:

1. Extraer completamente `sas-windows11-final-<fecha>.zip`.
2. Ejecutar `INSTALAR-SAS.cmd`.
3. Aceptar UAC.
4. Si falta TLS, proporcionar correo para Let's Encrypt o completar el certificado después.

El paquete incluye su propio Node.js; no requiere instalar Node, Chocolatey ni winget. No incluye secretos, datos productivos ni certificados privados.

### Instalación del cliente en diferentes versiones de Windows

El servidor principal continúa dirigido a Windows 11. El instalador independiente `SAS-Cliente-Setup-<version>.exe` admite Windows 10, Windows 11 y Windows Server 2016 o posterior, siempre en 64 bits y con PowerShell 5.0 o posterior. Antes de copiar archivos comprueba producto, build, arquitectura y PowerShell; el resultado queda registrado en el manifiesto y el checklist del equipo.

Windows 7, 8, 8.1 y sistemas de 32 bits no se aceptan porque el runtime Node.js seguro incluido no tiene soporte vigente para ellos. La instalación se detiene antes de vincular el equipo y muestra un mensaje comprensible.

### Producción sin certificado de firma

El instalador actual no tiene Authenticode. Debe verificarse su SHA-256 y conservar `UnsignedRestrictedProduction`: tickets, Fisher, panel local, heartbeat, vista autorizada y auditoría operan, mientras captura e ingreso nativos permanecen deshabilitados.

### Validación del artefacto sin instalar

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-windows11-final-package.ps1 -PackagePath dist\sas-windows11-final-<fecha> -InstallerExe dist\SAS-Windows11-Setup-<version>.exe
~~~

El reporte `output\windows11-installer-validation-report.json` comprueba archivos, hashes, privacidad, runtime, preflight y EXE sin elevación ni cambios en servicios.

Para detalles de actualización y desinstalación, consultar `docs\windows-11-pro-mvp-deployment.md`.

## 16. Preflight cliente Windows

Antes de probar en una PC real, ejecutar:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-client-preflight.ps1 -BuildHelpers
```

El reporte se genera en:

```text
output\client-preflight-report.json
```

El preflight valida Windows, PowerShell, compilador .NET Framework, archivos del agente, helper de captura, helper de entrada, firmas Authenticode de helpers, contexto de usuario Windows, bandera `SAS_ENABLE_REAL_INPUT`, salud del servidor y panel local del agente.

La consola web muestra este resultado en Pruebas, panel Preflight cliente Windows. Internamente lee el ultimo reporte mediante `GET /api/client-preflight`, sin ejecutar scripts desde el navegador.

Resultado esperado para prueba normal: `status` en `pass` o `warn` controlado. Si aparece `fail`, corregir antes de instalar o entregar el cliente. Para control real de laboratorio, revisar especialmente `input_helper_signature`, `real_input_guard` y `real_input_lab_ready`. Si el helper no esta firmado, el sistema debe permanecer en modo simulado o laboratorio, no produccion.

Para generar paquete portable de prueba:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-portable.ps1
```

El paquete queda en `dist\sas-support-portable-FECHA-HORA` e incluye manifest, allowlist y reporte de firmas.
## 16.1 Arranque local unificado

Para levantar servidor y agente local en ambiente de pruebas:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-local-stack.ps1
```

Resultado esperado:

- Servidor en `http://localhost:3110`.
- Panel local del agente en `http://127.0.0.1:37655`.
- Entrada real desactivada.
- Reporte en `output\local-stack-status.json` con salud HTTP, panel local, preflight, PIDs activos, escucha de puertos, rutas de logs y error concreto cuando alguna validacion falla.
- Agentes sin heartbeat reciente pasan a Desconectado para no contar equipos fantasmas como activos.

Para forzar reinicio de ambos procesos:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-local-stack.ps1 -Restart
```

El reinicio valida que los puertos locales queden liberados antes de levantar de nuevo el servidor y el agente. Si un puerto queda ocupado, el script debe detenerse con un mensaje claro en lugar de dejar un estado confuso. Los logs `logs\sas-server.out.log` y `logs\sas-agent.out.log` registran el PID iniciado para poder cruzarlo con el administrador de tareas.
## 16.2 Validacion automatizada local

Para validar sintaxis y pruebas basicas en una instalacion con npm disponible:

```powershell
npm run check
```

En el entorno de desarrollo actual tambien se puede ejecutar directamente con Node:

```powershell
node --test tests\*.test.js
```

La primera cobertura automatizada valida que los agentes con heartbeat reciente aparezcan En linea, que los agentes viejos pasen a Desconectado y que un heartbeat nuevo reactive el agente.

Tambien valida el flujo conversacional de WhatsApp: un mensaje que pide soporte remoto crea ticket y sesion remota, el comando enlace remoto reutiliza la sesion abierta, el comando cancelar remoto cierra solo la sesion remota y el comando cerrar ticket cierra el ticket junto con sus sesiones relacionadas.

## 17. Pruebas guiadas en consola

La consola incluye una seccion Pruebas para acelerar la validacion inicial.

Desde esta pantalla se puede:

- Ver si el servidor esta activo.
- Ver cuantos agentes estan online.
- Crear ticket y sesion remota de prueba.
- Abrir el consentimiento del cliente.
- Asignar el primer agente disponible.
- Iniciar la sesion cuando el consentimiento este aprobado.
- Activar Vista fluida para probar recepcion mas agil de pantalla.
- Pedir control interactivo.
- Enviar Enter simulado cuando el control este aprobado.
- Probar el comando Sistema despues de aprobar consentimiento general.
- Confirmar el checklist de comando de sistema completado.
- Confirmar el checklist de evento simulado recibido.
- Presionar Cerrar prueba para apagar la sesion remota y registrar auditoria.

La vista muestra un checklist con estos puntos: preflight cliente Windows, servidor activo, agente online, ticket de prueba, sesion remota, agente asignado, consentimiento aprobado, sesion iniciada, vista en vivo validada, control aprobado, comando de sistema completado, evento simulado recibido y sesion de prueba cerrada.

La guia avanza con el primer punto pendiente, aparece como primer panel de la pantalla y muestra una sola accion principal para continuar. Las acciones tecnicas quedan dentro de Mas acciones. El reporte guiado elige la sesion con mayor evidencia de avance cuando existen varias sesiones del mismo ticket, para evitar que una sesion vacia creada por error o por diagnostico desplace la prueba real. El boton Cerrar prueba ejecuta el cierre normal de la sesion, apaga vista en vivo, cancela pendientes y registra `remote.close` en auditoria. Cuando todos los pasos estan completos, indica que la prueba guiada fue completada y recomienda revisar auditoria.

Por seguridad, los comandos remotos no se pueden enviar antes de que el cliente apruebe el consentimiento general. En ese estado el servidor responde 409 y la consola muestra el aviso correspondiente.

### 17.1 Reporte de prueba guiada

La consola muestra el panel Reporte de prueba dentro de Pruebas. Este panel resume el flujo completo de validacion:

- Estado general: `not_started`, `in_progress` o `completed`.
- Porcentaje completado y numero de pasos validados.
- Siguiente accion recomendada.
- Ticket, sesion remota, agente asignado y ultimos eventos de auditoria.
- Checks de ticket, sesion, agente online, consentimiento, vista remota, comando Sistema, control, evento interactivo y cierre.

El endpoint interno es `GET /api/tests/guided-report`. Debe consultarse con rol autorizado para auditoria. El reporte usa la bitacora para validar eventos historicos importantes, por ejemplo control aprobado, aunque despues el cliente haya revocado control o cerrado la sesion.

## 17.2 Seguridad remota validada

La consola de Conexion muestra una tarjeta de seguridad por sesion con estos puntos:

- Permiso del cliente.
- Estado de pantalla compartida.
- Estado de control remoto.
- Acciones pendientes en cola.
- Acciones canceladas por cierre, rechazo o bloqueo.

Reglas protegidas por pruebas automatizadas:

- No iniciar soporte remoto sin consentimiento del cliente.
- No enviar comandos remotos sin consentimiento.
- No enviar eventos de teclado/mouse sin control aprobado.
- Al cerrar una sesion se cancelan comandos y eventos pendientes.
- Al rechazar control se cancelan eventos interactivos pendientes.

La vista principal de Conexion oculta sesiones expiradas o rechazadas para reducir ruido operativo. El historial sigue quedando disponible en auditoria y base local.

## 17.3 Fluidez de pantalla remota validada

La vista remota ahora conserva el perfil elegido por el tecnico y registra la latencia del ultimo frame recibido. Esto ayuda a distinguir si el problema esta en la red, en el equipo cliente o en el peso de la imagen.

Perfiles recomendados:

- Fluida: usar durante diagnostico normal o redes lentas. Prioriza refresco de pantalla sobre detalle visual.
- Normal: usar como perfil base para la mayoria de sesiones.
- Calidad: usar cuando sea necesario leer texto pequeno o revisar detalles visuales.

La prueba automatizada confirma que Fluida crea frames livianos cada 1 segundo, envia al agente calidad 45/ancho 960 y guarda `lastFrameLatencyMs` para telemetria.
## 17.4 Registro legible

La vista Registro traduce eventos tecnicos a nombres operativos. Ejemplos:

- `server.boot` se muestra como Servidor iniciado.
- `agent.register` se muestra como Equipo conectado.
- `remote.command.queue` se muestra como Comando remoto enviado.
- `remote.control.approved` se muestra como Cliente aprobo control.
- `whatsapp.message` se muestra como Mensaje WhatsApp recibido.

Cada tarjeta conserva actor, entidad, fecha y datos clave como codigo remoto, estado, comando, categoria, agente, IP o puerto. Los eventos `auth.denied` aparecen como Acceso denegado y muestran motivo, permiso, metodo, ruta e IP en chips legibles. Cuando existen accesos denegados recientes, Registro muestra un resumen superior con conteo, ultimo motivo y hora. El filtro Todos/Seguridad permite aislar los eventos de acceso denegado sin exportar la auditoria completa. Los filtros Remoto y Tickets permiten revisar actividad de sesiones, comandos, consentimiento, mensajes WhatsApp y cambios de casos sin mezclar todo el historial. La API `/api/audit` y la exportacion CSV/JSON respetan el filtro activo para que el archivo descargado coincida con la vista del tecnico. Al cambiar el filtro en Registro, la consola limpia la lista local, muestra Cargando eventos y consulta de nuevo la API filtrada. El objetivo es que el tecnico pueda revisar auditoria sin interpretar codigos internos ni confundir una carga temporal con una lista vacia.

## 18. Pruebas sugeridas ahora

Prueba A - Consola y tickets:

1. Abrir consola.
2. Crear ticket demo.
3. Cambiar prioridad.
4. Agregar nota.
5. Ejecutar diagnostico con Fisher.
6. Confirmar evento en Auditoria.

Prueba B - Agente:

1. Abrir panel local del agente.
2. Confirmar que aparece online.
3. Revisar ultima conexion.
4. Confirmar que el mismo agente aparece en la consola.

Prueba C - Soporte remoto con emparejamiento y consentimiento:

1. Solicitar soporte remoto desde WhatsApp o el simulador.
2. Confirmar que Fisher entrega un código de 6 caracteres.
3. Abrir `http://127.0.0.1:37655` en la computadora afectada.
4. Introducir el código en **Vincular este equipo**.
5. Confirmar que SAS muestra el equipo asignado y audita `remote.pair_agent`.
6. Abrir la liga de consentimiento.
7. Aprobar soporte remoto.
8. Iniciar la sesión.
9. Ejecutar un diagnóstico seguro.
10. Cerrar la sesión.

Prueba D - Control simulado:

1. Pedir control desde la consola.
2. Aprobar control desde la pagina del cliente.
3. Activar Vista en vivo.
4. Hacer click sobre la imagen.
5. Presionar Enter simulado.
6. Ver eventos simulated en la sesion y Auditoria.


Prueba F - Panel local del agente:

1. Abrir `http://127.0.0.1:37655`.
2. Crear sesion remota y aprobar consentimiento general.
3. Iniciar sesion y activar Vista fluida.
4. Solicitar y aprobar control.
5. Confirmar que el panel local muestre vista en vivo activa y control aprobado.
6. Confirmar que el modo de control siga en Simulado salvo que se active explicitamente `SAS_ENABLE_REAL_INPUT=true`.
7. Presionar Finalizar sesiones activas desde el panel local.
8. Confirmar que la sesion queda `closed`, la vista en vivo se apaga y el control queda `revoked`.

Prueba G - WhatsApp simulado y emparejamiento:

1. Confirmar servidor local activo en `http://localhost:3110`.
2. Ejecutar:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\simulate-whatsapp-message.ps1 -ServerUrl http://127.0.0.1:3110 -From 5215559002000 -Message "Necesito soporte remoto por AnyDesk, no abre Outlook"
```

3. Confirmar que se crea el ticket WhatsApp.
4. Confirmar que Fisher responde con diagnóstico, código y enlace `/remote/consent/{codigo}`.
5. Abrir el panel local del agente e introducir el código.
6. Confirmar que la sesión conserva consentimiento pendiente y queda asignada al `machineId` correcto.
7. Enviar un segundo mensaje del mismo cliente y confirmar que reutiliza la sesión.
8. Aprobar el consentimiento.
9. Confirmar que sólo el agente vinculado recibe la sesión.

Prueba H - Comandos por WhatsApp:

1. Enviar `ayuda` y confirmar que Fisher lista comandos.
2. Enviar `enlace remoto` y confirmar que se crea o recupera una sesion remota.
3. Enviar `estado` y confirmar que devuelve ticket, prioridad y codigo remoto.
4. Enviar `cancelar remoto` y confirmar que la sesion remota queda cerrada pero el ticket sigue abierto.
5. Enviar `hablar con tecnico` y confirmar que el ticket pasa a `in_progress`.
6. Enviar `cerrar ticket` y confirmar que el ticket queda `closed` y la sesion remota asociada tambien se cierra.

## 18. Panel de seguridad del cliente

La pagina de consentimiento ahora tambien funciona como panel de seguridad vivo.

Incluye:

- Banner principal de estado.
- Codigo de sesion.
- Estado de soporte remoto.
- Estado de sesion.
- Estado de vista en vivo.
- Estado de control interactivo.
- Boton destacado Finalizar sesion ahora.
- Controles que se muestran u ocultan segun el estado real.

Este panel ayuda a cumplir el requisito de transparencia antes de activar control real. El cliente siempre debe poder ver si hay una sesion activa y finalizarla inmediatamente.

## 18.1 Capacidades visibles del agente Windows

La pantalla Agentes ahora muestra chips simples para confirmar si el equipo cliente esta listo para pruebas remotas:

- Captura optimizada: indica si `SasCaptureHelper.exe` esta disponible para JPEG liviano.
- Control simulado o Control real: indica si `SAS_ENABLE_REAL_INPUT` esta apagado o encendido.
- Helper control listo: indica si `SasInputHelper.exe` esta disponible.
- Panel local: muestra el puerto del panel de seguridad del agente.

El agente reporta estas capacidades en registro y heartbeat. El servidor las conserva y la consola las muestra sin exponer JSON tecnico. Esto ayuda a decidir si una maquina esta lista para prueba real antes de enviar eventos de mouse o teclado.

Pruebas automatizadas agregadas:

- El registro del agente conserva capacidades de captura, control e input helper.
- El heartbeat actualiza capacidades si cambia la configuracion o aparece el helper.
## 18.2 Preflight de control real seguro

El reporte `output\client-preflight-report.json` ahora separa la prueba normal del control real de laboratorio.

Checks clave:

- `input_helper_signature`: confirma si `SasInputHelper.exe` tiene firma Authenticode valida.
- `windows_user_context`: registra usuario Windows y si corre como administrador para diagnostico de UAC/EDR.
- `real_input_guard`: confirma si `SAS_ENABLE_REAL_INPUT` esta apagado o activo.
- `real_input_lab_ready`: confirma si Windows, helper compilado y firma permiten avanzar a laboratorio controlado.

Estado esperado hoy: `warn` controlado, porque los helpers estan compilados pero aun no tienen firma valida. Esto es correcto para avanzar en desarrollo y evita activar control real como flujo normal.
## 18.3 Aviso visual de control real

La consola ahora muestra un aviso simple en dos lugares:

- En Conexion, dentro de cada sesion remota.
- En Guia, dentro del panel Preflight cliente Windows.

Estados visibles:

- Control seguro en modo simulado: estado normal para pruebas y soporte sin entrada real.
- Control real activo con bloqueo: la bandera esta activa, pero falta firma valida o requisito de laboratorio.
- Control real de laboratorio activo: el preflight permite laboratorio controlado; aun requiere consentimiento y paro local verificados.

El aviso resume el preflight, la firma del helper de control y el estado `real_input_lab_ready`. El objetivo es que el tecnico sepa, antes de presionar Enter o hacer clic en la pantalla, si SAS ejecutara eventos simulados o si existe riesgo de entrada real.
## 18.4 Auditoria de control simulado y real

SAS ahora distingue el resultado de eventos interactivos:

- `simulated`: evento recibido en modo seguro, sin tocar mouse ni teclado real.
- `completed`: evento ejecutado por helper nativo cuando `SAS_ENABLE_REAL_INPUT=true` y el agente reporta `simulated=false`.
- `failed`: evento fallido o rechazado por el helper/agente.

La vista Conexion muestra tarjetas legibles: Simulado, Ejecutado o Error. Auditoria `remote.event.result` registra `simulated`, `executed`, `helper`, `executedAt` y error cuando aplique. Esto deja trazabilidad clara antes de cualquier prueba de control real.

Pruebas automatizadas agregadas:

- Evento seguro conserva estado `simulated`.
- Evento real reportado por `SasInputHelper.exe` queda como `completed` y conserva datos del helper.
## 18.5 Laboratorio de control real separado

La pantalla Guia ahora incluye el panel Laboratorio control real. Este panel no reemplaza la prueba normal y mantiene bloqueado el boton de entrada real hasta cumplir todos los requisitos.

Checklist del laboratorio:

- Preflight ejecutado.
- Helper de control firmado.
- Entrada real activada con `SAS_ENABLE_REAL_INPUT=true`.
- Laboratorio listo segun `real_input_lab_ready`.
- Consentimiento de control aprobado.

Mientras algun requisito falte, la consola muestra el estado Enter real bloqueado sin presentarlo como accion clickeable. Cuando todos los requisitos esten listos, se habilita Probar Enter real. Antes de enviar el evento, la consola vuelve a revisar el preflight en memoria y bloquea la accion si ya no esta listo.
## 19. Revocacion inmediata y colas pendientes

SAS cancela acciones pendientes cuando el cliente revoca permisos o cierra una sesion.

Casos cubiertos:

- Si el cliente rechaza consentimiento general, se detiene vista en vivo y se cancelan comandos/eventos pendientes.
- Si el cliente rechaza control interactivo, se cancelan eventos de mouse/teclado pendientes.
- Si la sesion se cierra desde consola, cliente o agente local, se cancelan comandos y eventos pendientes.
- Si el agente reporta tarde una accion que ya fue cancelada, el servidor conserva el estado `cancelled`.
- El polling del agente solo entrega eventos interactivos cuando la sesion esta activa, el consentimiento general esta aprobado y el control interactivo sigue aprobado.

Esto es necesario antes de activar control real, porque evita que una accion antigua sobreviva a una revocacion del cliente.

## 20. Firma digital y verificacion

SAS incluye scripts para preparar una liberacion firmada:

- `scripts\sign-release.ps1`: firma archivos distribuibles dentro de un paquete.
- `scripts\verify-signatures.ps1`: genera `signature-report.json` con estado Authenticode.
- `scripts\build-portable.ps1`: compila el helper, opcionalmente firma y despues genera manifest/allowlist.
- `docs\release-signing.md`: guia operativa de firma.

Flujo recomendado cuando exista certificado:

1. Crear paquete portable.
2. Firmar con `-SignPackage -CertificateThumbprint THUMBPRINT`.
3. Verificar que `signature-report.json` tenga firmas validas.
4. Generar hashes finales despues de firmar.
5. Probar en Windows limpio y Defender/EDR.

En desarrollo, el reporte puede mostrar `NotSigned`. Eso es esperado hasta comprar o instalar el certificado de Code Signing.

## 20.1 Produccion restringida sin firma

Si por costo o disponibilidad todavia no se puede comprar certificado Code Signing, SAS puede operar con un perfil restringido preparado para produccion inicial. Este perfil no intenta evitar antivirus: reduce el riesgo apagando lo mas sensible.

Que funciona en este modo:

- Tickets, consola web y roles.
- WhatsApp cuando el servidor tenga HTTPS valido.
- Fisher, diagnostico, base de conocimiento y aprendizaje revisado.
- Agente Windows con heartbeat, panel local y paro inmediato.
- Sesiones remotas con consentimiento.
- Vista de pantalla por fallback documentado.
- Comandos de diagnostico en lista blanca.
- Auditoria de consentimientos, comandos, eventos y sesiones.

Que queda bloqueado:

- `SasCaptureHelper.exe` en produccion.
- `SasInputHelper.exe` en produccion.
- Control real de mouse y teclado.
- Captura JPEG optimizada por helper nativo.
- Cualquier intento de activar `SAS_ENABLE_REAL_INPUT=true` mientras `SAS_UNSIGNED_RESTRICTED_PRODUCTION=true`.

Crear paquete portable restringido:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-portable.ps1 -UnsignedRestrictedProduction
```

Instalar cliente restringido:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-client.ps1 -ServerUrl https://tu-dominio.com -AgentSharedSecret "SECRETO" -UnsignedRestrictedProduction
```

Validar preflight restringido:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\test-client-preflight.ps1 -UnsignedRestrictedProduction -OutputPath output\client-preflight-unsigned-restricted.json
```

Resultado esperado: `pass`. En la consola, el agente debe verse como `Produccion restringida`, sin captura optimizada y sin helper de control. El instalador tambien deja `post-install-checklist.json` y `POST-INSTALL-CHECKLIST.txt` dentro de `C:\SAS\Client` para evidencia de entrega. Si despues compramos firma, se instala de nuevo sin `-UnsignedRestrictedProduction`, se verifica firma y se vuelve a probar laboratorio antes de control real.

## 21. Let's Encrypt para HTTPS

Let's Encrypt sirve para certificado TLS del servidor SAS:

- Consola publica por HTTPS.
- Webhook WhatsApp Cloud API.
- Enlaces de consentimiento remoto.

No sirve para firmar codigo. Para `SasCaptureHelper.exe`, scripts PowerShell o instaladores se requiere certificado Code Signing.

Requisitos:

- Dominio real, por ejemplo `soporte.tu-dominio.com`.
- DNS apuntando al servidor SAS.
- Puerto 80 accesible desde Internet para HTTP-01, o DNS-01 con proveedor DNS.
- Puerto 443 abierto para HTTPS.
- Cliente ACME como win-acme (`wacs.exe`) en Windows.

Script preparado:

```powershell
.\scripts\test-domain-readiness.ps1 -Domain setinfo.sytes.net
.\scripts\request-letsencrypt-elevated.ps1 -Domain setinfo.sytes.net -Email jcmtza@gmail.com
```

Cuando el certificado quede emitido, SAS queda preparado para operar por HTTPS en el puerto 443. En produccion inicial se recomienda dejar `ENABLE_HTTP=false`; el puerto 80 se reserva para validacion y renovacion de Let's Encrypt. Arrancar SAS en modo produccion desde PowerShell Administrador:

```powershell
.\scripts\start-production-server.ps1
```

Despues de arrancar produccion, ejecutar:

```powershell
.\scripts\test-production-smoke.ps1 -BaseUrl https://setinfo.sytes.net
```

El reporte queda en `output\production-smoke-report.json` y revisa certificado TLS, `/health`, verificacion del webhook WhatsApp y `/api/admin/readiness` usando el token de `.env.production` cuando exista.
Para diagnostico rapido de produccion sin abrir logs manualmente:

```powershell
.\scripts\get-production-status.ps1 -LocalOnly
.\scripts\get-production-status.ps1 -RemoteOnly -BaseUrl https://setinfo.sytes.net -HostName setinfo.sytes.net
```

`-LocalOnly` confirma proceso, listener 443 y `/health` local aunque la ruta publica/NAT este lenta. El modo publico valida TLS y health contra el dominio final.
Para monitoreo operativo y reinicio controlado por tarea programada:

```powershell
.\scripts\monitor-production.ps1 -LocalOnly
.\scripts\monitor-production.ps1 -LocalOnly -RestartOnFail
.\scripts\restart-production-task.ps1
```

`monitor-production.ps1` guarda `output\production-monitor-report.json`. El reinicio controlado guarda `output\production-restart-report.json` y requiere que exista la tarea `SAS Support Server Production`.

El script copia el resultado a:

- `certs\server.key`
- `certs\server.crt`

Variables SAS recomendadas:

```text
PUBLIC_BASE_URL=https://soporte.tu-dominio.com
ENABLE_HTTP=false
HTTP_PORT=80
ENABLE_HTTPS=true
HTTPS_PORT=443
TLS_KEY_PATH=certs/server.key
TLS_CERT_PATH=certs/server.crt
```

Renovacion:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\renew-letsencrypt-cert.ps1 -WacsPath C:\tools\win-acme\wacs.exe
```

Para renovar, detener SAS si ocupa el puerto 80, ejecutar el script y reiniciar la tarea productiva para recargar el certificado. El script evita copiar `chain-only` y actualiza `certs\server.key` y `certs\server.crt`.
## 22. Preparacion antivirus y EDR

SAS incluye una estrategia para reducir falsos positivos en antivirus y EDR.

Archivos agregados para seguridad corporativa:

- `docs/antivirus-allowlist.md`: rutas, procesos, puertos, dominios y recomendaciones de allowlist.
- `docs/security-manifest.md`: comportamiento declarado del servidor y agente.
- `docs/code-signing-plan.md`: plan de firma digital para produccion.
- `docs/unsigned-restricted-production.md`: produccion inicial sin firma con helpers nativos deshabilitados.
- `scripts/generate-allowlist.ps1`: genera inventario SHA256 de archivos distribuibles.

Cambios operativos realizados:

- Los logs del cliente quedan en `logs\\sas-agent.log` y `logs\\sas-agent.err.log`.
- Los logs del servidor quedan en `logs\\sas-server.log` y `logs\\sas-server.err.log`.
- Los instaladores generan `install-manifest.json`.
- El paquete portable genera `manifest.json` y `sas-allowlist.json`.
- Se documentan tareas programadas, rutas, procesos y puertos esperados.

Recomendaciones antes de produccion:

1. Firmar instaladores, scripts y binarios con certificado Code Signing.
2. Usar timestamp RFC3161.
3. Mantener publisher y rutas estables.
4. Enviar falsos positivos a vendors si aparecen.
5. No activar control real hasta tener firma digital, indicador local y revocacion inmediata.
6. Si no hay firma, usar `-UnsignedRestrictedProduction` y documentar que el agente opera sin helpers nativos.

## 22.1 Estado del sistema y respaldos

La vista Registro incluye el panel Estado del sistema. Este panel ayuda a operar SAS en pruebas reales y produccion inicial sin abrir archivos manualmente.

Muestra:

- Estado de la base local.
- Tamano actual de `data\sas-db.json`.
- Ruta de datos y ruta de backups.
- Cantidad de respaldos disponibles.
- Ultima modificacion de la base.
- Ultimo respaldo detectado.
- Conteos de tickets, sesiones, equipos, auditoria y soluciones.

Accion principal:

- Crear respaldo: genera una copia en `data\backups` y registra auditoria `admin.backup`.

Endpoint interno:

```text
GET /api/admin/storage
POST /api/admin/backup
```

Recomendacion operativa: crear un respaldo antes de pruebas importantes, antes de cambios de configuracion y al cierre de cada jornada de pruebas con clientes reales.
## 22.1.1 Evidencia de instalaciones

La vista Registro incluye el panel Instalaciones. Este panel lee los archivos generados por los instaladores y resume si servidor y cliente tienen evidencia post-instalacion.

Archivos leidos:

- `install-manifest.json`.
- `post-install-checklist.json`.

Muestra por componente:

- Ruta de instalacion.
- Estado general: Correcto, Aviso, Error o Sin manifest.
- Conteo de checks correctos, avisos y errores.
- Perfil `Produccion restringida` cuando el cliente se instalo con `-UnsignedRestrictedProduction`.
- Token de consola configurado y secretos generados, solo por nombre o conteo, nunca el valor real.

Endpoint interno:

```text
GET /api/admin/installations
```

Variable opcional para ubicar el cliente si no esta en `C:\SAS\Client`:

```text
SAS_CLIENT_INSTALL_PATH=C:\SAS\Client
```

Uso recomendado: despues de instalar servidor o cliente, abrir Registro y confirmar que el panel muestra evidencia antes de iniciar pruebas con clientes reales.

## 22.1.2 Centro de operacion productiva

La vista Registro incluye el panel Operacion productiva. Este panel no ejecuta pruebas reales ni toca puertos; solo lee reportes ya generados para dar una vista clara del estado del MVP.

Reportes leidos:

- `output\production-smoke-report.json`.
- `output\production-monitor-report.json`.
- `output\production-task-verification.json`.
- `output\domain-readiness-report.json`.
- `output\production-config-report.json`.
- `install-manifest.json`.
- `post-install-checklist.json`.

Muestra:

- Estado general: Correcto, Aviso o Error.
- Cantidad de reportes listos contra reportes esperados.
- Reportes requeridos y opcionales.
- Fecha del reporte cuando exista.
- Vigencia: Reciente, Reporte viejo o Sin fecha.
- Resumen y siguiente accion sugerida.
- Plan de accion con severidad, responsable y comando sugerido.

Endpoint interno:

```text
GET /api/admin/operations
```

Tambien puede generarse evidencia offline sin abrir la consola:

```powershell
npm run ops:report
```

Este comando crea:

- `output\production-operations-report.json`.
- `output\production-operations-report.md`.

El lector acepta JSON UTF-8 con BOM generado por PowerShell. Los reportes requeridos con mas de 48 horas se marcan como aviso para evitar tomar evidencia vieja como estado vigente. Los opcionales se consideran viejos despues de 168 horas. Desde la version 3.80, una falla opcional no bloquea el estado general: se muestra como Aviso salvo que exista una falla requerida.

Uso recomendado: antes de una prueba real, abrir Registro o ejecutar `npm run ops:report` y revisar que Operacion productiva no tenga errores requeridos. Si solo hay avisos opcionales, el MVP puede seguir operando de forma controlada mientras se completan evidencias como dominio o tarea programada elevada. El plan de accion indica quien debe atender cada pendiente y que comando conviene ejecutar primero.

## 22.1.3 Semaforo de produccion

La vista Registro incluye el panel Semaforo de produccion. Este panel combina Preparacion y Operacion productiva para dar una decision simple antes de usar SAS con clientes reales.

Decisiones posibles:

- Verde - listo para produccion: no hay bloqueos ni avisos relevantes.
- Amarillo - listo con avisos: se puede operar produccion inicial de forma controlada, pero hay pendientes no bloqueantes.
- Rojo - bloqueado: existe al menos una falla requerida que debe corregirse antes de operar.

Endpoint interno:

```text
GET /api/admin/production-traffic-light
GET /api/admin/release-gate
GET /api/admin/production-traffic-light-history
```

Reporte offline:

```powershell
npm run semaforo:produccion
npm run release:gate
```

Este comando crea:

- `output\semaforo-produccion-report.json`.
- `output\release-gate-report.json` para compatibilidad.
- `output\semaforo-produccion-report.md`.
- `output\release-gate-report.md` para compatibilidad.
- `output\semaforo-produccion-history.json`.
- `output\semaforo-produccion-history.md`.

El semaforo muestra bloqueos, avisos y acciones principales con severidad, fuente, responsable y comando sugerido. Si falla algo opcional, queda en Amarillo, no Rojo. Cada ejecucion offline guarda historial para revisar si el estado avanza de Rojo o Amarillo hacia Verde.

## 20.2 Exportacion de auditoria

La vista Registro incluye botones CSV y JSON en Eventos recientes.

Estos botones descargan evidencia de auditoria sin abrir manualmente la base local.

Endpoint interno:

```text
GET /api/audit/export?format=csv&limit=1000
GET /api/audit/export?format=json&limit=1000
```

Cada exportacion queda registrada como `audit.export` con actor, formato y limite. Esto ayuda a comprobar acciones realizadas durante una prueba, soporte remoto o revision de seguridad.

## 21.1 Inicio de sesion en la consola web

La consola web reutiliza exactamente las mismas cuentas autorizadas de la aplicacion Android. No se crean usuarios ni perfiles paralelos.

Flujo normal:

1. Abrir la consola SAS.
2. Escribir el mismo usuario y contrasena asignados para la aplicacion movil.
3. SAS obtiene el rol real de la cuenta: administrador, supervisor, tecnico o consulta.
4. La sesion se renueva automaticamente mientras siga autorizada.
5. Al presionar Salir, el servidor revoca la sesion inmediatamente.

Tambien se conservan el bloqueo por intentos fallidos, el cambio obligatorio de contrasena temporal, la revocacion de dispositivos y la desactivacion de usuarios. Las credenciales de sesion se guardan solo en la pestana actual del navegador; al cerrarla dejan de estar disponibles localmente.

El token maestro `CONSOLE_SHARED_TOKEN` ya no aparece en la barra superior ni se usa durante la operacion normal. Queda dentro de **Acceso de recuperacion local**, en la pantalla de inicio, para emergencias donde las cuentas autorizadas no esten disponibles. Debe seguir siendo largo, secreto y exclusivo del administrador.

Cada inicio, rechazo, renovacion, cambio de contrasena y cierre desde navegador se registra como `console.auth.*`. Los rechazos por token o permiso siguen registrandose como `auth.denied`, sin guardar contrasenas ni tokens.

## 22.2 Preparacion automatica de produccion

La vista Registro tambien muestra un bloque Preparacion. Este bloque calcula un porcentaje de readiness operativo y lista pendientes concretos antes de usar SAS con clientes reales. Desde la version 3.36 tambien muestra tarjetas de Siguiente paso con prioridad, responsable y accion concreta para que el operador no tenga que interpretar mensajes tecnicos. Desde la version 3.77 separa `MVP operativo` de readiness total: los checks requeridos determinan si se puede operar el MVP, mientras WhatsApp real, agentes, preflight, Google AI y aprendizaje Fisher pueden aparecer como recomendados u opcionales sin bloquear el arranque controlado.

Revisa:

- URL publica `PUBLIC_BASE_URL`.
- HTTPS y archivos TLS.
- Token de consola `CONSOLE_SHARED_TOKEN`.
- Secreto real `AGENT_SHARED_SECRET`.
- Credenciales WhatsApp.
- Base local y respaldos.
- Agentes online.
- Preflight cliente Windows.
- Seguridad remota: TTL e intentos maximos.
- Google AI y revision humana.
- Aprendizaje Fisher con base aprobada, propuestas pendientes y reparaciones confirmadas.

Endpoint interno:

```text
GET /api/admin/readiness
```

En ambiente local es normal que aparezcan bloqueos por `localhost`, HTTPS deshabilitado y secreto demo. En produccion esos puntos deben pasar a Correcto antes de activar WhatsApp real y clientes externos.

Desde la version 3.63 Preparacion tambien incluye `Aprendizaje Fisher`. Este check revisa articulos aprobados, propuestas en revision y resultados confirmados de reparaciones. Si hay conocimiento aprobado y reparaciones confirmadas, el aprendizaje queda listo. Si solo hay senales parciales, muestra el siguiente paso Alimentar aprendizaje Fisher para confirmar mas resultados o aprobar propuestas desde Soluciones.

## 23. Aprendizaje continuo de Fisher

Fisher ya puede reutilizar resoluciones aprendidas desde tickets.

Flujo recomendado:

1. Resolver un ticket y validar la solucion con el cliente.
2. En el detalle del ticket, escribir la resolucion en Nota interna, una linea por paso.
3. Presionar Aprender resolucion.
4. Confirmar que aparece un articulo nuevo en Conocimiento.
5. Ejecutar Diagnosticar con Fisher usando un problema similar.
6. Confirmar que el diagnostico indique `source: knowledge_base` y `articleId`.

Controles incluidos:

- Requiere permiso `kb:write`.
- Registra auditoria `knowledge.learn_from_ticket`.
- Agrega nota interna al ticket con el articulo creado.
- El articulo conserva `sourceTicketId` para trazabilidad.

No se deben guardar contrasenas, tokens privados ni datos sensibles dentro de la resolucion aprendida.
## 24. Investigacion con Google AI

SAS puede generar propuestas de resolucion usando Google Gemini con busqueda web cuando se configure la integracion.

Estado por defecto:

- Desactivado: `GOOGLE_AI_ENABLED=false`.
- Requiere revision: `GOOGLE_AI_REQUIRE_REVIEW=true`.
- Modo prueba sin API: `GOOGLE_AI_MOCK=true`.

Flujo seguro:

1. Abrir un ticket.
2. Escribir contexto adicional en Nota interna si aplica.
3. Presionar Investigar Google AI.
4. Revisar la propuesta en Conocimiento.
5. Validar pasos, riesgos y citas.
6. Presionar Aprobar si procede.
7. Fisher solo usara ese articulo despues de aprobado.

Variables:

```text
GOOGLE_AI_ENABLED=true
GEMINI_API_KEY=tu-api-key
GOOGLE_AI_MODEL=gemini-2.5-flash
GOOGLE_AI_REQUIRE_REVIEW=true
```

Regla principal: Google AI ayuda a investigar, pero no aprende automaticamente sin aprobacion humana.
## 25. Ranking de revision Google AI

Las propuestas generadas por Google AI reciben un ranking de revision para acelerar el trabajo del tecnico.

Campos principales:

- `reviewScore*`: valor de 0 a 100, actualmente en observacion.
- `reviewRecommendation`: recommended_for_approval, needs_review o high_risk_review.
- `reviewSignals`: razones que explican el puntaje.

Comportamiento de Fisher:

1. Si hay articulo aprobado, Fisher lo usa como `knowledge_base`.
2. Si no hay articulo aprobado pero existe propuesta pendiente con score alto, Fisher devuelve `source: pending_review_ranked`.
3. En ese caso `nextAction` queda como `review_ai_proposal`.
4. El tecnico puede revisar y aprobar desde Conocimiento.
5. Despues de aprobar, Fisher ya usa la solucion como conocimiento normal.

Esto acelera la revision sin permitir aprendizaje automatico no validado. El asterisco indica que el criterio de ranking esta en observacion y podra modificarse segun los resultados reales.
## 26. Cola de revision de conocimiento

La base de conocimiento tiene una cola para propuestas pendientes generadas por Google AI.

Endpoint:

```text
GET /api/knowledge/review-queue
```

Comportamiento:

- Lista articulos `pending_review` ordenados por `reviewScore*` descendente.
- La consola muestra ranking, recomendacion y senales de revision.
- El tecnico puede aprobar o rechazar.
- Al aprobar, Fisher puede usar la solucion como `knowledge_base`.
- Al rechazar, Fisher deja de sugerirla como candidato pendiente.

Estados usados:

- `pending_review`: pendiente de revision humana.
- `approved`: usable por Fisher como conocimiento oficial.
- `rejected`: conservado para auditoria, pero no usado por Fisher.
## 27. Metricas de observacion reviewScore

Para evaluar `reviewScore*`, SAS expone metricas simples de revision.

Endpoint:

```text
GET /api/knowledge/review-metrics
```

Campos:

- `pending`: propuestas pendientes.
- `approved`: propuestas aprobadas.
- `rejected`: propuestas rechazadas.
- `averageScore`: promedio global del score.
- `averageApprovedScore`: promedio de articulos aprobados.
- `averageRejectedScore`: promedio de articulos rechazados.

La consola muestra estos datos en Conocimiento como Pendientes*, Aprobadas, Rechazadas y Score prom.*. Esto nos permitira observar si el ranking ayuda o si conviene modificar sus criterios.
## 29. Seguridad avanzada de sesiones remotas

SAS incluye politicas configurables para endurecer los enlaces de soporte remoto.

Variables:

```text
REMOTE_SESSION_TTL_MINUTES=60
REMOTE_CONSENT_MAX_ATTEMPTS=5
REMOTE_CONTROL_MAX_ATTEMPTS=5
```

Estados nuevos:

- `expired`: enlace vencido.
- `consent_locked`: demasiados intentos de consentimiento.
- `control_locked`: demasiados intentos de control interactivo.

Cuando una sesion expira o se bloquea:

- Se apaga vista en vivo.
- Se cancelan comandos pendientes.
- Se cancelan eventos interactivos pendientes.
- El panel del cliente oculta botones de accion.
- La auditoria conserva intentos, expiracion y motivo `lockedReason`.

## 30. Plan de los cinco frentes de produccion

1. Seguridad remota: expiracion, limites de intentos, auditoria y revocacion.
2. Cliente Windows real: preflight, paquete portable, helpers, panel local y paro de emergencia.
3. Fluidez de pantalla: baja latencia, balanceada y calidad.
4. WhatsApp real: dominio, HTTPS, webhook Meta y pruebas de comandos.
5. Google AI real: API key, revision humana obligatoria y `reviewScore*` en observacion.

Documentos de apoyo:

- `docs/production-readiness-plan.md`
- `docs/remote-security-hardening.md`
- `docs/windows-client-real-test-checklist.md`
- `docs/whatsapp-production-checklist.md`
- `docs/google-ai-production-checklist.md`
## 31. Problemas comunes

El agente no aparece online:

- Confirmar que el servidor esta activo.
- Confirmar que SAS_SERVER_URL apunta al servidor correcto.
- Confirmar que SAS_AGENT_SECRET coincide con AGENT_SHARED_SECRET.
- Revisar logs del agente.

Los comandos de diagnostico no se envian:

- Confirmar que el cliente aprobo consentimiento general.
- Confirmar que hay agente asignado.
- Confirmar que el rol activo es Admin o Supervisor.

La vista en vivo no muestra imagen:

- Confirmar consentimiento aprobado.
- Confirmar agente asignado.
- Confirmar que la sesion no esta cerrada.
- Esperar el siguiente intervalo de captura.

No se puede enviar control simulado:

- Confirmar que primero se pidio control.
- Confirmar que el cliente aprobo control.
- Confirmar que la sesion tiene agente asignado.

WhatsApp no responde:

- Confirmar WHATSAPP_ACCESS_TOKEN.
- Confirmar WHATSAPP_PHONE_NUMBER_ID.
- Confirmar webhook y verify token en Meta Developers.

## 23.1 Reparaciones automaticas controladas

SAS ya cuenta con una primera base para reparaciones automaticas del agente.

El catalogo inicial incluye:

- `flush_dns`: limpia cache DNS local, riesgo bajo.
- `renew_ip`: renueva direccion IP por DHCP, riesgo medio.
- `restart_print_spooler`: reinicia cola de impresion, riesgo medio.
- `clear_temp_files`: limpia temporales del usuario, riesgo medio.

Fisher puede sugerir estas acciones dentro del diagnostico cuando detecta problemas de red, impresion o rendimiento. Para enviarlas al equipo se requiere una sesion remota con consentimiento aprobado y agente asignado. El servidor registra `repair.queue` en auditoria y el agente recibe un comando `repair_action` con metadata segura.

Por seguridad, el cliente Windows no ejecuta cambios reales salvo que `SAS_ENABLE_REPAIR_ACTIONS=true` y el equipo no este en modo `SAS_UNSIGNED_RESTRICTED_PRODUCTION`. Si no esta habilitado, la accion queda registrada como simulacion segura para validar flujo sin modificar el equipo del cliente.

### 23.2 Motor de decision de Fisher

Fisher ya clasifica cada reparacion sugerida antes de enviarla al agente.

Modos actuales:

- `auto_allowed`: accion de bajo riesgo, confianza suficiente, sesion remota autorizada y agente asignado.
- `technician_approval_required`: accion de riesgo medio; el tecnico debe enviarla conscientemente.
- `remote_consent_required`: falta consentimiento remoto o equipo asignado.
- `customer_control_required`: requiere permiso adicional de control remoto.
- `human_review`: la incidencia o propuesta requiere revision humana antes de aplicar cambios.
- `suggest_only`: Fisher puede sugerir la accion, pero no ejecutarla automaticamente con la confianza actual.

La consola muestra la decision junto a cada reparacion sugerida. Al enviar una reparacion, el servidor guarda el modo de decision en auditoria para que sea posible revisar por que se ejecuto o por que quedo detenida.

### 23.3 Plan ejecutable de reparacion

SAS ya puede generar un plan de reparacion por ticket mediante `POST /api/tickets/{id}/repair-plan`.

El plan hace lo siguiente:

- Toma el ticket y el mensaje del operador o cliente.
- Busca una sesion remota autorizada y con agente asignado.
- Ejecuta diagnostico Fisher con contexto de esa sesion.
- Clasifica reparaciones con el motor de decision.
- Si `autoQueue=true`, encola solamente acciones `auto_allowed` de bajo riesgo.
- Registra auditoria `fisher.repair_plan` con conteo de acciones, decisiones y reparaciones encoladas.

La consola usa este plan al correr diagnostico para mostrar decisiones mas reales. Si todavia no existe sesion autorizada, Fisher no encola acciones y explica que falta consentimiento remoto.

### 23.4 Aprendizaje operativo de reparaciones

SAS ya registra el resultado de cada comando `repair_action` reportado por el agente.

Se guarda en la coleccion local `repairOutcomes`:

- Ticket relacionado.
- Sesion remota.
- Comando y accion de reparacion.
- Riesgo.
- Estado: `executed`, `simulated` o `failed`.
- Error o razon de simulacion cuando aplica.

El endpoint `GET /api/repair-outcomes` devuelve resultados recientes y resumen por accion. La consola muestra historial dentro del plan Fisher, por ejemplo acciones ejecutadas, simuladas, fallidas y porcentaje de exito real.

Este es el primer paso para que Fisher aprenda de la operacion real: por ahora registra y resume; el siguiente paso sera ajustar confianza y ranking automaticamente con base en esos resultados.

### 23.5 Ranking por aprendizaje operativo

Fisher ya usa el historial `repairOutcomes` para ajustar el orden de reparaciones dentro del plan.

Reglas actuales:

- Si una accion tiene varios exitos reales, Fisher la promueve y aumenta su puntaje efectivo.
- Si una accion falla repetidamente, Fisher reduce su prioridad.
- Si solo existen simulaciones, Fisher muestra el historial pero no lo toma como exito real.
- Si el historial es neutral o insuficiente, conserva el ranking por diagnostico.

La consola muestra la senal de aprendizaje junto a cada reparacion: `Sube prioridad`, `Baja prioridad`, `Evitar hasta revision`, `Solo simulaciones` o `Sin historial`.

Este ajuste todavia es conservador: no elimina acciones del catalogo ni ejecuta acciones de riesgo medio automaticamente; solo mejora el orden y deja evidencia para revision.

### 23.6 Confirmacion humana de reparaciones

SAS ya permite que el tecnico confirme si una reparacion realmente resolvio el problema.

En Registro aparece la tarjeta Resultados de reparaciones con acciones recientes y dos botones:

- `Resolvio`: marca el outcome como `resolved`.
- `No resolvio`: marca el outcome como `unresolved`.

El servidor guarda la confirmacion mediante `PATCH /api/repair-outcomes/{id}`, agrega nota interna al ticket y audita `repair.feedback`.

Fisher usa estas confirmaciones con mayor peso que el estado tecnico del comando. Si varias confirmaciones indican que una accion resolvio casos similares, Fisher la promueve. Si varias indican que no resolvio, Fisher la degrada aunque el comando se haya ejecutado correctamente.

### 23.7 Propuestas de conocimiento desde reparaciones confirmadas

SAS puede convertir reparaciones confirmadas en articulos `pending_review` de la base de conocimiento.

El endpoint `POST /api/repair-outcomes/knowledge-proposals` revisa el resumen `repairOutcomes`, exige un minimo de confirmaciones positivas y una tasa de resolucion suficiente, evita duplicados por `repairActionId` y crea articulos pendientes con `provider: sas_repair_learning`.

La consola muestra el boton Proponer solucion dentro de Resultados de reparaciones. Las propuestas no quedan aprobadas automaticamente; deben revisarse en Soluciones antes de que Fisher las use como conocimiento aprobado.

## 24. Alcance actual y siguiente fase

Alcance validado:

- Plataforma productiva para tickets, agentes, Fisher, consentimiento, diagnóstico, auditoría y control simulado.
- Aplicación Android de observación probada físicamente.
- Instalador final Windows 11 disponible en EXE y ZIP sin conexión.
- Producción restringida segura cuando no existe certificado de firma.

Pendientes reales:

1. Confirmar presencialmente el ciclo del EXE NSIS final aceptando UAC.
2. Configurar sólo los proveedores externos que se decidan utilizar: WhatsApp, OpenAI/Gemini y FCM.
3. Considerar una base dedicada cuando el volumen de datos justifique la migración.
4. Incorporar Authenticode cuando exista presupuesto; mientras tanto no habilitar control nativo.

## 25. Regla operativa de seguridad

Ningun tecnico, agente automatizado o proceso debe tomar control real sin:

- Ticket asociado.
- Agente identificado.
- Consentimiento general aprobado.
- Consentimiento de control aprobado.
- Registro de auditoria.
- Posibilidad de paro inmediato por el cliente.

## 26. Historial del manual

- 2026-07-15: Version 4.05 elimina eventos duplicados en Crear acceso y muestra validacion, progreso, exito o error junto al boton.

- 2026-07-15: Version 4.04 evita que el refresco automatico borre una contrasena de restablecimiento y conserva texto, foco y cursor durante actualizaciones manuales.

- 2026-07-15: Version 4.03 reutiliza las cuentas Android en la consola web, oculta el token maestro como recuperacion local y agrega renovacion, cierre y auditoria de sesiones.

- 2026-07-15: Version 4.02 agrega canales de actualizaci?n, verificaci?n, respaldo, prueba de salud y rollback autom?tico.
- 2026-07-15: Version 4.01 integra TinyURL y Bitly con seleccion automatica, credenciales protegidas y respaldo interno.
- 2026-07-15: Version 4.00 agrega liga corta interna de 8 caracteres, sin acortadores externos, compatible con ligas anteriores, temporal y de un solo uso.
- 2026-07-15: Version 3.99 separa Setup principal y SAS Cliente, agrega ligas temporales por WhatsApp y credenciales individuales por equipo.

- 2026-07-15: Version 3.98 agrega ayuda contextual, Siguiente clic, resaltado de controles y guia dinamica de permisos para cliente y tecnico.

- 2026-07-15: Version 3.97 agrega bandeja de WhatsApp en Casos, respuesta del tecnico, evidencias, cierre confirmado, notificaciones remotas, deduplicacion y firma de webhook.

- 2026-07-13: Version 3.92 agrega emparejamiento seguro por codigo entre WhatsApp y SAS Agent, sin omitir consentimiento y con auditoria extremo a extremo.

- 2026-07-13: Version 3.91 renueva la jerarquia visual de la consola y presenta Fisher como asistente supervisado con estados de carga, error y accesibilidad.

- 2026-07-13: Version 3.90 documenta el instalador final Windows 11, la validacion fisica Android, el verificador autonomo de artefactos y los pendientes externos reales.

- 2026-07-11: Version 3.89 agrega senales visuales en navegacion y cabecera para guiar al tecnico hacia la pantalla que requiere atencion.

- 2026-07-11: Version 3.88 mejora diagnostico de HTTPS local en 443, separando servidor vivo de problemas de NAT, DDNS o acceso externo.

- 2026-07-11: Version 3.87 agrega resumen visual por pantalla para identificar casos abiertos, permisos remotos, agentes, revisiones Fisher y semaforo sin abrir tarjetas.

- 2026-07-11: Version 3.86 agrega centro de avisos visuales con colores por severidad, tarjetas llamativas y pruebas automaticas de interfaz.

- 2026-07-11: Version 3.85 agrega pruebas automaticas de interfaz para conservar etiquetas simples y proteger los identificadores de control remoto.

- 2026-07-11: Version 3.84 simplifica lenguaje y jerarquia visual para tecnicos de primer nivel: navegacion, botones principales, soporte remoto, prueba guiada y Estado.
- 2026-07-11: Version 3.83 agrega historial del Semaforo de produccion, endpoint `/api/admin/production-traffic-light-history` y reportes `semaforo-produccion-history.*`.
- 2026-07-11: Version 3.82 renombra la vista a Semaforo de produccion, agrega alias `/api/admin/production-traffic-light`, `npm run semaforo:produccion` y reportes `semaforo-produccion-report.*`.
- 2026-07-11: Version 3.81 agrega gate de liberacion MVP, endpoint `/api/admin/release-gate` y reporte offline `npm run release:gate`.
- 2026-07-11: Version 3.80 agrega plan de accion operativo con severidad, responsable, comando sugerido y estado general que no bloquea por fallas opcionales.
- 2026-07-11: Version 3.79 agrega `npm run ops:report`, reportes `production-operations-report.json/.md`, tolerancia a BOM de PowerShell y vigencia de evidencia.
- 2026-07-10: Version 3.78 agrega `/api/admin/operations` y panel Operacion productiva en Registro para concentrar reportes de produccion sin abrir JSON manualmente.
- 2026-07-10: Version 3.77 separa `MVP operativo` de readiness total para distinguir bloqueos requeridos de pendientes recomendados u opcionales.
- 2026-07-10: Version 3.76 agrega `verify-production-task.ps1` y `verify-production-task-elevated.ps1` para confirmar tarea programada, manifiesto, checklist y estado local desde contexto normal o UAC.

- 2026-07-10: Version 3.75 agrega `install-production-task-elevated.ps1` para abrir UAC, detener listener manual en 443 y registrar/iniciar la tarea productiva con validacion local.

- 2026-07-10: Version 3.74 agrega `monitor-production.ps1` y `restart-production-task.ps1` para monitoreo local, reporte operativo y reinicio controlado de la tarea productiva.

- 2026-07-10: Version 3.73 agrega diagnostico productivo `get-production-status.ps1`, modo `-LocalOnly`, PID de produccion y preflight de puertos en arranque.

- 2026-07-10: Version 3.72 confirma HTTPS real en setinfo.sytes.net, corrige copia de certificado completo, smoke test con token de consola y renovacion TLS con reinicio opcional de tarea.

- 2026-07-09: Version 3.71 corrige destino de despliegue a Windows 11 Pro para MVP y genera paquete dedicado `sas-windows11-mvp-release`.

- 2026-07-09: Version 3.70 agrega generador de paquete ZIP para Windows Server 2019 con manifiesto SHA256 y exclusiones de secretos/datos.

- 2026-07-09: Version 3.69 agrega guia para Windows Server 2019 Standard y script de actualizacion segura preservando configuracion, datos y certificados.

- 2026-07-09: Version 3.68 agrega instalador de tarea programada productiva con firewall, manifiesto y checklist post-instalacion.

- 2026-07-09: Version 3.67 agrega smoke test productivo para validar TLS, health, webhook WhatsApp y readiness despues de arrancar HTTPS.

- 2026-07-09: Version 3.66 agrega lanzador elevado para Lets Encrypt y script de arranque productivo con validacion de certificados TLS.

- 2026-07-09: Version 3.65 valida `setinfo.sytes.net`, confirma NAT 80/443 con servicios temporales y prepara win-acme portable con chequeo de Administrador para Lets Encrypt.

- 2026-07-09: Version 3.64 agrega `prepare-production-config.ps1` para generar `.env.production` con secretos fuertes y reporte redacted antes de instalar en produccion.

- 2026-07-09: Version 3.63 agrega readiness de Aprendizaje Fisher en Preparacion, usando conocimiento aprobado, propuestas pendientes y reparaciones confirmadas.

- 2026-07-09: Version 3.62 agrega propuestas revisables de conocimiento desde reparaciones confirmadas y evita duplicados por `repairActionId`.

- 2026-07-08: Version 3.61 agrega confirmacion humana de reparaciones, endpoint `PATCH /api/repair-outcomes/{id}`, auditoria `repair.feedback` y aprendizaje con mayor peso por resolucion confirmada.

- 2026-07-08: Version 3.60 agrega ranking por aprendizaje operativo para promover reparaciones exitosas y degradar acciones con fallas repetidas.

- 2026-07-08: Version 3.59 agrega aprendizaje operativo de reparaciones con `repairOutcomes`, endpoint de consulta y resumen de historial en plan Fisher.

- 2026-07-08: Version 3.58 agrega plan ejecutable de reparacion Fisher con endpoint por ticket, auditoria y auto-encolado de bajo riesgo permitido.

- 2026-07-07: Version 3.57 agrega motor de decision Fisher para clasificar reparaciones por riesgo, consentimiento, confianza y necesidad de revision humana.

- 2026-07-07: Version 3.56 agrega catalogo de reparaciones automaticas controladas, sugerencias Fisher, endpoint de encolado y ejecucion segura/simulada en agente.

- 2026-07-07: Version 3.55 agrega comando WhatsApp cancelar remoto y respuestas de estado con etiquetas claras.

- 2026-07-06: Version 3.54 agrega Avanzar automatico en Guia y evita que errores internos tumben el servidor HTTP.

- 2026-07-06: Version 3.53 agrega diagnostico de arranque local con PID, logs, escucha de puertos y errores en el status JSON.

- 2026-07-06: Version 3.52 agrega estados vacios guiados en las vistas principales para orientar al tecnico.

- 2026-07-06: Version 3.51 agrega indicador de reconexion y ultima revision cuando una API no responde.

- 2026-07-06: Version 3.50 muestra Cargando eventos al cambiar filtros de Registro mientras se actualiza la auditoria.

- 2026-07-06: Version 3.49 hace que el cambio de filtro en Registro consulte nuevamente la API filtrada en vivo.

- 2026-07-06: Version 3.48 agrega estado visual Sin token/Token guardado sin revelar el token de consola.

- 2026-07-06: Version 3.47 corrige el control de token para que los botones Ver/Ocultar y OK no queden ocultos ni comprimidos.

- 2026-07-06: Version 3.46 corrige visualmente el campo Token con botones Ver/Ocultar y OK alineados en la barra superior.

- 2026-07-06: Version 3.45 hace que /api/audit y la exportacion CSV/JSON respeten el filtro activo de Registro.

- 2026-07-06: Version 3.44 amplia filtros de Registro con Remoto y Tickets para revisar auditoria operativa mas rapido.

- 2026-07-06: Version 3.43 agrega filtro Todos/Seguridad en Registro para aislar accesos denegados.

- 2026-07-06: Version 3.42 agrega resumen superior de accesos denegados recientes en Registro.

- 2026-07-06: Version 3.41 muestra uth.denied en Registro como Acceso denegado con detalles claros de seguridad.

- 2026-07-06: Version 3.40 registra uth.denied para accesos denegados por token faltante o permisos insuficientes.

- 2026-07-06: Version 3.39 agrega controles Ver/Ocultar y OK al token de consola para aplicar autenticacion rapidamente.

- 2026-07-06: Version 3.38 agrega estado Token en la franja operativa cuando la consola protegida necesita autenticacion.

- 2026-07-06: Version 3.37 agrega aviso visual de Token requerido cuando la consola protegida no puede cargar datos de Registro.

- 2026-07-06: Version 3.36 agrega pasos guiados de preparacion a produccion con prioridad, responsable y accion concreta en Registro.

- 2026-07-06: Version 3.35 corrige arranque persistente de servidor/agente y hace auditorias E2E limpias con telefono unico por ejecucion.
- 2026-07-04: Version 3.34 agrega auditoria local extremo a extremo `npm run audit:e2e`, reportes JSON/Markdown y corrige preservacion de perfil `lowLatency` en vista fluida.
- 2026-07-04: Version 3.33 pule interfaz y movil: botones mas cortos, foco visible, barra superior compacta y metricas moviles en dos columnas.
- 2026-07-04: Version 3.32 mejora el aspecto visual general: Atencion muestra actividad reciente, Conexion pliega evidencia pesada y Registro agrupa eventos antiguos.
- 2026-07-04: Version 3.31 convierte la informacion del equipo remoto a tarjetas amigables: sistema, red, discos, procesos y servicios con detalle tecnico plegado.
- 2026-07-04: Version 3.30 elimina el estado Servidor duplicado: queda en la franja operativa y metricas se enfoca en trabajo pendiente.
- 2026-07-04: Version 3.29 simplifica Equipos y Soluciones: resumen visual, detalles tecnicos plegados y menos ruido operativo.
- 2026-07-04: Version 3.28 simplifica Guia: laboratorio real y detalle tecnico quedan plegados; Flujo sugerido muestra solo pendientes principales.
- 2026-07-04: Version 3.27 simplifica Conexion: oculta Diagnostico, Pantalla y Control hasta tener consentimiento, equipo asignado y sesion vigente.
- 2026-07-04: Version 3.26 oculta botones repetidos/no accionables: asignacion redundante, refrescos duplicados y Enter real bloqueado como estado no clickeable.
- 2026-07-04: Version 3.25 agrega refresco visual inicial: chips de estado coloreados, tickets seleccionables mas claros, metricas operativas y limpieza de separadores.
- 2026-07-04: Version 3.24 agrega endpoint `/api/admin/installations` y panel Registro para evidencia de instalacion servidor/cliente.
- 2026-07-04: Version 3.23 mejora instalador cliente con checklist post-instalacion, manifest y validacion de perfil restringido sin firma.
- 2026-07-04: Version 3.22 mejora instalador servidor con secretos automaticos, revision de puertos 80/443 y checklist post-instalacion.
- 2026-07-03: Version 3.21 agrega exportacion de auditoria CSV/JSON desde Registro y evento `audit.export`.
- 2026-07-03: Version 3.20 agrega `CONSOLE_SHARED_TOKEN`, campo Token en consola y proteccion opcional de endpoints internos.
- 2026-07-03: Version 3.19 agrega checklist automatico de preparacion a produccion y endpoint `/api/admin/readiness`.
- 2026-07-03: Version 3.18 agrega panel Estado del sistema, endpoint de almacenamiento y respaldo manual auditado.
- 2026-07-03: Version 3.17 agrega perfil de produccion restringida sin firma, paquete portable restringido, instalacion y preflight dedicado.
- 2026-07-02: Version 3.16 agrega panel Laboratorio control real separado con checklist y boton bloqueado por preflight.
- 2026-07-02: Version 3.15 distingue auditoria y tarjetas de eventos de control simulados, reales ejecutados y fallidos.
- 2026-07-02: Version 3.14 agrega aviso visual de control real en Conexion y Preflight para diferenciar modo simulado, bloqueado y laboratorio.
- 2026-07-02: Version 3.13 agrega preflight de control real seguro con firma Authenticode, contexto Windows y estado laboratorio.
- 2026-07-02: Version 3.12 muestra capacidades del agente Windows en consola y agrega pruebas de registro/heartbeat de helpers.
- 2026-07-02: Version 3.11 corrige perfil Fluida, agrega latencia de frame y valida pantalla remota de baja latencia con pruebas automatizadas.
- 2026-07-02: Version 3.10 traduce auditoria a tarjetas legibles con detalles clave para tecnicos.
- 2026-07-01: Version 3.9 agrega resumen de seguridad remota, oculta sesiones expiradas en Conexion y cubre reglas criticas con pruebas automatizadas.
- 2026-07-01: Version 3.8 agrega pruebas automatizadas del flujo WhatsApp remoto, reutilizacion de enlace y cierre de sesion.
- 2026-07-01: Version 3.7 agrega pruebas automatizadas para estado de agentes y comandos `check`/`test` en `package.json`.
- 2026-07-01: Version 3.6 agrega franja de estado operativo y marca agentes sin heartbeat reciente como Desconectado.
- 2026-07-01: Version 3.5 mejora `start-local-stack.ps1 -Restart` con liberacion validada de puertos y reporte confiable de PIDs.
- 2026-07-01: Version 3.4 agrega simulador WhatsApp integrado en consola y preparacion automatica de sesion remota cuando el mensaje pide soporte remoto.
- 2026-07-01: Version 3.3 convierte diagnostico Fisher en tarjeta operativa y reutiliza sesiones remotas abiertas.
- 2026-07-01: Version 3.2 traduce estados visibles a etiquetas claras para usuarios y tecnicos.
- 2026-07-01: Version 3.1 mueve Paso actual al inicio de Guia y agrega una accion principal dinamica.
- 2026-07-01: Version 3.0 simplifica la interfaz grafica con nombres claros y acciones avanzadas agrupadas.
- 2026-07-01: Version 2.9 agrega reporte de prueba guiada con avance, auditoria y endpoint `/api/tests/guided-report`.
- 2026-07-01: Version 2.8 agrega arranque local unificado de servidor y agente con reporte JSON.
- 2026-06-30: Version 2.7 agrega cierre guiado de prueba remota y auditoria `remote.close`.
- 2026-06-30: Version 2.6 agrega panel Paso actual con avance y siguiente accion en Pruebas guiadas.
- 2026-06-30: Version 2.5 agrega visualizacion del preflight Windows en la consola web y endpoint `/api/client-preflight`.
- 2026-06-30: Version 2.4 agrega preflight cliente Windows, reporte JSON y paquete portable de prueba.

- 2026-06-30: Version 1.6 valida flujo WhatsApp simulado con ticket, diagnostico Fisher y reutilizacion de sesion remota.
- 2026-06-30: Version 1.5 valida prueba de panel local con vista activa, control aprobado y paro local.
- 2026-06-30: Version 1.4 mejora panel local del agente como indicador visible y paro inmediato aun si el servidor esta caido.
- 2026-06-30: Version 1.3 agrega `SasInputHelper.exe` para control nativo Windows preparado y desactivado por defecto.
- 2026-06-30: Version 1.2 agrega flujo Let's Encrypt para HTTPS del servidor SAS.
- 2026-06-30: Version 1.1 agrega flujo de firma Authenticode, reporte `signature-report.json` y verificacion de firmas.
- 2026-06-30: Version 1.0 integra SAS Capture Helper en instalador cliente, paquete portable, manifest y allowlist.
- 2026-06-30: Version 0.9 agrega SAS Capture Helper para frames JPEG optimizados y firmables.
- 2026-06-30: Version 0.8 agrega telemetria de fluidez en la vista en vivo.
- 2026-06-30: Version 0.7 mejora fluidez de vista en vivo con polling de 2 segundos, modo fluido/calidad y configuracion de captura.
- 2026-06-30: Version 0.6 agrega panel de seguridad vivo para el cliente.
- 2026-06-30: Version 0.5 agrega revocacion inmediata y cancelacion de comandos/eventos pendientes.
- 2026-06-30: Version 0.4 agrega preparacion antivirus/EDR, allowlist, manifiestos y plan de firma digital.
- 2026-06-30: Version 0.3 exige consentimiento antes de comandos remotos y documenta el checklist extendido.
- 2026-06-30: Version 0.2 agrega vista Pruebas guiadas y checklist operativo.
- 2026-06-30: Version inicial para pruebas funcionales basicas.
















































































































































