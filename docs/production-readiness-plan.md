# Plan de preparacion a produccion SAS

Este plan agrupa los cinco frentes acordados para avanzar hacia pruebas reales y produccion controlada.

## 1. Seguridad de acceso remoto

Implementado en esta etapa:

- Expiracion de enlaces remotos con `REMOTE_SESSION_TTL_MINUTES`.
- Limite de intentos de consentimiento con `REMOTE_CONSENT_MAX_ATTEMPTS`.
- Limite de intentos de control interactivo con `REMOTE_CONTROL_MAX_ATTEMPTS`.
- Estados terminales nuevos: `expired`, `consent_locked`, `control_locked`.
- Cancelacion de comandos/eventos pendientes cuando una sesion expira o se bloquea.
- Auditoria con `expiresAt`, intentos y `lockedReason`.

Variables sugeridas para pruebas:

```text
REMOTE_SESSION_TTL_MINUTES=60
REMOTE_CONSENT_MAX_ATTEMPTS=5
REMOTE_CONTROL_MAX_ATTEMPTS=5
```

## 2. Pruebas reales con cliente Windows

Checklist:

- Compilar `SasCaptureHelper.exe`.
- Compilar `SasInputHelper.exe`.
- Generar paquete portable.
- Verificar panel local en `http://127.0.0.1:37655`.
- Confirmar boton de paro local.
- Probar vista baja latencia, balanceada y calidad.
- Mantener `SAS_ENABLE_REAL_INPUT=false` hasta validar firma, auditoria y consentimiento.
- Revisar Capacidades visibles del agente: captura optimizada, helper de control, modo simulado/real y panel local.
- Ejecutar preflight de control real y exigir firma valida antes de activar `SAS_ENABLE_REAL_INPUT=true`.
- Si no hay firma de codigo disponible, instalar con `-UnsignedRestrictedProduction` y validar `output\client-preflight-unsigned-restricted.json`.

## 3. Fluidez de pantalla

Perfiles definidos en consola:

- Baja latencia: 1s, calidad 45, ancho 960.
- Vista balanceada: 2s, calidad 62, ancho 1280.
- Vista calidad: 3s, calidad 78, ancho 1600.

La medicion visual se debe hacer con edad de frame, latencia, peso KB, resolucion, perfil activo y estabilidad del agente.

## 4. WhatsApp real

Requisitos antes de activar webhook real:

- Dominio publico.
- HTTPS en 443 con certificado valido.
- Webhook `https://dominio/webhooks/whatsapp`.
- Verify token configurado.
- Access token y Phone Number ID de Meta.
- Prueba de comandos: `ayuda`, `estado`, `enlace remoto`, `hablar con tecnico`, `cerrar ticket`.

## 5. Google AI real

Requisitos:

- `GOOGLE_AI_ENABLED=true`.
- `GEMINI_API_KEY` configurada.
- `GOOGLE_AI_REQUIRE_REVIEW=true`.
- Mantener `reviewScore*` en observacion.
- Revisar 20 a 30 propuestas antes de ajustar criterios.

Regla: Google AI investiga y propone; SAS solo aprende automaticamente despues de aprobacion humana.

## 6. Produccion restringida sin firma

Este perfil queda listo para operar cuando el costo o disponibilidad de Code Signing retrase la liberacion. No reemplaza la firma: limita funciones sensibles para poder usar SAS de forma transparente.

Habilitado:

- Tickets, WhatsApp, Fisher, consola, auditoria y base de conocimiento.
- Agente Windows con heartbeat, panel local y paro inmediato.
- Sesiones remotas con consentimiento y vista de pantalla por fallback documentado.
- Diagnosticos en lista blanca.

Deshabilitado:

- Helpers nativos no firmados.
- Captura JPEG optimizada por `SasCaptureHelper.exe`.
- Control real de mouse y teclado.

Comandos:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-portable.ps1 -UnsignedRestrictedProduction
powershell -ExecutionPolicy Bypass -File scripts\install-client.ps1 -ServerUrl https://tu-dominio.com -AgentSharedSecret "SECRETO" -UnsignedRestrictedProduction
powershell -ExecutionPolicy Bypass -File scripts\test-client-preflight.ps1 -UnsignedRestrictedProduction -OutputPath output\client-preflight-unsigned-restricted.json
```

Criterio de salida: preflight en `pass`, agente visible como `Produccion restringida`, `SAS_ENABLE_REAL_INPUT=false` y auditoria activa.

## 7. Persistencia y backups operativos

Implementado para operacion inicial:

- Endpoint `GET /api/admin/storage` con ruta de base, tamano, fecha de modificacion, conteos y ultimo respaldo.
- Endpoint `POST /api/admin/backup` para crear respaldo manual auditado.
- Panel Estado del sistema dentro de Registro.
- Retencion de backups automatica limitada a 25 archivos.

Checklist antes de produccion:

1. Confirmar que `data\sas-db.json` exista y crezca despues de crear tickets.
2. Presionar Crear respaldo desde Registro.
3. Confirmar evento `admin.backup` en auditoria.
4. Copiar `data\backups` a almacenamiento externo como parte de la rutina diaria.
5. Definir migracion futura a base dedicada cuando haya uso concurrente real.

## 8. Readiness automatico de produccion

Implementado para que SAS mida su propio avance operativo:

- Endpoint `GET /api/admin/readiness`.
- Panel Preparacion dentro de Registro.
- Porcentaje calculado a partir de checks de URL publica, HTTPS, token de consola, secreto de agente, WhatsApp, almacenamiento, agentes, preflight, seguridad remota y Google AI.
- Siguientes acciones visibles para reducir incertidumbre antes de pruebas reales.

Interpretacion:

- `pass`: listo para produccion controlada.
- `warn`: usable con pendientes documentados.
- `fail`: existen bloqueos que deben resolverse antes de cliente real.

En ambiente local es normal ver fallos en HTTPS y secreto porque `start-local-stack.ps1` usa `localhost`, `ENABLE_HTTPS=false` y secreto demo.

