# Comandos conversacionales por WhatsApp

SAS puede recibir mensajes de WhatsApp y tratarlos como diagnostico normal o como comandos cortos de operacion del ticket.

## Comandos disponibles

- `ayuda`, `menu`, `opciones`: muestra las acciones disponibles para el ticket activo.
- `estado`, `estatus`, `status`, `seguimiento`: devuelve estado, prioridad, fecha de actualizacion y sesion remota asociada.
- `enlace remoto`, `liga remota`, `codigo remoto`: crea o recupera una sesion remota segura para el ticket activo.
- `hablar con tecnico`, `asesor humano`, `operador`: marca el ticket como `in_progress` para atencion humana.
- `cerrar ticket`, `finalizar caso`, `resuelto`, `solucionado`: cierra el ticket y cierra sesiones remotas abiertas asociadas.

## Comportamiento esperado

1. Si el telefono no tiene ticket abierto, SAS crea uno automaticamente con el primer mensaje.
2. Si el mensaje no coincide con un comando, Fisher ejecuta diagnostico y responde con pasos sugeridos.
3. Si el diagnostico requiere soporte remoto, se crea una sesion y se envia la liga de consentimiento.
4. Si el usuario vuelve a pedir `enlace remoto`, SAS reutiliza la sesion abierta del mismo ticket.
5. Al cerrar el ticket por WhatsApp, se cierran las sesiones remotas que sigan abiertas.

## Prueba local

Con el servidor iniciado en `http://localhost:3110`, se puede simular un mensaje asi:

```powershell
.\scripts\simulate-whatsapp-message.ps1 -From 5215559003000 -Name "Cliente Demo" -Text "ayuda" -ServerUrl http://localhost:3110
.\scripts\simulate-whatsapp-message.ps1 -From 5215559003000 -Name "Cliente Demo" -Text "enlace remoto" -ServerUrl http://localhost:3110
.\scripts\simulate-whatsapp-message.ps1 -From 5215559003000 -Name "Cliente Demo" -Text "estado" -ServerUrl http://localhost:3110
.\scripts\simulate-whatsapp-message.ps1 -From 5215559003000 -Name "Cliente Demo" -Text "cerrar ticket" -ServerUrl http://localhost:3110
```

La auditoria registra cada mensaje como `whatsapp.message` e incluye el campo `command` cuando se detecta un comando conversacional.
