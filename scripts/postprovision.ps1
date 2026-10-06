$ErrorActionPreference = 'Stop'

function Get-AzdValue {
    param([Parameter(Mandatory)][string]$Name)

    $value = & azd env get-value $Name 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($value)) {
        throw "Required azd environment value '$Name' is missing."
    }
    return $value.Trim()
}

function Invoke-AzJson {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$Operation
    )

    $output = & az @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Operation failed (Azure CLI exit code $LASTEXITCODE)."
    }
    $json = $output -join [Environment]::NewLine
    if ([string]::IsNullOrWhiteSpace($json)) {
        throw "$Operation returned no JSON."
    }
    return $json | ConvertFrom-Json
}

function Invoke-AzChecked {
    param([Parameter(Mandatory)][string[]]$Arguments)

    $output = & az @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI command failed: az $($Arguments[0]) (exit code $LASTEXITCODE)."
    }
    return ($output -join [Environment]::NewLine)
}

function Invoke-AzRestWithBody {
    param(
        [Parameter(Mandatory)][ValidateSet('PATCH', 'POST')][string]$Method,
        [Parameter(Mandatory)][string]$Uri,
        [Parameter(Mandatory)][string]$Body,
        [Parameter(Mandatory)][string]$Operation
    )

    $bodyPath = Join-Path $env:TEMP ('data-ingestion-graph-' + [guid]::NewGuid().ToString('N') + '.json')
    try {
        [System.IO.File]::WriteAllText($bodyPath, $Body, [System.Text.UTF8Encoding]::new($false))
        & az rest `
            --method $Method `
            --uri $Uri `
            --headers 'Content-Type=application/json' `
            --body "@$bodyPath" `
            --only-show-errors `
            --output none
        if ($LASTEXITCODE -ne 0) {
            throw "$Operation failed (Azure CLI exit code $LASTEXITCODE)."
        }
    }
    finally {
        if (Test-Path -LiteralPath $bodyPath) {
            Remove-Item -LiteralPath $bodyPath -Force
        }
    }
}

$frontendOrigin = Get-AzdValue 'FRONTEND_URL'
$resourceGroup = Get-AzdValue 'AZURE_RESOURCE_GROUP'
$apiContainerAppName = Get-AzdValue 'API_CONTAINER_APP_NAME'
$apiUrl = Get-AzdValue 'API_URL'
$ssoClientId = Get-AzdValue 'MS_CLIENT_ID'
$rulesApiClientId = Get-AzdValue 'RULES_SERVICE_API_CLIENT_ID'
$rulesApiRoleId = Get-AzdValue 'RULES_SERVICE_API_ROLE_ID'
$apiPrincipalId = Get-AzdValue 'API_IDENTITY_PRINCIPAL_ID'

foreach ($id in @($ssoClientId, $rulesApiClientId, $rulesApiRoleId, $apiPrincipalId)) {
    if ($id -notmatch '^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$') {
        throw 'Entra client, role and principal IDs must be valid GUIDs.'
    }
}
if ($frontendOrigin -notmatch '^https://[^/]+$') {
    throw 'FRONTEND_URL must be an HTTPS origin without a path.'
}
if ($apiUrl -notmatch '^https://[^/]+/api/v1$') {
    throw 'API_URL must be an HTTPS API base URL ending in /api/v1.'
}

$redirectUri = "$frontendOrigin/auth/callback"
Invoke-AzChecked @(
    'containerapp', 'update',
    '--name', $apiContainerAppName,
    '--resource-group', $resourceGroup,
    '--set-env-vars', "CORS_ORIGIN=$frontendOrigin", "MS_REDIRECT_URI=$redirectUri",
    '--only-show-errors', '--output', 'none'
) | Out-Null

$ssoAppObjectId = [string](Invoke-AzJson -Arguments @(
    'ad', 'app', 'show', '--id', $ssoClientId, '--only-show-errors', '--output', 'json'
) -Operation 'Reading the SSO app registration').id
$rulesApi = Invoke-AzJson -Arguments @(
    'ad', 'app', 'show', '--id', $rulesApiClientId, '--only-show-errors', '--output', 'json'
) -Operation 'Reading the Rules API app registration'
$rulesApiServicePrincipalId = [string](Invoke-AzJson -Arguments @(
    'ad', 'sp', 'show', '--id', $rulesApiClientId, '--only-show-errors', '--output', 'json'
) -Operation 'Reading the Rules API service principal').id

if ($rulesApi.appRoles.id -notcontains $rulesApiRoleId) {
    throw 'The configured application role is missing from the Rules API registration.'
}

$ssoApp = Invoke-AzJson -Arguments @(
    'rest', '--method', 'GET',
    '--uri', "https://graph.microsoft.com/v1.0/applications/$ssoAppObjectId",
    '--only-show-errors', '--output', 'json'
) -Operation 'Reading SSO redirect URIs'
$redirectUris = @()
if ($ssoApp.web -and $ssoApp.web.redirectUris) {
    $redirectUris = @($ssoApp.web.redirectUris)
}
if ($redirectUris -notcontains $redirectUri) {
    $redirectUris += $redirectUri
    $redirectBody = @{ web = @{ redirectUris = $redirectUris } } | ConvertTo-Json -Depth 6 -Compress
    Invoke-AzRestWithBody -Method PATCH `
        -Uri "https://graph.microsoft.com/v1.0/applications/$ssoAppObjectId" `
        -Body $redirectBody `
        -Operation 'Setting the frontend Container App SSO redirect URI'
}

$escapedFilter = [Uri]::EscapeDataString("resourceId eq $rulesApiServicePrincipalId")
$assignments = Invoke-AzJson -Arguments @(
    'rest', '--method', 'GET',
    '--uri', "https://graph.microsoft.com/v1.0/servicePrincipals/$apiPrincipalId/appRoleAssignments?`$filter=$escapedFilter",
    '--only-show-errors', '--output', 'json'
) -Operation 'Checking the API managed identity app-role assignment'
$existingAssignment = @($assignments.value) |
    Where-Object { $_.appRoleId -eq $rulesApiRoleId } |
    Select-Object -First 1

if (-not $existingAssignment) {
    $assignmentBody = @{
        principalId = $apiPrincipalId
        resourceId = $rulesApiServicePrincipalId
        appRoleId = $rulesApiRoleId
    } | ConvertTo-Json -Compress
    Invoke-AzRestWithBody -Method POST `
        -Uri "https://graph.microsoft.com/v1.0/servicePrincipals/$apiPrincipalId/appRoleAssignments" `
        -Body $assignmentBody `
        -Operation 'Granting the API managed identity the Rules API application role'
}

Write-Host 'SSO redirect URI and API managed-identity application permission are configured.'
