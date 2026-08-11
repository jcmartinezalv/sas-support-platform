# Aprendizaje continuo de Fisher

SAS puede convertir una resolucion validada por el tecnico en un articulo de base de conocimiento. Esto permite que Fisher reutilice la solucion en diagnosticos posteriores.

## Flujo operativo

1. Abrir un ticket en la consola.
2. Escribir la resolucion en la nota interna, preferentemente una linea por paso.
3. Presionar `Aprender resolucion`.
4. SAS crea un articulo en la base de conocimiento con referencia al ticket origen.
5. Fisher usa ese articulo cuando un nuevo diagnostico coincide con sus palabras clave o contenido.

## Reglas de seguridad

- Solo roles con permiso `kb:write` pueden crear conocimiento desde tickets.
- La auditoria registra `knowledge.learn_from_ticket`.
- El ticket recibe una nota interna indicando el articulo creado.
- La base de conocimiento no debe contener contrasenas, tokens privados ni datos sensibles del cliente.

## API

Crear conocimiento desde ticket:

```http
POST /api/tickets/{ticketId}/learn
```

Cuerpo recomendado:

```json
{
  "resolution": "Validar hora del equipo\nReiniciar servicio\nProbar conexion",
  "keywords": ["vpn", "forticlient", "token"]
}
```

Respuesta esperada:

```json
{
  "article": {
    "id": "KB-...",
    "sourceTicketId": "TCK-...",
    "resolutionSteps": ["Validar hora del equipo", "Reiniciar servicio", "Probar conexion"]
  }
}
```

Cuando Fisher usa un articulo aprendido, el diagnostico incluye:

- `source`: `knowledge_base`
- `articleId`: identificador del articulo usado
- `articleTitle`: titulo de la resolucion sugerida
