# Checklist WhatsApp real

Requisitos:

- Dominio apuntando al servidor SAS.
- Puerto 80 abierto para emision/renovacion Let's Encrypt si se usa HTTP-01.
- Puerto 443 abierto para HTTPS.
- `PUBLIC_BASE_URL=https://dominio`.
- `WHATSAPP_VERIFY_TOKEN` configurado.
- `WHATSAPP_ACCESS_TOKEN` configurado.
- `WHATSAPP_PHONE_NUMBER_ID` configurado.

Prueba inicial:

1. Configurar webhook en Meta: `https://dominio/webhooks/whatsapp`.
2. Verificar challenge del webhook.
3. Enviar mensaje real desde WhatsApp.
4. Confirmar ticket creado.
5. Probar `ayuda`.
6. Probar `enlace remoto` y confirmar que Fisher entrega el código de 6 caracteres.
7. En la computadora afectada abrir `http://127.0.0.1:37655` y vincular el equipo con el código.
8. Confirmar en auditoría el evento `remote.pair_agent`.
9. Abrir liga de consentimiento HTTPS.
10. Cerrar ticket por WhatsApp.

