# Arquitectura inicial

## Componentes

### WhatsApp Gateway

Recibe mensajes entrantes desde Meta WhatsApp Cloud API, normaliza el contenido y crea o actualiza tickets.

Responsabilidades:

- Validar webhook.
- Extraer remitente, nombre, texto y metadata.
- Resolver ticket abierto por numero telefonico.
- Enviar acuse o siguiente paso al cliente.

### Ticket Core

Modelo central de soporte. Un ticket representa una conversacion tecnica con trazabilidad.

Estados iniciales:

- `open`
- `waiting_customer`
- `in_progress`
- `resolved`
- `closed`

Prioridades iniciales:

- `low`
- `normal`
- `high`
- `urgent`

### Remote Support

Controla la solicitud, autorizacion y vida de una sesion remota.

La primera version solo crea sesiones y codigos de union. La implementacion real debe incluir:

- Agente instalable en Windows.
- Canal seguro WebRTC o relay propio.
- Consentimiento explicito del usuario.
- Registro de auditoria.
- Revocacion inmediata de acceso.

### Automated Agent

Agente tecnico con flujo de diagnostico:

1. Clasifica el problema.
2. Consulta base de conocimiento.
3. Propone pasos seguros.
4. Escala a humano si falta permiso, hay riesgo o no hay confianza suficiente.

El autoaprendizaje debe ser supervisado: el sistema puede proponer nuevas soluciones, pero un humano aprueba antes de incorporarlas a la base oficial.

## Principios de seguridad

- Nunca tomar control remoto sin consentimiento verificable.
- Registrar acciones relevantes.
- Separar permisos de operador, administrador y agente automatico.
- No ejecutar comandos destructivos automaticamente.
- Cifrar secretos y tokens.
- Evitar almacenar credenciales enviadas por clientes.
