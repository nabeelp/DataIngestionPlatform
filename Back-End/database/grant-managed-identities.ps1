[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$Server,

    [Parameter(Mandatory)]
    [ValidatePattern('^[A-Za-z][A-Za-z0-9_]{0,127}$')]
    [string]$Database,

    [Parameter(Mandatory)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$')]
    [string]$ApiIdentityName,

    [Parameter(Mandatory)]
    [guid]$ApiIdentityPrincipalId,

    [Parameter(Mandatory)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$')]
    [string]$WorkerIdentityName,

    [Parameter(Mandatory)]
    [guid]$WorkerIdentityPrincipalId,

    [string]$SqlCmdPath = 'sqlcmd'
)

$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'grant-managed-identities.sql'
if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw 'The managed identity grant script was not found.'
}
if (-not (Get-Command $SqlCmdPath -ErrorAction SilentlyContinue)) {
    throw 'The Go sqlcmd utility is required for Entra authentication.'
}

& $SqlCmdPath `
    -S $Server `
    -d $Database `
    -b `
    --authentication-method ActiveDirectoryDefault `
    -v `
    "ApiIdentityName=$ApiIdentityName" `
    "ApiIdentityPrincipalId=$($ApiIdentityPrincipalId.ToString())" `
    "WorkerIdentityName=$WorkerIdentityName" `
    "WorkerIdentityPrincipalId=$($WorkerIdentityPrincipalId.ToString())" `
    -i $scriptPath
if ($LASTEXITCODE -ne 0) {
    throw "Managed identity database grants failed with exit code $LASTEXITCODE."
}
