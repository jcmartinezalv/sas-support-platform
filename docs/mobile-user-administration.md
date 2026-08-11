# AdministraciÃ³n de usuarios mÃ³viles

Las operaciones requieren el permiso `mobile:approve` y generan eventos de auditorÃ­a.

- `GET /api/mobile-admin/v1/users`: lista usuarios sin contraseÃ±as ni hashes.
- `POST /api/mobile-admin/v1/users`: crea un usuario con contraseÃ±a mÃ­nima de 12 caracteres.
- `PATCH /api/mobile-admin/v1/users/{id}`: cambia nombre, rol o estado.
- `POST /api/mobile-admin/v1/users/{id}/reset-password`: cambia la contraseÃ±a y revoca sesiones y dispositivos.

Roles admitidos: `admin`, `supervisor`, `technician` y `viewer`. Estados admitidos: `active` y `disabled`. Una sesiÃ³n mÃ³vil no puede desactivar al mismo usuario con el que estÃ¡ autenticada.

## Contraseñas temporales y bloqueo

Toda cuenta creada o restablecida queda con `mustChangePassword: true`. Puede iniciar sesión, pero el servidor limita esa sesión a consultar identidad, cerrar sesión o cambiar la contraseña. Al guardar una contraseña definitiva de 12 caracteres o más se revocan todas las sesiones y se solicita iniciar sesión nuevamente.

Después de cinco contraseñas incorrectas la cuenta queda bloqueada durante 15 minutos. Ambos valores son configurables con `MOBILE_MAX_FAILED_ATTEMPTS` y `MOBILE_LOCK_MINUTES`. Los intentos se auditan sin registrar usuario ni contraseña.
