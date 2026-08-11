# Integracion Google AI para investigacion asistida

SAS puede usar Google Gemini como motor de investigacion para proponer resoluciones cuando la base local no tiene una respuesta confiable.

## Principios de seguridad

- La integracion esta desactivada por defecto.
- Las propuestas generadas por Google AI quedan siempre en `pending_review`, incluso si una configuracion antigua intenta aprobarlas automaticamente.
- Fisher solo usa articulos con estado `approved`.
- Un tecnico debe revisar pasos, citas y riesgos antes de aprobar.
- No se deben guardar contrasenas, tokens, llaves privadas ni datos sensibles de clientes.
- Google AI y OpenAI usan un sanitizador compartido para ocultar correos, telefonos y secretos antes de consultar.

## Taxonomia central de Fisher

Fisher usa 25 categorias operativas agrupadas en Red, Colaboracion, Perifericos, Windows, Aplicaciones, Seguridad, Identidad, Continuidad, Servidores, Hardware y Soporte. Las reglas detalladas tienen prioridad; la taxonomia funciona como respaldo para evitar que VPN, certificados, Active Directory, Windows Update, respaldos y servicios de servidor caigan en `general`.

Los incidentes criticos de seguridad y los cambios de infraestructura se escalan a revision humana.

## Contrato de investigacion supervisada

Cada propuesta debe incluir:

- prerrequisitos y comprobaciones de diagnostico;
- pasos de resolucion separados de la inspeccion;
- procedimiento de reversion;
- necesidad de administrador e impacto de servicio;
- riesgos, resumen y citas verificables;
- confianza de fuentes y aprobacion humana obligatoria.

El ranking premia dominios oficiales conocidos y penaliza fuentes secundarias, citas invalidas, cambios administrativos sin reversion y procedimientos destructivos o relacionados con secretos.
## Variables de entorno

```text
GOOGLE_AI_ENABLED=false
GOOGLE_AI_MOCK=false
GOOGLE_AI_REQUIRE_REVIEW=true
GEMINI_API_KEY=
GOOGLE_AI_MODEL=gemini-2.5-flash
```

Para pruebas sin internet ni API key:

```text
GOOGLE_AI_ENABLED=true
GOOGLE_AI_MOCK=true
GOOGLE_AI_REQUIRE_REVIEW=true
```

## Flujo en consola

1. Abrir un ticket.
2. Opcionalmente escribir contexto adicional en Nota interna.
3. Presionar `Investigar Google AI`.
4. Revisar el articulo generado en Conocimiento.
5. Confirmar citas, pasos y riesgos.
6. Presionar `Aprobar` si la propuesta es valida.
7. A partir de ese momento Fisher puede usarla en diagnosticos similares.

## Endpoints

Investigar ticket:

```http
POST /api/tickets/{ticketId}/research-google-ai
```

Aprobar articulo:

```http
PATCH /api/knowledge/{articleId}
```

Cuerpo:

```json
{ "status": "approved" }
```

## Auditoria

- `google_ai.research_ticket`: propuesta generada desde ticket.
- `knowledge.update`: cambio de estado, incluyendo aprobacion.
- El ticket recibe una nota interna con el articulo generado.

## Fuentes tecnicas

La implementacion usa Gemini API REST con herramienta `google_search` para grounding. Consultar documentacion oficial:

- https://ai.google.dev/gemini-api/docs
- https://ai.google.dev/gemini-api/docs/google-search

## Ranking de revision

Cada propuesta de Google AI recibe un `reviewScore*` de 0 a 100.

*Nota de observacion: el `reviewScore*` queda marcado con asterisco porque el criterio esta en evaluacion. Se ajustara despues de observar casos reales.*

Criterios actuales:

- Citas presentes o multiples citas.
- Cantidad razonable de pasos operativos.
- Palabras clave suficientes para reutilizacion.
- Notas de riesgo incluidas.
- Penalizacion si los pasos parecen destructivos o solicitan secretos.

Recomendaciones:

- `recommended_for_approval`: 80 a 100, candidato fuerte para revision rapida.
- `needs_review`: 60 a 79, requiere revision normal.
- `high_risk_review`: menos de 60, revisar con cuidado.

Fisher puede detectar propuestas `pending_review` con ranking alto y devolver `nextAction: review_ai_proposal`, pero no las usa como solucion automatica hasta que el articulo sea aprobado.

## Cola de revision

Las propuestas `pending_review` se consultan por ranking con:

```http
GET /api/knowledge/review-queue
```

La cola ordena primero las propuestas con mayor `reviewScore`.

Acciones disponibles:

- Aprobar: `PATCH /api/knowledge/{articleId}` con `{ "status": "approved" }`.
- Rechazar: `PATCH /api/knowledge/{articleId}` con `{ "status": "rejected" }`.

Cuando una propuesta se rechaza:

- Sale de la cola pendiente.
- Fisher deja de sugerirla como `pending_review_ranked`.
- Se conserva auditoria y nota de revision.


## Metricas de observacion

Para evaluar `reviewScore*` se expone:

```http
GET /api/knowledge/review-metrics
```

Devuelve:

- `pending`: propuestas pendientes.
- `approved`: propuestas aprobadas.
- `rejected`: propuestas rechazadas.
- `averageScore`: promedio global.
- `averageApprovedScore`: promedio de propuestas aprobadas.
- `averageRejectedScore`: promedio de propuestas rechazadas.

Estas metricas ayudan a decidir si los umbrales actuales deben ajustarse.


