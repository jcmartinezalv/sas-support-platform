# Checklist Google AI real

Variables:

```text
GOOGLE_AI_ENABLED=true
GOOGLE_AI_MOCK=false
GOOGLE_AI_REQUIRE_REVIEW=true
GEMINI_API_KEY=...
GOOGLE_AI_MODEL=gemini-2.5-flash
```

Prueba controlada:

1. Activar Google AI en ambiente de pruebas.
2. Crear 5 tickets de casos conocidos.
3. Generar propuestas con `Investigar Google AI`.
4. Revisar citas, pasos y riesgos.
5. Aprobar solo propuestas validadas.
6. Rechazar propuestas que no apliquen.
7. Revisar metricas `reviewScore*`.
8. Ajustar criterios despues de 20 a 30 propuestas reales.
