$ErrorActionPreference = 'Stop'

function Get-AzdValue {
    param([Parameter(Mandatory)][string]$Name)

    $value = & azd env get-value $Name 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($value)) {
        throw "Required azd environment value '$Name' is missing."
    }
    return $value.Trim()
}

$apiUrl = Get-AzdValue 'API_URL'
$frontendUrl = Get-AzdValue 'FRONTEND_URL'

if ($apiUrl -notmatch '^https://[^/]+/api/v1$') {
    throw 'API_URL must be an HTTPS API base URL ending in /api/v1.'
}
if ($frontendUrl -notmatch '^https://[^/]+$') {
    throw 'FRONTEND_URL must be an HTTPS origin without a path.'
}

Write-Host 'Validated the frontend runtime API URL and HTTPS origin.'
