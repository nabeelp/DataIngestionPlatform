$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$backend = Join-Path $root 'Back-End'
$frontend = Join-Path $root 'Front-End'
$pythonService = Join-Path $root 'Validation-Service'
$backendEnv = Join-Path $backend '.env'
$composeFile = Join-Path $root 'docker-compose.yml'
$processes = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()

function Stop-ProcessTree {
    param(
        [Parameter(Mandatory)]
        [int]$RootProcessId
    )

    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $RootProcessId" -ErrorAction SilentlyContinue
    foreach ($child in $children) {
        Stop-ProcessTree -RootProcessId $child.ProcessId
    }

    Stop-Process -Id $RootProcessId -Force -ErrorAction SilentlyContinue
}

function Get-ConfiguredValue {
    param(
        [Parameter(Mandatory)]
        [string]$Name,

        [Parameter(Mandatory)]
        [hashtable]$Settings
    )

    $environmentValue = [Environment]::GetEnvironmentVariable($Name)
    if (-not [string]::IsNullOrWhiteSpace($environmentValue)) {
        return $environmentValue
    }

    return [string]$Settings[$Name]
}

function Get-ConfiguredPort {
    param(
        [Parameter(Mandatory)]
        [string]$Name,

        [Parameter(Mandatory)]
        [hashtable]$Settings,

        [Parameter(Mandatory)]
        [int]$Default
    )

    $value = Get-ConfiguredValue -Name $Name -Settings $Settings
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $Default
    }

    $port = 0
    if (-not [int]::TryParse($value, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
        throw "$Name must be a TCP port between 1 and 65535."
    }

    return $port
}

function Read-EnvironmentFile {
    param([Parameter(Mandatory)][string]$Path)

    $settings = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
            $name = $Matches[1]
            $value = $Matches[2].Trim()
            if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            $settings[$name] = $value
            if ([string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($name))) {
                [Environment]::SetEnvironmentVariable($name, $value, 'Process')
            }
        }
    }
    return $settings
}

function Wait-ForTcpPort {
    param(
        [Parameter(Mandatory)]
        [int]$Port,

        [int]$TimeoutSeconds = 60
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $client = [System.Net.Sockets.TcpClient]::new()
        try {
            $pending = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
            if ($pending.AsyncWaitHandle.WaitOne(500) -and $client.Connected) {
                $client.EndConnect($pending)
                return
            }
        }
        catch {
        }
        finally {
            $client.Dispose()
        }
        Start-Sleep -Milliseconds 500
    }

    throw "Local service did not open port $Port within $TimeoutSeconds seconds."
}

function Wait-ForHttpService {
    param(
        [System.Diagnostics.Process]$Process,

        [Parameter(Mandatory)]
        [string]$HealthUrl,

        [int]$TimeoutSeconds = 90,

        [string]$FailureHint = ''
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastError = $null
    while ((Get-Date) -lt $deadline) {
        if ($null -ne $Process -and $Process.HasExited) {
            throw "Process exited with code $($Process.ExitCode) before becoming healthy."
        }

        try {
            $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
                return
            }
            $lastError = "HTTP $($response.StatusCode)"
        }
        catch {
            $lastError = $_.Exception.Message
        }

        Start-Sleep -Milliseconds 500
    }

    throw "Service did not become healthy at $HealthUrl within $TimeoutSeconds seconds. Last error: $lastError. $FailureHint"
}

function Test-ContainerRunning {
    param([Parameter(Mandatory)][string]$Name)

    $running = & docker inspect --format '{{.State.Running}}' $Name 2>$null
    return $LASTEXITCODE -eq 0 -and $running -eq 'true'
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'Node.js 24 and npm are required. Install them before starting the app.'
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw 'Python 3.12 and uv are required. Install them before starting the app.'
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker Desktop is required. Install it and start the Docker engine.'
}
if (-not (Test-Path $backendEnv)) {
    throw "Create $backendEnv from Back-End\.env.example and configure local credentials."
}
if (-not (Test-Path $composeFile)) {
    throw "Docker Compose file was not found at $composeFile."
}
foreach ($project in @($backend, $frontend)) {
    if (-not (Test-Path (Join-Path $project 'node_modules'))) {
        throw "Dependencies are missing in $project. Run npm ci in that directory first."
    }
}

$settings = Read-EnvironmentFile -Path $backendEnv
$requiredSettings = @(
    'DB_CONNECTION_STRING',
    'JWT_SECRET',
    'MSSQL_SA_PASSWORD',
    'ACCEPT_EULA',
    'SERVICEBUS_CONNECTION_STRING',
    'AZURE_STORAGE_CONNECTION_STRING',
    'RULES_SERVICE_DEV_KEY'
)
foreach ($name in $requiredSettings) {
    if ([string]::IsNullOrWhiteSpace((Get-ConfiguredValue -Name $name -Settings $settings))) {
        throw "Configure $name in Back-End\.env before starting. Secret values are not displayed."
    }
}
if ((Get-ConfiguredValue -Name 'ACCEPT_EULA' -Settings $settings) -ne 'Y') {
    throw 'Review the SQL Server and Service Bus emulator license terms, then set ACCEPT_EULA=Y in Back-End\.env.'
}

$script:saPassword = Get-ConfiguredValue -Name 'MSSQL_SA_PASSWORD' -Settings $settings
$dbConnectionString = Get-ConfiguredValue -Name 'DB_CONNECTION_STRING' -Settings $settings
$databaseName = Get-ConfiguredValue -Name 'SQLCMD_DATABASE' -Settings $settings
$backendPort = Get-ConfiguredPort -Name 'PORT' -Settings $settings -Default 3000
$rulesPort = Get-ConfiguredPort -Name 'RULES_SERVICE_PORT' -Settings $settings -Default 8000
$emulatorHttpPort = Get-ConfiguredPort -Name 'SERVICEBUS_EMULATOR_HTTP_PORT' -Settings $settings -Default 5300
$backendHealthUrl = "http://localhost:$backendPort/health"
$rulesHealthUrl = "http://localhost:$rulesPort/healthz"
$frontendUrl = 'http://localhost:5173'
if ([string]::IsNullOrWhiteSpace($databaseName)) {
    $databaseName = 'FileValidationPlatform'
}
try {
    $dbSettings = [System.Data.SqlClient.SqlConnectionStringBuilder]::new($dbConnectionString)
}
catch {
    throw 'DB_CONNECTION_STRING is invalid. Configure it for the local Docker SQL Server without displaying its value.'
}
if ($dbSettings.DataSource -notmatch '^(?i:tcp:)?(localhost|127\.0\.0\.1)(,1433)?$') {
    throw 'DB_CONNECTION_STRING must target the local Docker SQL Server at localhost on port 1433.'
}
if ($dbSettings.InitialCatalog -ne $databaseName) {
    throw 'DB_CONNECTION_STRING and SQLCMD_DATABASE must name the same local database.'
}
if ($dbSettings.UserID -ne 'sa' -or $dbSettings.Password -ne $script:saPassword) {
    throw 'DB_CONNECTION_STRING must use the local SQL Server credentials configured in Back-End/.env.'
}

$ports = @(1433, 5173, $backendPort, 5672, $emulatorHttpPort, 10000, 10001, 10002) | Select-Object -Unique
$composePortContainers = @{
    1433 = 'data-ingestion-sql'
    5672 = 'servicebus-emulator'
    $emulatorHttpPort = 'servicebus-emulator'
    10000 = 'data-ingestion-azurite'
    10001 = 'data-ingestion-azurite'
    10002 = 'data-ingestion-azurite'
}
foreach ($port in $ports) {
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        if ($composePortContainers.ContainsKey($port) -and (Test-ContainerRunning -Name $composePortContainers[$port])) {
            continue
        }
        throw "Port $port is already in use by process $($listener.OwningProcess). Stop it before running start.ps1."
    }
}

Push-Location $root
try {
    & docker info --format '{{.ServerVersion}}' | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker Desktop is installed but the Docker engine is not running.'
    }

    Write-Host 'Starting SQL Server, Azurite, and the Service Bus emulator...'
    & docker compose --env-file $backendEnv -f $composeFile up --detach --wait --wait-timeout 180
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker Compose failed to start the local infrastructure. Check the Docker output above.'
    }
    foreach ($port in @(1433, 5672, $emulatorHttpPort, 10000)) {
        Wait-ForTcpPort -Port $port -TimeoutSeconds 60
    }
    Write-Host 'Waiting for Service Bus emulator readiness...'
    Wait-ForHttpService -HealthUrl "http://localhost:$emulatorHttpPort/health" -TimeoutSeconds 180 `
        -FailureHint 'Inspect docker logs --tail 100 servicebus-emulator and docker logs --tail 100 data-ingestion-servicebus-sql. See README.md for Service Bus recovery guidance.'

    Write-Host 'Applying local database scripts...'
    $applyScript = Join-Path $backend 'database\apply.ps1'
    & $applyScript -Authentication Local -Database $databaseName -Password $script:saPassword -CreateDatabase
    if ($LASTEXITCODE -ne 0) {
        throw 'Local database initialization failed. Check the Docker SQL Server logs and .env settings.'
    }

    $pythonApiEntry = Join-Path $pythonService 'src\dq_engine\api\app.py'
    $pythonWorkerEntry = Join-Path $pythonService 'src\dq_engine\messaging\servicebus.py'
    if ((Test-Path $pythonApiEntry) -and (Test-Path $pythonWorkerEntry)) {
        $uvPath = (Get-Command uv).Source
        Write-Host 'Starting Python rules service...'
        $rulesService = Start-Process $uvPath -WorkingDirectory $pythonService -ArgumentList 'run', 'dq-engine', 'api' -NoNewWindow -PassThru
        $processes.Add($rulesService)
        $worker = Start-Process $uvPath -WorkingDirectory $pythonService -ArgumentList 'run', 'dq-engine', 'worker' -NoNewWindow -PassThru
        $processes.Add($worker)
        Wait-ForHttpService -Process $rulesService -HealthUrl $rulesHealthUrl
    }
    else {
        Write-Warning 'Python API and worker entry points will start once their work package is implemented.'
    }

    Write-Host 'Starting Node API...'
    $backendProcess = Start-Process npm.cmd -WorkingDirectory $backend -ArgumentList 'run', 'dev' -NoNewWindow -PassThru
    $processes.Add($backendProcess)
    Wait-ForHttpService -Process $backendProcess -HealthUrl $backendHealthUrl

    Write-Host 'Starting frontend...'
    $frontendProcess = Start-Process npm.cmd -WorkingDirectory $frontend -ArgumentList 'run', 'dev' -NoNewWindow -PassThru
    $processes.Add($frontendProcess)
    Wait-ForHttpService -Process $frontendProcess -HealthUrl $frontendUrl

    Write-Host "Health: $backendHealthUrl"
    if ((Test-Path $pythonApiEntry) -and (Test-Path $pythonWorkerEntry)) {
        Write-Host "Rules service: $rulesHealthUrl"
    }
    Write-Host "Frontend: $frontendUrl"
    Write-Host 'Press Ctrl-C to stop the application processes. Docker services remain running.'

    while (($processes | Where-Object { -not $_.HasExited }).Count -eq $processes.Count) {
        Start-Sleep -Seconds 1
    }

    $exited = $processes | Where-Object { $_.HasExited } | Select-Object -First 1
    throw "Application process exited unexpectedly with code $($exited.ExitCode)."
}
finally {
    Write-Host "`nStopping application processes..."
    foreach ($process in $processes) {
        if ($null -ne $process -and -not $process.HasExited) {
            Stop-ProcessTree -RootProcessId $process.Id
        }
    }
    Pop-Location
}
