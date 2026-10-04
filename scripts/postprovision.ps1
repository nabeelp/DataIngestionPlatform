$ErrorActionPreference = 'Stop'

function Get-AzdValue {
    param([Parameter(Mandatory)][string]$Name)

    $value = & azd env get-value $Name 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($value)) {
        throw "Required azd environment output '$Name' is missing."
    }
    return $value.Trim()
}

$serverName = Get-AzdValue 'SQL_SERVER_NAME'
$databaseName = Get-AzdValue 'SQL_DATABASE_NAME'
$apiIdentityName = Get-AzdValue 'API_IDENTITY_NAME'
$apiPrincipalId = Get-AzdValue 'API_IDENTITY_PRINCIPAL_ID'
$workerIdentityName = Get-AzdValue 'WORKER_IDENTITY_NAME'
$workerPrincipalId = Get-AzdValue 'WORKER_IDENTITY_PRINCIPAL_ID'
$serverFqdn = "$serverName.database.windows.net"

& (Join-Path $PSScriptRoot '..\Back-End\database\apply.ps1') `
    -Authentication Entra `
    -Server $serverFqdn `
    -Database $databaseName
if ($LASTEXITCODE -ne 0) {
    throw 'Applying the Azure SQL schema failed.'
}

& (Join-Path $PSScriptRoot '..\Back-End\database\grant-managed-identities.ps1') `
    -Server $serverFqdn `
    -Database $databaseName `
    -ApiIdentityName $apiIdentityName `
    -ApiIdentityPrincipalId $apiPrincipalId `
    -WorkerIdentityName $workerIdentityName `
    -WorkerIdentityPrincipalId $workerPrincipalId
if ($LASTEXITCODE -ne 0) {
    throw 'Granting SQL database access to the managed identities failed.'
}

Write-Host 'Azure SQL schema and managed-identity access are ready.'
