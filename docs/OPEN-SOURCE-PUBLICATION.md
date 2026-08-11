# Publicación abierta de SAS

SAS se prepara para publicarse como software libre bajo GNU AGPL versión 3. La marca, experiencia, consola, flujo de tickets, consentimiento, auditoría y Fisher continúan siendo propios de SAS.

## Estrategia del motor remoto

La primera integración reutilizará un motor AGPL como componente claramente delimitado. SAS conservará la orquestación y el proveedor remoto resolverá captura, teclado, puntero, portapapeles y escritorio elevado. El objetivo inmediato es obtener control funcional antes de reemplazar gradualmente partes de la interfaz externa.

RustDesk es la base preferente para la primera integración porque su cliente, servidor e historial de desarrollo están publicados en GitHub. HopToDesk permanecerá como proveedor compatible y referencia secundaria. No se copiará código sin registrar su repositorio, revisión, licencia y modificaciones.

## Obligaciones de publicación

- Incluir el texto completo de AGPL-3.0 y los avisos de terceros.
- Publicar el código fuente correspondiente a cada binario distribuido y a la versión usada por el servicio de red.
- Mantener los avisos de copyright y documentar archivos derivados y fechas de modificación.
- Mostrar en las interfaces interactivas un acceso visible a licencia, ausencia de garantía y código fuente.
- Mantener instrucciones reproducibles de compilación, instalación y pruebas.
- Excluir credenciales, certificados privados, bases reales, respaldos, diagnósticos e instaladores internos.

## Estructura recomendada

- `src`, `public`, `client`: plataforma y experiencia SAS.
- `tools`: helpers nativos propios y dependencias con sus avisos.
- `vendor`: sólo componentes importados con archivo de procedencia por proveedor.
- `docs`: arquitectura, seguridad, licencias, compilación y operación.

## Puerta de publicación

Antes de cada envío a GitHub deben aprobar `npm test` y `npm run audit:publication`. La auditoría bloquea rutas operativas, secretos conocidos y binarios generados aunque una regla de exclusión se modifique accidentalmente.

La primera publicación no debe contener historial previo hasta completar la auditoría de secretos. El repositorio remoto, organización, URL de código fuente y canal de reporte de vulnerabilidades se definirán antes del primer `push`.
