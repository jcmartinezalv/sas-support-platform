param(
  [string]$InstallPath = "C:\SAS\Server",
  [string]$PublicHost = "setinfo.sytes.net",
  [string]$ExternalIp = "",
  [int]$ListeningPort = 3478,
  [int]$TlsPort = 5349,
  [int]$RelayMinPort = 49152,
  [int]$RelayMaxPort = 49200
)
$ErrorActionPreference = "Stop"
$principal=[Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw "Ejecuta SAS Administrador como administrador para instalar TURN."}
$root=(Resolve-Path $InstallPath).Path
$turnExe=Join-Path $root "tools\coturn\turnserver.exe"
$wrapper=Join-Path $root "src\turn\turn-service.js"
$nodeExe=Join-Path $root "runtime\node\node.exe"
$hostExe=Join-Path $root "tools\sas-service-host\SasServiceHost.exe"
$envFile=Join-Path $root ".env.production"
$keyPath=Join-Path $root "certs\server.key"
$certPath=Join-Path $root "certs\server.crt"
foreach($required in @($turnExe,$wrapper,$nodeExe,$hostExe,$envFile,$keyPath,$certPath)){if(-not(Test-Path -LiteralPath $required)){throw "Falta el componente requerido: $required"}}
$existingEnvironment=@{}
foreach($environmentLine in (Get-Content -LiteralPath $envFile -Encoding UTF8)){
  if($environmentLine -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$'){$existingEnvironment[$matches[1]]=$matches[2].Trim()}
}
function Read-ConfiguredInt([string]$Name,[int]$Fallback,[int]$Minimum,[int]$Maximum){
  if(-not $existingEnvironment.ContainsKey($Name)){return $Fallback}
  $candidate=0
  if([Int32]::TryParse($existingEnvironment[$Name],[ref]$candidate)-and $candidate-ge$Minimum-and $candidate-le$Maximum){return $candidate}
  return $Fallback
}
if(-not $PSBoundParameters.ContainsKey('PublicHost')){
  if($existingEnvironment.ContainsKey('SAS_TURN_PUBLIC_HOST')-and -not [String]::IsNullOrWhiteSpace($existingEnvironment['SAS_TURN_PUBLIC_HOST'])){$PublicHost=$existingEnvironment['SAS_TURN_PUBLIC_HOST']}
  elseif($existingEnvironment.ContainsKey('PUBLIC_BASE_URL')){try{$configuredUri=[Uri]$existingEnvironment['PUBLIC_BASE_URL'];if($configuredUri.Host){$PublicHost=$configuredUri.Host}}catch{}}
}
if(-not $PSBoundParameters.ContainsKey('ListeningPort')){$ListeningPort=Read-ConfiguredInt 'SAS_TURN_LISTENING_PORT' $ListeningPort 1 65535}
if(-not $PSBoundParameters.ContainsKey('TlsPort')){$TlsPort=Read-ConfiguredInt 'SAS_TURN_TLS_PORT' $TlsPort 1 65535}
if(-not $PSBoundParameters.ContainsKey('RelayMinPort')){$RelayMinPort=Read-ConfiguredInt 'WEBRTC_UDP_MIN_PORT' $RelayMinPort 1024 65535}
if(-not $PSBoundParameters.ContainsKey('RelayMaxPort')){$RelayMaxPort=Read-ConfiguredInt 'WEBRTC_UDP_MAX_PORT' $RelayMaxPort 1024 65535}
$ipRefreshSeconds=Read-ConfiguredInt 'SAS_TURN_IP_REFRESH_SECONDS' 60 15 3600
if($RelayMinPort -lt 1024 -or $RelayMaxPort -lt $RelayMinPort -or $RelayMaxPort -gt 65535){throw "El rango de puertos relay no es válido."}
$turnRoot=Join-Path $root "turn"
$turnTlsRoot=Join-Path $turnRoot "tls"
$logRoot=Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $turnRoot,$turnTlsRoot,$logRoot|Out-Null
$turnCertPath=Join-Path $turnTlsRoot "server.crt"
$turnKeyPath=Join-Path $turnTlsRoot "server.key"
Copy-Item -LiteralPath $certPath -Destination $turnCertPath -Force
Copy-Item -LiteralPath $keyPath -Destination $turnKeyPath -Force
$existingSecret=(Get-Content -LiteralPath $envFile -Encoding UTF8 | Where-Object {$_ -match '^WEBRTC_TURN_SECRET='} | Select-Object -First 1) -replace '^WEBRTC_TURN_SECRET=',''
if($existingSecret -and $existingSecret.Length -ge 32){
  $secret=$existingSecret
}else{
  $secretBytes=New-Object byte[] 48
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($secretBytes)
  $secret=[Convert]::ToBase64String($secretBytes)
}
$externalIpWasProvided=-not [String]::IsNullOrWhiteSpace($ExternalIp)
$localIp=""
$externalMapping=$ExternalIp
if(-not $externalMapping){
  $publicIp=(Resolve-DnsName -Name $PublicHost -Type A -ErrorAction SilentlyContinue | Where-Object {$_.IPAddress} | Select-Object -First 1 -ExpandProperty IPAddress)
  $localIp=(Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object {$_.IPv4DefaultGateway -and $_.IPv4Address} | Select-Object -First 1 -ExpandProperty IPv4Address).IPAddress
  if($publicIp -and $localIp -and $publicIp -ne $localIp){$externalMapping="$publicIp/$localIp"}
  elseif($publicIp){$externalMapping=$publicIp}
}
$configLines=@(
  "listening-port=$ListeningPort",
  "tls-listening-port=$TlsPort",
  "min-port=$RelayMinPort",
  "max-port=$RelayMaxPort",
  "realm=$PublicHost",
  "server-name=$PublicHost",
  "fingerprint",
  "use-auth-secret",
  "static-auth-secret=$secret",
  "cert=tls/server.crt",
  "pkey=tls/server.key",
  "stale-nonce=600",
  "no-multicast-peers",
  "no-loopback-peers",
  "user-quota=4",
  "total-quota=100",
  "log-file=stdout",
  "simple-log"
)
if($externalMapping){$configLines += "external-ip=$externalMapping"}
$configPath=Join-Path $turnRoot "turnserver.conf"
[IO.File]::WriteAllLines($configPath,$configLines,[Text.UTF8Encoding]::new($false))
# Los SID son universales y no dependen del idioma de Windows.
$protectedIdentitySids=@("S-1-5-18","S-1-5-32-544")
foreach($protectedPath in @($configPath,$turnCertPath,$turnKeyPath)){
  $acl=Get-Acl $protectedPath
  $acl.SetAccessRuleProtection($true,$false)
  foreach($sidValue in $protectedIdentitySids){
    $sid=New-Object Security.Principal.SecurityIdentifier($sidValue)
    $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,"FullControl","Allow")
    $acl.AddAccessRule($rule)
  }
  Set-Acl $protectedPath $acl
}
$envLines=[Collections.Generic.List[string]](Get-Content -LiteralPath $envFile -Encoding UTF8)
function Set-EnvValue([string]$Name,[string]$Value){$index=-1;for($i=0;$i-lt$envLines.Count;$i++){if($envLines[$i]-match "^$([regex]::Escape($Name))="){$index=$i;break}};$line="$Name=$Value";if($index-ge 0){$envLines[$index]=$line}else{$envLines.Add($line)}}
$turnUrls="turn:${PublicHost}:${ListeningPort}?transport=udp,turn:${PublicHost}:${ListeningPort}?transport=tcp,turns:${PublicHost}:${TlsPort}?transport=tcp"
Set-EnvValue "WEBRTC_TURN_URLS" $turnUrls
Set-EnvValue "WEBRTC_TURN_SECRET" $secret
Set-EnvValue "WEBRTC_TURN_CREDENTIAL_TTL_SECONDS" "600"
Set-EnvValue "SAS_TURN_EXECUTABLE" $turnExe
Set-EnvValue "SAS_TURN_CONFIG_PATH" $configPath
Set-EnvValue "SAS_TURN_PUBLIC_HOST" $PublicHost
Set-EnvValue "SAS_TURN_LISTENING_PORT" "$ListeningPort"
Set-EnvValue "SAS_TURN_TLS_PORT" "$TlsPort"
Set-EnvValue "WEBRTC_UDP_MIN_PORT" "$RelayMinPort"
Set-EnvValue "WEBRTC_UDP_MAX_PORT" "$RelayMaxPort"
Set-EnvValue "SAS_TURN_EXTERNAL_IP_MODE" $(if($externalIpWasProvided){"manual"}else{"auto"})
Set-EnvValue "SAS_TURN_PRIVATE_IP" $localIp
Set-EnvValue "SAS_TURN_IP_REFRESH_SECONDS" "$ipRefreshSeconds"
[IO.File]::WriteAllLines($envFile,$envLines,[Text.UTF8Encoding]::new($false))
foreach($ruleName in @("SAS TURN 3478 UDP","SAS TURN 3478 TCP","SAS TURN 5349 TCP","SAS TURN Relay UDP","SAS TURN Relay TCP")){Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue|Remove-NetFirewallRule}
New-NetFirewallRule -DisplayName "SAS TURN 3478 UDP" -Direction Inbound -Action Allow -Protocol UDP -LocalPort $ListeningPort|Out-Null
New-NetFirewallRule -DisplayName "SAS TURN 3478 TCP" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $ListeningPort|Out-Null
New-NetFirewallRule -DisplayName "SAS TURN 5349 TCP" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $TlsPort|Out-Null
New-NetFirewallRule -DisplayName "SAS TURN Relay UDP" -Direction Inbound -Action Allow -Protocol UDP -LocalPort "$RelayMinPort-$RelayMaxPort"|Out-Null
New-NetFirewallRule -DisplayName "SAS TURN Relay TCP" -Direction Inbound -Action Allow -Protocol TCP -LocalPort "$RelayMinPort-$RelayMaxPort"|Out-Null
$serviceName="SAS Support TURN"
$displayName="SAS Support TURN"
$binary='"'+$hostExe+'" "'+$serviceName+'" "'+$displayName+'" "'+$nodeExe+'" "'+$wrapper+'" "'+$root+'" "'+$envFile+'" "'+(Join-Path $logRoot 'sas-turn.out.log')+'" "'+(Join-Path $logRoot 'sas-turn.err.log')+'"'
$service=Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if($service){
  if($service.Status-ne'Stopped'){Stop-Service $serviceName -Force; $service.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(20))}
  & sc.exe config $serviceName binPath= $binary start= auto DisplayName= $displayName|Out-Null
}else{
  New-Service -Name $serviceName -BinaryPathName $binary -DisplayName $displayName -Description "Relay WebRTC de SAS Support Platform" -StartupType Automatic|Out-Null
}
& sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/15000/restart/60000|Out-Null
Start-Service $serviceName
(Get-Service $serviceName).WaitForStatus('Running',[TimeSpan]::FromSeconds(20))
Restart-Service "SAS Support Server" -ErrorAction Stop
Start-Sleep -Seconds 2
[pscustomobject]@{status="pass";service=(Get-Service $serviceName).Status.ToString();host=$PublicHost;turnUrls=$turnUrls;relayPorts="$RelayMinPort-$RelayMaxPort";externalIp=$(if($externalMapping){$externalMapping}else{"sin asignar; revisar NAT"});ipRefresh=$(if($externalIpWasProvided){"manual"}else{"automático cada $ipRefreshSeconds segundos desde DNS"});credentials="temporales";routerPorts="$ListeningPort UDP/TCP, $TlsPort TCP, $RelayMinPort-$RelayMaxPort UDP/TCP"}|ConvertTo-Json -Depth 4
