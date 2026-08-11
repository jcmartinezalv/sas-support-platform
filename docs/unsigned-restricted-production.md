# Produccion restringida sin firma

Este perfil permite operar SAS en produccion cuando todavia no hay certificado Code Signing disponible. No intenta evadir antivirus ni EDR: reduce superficie sensible deshabilitando los binarios nativos no firmados y manteniendo el control real apagado.

## Que queda habilitado

- Tickets y consola web.
- Integracion WhatsApp cuando el servidor tenga HTTPS valido.
- Fisher para diagnostico, base de conocimiento, flujos y auditoria.
- Agente Windows con registro, heartbeat y panel local.
- Sesiones remotas con consentimiento.
- Vista de pantalla usando fallback documentado.
- Comandos de diagnostico en lista blanca.
- Auditoria de comandos, consentimientos y eventos.

## Que queda deshabilitado

- `SasCaptureHelper.exe` dentro del cliente instalado o paquete restringido.
- `SasInputHelper.exe` dentro del cliente instalado o paquete restringido.
- Control real de mouse y teclado.
- `SAS_ENABLE_REAL_INPUT=true`, aunque alguien lo active por error, queda bloqueado si `SAS_UNSIGNED_RESTRICTED_PRODUCTION=true`.
- Captura JPEG optimizada por helper nativo.

## Crear paquete portable restringido

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-portable.ps1 -UnsignedRestrictedProduction
```

El paquete generado incluye:

- `CLIENT_ENV_UNSIGNED_RESTRICTED.txt` con variables sugeridas.
- `QUICKSTART.txt` con el comando de instalacion restringida.
- `manifest.json` y `sas-allowlist.json`.
- `signature-report.json` para auditoria.

Los helpers nativos se retiran fisicamente del paquete aunque existan en el repositorio de desarrollo.

## Instalar cliente restringido

Ejecutar como Administrador en el equipo cliente:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-client.ps1 -ServerUrl https://tu-dominio.com -AgentSharedSecret "SECRETO" -UnsignedRestrictedProduction
```

El instalador deja `.env.client` con:

```text
SAS_CAPTURE_HELPER_PATH=
SAS_INPUT_HELPER_PATH=
SAS_ENABLE_REAL_INPUT=false
SAS_UNSIGNED_RESTRICTED_PRODUCTION=true
```

Tambien retira `SasCaptureHelper.exe` y `SasInputHelper.exe` del directorio instalado si estaban presentes.

## Preflight recomendado

```powershell
powershell -ExecutionPolicy Bypass -File scripts\test-client-preflight.ps1 -UnsignedRestrictedProduction -OutputPath output\client-preflight-unsigned-restricted.json
```

El resultado esperado es `pass`. Las firmas de helpers aparecen como no requeridas porque los helpers quedan deshabilitados en este perfil.

## Cuando exista firma valida

1. Firmar paquete, instalador, scripts y helpers con certificado Code Signing.
2. Verificar con `scripts\verify-signatures.ps1`.
3. Generar allowlist final despues de firmar.
4. Instalar sin `-UnsignedRestrictedProduction`.
5. Mantener `SAS_ENABLE_REAL_INPUT=false` hasta completar laboratorio controlado.

## Reglas de seguridad

- No desactivar antivirus ni firewall.
- No ofuscar archivos ni ocultar procesos.
- No activar control real sin firma, consentimiento, indicador local, paro inmediato y auditoria.
- Informar al cliente que la version sin firma opera en modo restringido.
