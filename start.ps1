$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$backend = Join-Path $root 'Back-End'
$frontend = Join-Path $root 'Front-End'
$backendEnv = Join-Path $backend '.env'

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

Start-Process powershell.exe -WorkingDirectory $backend -ArgumentList '-NoExit', '-Command', 'npm run dev' | Out-Null
Start-Process powershell.exe -WorkingDirectory $frontend -ArgumentList '-NoExit', '-Command', 'npm run dev' | Out-Null
Write-Host 'Started backend and frontend in separate terminal windows.'
Write-Host 'Health: http://localhost:3000/health'
Write-Host 'Frontend: http://localhost:5173'
