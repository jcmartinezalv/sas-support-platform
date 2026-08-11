# SAS 0.2.6

Fecha: 2026-07-15

## Liga corta de instalacion

- Fisher envia una direccion breve con formato `https://setinfo.sytes.net/i/XXXXXXXX`.
- El codigo usa 8 caracteres sin `I`, `O`, `0` ni `1` para facilitar el dictado y tecleo.
- El acortamiento se resuelve dentro de SAS; no comparte tickets ni codigos con terceros.
- La liga y el codigo vencen en 60 minutos y solo vinculan un equipo.
- Las ligas largas generadas por SAS 0.2.5 siguen siendo compatibles.
- La pagina de descarga y el instalador muestran el mismo codigo corto.
- Instalar SAS Cliente no concede permiso de vista o control remoto.

## Validacion

- 180 pruebas automaticas aprobadas.
- Flujo completo validado: crear liga corta, abrir descarga, enrolar equipo, autenticar dispositivo y bloquear reutilizacion.
