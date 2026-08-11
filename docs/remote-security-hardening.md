# Endurecimiento de seguridad remota

## Politicas agregadas

- `REMOTE_SESSION_TTL_MINUTES`: tiempo de vida del enlace de consentimiento.
- `REMOTE_CONSENT_MAX_ATTEMPTS`: intentos maximos para aprobar/rechazar consentimiento general.
- `REMOTE_CONTROL_MAX_ATTEMPTS`: intentos maximos para decisiones de control interactivo.

## Estados terminales

- `closed`: sesion cerrada normalmente.
- `consent_rejected`: cliente rechazo el soporte.
- `expired`: enlace vencido.
- `consent_locked`: demasiados intentos de consentimiento.
- `control_locked`: demasiados intentos de control.

## Efectos de seguridad

Cuando una sesion expira o se bloquea:

- Se apaga vista en vivo.
- Se cancelan comandos pendientes.
- Se cancelan eventos interactivos pendientes.
- Fisher/agente no reciben nuevas acciones para esa sesion.
- El panel de cliente oculta botones de accion.

## Auditoria

Los eventos incluyen:

- `expiresAt` al crear sesion.
- `attempts` en decisiones de consentimiento.
- `lockedReason` cuando aplica.
