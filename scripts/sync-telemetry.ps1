[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ConfirmEnvironment,
    [switch]$Execute
)

$ErrorActionPreference = 'Stop'

function Get-AzdValue {
    param([Parameter(Mandatory)][string]$Name)
    $value = & azd env get-value $Name 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($value)) {
        throw "Required azd environment value '$Name' is missing."
    }
    return $value.Trim()
}

function Invoke-AzChecked {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $output = & az @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI operation '$($Arguments[0])' failed (exit code $LASTEXITCODE)."
    }
    return ($output -join [Environment]::NewLine)
}

if ($ConfirmEnvironment -cne (Get-AzdValue 'AZURE_ENV_NAME')) {
    throw 'Environment confirmation does not match the selected azd environment.'
}
$subscription = Get-AzdValue 'AZURE_SUBSCRIPTION_ID'
if ((Invoke-AzChecked @('account', 'show', '--query', 'id', '--output', 'tsv')).Trim() -ne $subscription) {
    throw 'Azure CLI and azd subscriptions do not match.'
}
$resourceGroup = Get-AzdValue 'AZURE_RESOURCE_GROUP'
$api = Get-AzdValue 'API_CONTAINER_APP_NAME'
$rules = Get-AzdValue 'RULES_SERVICE_CONTAINER_APP_NAME'
$worker = Get-AzdValue 'WORKER_JOB_NAME'
$frontend = Get-AzdValue 'FRONTEND_CONTAINER_APP_NAME'
$vault = Get-AzdValue 'KEY_VAULT_NAME'
$identity = Get-AzdValue 'WORKER_IDENTITY_NAME'
$identityId = (Invoke-AzChecked @('identity', 'show', '--name', $identity, '--resource-group', $resourceGroup,
    '--query', 'id', '--output', 'tsv', '--only-show-errors')).Trim()
$components = @((
    Invoke-AzChecked @('resource', 'list', '--resource-group', $resourceGroup,
        '--resource-type', 'Microsoft.Insights/components', '--query', '[].id', '--output', 'json', '--only-show-errors')
) | ConvertFrom-Json)
if ($components.Count -ne 1 -or -not $identityId) {
    throw 'Expected one existing monitoring component and the worker managed identity.'
}

Write-Host "Telemetry reconciliation target: $resourceGroup ($ConfirmEnvironment). Other runtime settings will be preserved."
if (-not $Execute) {
    Write-Host 'Inspection only. Use -Execute to configure the existing monitoring secret references and runtime environment.'
    return
}

# Browser routing configuration is public; server workloads use a Key Vault reference.
$browserConnection = (Invoke-AzChecked @('resource', 'show', '--ids', $components[0],
    '--query', 'properties.ConnectionString', '--output', 'tsv', '--only-show-errors')).Trim()
if (-not $browserConnection.StartsWith('InstrumentationKey=')) {
    throw 'Monitoring component returned no valid browser routing configuration.'
}
foreach ($target in @(@('containerapp', $rules), @('job', $worker))) {
    [string[]]$prefix = if ($target[0] -eq 'job') { @('containerapp', 'job') } else { @('containerapp') }
    Invoke-AzChecked ($prefix + @('secret', 'set', '--name', $target[1], '--resource-group', $resourceGroup,
        '--secrets', "app-insights-connection-string=keyvaultref:https://$vault.vault.azure.net/secrets/app-insights-connection-string,identityref:$identityId",
        '--output', 'none', '--only-show-errors')) | Out-Null
    $role = if ($target[0] -eq 'job') { 'data-ingestion-worker' } else { 'data-ingestion-rules' }
    Invoke-AzChecked ($prefix + @('update', '--name', $target[1], '--resource-group', $resourceGroup,
        '--set-env-vars', 'APPLICATIONINSIGHTS_CONNECTION_STRING=secretref:app-insights-connection-string',
        "OTEL_SERVICE_NAME=$role", 'APPLICATIONINSIGHTS_SAMPLING_RATIO=1',
        '--output', 'none', '--only-show-errors')) | Out-Null
}
Invoke-AzChecked @('containerapp', 'update', '--name', $api, '--resource-group', $resourceGroup,
    '--set-env-vars', 'OTEL_SERVICE_NAME=data-ingestion-api', 'APPLICATIONINSIGHTS_SAMPLING_RATIO=1',
    '--output', 'none', '--only-show-errors') | Out-Null
Invoke-AzChecked @('containerapp', 'update', '--name', $frontend, '--resource-group', $resourceGroup,
    '--set-env-vars', "APPLICATIONINSIGHTS_CONNECTION_STRING=$browserConnection",
    'APPLICATIONINSIGHTS_BROWSER_SAMPLING_PERCENTAGE=100', '--output', 'none', '--only-show-errors') | Out-Null
Write-Host 'Existing telemetry configuration reconciled. Verify startup and ingestion after deployment.'
