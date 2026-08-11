# SAS 0.2.19

- Corrige las ventanas de PowerShell que aparecían cada minuto en equipos con SAS Cliente.
- Ejecuta la tarea del agente con ventana oculta y elimina el disparador periódico redundante.
- Conserva el reinicio automático del agente si el proceso realmente falla.
- Detecta cuando el servidor rechaza la credencial individual del equipo.
- Muestra en el panel local el estado **Requiere vinculación** con una explicación clara.
- Permite renovar la credencial con un código temporal de 8 caracteres sin reinstalar SAS.
- Mantiene la identidad estable del equipo, aun cuando cambie su nombre.
- Incluye Android alineado con la versión 0.2.19.