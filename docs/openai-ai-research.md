# Integracion OpenAI para investigacion de Fisher

SAS puede usar OpenAI como segundo proveedor de investigacion junto con Google AI. El proveedor usa Responses API, busqueda web opcional y salida JSON estructurada.

## Estado actual

- Integracion disponible en modo simulado sin API key.
- Boton `Buscar con OpenAI` dentro del detalle del ticket.
- Toda propuesta queda en `pending_review`.
- Los datos enviados se sanitizan antes de construir la solicitud.
- No se envian nombre ni telefono del cliente como campos del ticket.
- Correos, telefonos y valores parecidos a contrasenas, tokens o API keys se reemplazan.
- OpenAI nunca ejecuta las acciones propuestas.

## Configuracion

```text
OPENAI_ENABLED=false
OPENAI_MOCK=false
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-terra
OPENAI_WEB_SEARCH=true
OPENAI_REASONING_EFFORT=low
```

Prueba local sin clave:

```text
OPENAI_ENABLED=true
OPENAI_MOCK=true
```

## Flujo

1. Abrir un caso y escribir contexto opcional en Nota interna.
2. Seleccionar `Mas de Fisher` y `Buscar con OpenAI`.
3. SAS anonimiza la consulta.
4. OpenAI devuelve una propuesta estructurada con fuentes cuando la busqueda esta habilitada.
5. SAS calcula ranking, confianza de fuentes y riesgos.
6. La propuesta entra a Soluciones como `pending_review`.
7. Un tecnico aprueba o rechaza; Fisher no la usa antes de la aprobacion.
8. La opcion Comparar ambos consulta Google y OpenAI, registra coincidencias o desacuerdos y crea un informe de consenso pendiente.

## API

```http
POST /api/tickets/{ticketId}/research-openai
```

La clave se configura solamente en el archivo de entorno protegido del servidor. No debe guardarse en JavaScript publico, tickets, documentacion, repositorio ni conversaciones.

## Modelo

El valor predeterminado es `gpt-5.6-terra` para equilibrar capacidad y costo. Puede cambiarse mediante `OPENAI_MODEL` sin modificar el codigo.

Fuentes oficiales:

- https://developers.openai.com/api/docs/models
- https://developers.openai.com/api/docs/models/gpt-5.6-sol
## Comparacion entre proveedores

`Comparar ambos` no mezcla automaticamente instrucciones operativas. Compara categoria, modelos, palabras clave, dominios citados, riesgo y disponibilidad de cada proveedor. Si las categorias no coinciden, reduce el ranking y exige resolver el desacuerdo. Si un proveedor falla, conserva el resultado disponible pero lo marca como revision de proveedor unico.

Google AI y OpenAI usan el mismo sanitizador antes de cualquier solicitud externa.
## Revision visual antes de aprobar

Las tarjetas de Soluciones muestran proveedor, proteccion de datos, necesidad de administrador, impacto, prerrequisitos, comprobaciones, riesgos y reversion. Los resultados de consenso indican si ambos proveedores coinciden, discrepan o si uno no respondio. Aprobar cualquier propuesta externa requiere una confirmacion adicional del tecnico.

