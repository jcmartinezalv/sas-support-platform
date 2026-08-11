# Aplicación Android de Fisher

## Alcance

La aplicación permite iniciar sesión desde un dispositivo registrado, revisar el tablero operativo, consultar actividad y alertas de Fisher, hacer consultas y administrar preferencias. Es una interfaz de observación: no inicia reparaciones, sesiones remotas ni aprobaciones críticas.

## Seguridad

- Solo admite HTTPS; Android bloquea tráfico HTTP en claro.
- Tokens de acceso y renovación cifrados mediante Android Keystore y AES-GCM.
- Cada instalación genera un UUID aleatorio; no se recopilan IMEI, teléfono ni identificadores permanentes.
- El servidor conserva hashes, rota el token de renovación y permite revocar dispositivos.
- La copia de seguridad de datos de la aplicación está desactivada.
- Las cuentas temporales utilizadas para validación ya están deshabilitadas y responden HTTP 401.

## Activación del primer administrador

Configure estas variables únicamente en el servidor y nunca dentro del APK:

```dotenv
MOBILE_BOOTSTRAP_USERNAME=administrador
MOBILE_BOOTSTRAP_PASSWORD=una-clave-larga-y-unica
MOBILE_BOOTSTRAP_DISPLAY_NAME=Administrador movil
MOBILE_ACCESS_TTL_MINUTES=15
MOBILE_REFRESH_TTL_DAYS=30
```

Las dos primeras crean el primer administrador sólo cuando no existen usuarios móviles. Después del alta, retire la contraseña de bootstrap y reinicie el servicio.

## Validación física completada

El 13 de julio de 2026 se compiló, instaló y probó la variante debug en:

- Dispositivo: Xiaomi 2506BPN68G.
- Sistema: HyperOS OS3.0.302.0.WOSMIXM.
- Servidor: `https://setinfo.sytes.net`.

Resultados aprobados:

- Inicio y cierre de sesión.
- Tablero, actividad y bandeja de alertas.
- Consultas a Fisher con respuesta legible.
- Ajustes y persistencia de preferencias.
- Navegación con las áreas seguras de Android.
- Fondo oscuro y contraste correcto de los campos de acceso.

## Sesión y red

La app guarda cifrados el token de acceso, el token de renovación y sus vencimientos. Revisa la vigencia cada minuto y rota la sesión cuando restan dos minutos o menos. Si la renovación falla, elimina la sesión local.

La URL HTTPS elegida se recuerda localmente. Las lecturas GET se reintentan hasta dos veces ante errores de transporte o respuestas 5xx; nunca se repiten automáticamente inicios de sesión, cambios ni respuestas 4xx. El último tablero válido se conserva cifrado para interrupciones temporales.

## Alertas y paginación

La bandeja evita duplicados, permite marcar elementos como leídos y guarda preferencias por categoría. Actividad y alertas cargan 20 elementos y pueden ampliar hasta 100 mediante `Cargar más`.

## Preparación FCM

La bandeja funciona sin Firebase. El servidor ya mantiene una cola persistente `mobilePushDeliveries`, pero las entregas quedan como `pending_provider` hasta configurar Firebase y el transporte FCM. FCM es una mejora opcional, no un requisito para operar la aplicación.

