$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$backend = Join-Path $root 'Back-End'
$frontend = Join-Path $root 'Front-End'
$backendEnv = Join-Path $backend '.env'
$backendHealthUrl = 'http://localhost:3000/health'
$backendProcess = $null
$frontendProcess = $null

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

function Wait-ForBackend {
    param(
        [Parameter(Mandatory)]
        [System.Diagnostics.Process]$Process,

        [Parameter(Mandatory)]
        [string]$HealthUrl,

        [int]$TimeoutSeconds = 60
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastError = $null
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) {
            throw "Backend exited with code $($Process.ExitCode) before becoming healthy."
        }

        try {
            $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
                return
            }
        }
        catch {
            $lastError = $_.Exception.Message
        }

        Start-Sleep -Milliseconds 500
    }

    throw "Backend did not become healthy at $HealthUrl within $TimeoutSeconds seconds. Last error: $lastError"
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'Node.js and npm are required. Install them before starting the app.'
}

foreach ($project in @($backend, $frontend)) {
    if (-not (Test-Path (Join-Path $project 'node_modules'))) {
        throw "Dependencies are missing in $project. Run npm ci in that directory first."
    }
}

if (-not (Test-Path $backendEnv)) {
    throw "Create $backendEnv from Back-End\.env.example and configure local SQL Server."
}

$settings = Get-Content $backendEnv
foreach ($name in @('DB_CONNECTION_STRING', 'JWT_SECRET')) {
    $configured = [bool]([Environment]::GetEnvironmentVariable($name)) -or
        [bool]($settings | Where-Object { $_ -match "^\s*$name\s*=\s*\S" })
    if (-not $configured) {
        throw "Configure $name in Back-End\.env (or your environment) before starting."
    }
}

if (-not (Test-Path (Join-Path $frontend '.env.development'))) {
    Write-Warning 'Front-End\.env.development not found; the frontend will use the Vite /api proxy and the mock login is disabled.'
}

foreach ($port in @(3000, 5173)) {
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        throw "Port $port is already in use by process $($listener.OwningProcess). Stop it before running start.ps1."
    }
}

try {
    Write-Host 'Starting backend...'
    $backendProcess = Start-Process npm.cmd -WorkingDirectory $backend -ArgumentList 'run', 'dev' -NoNewWindow -PassThru
    Wait-ForBackend -Process $backendProcess -HealthUrl $backendHealthUrl

    Write-Host 'Backend is healthy. Starting frontend...'
    $frontendProcess = Start-Process npm.cmd -WorkingDirectory $frontend -ArgumentList 'run', 'dev' -NoNewWindow -PassThru

    Write-Host "Health: $backendHealthUrl"
    Write-Host 'Frontend: http://localhost:5173'
    Write-Host 'Press Ctrl-C to stop both.'

    while (-not $backendProcess.HasExited -and -not $frontendProcess.HasExited) {
        Start-Sleep -Seconds 1
    }

    if ($backendProcess.HasExited) {
        throw "Backend exited unexpectedly with code $($backendProcess.ExitCode)."
    }

    throw "Frontend exited unexpectedly with code $($frontendProcess.ExitCode)."
}
finally {
    Write-Host "`nStopping backend and frontend..."
    foreach ($process in @($frontendProcess, $backendProcess)) {
        if ($null -ne $process -and -not $process.HasExited) {
            Stop-ProcessTree -RootProcessId $process.Id
        }
    }
}
