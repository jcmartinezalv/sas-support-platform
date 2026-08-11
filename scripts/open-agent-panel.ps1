param(
  [int]$Port = 37655
)

$uri = "http://127.0.0.1:$Port"
Write-Host "Abriendo panel local SAS Agent: $uri"
Start-Process $uri
