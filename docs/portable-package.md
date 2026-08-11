# Paquete portable SAS

El paquete portable sirve para copiar la version actual del proyecto a otra maquina Windows sin incluir datos locales, logs ni archivos temporales.

## Crear paquete

Desde la carpeta del proyecto:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-portable.ps1
```

El resultado queda en:

```text
dist\sas-support-portable-YYYYMMDD-HHMMSS
```

Incluye:

- `src`: servidor SAS.
- `client`: agente Windows.
- `public`: consola web.
- `scripts`: instaladores y utilidades.
- `docs`: documentacion.
- `manifest.json`: hashes SHA256 de archivos.
- `QUICKSTART.txt`: comandos rapidos.

## No incluye

- `data/sas-db.json`
- `data/backups`
- logs
- certificados privados
- `.env`

## Uso recomendado

1. Crear paquete portable.
2. Copiar carpeta generada a servidor o cliente.
3. Configurar `.env` o `.env.client`.
4. Ejecutar instalador correspondiente como Administrador.

## Produccion

Para produccion se debe usar certificado TLS real, dominio publico para WhatsApp y secretos fuertes.
