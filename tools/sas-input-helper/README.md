# SAS Input Helper

Ejecutor nativo para eventos interactivos autorizados de Windows.

Estado: preparado, pero desactivado por defecto en el agente.

Activacion controlada:

```text
SAS_ENABLE_REAL_INPUT=true
SAS_INPUT_HELPER_PATH=C:\SAS\Client\tools\sas-input-helper\bin\Release\SasInputHelper.exe
```

Eventos soportados:

- `mouse_move`
- `mouse_click`
- `key_press` para teclas permitidas: Enter, Tab, Esc, Backspace, Space, A-Z, 0-9.

Requisitos de seguridad:

- Consentimiento general aprobado.
- Consentimiento de control aprobado.
- Sesion activa.
- Helper firmado antes de produccion.
- Paro inmediato cliente/agente.
