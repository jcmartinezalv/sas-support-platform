# SAS 0.2.151 — RustDesk integrado en el instalador

- El instalador de SAS Cliente incluye el MSI oficial de RustDesk 1.4.9.
- La compilación y la instalación verifican el SHA-256 fijado antes de ejecutarlo.
- RustDesk se instala silenciosamente en instalaciones nuevas y actualizaciones.
- SAS configura `SAS_REMOTE_ENGINE=auto` para seleccionar RustDesk cuando está disponible.
- Si RustDesk ya está instalado, SAS lo conserva y continúa sin reinstalarlo.
- El ID del equipo atendido se reporta a SAS y se abre desde RustDesk en el equipo técnico.

SHA-256 oficial fijado para `rustdesk-1.4.9-x86_64.msi`:

`C87D2F4CEF2A5ACD6003B6507DCFBF5D5168A256DB082CD90B54D35193224AAA`
