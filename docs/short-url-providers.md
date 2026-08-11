# Acortadores de liga para Fisher

SAS puede usar TinyURL, Bitly o su liga corta interna. El modo recomendado es `auto`: intenta TinyURL, luego Bitly y finalmente usa SAS si los proveedores no estan configurados o no responden.

## Configuracion

```env
SHORT_URL_PROVIDER=auto
SHORT_URL_TIMEOUT_MS=5000
TINYURL_API_TOKEN=
TINYURL_DOMAIN=tinyurl.com
BITLY_ACCESS_TOKEN=
BITLY_DOMAIN=bit.ly
```

Valores permitidos para `SHORT_URL_PROVIDER`: `auto`, `tinyurl`, `bitly` o `internal`.

## Obtener credenciales

- TinyURL: iniciar sesion, abrir API Settings y crear un token con permiso Create TinyURL: https://tinyurl.com/app/dev
- Bitly: abrir la configuracion de API y generar un access token: https://dev.bitly.com/docs/getting-started/authentication/

Los tokens deben guardarse solamente en `.env.production` o `.env`. SAS no los devuelve por API, no los escribe en auditoria y los reportes solo indican si existen.

## Privacidad y vencimiento

El proveedor recibe una direccion como `https://setinfo.sytes.net/i/XXXXXXXX`. No recibe nombre, telefono ni identificador de ticket. TinyURL o Bitly pueden conservar la direccion y sus datos de clics conforme a sus politicas. Aunque la liga externa permanezca, SAS bloquea el destino al vencer el codigo interno o despues de vincular un equipo.

## Comportamiento de respaldo

- `auto`: TinyURL, despues Bitly, despues SAS.
- Proveedor fijo: si falla, SAS envia su liga interna.
- La consola informa cual proveedor se utilizo.
- El fallo de un acortador nunca impide atender al cliente.
