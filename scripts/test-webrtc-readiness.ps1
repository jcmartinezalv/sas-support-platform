param([string]$PublicHost="setinfo.sytes.net",[int]$HttpsPort=443,[int]$TurnPort=5349,[int]$StunPort=3478,[int]$UdpStart=49152,[int]$UdpEnd=49200)
$ErrorActionPreference="SilentlyContinue"; $results=@()
function Add-Result($name,$ok,$detail){$script:results += [pscustomobject]@{check=$name;status=if($ok){"pass"}else{"fail"};detail=$detail}}
try{$dns=Resolve-DnsName $PublicHost -Type A -ErrorAction Stop;Add-Result "public_dns" $true (($dns|Select-Object -ExpandProperty IPAddress)-join ", ")}catch{Add-Result "public_dns" $false $_.Exception.Message}
foreach($port in @($HttpsPort,$TurnPort)){$r=Test-NetConnection $PublicHost -Port $port -WarningAction SilentlyContinue;Add-Result "tcp_$port" $r.TcpTestSucceeded (if($r.TcpTestSucceeded){"reachable"}else{"not reachable"})}
$udp=$true;try{$u=Get-NetUDPEndpoint -LocalPort $StunPort -ErrorAction Stop;$detail="listener present"}catch{$udp=$false;$detail="no local listener"};Add-Result "udp_$StunPort" $udp $detail
$ports=@(Get-NetUDPEndpoint | Where-Object {$_.LocalPort -ge $UdpStart -and $_.LocalPort -le $UdpEnd});Add-Result "udp_media_range" ($ports.Count -gt 0) ("listeners: {0}" -f $ports.Count)
[pscustomobject]@{status=if(@($results|Where-Object status -eq "fail").Count){"blocked"}else{"ready"};host=$PublicHost;checkedAtUtc=(Get-Date).ToUniversalTime().ToString("o");checks=$results}|ConvertTo-Json -Depth 5
