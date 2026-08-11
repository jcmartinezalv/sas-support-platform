# Soporte rápido atendido y desatendido

## Modalidades

- **Atendido:** el técnico crea la sesión y el usuario pulsa **Autorizar soporte**. Ver pantalla y usar teclado/mouse siguen siendo permisos separados.
- **Desatendido:** el propietario lo habilita previamente desde `http://127.0.0.1:37655` en el propio equipo y define una contraseña exclusiva. De forma predeterminada permite sólo pantalla; teclado y mouse requieren marcarlo expresamente al configurar.

## Activación en el equipo

1. Abrir **SAS en este equipo**.
2. Ir a **Soporte rápido desatendido**.
3. Escribir y confirmar una contraseña de 12 caracteres o más, distinta de Windows.
4. Decidir si se permite también teclado y mouse.
5. Pulsar **Habilitar o cambiar contraseña**.

Cambiar la contraseña o deshabilitar la función cierra inmediatamente las sesiones desatendidas activas. El botón **Finalizar sesiones activas** continúa disponible como paro local.

## Inicio desde la consola

1. Abrir **Remoto** y localizar **Iniciar soporte rápido**.
2. Seleccionar equipo, modalidad y motivo.
3. En modo atendido, abrir el permiso del usuario y esperar su aprobación.
4. En modo desatendido, un administrador o supervisor escribe la contraseña exclusiva del equipo.
5. Revisar si el alcance autorizado es sólo pantalla o también teclado/mouse y pulsar **Conectar**.

## Controles de seguridad

- Contraseña diferente para cada equipo, derivada con `scrypt`; nunca se muestra ni se devuelve por API.
- Sólo la credencial individual del agente puede habilitar, cambiar o deshabilitar la política.
- Sólo administradores y supervisores pueden usar acceso desatendido.
- Bloqueo de 15 minutos después de cinco contraseñas incorrectas.
- Cada alta, baja, intento, autorización, inicio, acción y cierre queda en auditoría.
- Cada sesión caduca y siempre crea un caso para conservar trazabilidad.
- La política puede revocarse únicamente desde el equipo y al hacerlo cierra sesiones desatendidas.