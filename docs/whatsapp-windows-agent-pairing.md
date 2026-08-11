# Emparejamiento WhatsApp con agente Windows

## Objetivo

Vincular de forma segura una solicitud recibida por WhatsApp con la computadora Windows que tiene instalado SAS Agent, sin asumir que el teléfono identifica por sí solo al equipo.

## Flujo

1. El cliente escribe a Fisher por WhatsApp y solicita soporte remoto.
2. SAS crea o reutiliza el ticket asociado al número.
3. Fisher crea una sesión y responde con un código alfanumérico de 6 caracteres y la liga de consentimiento.
4. En la computadora afectada, el cliente abre `http://127.0.0.1:37655`.
5. En **Vincular este equipo**, introduce el código recibido.
6. El panel local envía el código al servidor usando el secreto del agente y su `machineId`.
7. SAS vincula la sesión únicamente con ese equipo y registra `remote.pair_agent`.
8. El cliente todavía debe aprobar el consentimiento.
9. Después del consentimiento, el agente recibe únicamente la sesión asignada a su `machineId`.

## Controles de seguridad

- El endpoint del agente exige `AGENT_SHARED_SECRET`.
- El panel local sólo escucha en `127.0.0.1`.
- El código debe contener exactamente 6 letras o números.
- Una sesión cerrada, rechazada, bloqueada o expirada no puede vincularse.
- Un segundo equipo no puede apropiarse de una sesión ya emparejada.
- Repetir el código desde el mismo equipo es idempotente.
- Vincular no aprueba consentimiento, pantalla ni control.
- La auditoría conserva agente, hostname y método de vinculación, pero no publica secretos.

## Endpoints

- Panel local: `POST http://127.0.0.1:37655/pair`.
- Servidor autenticado: `POST /api/agents/pair`.
- Auditoría: acción `remote.pair_agent`.

## Evidencia automatizada

La prueba aislada cubre servidor HTTP real, sesión tipo WhatsApp, emparejamiento, conflicto de agente, consentimiento, polling del agente correcto y auditoría. Las pruebas unitarias cubren idempotencia, sesiones terminales y conservación del consentimiento.

## Prueba presencial pendiente

Cuando WhatsApp Cloud API esté configurado:

1. Enviar “necesito soporte remoto” desde el teléfono.
2. Copiar el código recibido.
3. Abrir el panel local en la PC afectada.
4. Vincular el equipo.
5. Aprobar la liga de consentimiento.
6. Confirmar que la consola muestra el equipo y el evento de auditoría.
7. Confirmar que otro agente no recibe la sesión.

