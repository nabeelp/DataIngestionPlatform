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
        throw "Azure CLI command failed: az $($Arguments[0]) (exit code $LASTEXITCODE)."
    }
    return ($output -join [Environment]::NewLine)
}

$resourceGroup = Get-AzdValue 'AZURE_RESOURCE_GROUP'
$registryLoginServer = Get-AzdValue 'ACR_LOGIN_SERVER'
$imageTag = Get-AzdValue 'IMAGE_TAG'
$apiContainerAppName = Get-AzdValue 'API_CONTAINER_APP_NAME'
$rulesServiceContainerAppName = Get-AzdValue 'RULES_SERVICE_CONTAINER_APP_NAME'
$sqlServerName = Get-AzdValue 'SQL_SERVER_NAME'
$sqlBootstrapJobName = Get-AzdValue 'SQL_BOOTSTRAP_JOB_NAME'
$sqlBootstrapIdentityName = Get-AzdValue 'SQL_BOOTSTRAP_IDENTITY_NAME'
$sqlBootstrapIdentityPrincipalId = Get-AzdValue 'SQL_BOOTSTRAP_IDENTITY_PRINCIPAL_ID'
$sqlAdminObjectId = Get-AzdValue 'SQL_ADMIN_OBJECT_ID'
$sqlAdminLogin = Get-AzdValue 'SQL_ADMIN_LOGIN'
$workerJobName = Get-AzdValue 'WORKER_JOB_NAME'

if ($imageTag -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$') {
    throw 'IMAGE_TAG must use only letters, numbers, underscores, periods, and hyphens.'
}
foreach ($id in @($sqlBootstrapIdentityPrincipalId, $sqlAdminObjectId)) {
    if ($id -notmatch '^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$') {
        throw 'SQL administrator object IDs must be valid Microsoft Entra object IDs.'
    }
}

$bootstrapImage = (Invoke-AzChecked @(
    'containerapp', 'show',
    '--name', $apiContainerAppName,
    '--resource-group', $resourceGroup,
    '--query', 'properties.template.containers[0].image',
    '--only-show-errors', '--output', 'tsv'
)).Trim()
$workerImage = (Invoke-AzChecked @(
    'containerapp', 'show',
    '--name', $rulesServiceContainerAppName,
    '--resource-group', $resourceGroup,
    '--query', 'properties.template.containers[0].image',
    '--only-show-errors', '--output', 'tsv'
)).Trim()
foreach ($image in @($bootstrapImage, $workerImage)) {
    if ([string]::IsNullOrWhiteSpace($image) -or
        -not $image.StartsWith("$registryLoginServer/", [StringComparison]::OrdinalIgnoreCase) -or
        -not $image.EndsWith(":$imageTag", [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The deployed API and Rules Service images must use the configured ACR and IMAGE_TAG.'
    }
}
$bootstrapAdminSet = $false

try {
    $bootstrapAdminSet = $true
    Invoke-AzChecked @(
        'sql', 'server', 'ad-admin', 'update',
        '--server', $sqlServerName,
        '--resource-group', $resourceGroup,
        '--object-id', $sqlBootstrapIdentityPrincipalId,
        '--display-name', $sqlBootstrapIdentityName,
        '--only-show-errors', '--output', 'none'
    ) | Out-Null

    $previousExecutionsJson = Invoke-AzChecked @(
        'containerapp', 'job', 'execution', 'list',
        '--name', $sqlBootstrapJobName,
        '--resource-group', $resourceGroup,
        '--only-show-errors', '--output', 'json'
    )
    $previousExecutions = @()
    if (-not [string]::IsNullOrWhiteSpace($previousExecutionsJson)) {
        $previousExecutions = @($previousExecutionsJson | ConvertFrom-Json)
    }
    $previousExecutionNames = @($previousExecutions | ForEach-Object { $_.name })

    Invoke-AzChecked @(
        'containerapp', 'job', 'update',
        '--name', $sqlBootstrapJobName,
        '--resource-group', $resourceGroup,
        '--image', $bootstrapImage,
        '--only-show-errors', '--output', 'none'
    ) | Out-Null

    Invoke-AzChecked @(
        'containerapp', 'job', 'start',
        '--name', $sqlBootstrapJobName,
        '--resource-group', $resourceGroup,
        '--only-show-errors', '--output', 'none'
    ) | Out-Null

    $deadline = (Get-Date).AddMinutes(35)
    $execution = $null
    while ((Get-Date) -lt $deadline) {
        $executionsJson = Invoke-AzChecked @(
            'containerapp', 'job', 'execution', 'list',
            '--name', $sqlBootstrapJobName,
            '--resource-group', $resourceGroup,
            '--only-show-errors', '--output', 'json'
        )
        $executions = @()
        if (-not [string]::IsNullOrWhiteSpace($executionsJson)) {
            $executions = @($executionsJson | ConvertFrom-Json)
        }
        $execution = $executions |
            Where-Object { $previousExecutionNames -notcontains $_.name } |
            Sort-Object { [DateTime]$_.properties.startTime } -Descending |
            Select-Object -First 1

        if ($execution) {
            $status = [string]$execution.properties.status
            if ($status -eq 'Succeeded') {
                Write-Host "SQL bootstrap execution '$($execution.name)' succeeded."
                break
            }
            if ($status -in @('Failed', 'Stopped', 'Canceled', 'Cancelled')) {
                throw "SQL bootstrap execution '$($execution.name)' ended with status '$status'. Inspect Container Apps job logs before retrying."
            }
            Write-Host "SQL bootstrap execution status: $status"
        }
        else {
            Write-Host 'Waiting for the SQL bootstrap execution to appear.'
        }
        Start-Sleep -Seconds 15
    }

    if (-not $execution -or $execution.properties.status -ne 'Succeeded') {
        throw 'SQL bootstrap did not succeed within 35 minutes.'
    }
}
finally {
    if ($bootstrapAdminSet) {
        Invoke-AzChecked @(
            'sql', 'server', 'ad-admin', 'update',
            '--server', $sqlServerName,
            '--resource-group', $resourceGroup,
            '--object-id', $sqlAdminObjectId,
            '--display-name', $sqlAdminLogin,
            '--only-show-errors', '--output', 'none'
        ) | Out-Null
        Write-Host 'Restored the configured Microsoft Entra SQL administrator.'
    }
}

Invoke-AzChecked @(
    'containerapp', 'job', 'update',
    '--name', $workerJobName,
    '--resource-group', $resourceGroup,
    '--image', $workerImage,
    '--only-show-errors', '--output', 'none'
) | Out-Null

Write-Host "Updated the validation worker image to '$workerImage'."
