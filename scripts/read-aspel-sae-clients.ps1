param(
  [Parameter(Mandatory = $true)][string]$DatabasePath,
  [string]$Username = "SYSDBA",
  [string]$IsqlPath = ""
)
$ErrorActionPreference = "Stop"

function Find-Isql {
  $candidates = New-Object System.Collections.Generic.List[string]
  if ($IsqlPath) { $candidates.Add($IsqlPath) }
  if ($env:SAS_ASPEL_ISQL_PATH) { $candidates.Add($env:SAS_ASPEL_ISQL_PATH) }
  try {
    $command = Get-Command isql.exe -ErrorAction Stop
    $candidates.Add($command.Source)
  } catch {}
  foreach ($registryPath in @(
    "HKLM:\SOFTWARE\Firebird Project\Firebird Server\Instances",
    "HKLM:\SOFTWARE\WOW6432Node\Firebird Project\Firebird Server\Instances"
  )) {
    try {
      $item = Get-ItemProperty -Path $registryPath -ErrorAction Stop
      foreach ($property in $item.PSObject.Properties) {
        if ($property.Name -notlike "PS*" -and $property.Value) {
          $candidates.Add((Join-Path ([string]$property.Value) "isql.exe"))
        }
      }
    } catch {}
  }
  foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if (-not $root) { continue }
    Get-ChildItem -Path (Join-Path $root "Firebird") -Filter isql.exe -File -Recurse -ErrorAction SilentlyContinue |
      ForEach-Object { $candidates.Add($_.FullName) }
  }
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }
  throw "No se encontró isql.exe. Instala las herramientas de Firebird o configura SAS_ASPEL_ISQL_PATH."
}

function Invoke-Isql([string]$Sql) {
  $sqlPath = Join-Path $temporaryRoot ("query-" + [guid]::NewGuid().ToString("N") + ".sql")
  $outputPath = "$sqlPath.out"
  [IO.File]::WriteAllText($sqlPath, $Sql, (New-Object Text.UTF8Encoding($false)))
  $previousUser = $env:ISC_USER
  $previousPassword = $env:ISC_PASSWORD
  try {
    $env:ISC_USER = $Username
    $env:ISC_PASSWORD = $password
    & $resolvedIsql -ch UTF8 -input $sqlPath -output $outputPath $resolvedDatabase 2>&1 | Out-Null
    $exitCode = $LASTEXITCODE
    $output = if (Test-Path $outputPath) { Get-Content -LiteralPath $outputPath -Raw -Encoding UTF8 } else { "" }
    if ($exitCode -ne 0 -or $output -match "(?im)Statement failed|SQL error code|Unable to complete network request") {
      throw ($output.Trim() -replace [regex]::Escape($password), "***")
    }
    return $output
  } finally {
    $env:ISC_USER = $previousUser
    $env:ISC_PASSWORD = $previousPassword
    Remove-Item -LiteralPath $sqlPath,$outputPath -Force -ErrorAction SilentlyContinue
  }
}

function First-Field([string[]]$Fields, [string[]]$Candidates) {
  foreach ($candidate in $Candidates) {
    if ($Fields -contains $candidate) { return $candidate }
  }
  return ""
}

function Sql-Field([string]$Field, [string]$Alias, [int]$Width = 500) {
  if ($Field) { return "CAST($Field AS VARCHAR($Width)) AS $Alias" }
  return "CAST('' AS VARCHAR($Width)) AS $Alias"
}

function Parse-Records([string]$Output, [string]$TableName) {
  $aliasMap = @{
    SAS_KEY = "externalKey"; SAS_NAME = "legalName"; SAS_RFC = "rfc"; SAS_PHONE = "phone";
    SAS_EMAIL = "email"; SAS_STREET = "street"; SAS_EXT = "exterior"; SAS_INT = "interior";
    SAS_NEIGHBORHOOD = "neighborhood"; SAS_ZIP = "postalCode"; SAS_CITY = "city";
    SAS_STATE = "state"; SAS_COUNTRY = "country"; SAS_STATUS = "status"
  }
  $items = New-Object System.Collections.Generic.List[object]
  $current = [ordered]@{}
  foreach ($line in ($Output -split "\r?\n")) {
    if ($line -match "^\s*(SAS_[A-Z_]+)\s+(.*)$") {
      $alias = $matches[1]
      if ($alias -eq "SAS_KEY" -and $current.Contains("legalName")) {
        $items.Add((Complete-Record $current $TableName))
        $current = [ordered]@{}
      }
      if ($aliasMap.ContainsKey($alias)) { $current[$aliasMap[$alias]] = $matches[2].Trim() }
    }
  }
  if ($current.Contains("legalName")) { $items.Add((Complete-Record $current $TableName)) }
  return $items
}

function Complete-Record([System.Collections.IDictionary]$Record, [string]$TableName) {
  $address = @($Record.street, $Record.exterior, $Record.interior, $Record.neighborhood, $Record.postalCode, $Record.city, $Record.state, $Record.country) |
    Where-Object { $_ } | Select-Object -Unique
  return [ordered]@{
    externalKey = [string]$Record.externalKey
    legalName = [string]$Record.legalName
    rfc = [string]$Record.rfc
    phone = [string]$Record.phone
    email = [string]$Record.email
    address = ($address -join ", ")
    status = [string]$Record.status
    sourceTable = $TableName
  }
}

$password = [string]$env:SAS_ASPEL_PASSWORD
if (-not $password) { throw "No se recibió la contraseña de lectura de Firebird." }
$resolvedDatabase = (Resolve-Path -LiteralPath $DatabasePath -ErrorAction Stop).Path
if ([IO.Path]::GetExtension($resolvedDatabase) -notmatch "^\.(fdb|gdb)$") { throw "La base debe ser un archivo .FDB o .GDB." }
$resolvedIsql = Find-Isql
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("sas-aspel-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null

try {
  $tableOutput = Invoke-Isql @"
SET BAIL ON;
SET LIST ON;
SET HEADING OFF;
SELECT TRIM(RDB`$RELATION_NAME) AS SAS_TABLE
FROM RDB`$RELATIONS
WHERE COALESCE(RDB`$SYSTEM_FLAG, 0) = 0 AND RDB`$RELATION_NAME STARTING WITH 'CLIE'
ORDER BY RDB`$RELATION_NAME;
QUIT;
"@
  $tableNames = @([regex]::Matches($tableOutput, "(?im)^\s*SAS_TABLE\s+([A-Z0-9_`$]+)\s*$") | ForEach-Object { $_.Groups[1].Value.Trim() } | Where-Object { $_ -match "^CLIE\d+$" })
  if ($tableNames.Count -eq 0) { throw "No se encontraron tablas de clientes CLIE## en la base seleccionada." }

  $allClients = New-Object System.Collections.Generic.List[object]
  foreach ($tableName in $tableNames) {
    $fieldOutput = Invoke-Isql @"
SET BAIL ON;
SET LIST ON;
SET HEADING OFF;
SELECT TRIM(RDB`$FIELD_NAME) AS SAS_FIELD
FROM RDB`$RELATION_FIELDS
WHERE RDB`$RELATION_NAME = '$tableName'
ORDER BY RDB`$FIELD_POSITION;
QUIT;
"@
    $fields = @([regex]::Matches($fieldOutput, "(?im)^\s*SAS_FIELD\s+([A-Z0-9_`$]+)\s*$") | ForEach-Object { $_.Groups[1].Value.Trim() })
    $nameField = First-Field $fields @("NOMBRE","RAZON_SOCIAL","RAZON_SOC","NOM_COMERCIAL")
    if (-not $nameField) { continue }
    $selectFields = @(
      (Sql-Field (First-Field $fields @("CLAVE","CVE_CLIE","ID_CLIENTE")) "SAS_KEY" 100),
      (Sql-Field $nameField "SAS_NAME" 500),
      (Sql-Field (First-Field $fields @("RFC","RFC_CLIENTE")) "SAS_RFC" 50),
      (Sql-Field (First-Field $fields @("TELEFONO","TELEFONO1","TEL_1","TEL1")) "SAS_PHONE" 100),
      (Sql-Field (First-Field $fields @("EMAIL","CORREO","MAIL")) "SAS_EMAIL" 300),
      (Sql-Field (First-Field $fields @("CALLE","DIRECCION")) "SAS_STREET" 500),
      (Sql-Field (First-Field $fields @("NUMEXT","NUM_EXT")) "SAS_EXT" 50),
      (Sql-Field (First-Field $fields @("NUMINT","NUM_INT")) "SAS_INT" 50),
      (Sql-Field (First-Field $fields @("COLONIA")) "SAS_NEIGHBORHOOD" 300),
      (Sql-Field (First-Field $fields @("CODIGO","COD_POSTAL","CP")) "SAS_ZIP" 30),
      (Sql-Field (First-Field $fields @("MUNICIPIO","POBLACION","LOCALIDAD")) "SAS_CITY" 300),
      (Sql-Field (First-Field $fields @("ESTADO")) "SAS_STATE" 200),
      (Sql-Field (First-Field $fields @("PAIS")) "SAS_COUNTRY" 200),
      (Sql-Field (First-Field $fields @("STATUS","ESTATUS")) "SAS_STATUS" 50)
    )
    $recordsOutput = Invoke-Isql @"
SET BAIL ON;
SET LIST ON;
SET HEADING OFF;
SELECT $($selectFields -join ",`r`n       ")
FROM $tableName
WHERE $nameField IS NOT NULL
ORDER BY $nameField;
QUIT;
"@
    foreach ($record in (Parse-Records $recordsOutput $tableName)) {
      if ($record.legalName) { $allClients.Add($record) }
    }
  }
  [ordered]@{
    status = "ok"
    engine = "Firebird"
    databasePath = $resolvedDatabase
    isqlPath = $resolvedIsql
    tableNames = $tableNames
    clients = $allClients
  } | ConvertTo-Json -Depth 5 -Compress
} finally {
  Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
}
