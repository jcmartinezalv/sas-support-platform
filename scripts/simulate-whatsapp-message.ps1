param(
  [string]$ServerUrl = "http://127.0.0.1:3110",
  [string]$From = "5215550000000",
  [string]$Name = "Cliente Prueba WhatsApp",
  [string]$Message = "Necesito soporte remoto por AnyDesk, mi correo no funciona",
  [string]$MessageId = "wamid.test"
)

$ErrorActionPreference = "Stop"

$payload = @{
  object = "whatsapp_business_account"
  entry = @(
    @{
      id = "test-entry"
      changes = @(
        @{
          field = "messages"
          value = @{
            messaging_product = "whatsapp"
            metadata = @{
              display_phone_number = "5215551112222"
              phone_number_id = "test-phone-number-id"
            }
            contacts = @(
              @{
                profile = @{ name = $Name }
                wa_id = $From
              }
            )
            messages = @(
              @{
                from = $From
                id = $MessageId
                timestamp = [string][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
                type = "text"
                text = @{ body = $Message }
              }
            )
          }
        }
      )
    }
  )
}

$response = Invoke-WebRequest -Uri "$ServerUrl/webhooks/whatsapp" -Method POST -Headers @{ "Content-Type" = "application/json" } -Body ($payload | ConvertTo-Json -Depth 12) -UseBasicParsing
$response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 12
