[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Local', 'Entra')]
    [string]$Authentication,

    [Parameter(Mandatory)]
    [ValidatePattern('^[A-Za-z][A-Za-z0-9_]{0,127}$')]
    [string]$Database,

    [string]$Server,
    [string]$Container = 'data-ingestion-sql',
    [string]$Username = 'sa',
    [string]$Password,
    [string]$SqlCmdPath = 'sqlcmd',
    [switch]$CreateDatabase
)

$ErrorActionPreference = 'Stop'
$databaseScripts = @(
    '001_users.sql',
    '002_file_definitions.sql',
    '003_lookups.sql',
    '004_uploads.sql',
    '005_file_definition_versions.sql',
    '006_audit_logs.sql'
)
$databaseDirectory = $PSScriptRoot

function Invoke-ExternalCommand {
    param(
        [Parameter(Mandatory)]
        [string]$Executable,

        [Parameter(Mandatory)]
        [string[]]$Arguments
    )

    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Database operation failed with exit code $LASTEXITCODE."
    }
}

if ($Authentication -eq 'Local') {
    if ([string]::IsNullOrWhiteSpace($Password)) {
        throw 'A local SQL password is required; configure MSSQL_SA_PASSWORD in Back-End/.env.'
    }
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw 'Docker is required to apply the local database scripts.'
    }

    $previousSqlPassword = [Environment]::GetEnvironmentVariable('SQLCMDPASSWORD', 'Process')
    [Environment]::SetEnvironmentVariable('SQLCMDPASSWORD', $Password, 'Process')
    try {
        if ($CreateDatabase) {
            $escapedDatabase = $Database.Replace(']', ']]').Replace("'", "''")
            $query = "IF DB_ID(N'$escapedDatabase') IS NULL CREATE DATABASE [$escapedDatabase]"
            Invoke-ExternalCommand -Executable 'docker' -Arguments @(
                'exec', '-e', 'SQLCMDPASSWORD', $Container,
                '/opt/mssql-tools18/bin/sqlcmd', '-S', 'localhost', '-U', $Username,
                '-C', '-b', '-d', 'master', '-Q', $query
            )
        }

        foreach ($scriptName in $databaseScripts) {
            $scriptPath = Join-Path $databaseDirectory $scriptName
            if (-not (Test-Path -LiteralPath $scriptPath)) {
                throw "Database script was not found: $scriptName."
            }

            Invoke-ExternalCommand -Executable 'docker' -Arguments @(
                'exec', '-e', 'SQLCMDPASSWORD', '-i', $Container,
                '/opt/mssql-tools18/bin/sqlcmd', '-S', 'localhost', '-U', $Username,
                '-C', '-b', '-d', $Database, '-i', "/var/opt/mssql/scripts/$scriptName"
            )
        }

        $seedScript = 'seed_local_users.sql'
        if (-not (Test-Path -LiteralPath (Join-Path $databaseDirectory $seedScript))) {
            throw "Database script was not found: $seedScript."
        }
        Invoke-ExternalCommand -Executable 'docker' -Arguments @(
            'exec', '-e', 'SQLCMDPASSWORD', '-i', $Container,
            '/opt/mssql-tools18/bin/sqlcmd', '-S', 'localhost', '-U', $Username,
            '-C', '-b', '-d', $Database, '-i', "/var/opt/mssql/scripts/$seedScript"
        )
    }
    finally {
        [Environment]::SetEnvironmentVariable('SQLCMDPASSWORD', $previousSqlPassword, 'Process')
    }
    return
}

if ([string]::IsNullOrWhiteSpace($Server)) {
    throw 'Server is required when using Entra authentication.'
}
if ($CreateDatabase) {
    throw 'Database creation is not supported in Entra mode; provision the database before applying its schema.'
}
if (-not (Get-Command $SqlCmdPath -ErrorAction SilentlyContinue)) {
    throw 'The Go sqlcmd utility is required for Entra authentication.'
}

foreach ($scriptName in $databaseScripts) {
    $scriptPath = Join-Path $databaseDirectory $scriptName
    if (-not (Test-Path -LiteralPath $scriptPath)) {
        throw "Database script was not found: $scriptName."
    }

    Invoke-ExternalCommand -Executable $SqlCmdPath -Arguments @(
        '-S', $Server, '-d', $Database, '-b',
        '--authentication-method', 'ActiveDirectoryDefault',
        '-i', $scriptPath
    )
}
