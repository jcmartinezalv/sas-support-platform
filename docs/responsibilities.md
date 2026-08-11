# Responsabilidades Tecnicas SAS

Fisher queda responsable de desarrollar y mantener estas areas del proyecto:

## Plataforma de tickets

- Tickets por WhatsApp, consola web y creacion manual.
- Estados, prioridades, historial de mensajes y seguimiento.
- Escalamiento a tecnico humano cuando la confianza del agente sea baja.

## Acceso remoto

- Cliente Windows instalable.
- Registro y heartbeat del agente cliente.
- Sesiones remotas con codigo unico y consentimiento del cliente.
- Futuro canal WebRTC/relay para control remoto seguro.

## Servidor y consola web

- Servidor HTTP/HTTPS en puertos 80 y 443.
- Consola web para tickets, agentes, sesiones, base de conocimiento y auditoria.
- Instaladores Windows para servidor y cliente.

## Agente de IA

- Diagnostico inicial por reglas y base de conocimiento aprobada.
- Recomendacion de pasos de resolucion.
- Activacion de flujos automatizados.
- Escalamiento cuando hay riesgo, permisos insuficientes o baja confianza.

## Automatizacion

- Scripts PowerShell de instalacion y arranque.
- Flujos de resolucion por categoria de problema.
- Registro de acciones automatizadas.

## Base de conocimiento y aprendizaje

- Articulos aprobados por categoria.
- Busqueda por palabras clave.
- Aprendizaje continuo supervisado: Fisher puede proponer, un humano aprueba.

## Seguridad, permisos y auditoria

- Roles: admin, supervisor, technician, ai_agent y viewer.
- Permisos por accion.
- Registro de tickets, diagnosticos, WhatsApp, sesiones remotas y agentes.
- Prohibido ejecutar acciones remotas destructivas sin autorizacion, auditoria y lista blanca.
