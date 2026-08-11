# Actualizaciones automaticas de SAS

## Alcance

SAS 0.2.8 incorpora el actualizador del equipo principal. Esta version debe instalarse una vez con el Setup completo; las versiones posteriores podran aplicarse desde Estado del sistema.

## Canales

- `stable`: versiones aprobadas para produccion.
- `testing`: validacion antes de promover una version.
- `client`: reservado para el agente de usuario.

Direccion predeterminada: `https://setinfo.sytes.net/updates/{canal}/manifest.json`.

## Flujo del administrador

1. Abrir Estado del sistema > Actualizaciones de SAS.
2. Pulsar Buscar actualizacion.
3. Revisar version, notas y estado de firma.
4. Pulsar Descargar y verificar. Esto no reinicia SAS.
5. Pulsar Instalar actualizacion y escribir `ACTUALIZAR x.y.z`.
6. SAS crea una tarea independiente, respalda la version y reinicia el servidor.
7. El actualizador exige que `/health` responda la version esperada.
8. Si falla, restaura la version anterior y vuelve a comprobar su salud.

## Controles

- Solo el rol Administrador tiene `system:update`.
- El paquete debe proceder del mismo origen configurado.
- HTTPS obligatorio, salvo habilitacion local explicita.
- Limite predeterminado de 512 MiB.
- SHA-256 externo y todos los hashes de `release-manifest.json`.
- Firma Ed25519 opcional y gratuita; puede hacerse obligatoria.
- Conservacion de los tres respaldos mas recientes.
- La configuracion, datos y certificados se conservan.
- Cada consulta, preparacion e instalacion se audita.

## Publicar una version

```powershell
node scripts/publish-update-channel.mjs --package dist\sas-windows11-final-FECHA.zip --channel testing --version 0.2.9 --output C:\SAS\Updates --notes "Mejora uno|Correccion dos"
```

Despues de validar `testing`, repetir con `--channel stable`.

## Firma Ed25519 sin certificado comercial

Generar una sola vez, fuera del proyecto:

```powershell
node scripts/generate-update-signing-key.mjs C:\SAS-Secrets\update-signing
```

La clave privada solo se usa al publicar con `--private-key`. La clave publica se configura como `UPDATE_PUBLIC_KEY` usando saltos escapados `\n`, y se activa `UPDATE_REQUIRE_SIGNATURE=true`. Nunca copiar la clave privada al equipo principal ni al paquete.

## Recuperacion

Resultados: `C:\SAS\Updates\last-update-result.json`.
Respaldos: `C:\SAS\Updates\backups`.
Tarea temporal: `SAS Support Platform Update`.
Tarea del servidor: `SAS Support Server Production`.
## Flujo entre la maquina de desarrollo y la maquina definitiva

La maquina de desarrollo genera y prueba el canal local. La maquina definitiva almacena el canal en C:\SAS\Updates y lo publica por HTTPS. Crear la carpeta updates solamente en la computadora de desarrollo no actualiza el servidor.

Para transferir una version, compartir o mapear de forma autenticada C:\SAS\Updates del servidor definitivo y ejecutar desde la maquina de desarrollo:

    .\scripts\publish-update-to-server.ps1 -SourceRoot .\updates -DestinationRoot "\\192.168.50.1\SASUpdates$" -Channel stable -ExpectedVersion 0.2.18 -PublicBaseUrl https://setinfo.sytes.net

El publicador no guarda contrasenas. Verifica el paquete local, copia el ZIP, vuelve a calcular su SHA-256 en el destino y publica manifest.json al final. Despues comprueba que el manifiesto sea visible por HTTPS. El recurso actual `SASUpdates$` apunta exclusivamente a `C:\SAS\Updates`; autenticarlo como `SERVER\juancarlos` antes de publicar.

Responsabilidades:

- Maquina de desarrollo: compilar, probar, firmar y preparar los canales.
- Maquina definitiva: almacenar C:\SAS\Updates, publicarlos en /updates/ y aplicar la version bajo la cuenta SYSTEM.
- Nunca copiar la clave privada de firma a la maquina definitiva.