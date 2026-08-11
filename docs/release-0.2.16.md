# SAS 0.2.16

- Conserva una identidad estable del cliente Windows aunque se cambie el nombre del equipo.
- Migra automáticamente el identificador ya guardado en `agent-credential.json`, sin perder historial, vínculo ni autorización.
- Registra cada cambio real de nombre con nombre anterior, nombre actual y fecha; ignora diferencias sólo de mayúsculas y minúsculas.
- Mantiene los diez cambios más recientes y evita crear fichas duplicadas por un renombre.
- Muestra una alerta clara durante siete días, una indicación en la ficha del equipo y el historial completo en “Datos del equipo”.
- Añade el evento de auditoría “Nombre de equipo actualizado” para administradores y técnicos.
- Incluye las correcciones del actualizador 0.2.15: confirmación compatible con navegadores y regeneración automática del semáforo operativo.
- Incluye la aplicación Android interna alineada con la versión 0.2.16.