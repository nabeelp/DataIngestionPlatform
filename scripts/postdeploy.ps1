[CmdletBinding()]
param(
    [switch]$Prepare,
    [switch]$ExecuteReset,
    [string]$ConfirmEnvironment,
    [string]$BootstrapImage,
    [int]$ExpectedUsers = 0
)

$ErrorActionPreference = 'Stop'

if (-not $Prepare -and ($ExecuteReset -or $ConfirmEnvironment -or $BootstrapImage -or $ExpectedUsers)) {
    throw 'Reset arguments are allowed only with -Prepare; normal postdeploy never resets data.'
}

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
$workerJobName = Get-AzdValue 'WORKER_JOB_NAME'
$environmentName = Get-AzdValue 'AZURE_ENV_NAME'
$subscriptionId = Get-AzdValue 'AZURE_SUBSCRIPTION_ID'
$activeSubscription = (Invoke-AzChecked @('account', 'show', '--query', 'id', '--output', 'tsv')).Trim()
if ($activeSubscription -ne $subscriptionId) {
    throw 'Azure CLI and azd subscriptions do not match.'
}

if ($imageTag -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$') {
    throw 'IMAGE_TAG must use only letters, numbers, underscores, periods, and hyphens.'
}
foreach ($id in @($sqlBootstrapIdentityPrincipalId)) {
    if ($id -notmatch '^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$') {
        throw 'SQL administrator object IDs must be valid Microsoft Entra object IDs.'
    }
}

if ($Prepare -and ($ConfirmEnvironment -cne $environmentName -or $ExpectedUsers -lt 1 -or -not $BootstrapImage)) {
    throw 'Preparation requires -ConfirmEnvironment matching the selected environment, -ExpectedUsers and a staged -BootstrapImage. Omit -ExecuteReset for inspection only.'
}
if ($Prepare) {
    Write-Host "Preparation target: subscription $subscriptionId, resource group $resourceGroup, environment $environmentName."
}

if (-not $Prepare) {
    $BootstrapImage = (Invoke-AzChecked @(
    'containerapp', 'show',
    '--name', $apiContainerAppName,
    '--resource-group', $resourceGroup,
    '--query', 'properties.template.containers[0].image',
    '--only-show-errors', '--output', 'tsv'
    )).Trim()
}
$workerImage = (Invoke-AzChecked @(
    'containerapp', 'show',
    '--name', $rulesServiceContainerAppName,
    '--resource-group', $resourceGroup,
    '--query', 'properties.template.containers[0].image',
    '--only-show-errors', '--output', 'tsv'
)).Trim()
foreach ($image in @($BootstrapImage, $(if (-not $Prepare) { $workerImage }))) {
    if ($null -eq $image) { continue }
    if ([string]::IsNullOrWhiteSpace($image) -or
        -not $image.StartsWith("$registryLoginServer/", [StringComparison]::OrdinalIgnoreCase) -or
        -not $image.EndsWith(":$imageTag", [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The deployed API and Rules Service images must use the configured ACR and IMAGE_TAG.'
    }
}
$bootstrapAdminSet = $false
$createdRoleIds = [System.Collections.Generic.List[string]]::new()
$originalRetryLimit = $null
$startedExecutionName = $null
$executionTemplatePath = $null
$execution = $null
$originalAdmin = @((
    Invoke-AzChecked @('sql', 'server', 'ad-admin', 'list', '--server', $sqlServerName,
        '--resource-group', $resourceGroup, '--output', 'json', '--only-show-errors')
) | ConvertFrom-Json)
if ($originalAdmin.Count -ne 1 -or
    $originalAdmin[0].sid -notmatch '^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$' -or
    [string]::IsNullOrWhiteSpace($originalAdmin[0].login)) {
    throw 'Cannot capture the existing SQL administrator; refusing bootstrap.'
}

function Assert-IdleMessaging {
    $namespace = (Invoke-AzChecked @('containerapp', 'show', '--name', $apiContainerAppName,
        '--resource-group', $resourceGroup,
        '--query', "properties.template.containers[0].env[?name=='SERVICEBUS_NAMESPACE'].value | [0]",
        '--output', 'tsv', '--only-show-errors')).Trim()
    if ($namespace -notmatch '^[a-zA-Z0-9-]+\.servicebus\.windows\.net$') {
        throw 'Cannot resolve the configured Service Bus namespace.'
    }
    $namespace = $namespace.Split('.')[0]
    $entities = @(
        @('queue', 'show', '--name', 'validation-requests'),
        @('queue', 'show', '--name', 'delivery-requests'),
        @('topic', 'show', '--name', 'validation-events'),
        @('topic', 'subscription', 'show', '--topic-name', 'validation-events', '--name', 'api')
    )
    foreach ($entity in $entities) {
        $details = Invoke-AzChecked (@('servicebus') + $entity + @('--namespace-name', $namespace,
            '--resource-group', $resourceGroup, '--query', 'countDetails', '--output', 'json', '--only-show-errors'))
        $counts = $details | ConvertFrom-Json
        if (-not $counts -or @($counts.PSObject.Properties).Count -lt 5 -or
            @($counts.PSObject.Properties | Where-Object { $_.Value -ne 0 }).Count -ne 0) {
            throw 'Messaging is not empty. Stop processing and explicitly review message cleanup before resetting.'
        }
    }
    foreach ($job in @($workerJobName, $sqlBootstrapJobName)) {
        $executions = Invoke-AzChecked @('containerapp', 'job', 'execution', 'list', '--name', $job,
            '--resource-group', $resourceGroup, '--output', 'json', '--only-show-errors') | ConvertFrom-Json
        if (@($executions | Where-Object { $_.properties.status -in @('Running', 'Processing', 'Pending') }).Count -ne 0) {
            throw "Job '$job' has an active execution; refusing reset."
        }
    }
}

function Set-BootstrapRetryLimit {
    param([int]$Limit)
    Invoke-AzChecked @('resource', 'update', '--name', $sqlBootstrapJobName,
        '--resource-group', $resourceGroup, '--resource-type', 'Microsoft.App/jobs',
        '--api-version', '2025-01-01', '--set', "properties.configuration.replicaRetryLimit=$Limit",
        '--output', 'none', '--only-show-errors') | Out-Null
    $actual = (Invoke-AzChecked @('containerapp', 'job', 'show', '--name', $sqlBootstrapJobName,
        '--resource-group', $resourceGroup, '--query', 'properties.configuration.replicaRetryLimit',
        '--output', 'tsv', '--only-show-errors')).Trim()
    if ($actual -cne "$Limit") { throw 'Bootstrap retry limit update was not applied.' }
}

try {
    if ($Prepare) {
        Assert-IdleMessaging
        $storageAccountName = Get-AzdValue 'AZURE_STORAGE_ACCOUNT_NAME'
        $storageUrl = Get-AzdValue 'AZURE_STORAGE_ACCOUNT_URL'
        if ($storageUrl.TrimEnd('/') -cne "https://$storageAccountName.blob.core.windows.net") {
            throw 'Storage account name and endpoint do not match.'
        }
        $storageId = (Invoke-AzChecked @('storage', 'account', 'show', '--name', $storageAccountName,
            '--resource-group', $resourceGroup, '--query', 'id', '--output', 'tsv', '--only-show-errors')).Trim()
        $roleId = if ($ExecuteReset) { 'ba92f5b4-2d11-453d-a403-e96b0029c9fe' } else { '2a2b9908-6ea1-4ae2-8e65-a410df84e7d1' }
        foreach ($container in @('uploads', 'reports', 'templates', 'staging', 'deliveries')) {
            $scope = "$storageId/blobServices/default/containers/$container"
            $existing = Invoke-AzChecked @('role', 'assignment', 'list', '--scope', $scope,
                '--assignee-object-id', $sqlBootstrapIdentityPrincipalId, '--output', 'json', '--only-show-errors') | ConvertFrom-Json
            if (@($existing | Where-Object { $_.roleDefinitionId.EndsWith("/$roleId") -and $_.scope -ieq $scope }).Count -eq 0) {
                $roleName = [guid]::NewGuid().ToString()
                $createdRoleIds.Add("$scope/providers/Microsoft.Authorization/roleAssignments/$roleName")
                Invoke-AzChecked @('role', 'assignment', 'create', '--name', $roleName,
                    '--assignee-object-id', $sqlBootstrapIdentityPrincipalId, '--assignee-principal-type', 'ServicePrincipal',
                    '--role', $roleId, '--scope', $scope, '--output', 'none', '--only-show-errors') | Out-Null
            }
        }
        $originalRetryLimit = [int](Invoke-AzChecked @('containerapp', 'job', 'show', '--name', $sqlBootstrapJobName,
            '--resource-group', $resourceGroup, '--query', 'properties.configuration.replicaRetryLimit',
            '--output', 'tsv', '--only-show-errors'))
        Set-BootstrapRetryLimit 0
        Write-Host 'Allowing temporary data-plane permissions to propagate.'
        Start-Sleep -Seconds 60
    }
    $bootstrapAdminSet = $true
    Invoke-AzChecked @(
        'sql', 'server', 'ad-admin', 'update',
        '--server', $sqlServerName,
        '--resource-group', $resourceGroup,
        '--object-id', $sqlBootstrapIdentityPrincipalId,
        '--display-name', $sqlBootstrapIdentityName,
        '--only-show-errors', '--output', 'none'
    ) | Out-Null

    if (-not $Prepare) {
        Invoke-AzChecked @(
            'containerapp', 'job', 'update',
            '--name', $sqlBootstrapJobName,
            '--resource-group', $resourceGroup,
            '--image', $BootstrapImage,
            '--only-show-errors', '--output', 'none'
        ) | Out-Null
    }

    $startArguments = @(
        'containerapp', 'job', 'start',
        '--name', $sqlBootstrapJobName,
        '--resource-group', $resourceGroup,
        '--only-show-errors', '--output', 'json'
    )
    if ($Prepare) {
        $mode = if ($ExecuteReset) { 'reset-application-data' } else { 'inspect-reset' }
        $databaseName = Get-AzdValue 'SQL_DATABASE_NAME'
        $template = Invoke-AzChecked @('containerapp', 'job', 'show', '--name', $sqlBootstrapJobName,
            '--resource-group', $resourceGroup, '--query', 'properties.template',
            '--output', 'json', '--only-show-errors') | ConvertFrom-Json
        if (@($template.containers).Count -ne 1 -or
            @($template.containers[0].env | Where-Object { $_.name -eq 'DB_DATABASE' -and $_.value -ceq $databaseName }).Count -ne 1) {
            throw 'Expected one bootstrap container with the confirmed database environment.'
        }
        $template.containers[0].image = $BootstrapImage
        $template.containers[0] | Add-Member -NotePropertyName args -NotePropertyValue @(
            'dist/scripts/bootstrapSql.js', $mode, $databaseName, "$ExpectedUsers", $storageUrl
        ) -Force
        # CLI image/argument flags replace the container instead of merging its environment.
        $executionTemplatePath = [IO.Path]::GetTempFileName()
        [IO.File]::WriteAllText($executionTemplatePath, ($template | ConvertTo-Json -Depth 30))
        $startArguments += @('--yaml', $executionTemplatePath)
    }
    $started = Invoke-AzChecked $startArguments | ConvertFrom-Json
    $startedExecutionName = $started.name
    if ([string]::IsNullOrWhiteSpace($startedExecutionName)) {
        throw 'Job start returned no execution name; inspect job executions before retrying.'
    }

    $deadline = (Get-Date).AddMinutes(35)
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
            Where-Object { $_.name -eq $startedExecutionName } |
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
    if ($Prepare) { Assert-IdleMessaging }
}
finally {
    $cleanupErrors = [System.Collections.Generic.List[string]]::new()
    if ($startedExecutionName -and (-not $execution -or $execution.properties.status -in @('Running', 'Processing', 'Pending'))) {
        try {
            Invoke-AzChecked @('containerapp', 'job', 'stop', '--name', $sqlBootstrapJobName,
                '--resource-group', $resourceGroup, '--job-execution-name', $startedExecutionName,
                '--output', 'none', '--only-show-errors') | Out-Null
        } catch { $cleanupErrors.Add("Stopping unfinished bootstrap execution failed: $_") }
    }
    if ($bootstrapAdminSet) {
        try {
        Invoke-AzChecked @(
            'sql', 'server', 'ad-admin', 'update',
            '--server', $sqlServerName,
            '--resource-group', $resourceGroup,
            '--object-id', $originalAdmin[0].sid,
            '--display-name', $originalAdmin[0].login,
            '--only-show-errors', '--output', 'none'
        ) | Out-Null
        Write-Host 'Restored the configured Microsoft Entra SQL administrator.'
        } catch { $cleanupErrors.Add("SQL administrator restoration failed: $_") }
    }
    if ($null -ne $originalRetryLimit) {
        try {
            Set-BootstrapRetryLimit $originalRetryLimit
        } catch { $cleanupErrors.Add("Job retry restoration failed: $_") }
    }
    if ($executionTemplatePath) {
        try { [IO.File]::Delete($executionTemplatePath) }
        catch { $cleanupErrors.Add("Temporary execution template removal failed: $_") }
    }
    foreach ($id in $createdRoleIds) {
        try {
            Invoke-AzChecked @('role', 'assignment', 'delete', '--ids', $id,
                '--output', 'none', '--only-show-errors') | Out-Null
        } catch { $cleanupErrors.Add("Temporary role removal failed for ${id}: $_") }
    }
    if ($cleanupErrors.Count -ne 0) { throw ($cleanupErrors -join [Environment]::NewLine) }
}

if ($Prepare) {
    Write-Host 'Preparation execution succeeded. Review sanitized job inventory logs before deployment.'
    return
}

Invoke-AzChecked @(
    'containerapp', 'job', 'update',
    '--name', $workerJobName,
    '--resource-group', $resourceGroup,
    '--image', $workerImage,
    '--only-show-errors', '--output', 'none'
) | Out-Null

Write-Host "Updated the validation worker image to '$workerImage'."
