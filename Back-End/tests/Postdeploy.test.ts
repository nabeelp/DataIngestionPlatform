import { execFileSync } from 'node:child_process';
import path from 'node:path';

interface Result {
    failed: boolean;
    commands: string[];
    template?: { containers: { name: string; image: string; args: string[]; env: { name: string; value: string }[]; resources: { cpu: number } }[] };
    templateExists: boolean;
}

function run(parameters: string, failStart = false, backlog = false, scriptName = 'postdeploy.ps1'): Result {
    const script = path.resolve(__dirname, '../../scripts', scriptName).replace(/'/g, "''");
    const harness = `
$ErrorActionPreference = 'Stop'
$global:commands = [System.Collections.Generic.List[string]]::new()
$global:started = $false
$global:retryLimit = 2
$global:template = $null
$global:templatePath = $null
function Start-Sleep {}
function azd {
    $global:LASTEXITCODE = 0
    $values = @{
        AZURE_RESOURCE_GROUP='rg-test'; ACR_LOGIN_SERVER='test.azurecr.io'; IMAGE_TAG='release';
        API_CONTAINER_APP_NAME='api'; RULES_SERVICE_CONTAINER_APP_NAME='rules'; SQL_SERVER_NAME='sql';
        SQL_BOOTSTRAP_JOB_NAME='bootstrap'; SQL_BOOTSTRAP_IDENTITY_NAME='bootstrap-id'; WORKER_JOB_NAME='worker';
        SQL_BOOTSTRAP_IDENTITY_PRINCIPAL_ID='11111111-1111-1111-1111-111111111111';
        AZURE_ENV_NAME='test'; AZURE_SUBSCRIPTION_ID='subscription'; SQL_DATABASE_NAME='DataIngestion';
        AZURE_STORAGE_ACCOUNT_NAME='sttest'; AZURE_STORAGE_ACCOUNT_URL='https://sttest.blob.core.windows.net/';
        KEY_VAULT_NAME='vault'; WORKER_IDENTITY_NAME='worker-identity'; FRONTEND_CONTAINER_APP_NAME='frontend';
    }
    $values[$args[-1]]
}
function az {
    $global:LASTEXITCODE = 0
    $command = $args -join '|'
    $global:commands.Add($command)
    if ($command.StartsWith('account|show')) { return 'subscription' }
    if ($command.StartsWith('sql|server|ad-admin|list')) {
        return '[{"sid":"33333333-3333-3333-3333-333333333333","login":"actual-admin"}]'
    }
    if ($command.StartsWith('containerapp|show')) {
        if ($command.Contains('SERVICEBUS_NAMESPACE')) { return 'bus.servicebus.windows.net' }
        return 'test.azurecr.io/workload:release'
    }
    if ($command.StartsWith('servicebus|')) {
        return '{"activeMessageCount":${backlog ? 1 : 0},"deadLetterMessageCount":0,"scheduledMessageCount":0,"transferMessageCount":0,"transferDeadLetterMessageCount":0}'
    }
    if ($command.StartsWith('storage|account|show')) { return '/subscriptions/subscription/resourceGroups/rg-test/providers/Microsoft.Storage/storageAccounts/sttest' }
    if ($command.StartsWith('identity|show')) { return '/subscriptions/subscription/resourceGroups/rg-test/providers/Microsoft.ManagedIdentity/userAssignedIdentities/worker' }
    if ($command.StartsWith('resource|list')) { return '["/subscriptions/subscription/resourceGroups/rg-test/providers/Microsoft.Insights/components/monitor"]' }
    if ($command.StartsWith('resource|show')) { return 'InstrumentationKey=public-test-routing-key' }
    if ($command.StartsWith('role|assignment|list')) { return '[]' }
    if ($command.StartsWith('resource|update')) {
        $global:retryLimit = [int]([regex]::Match($command, 'replicaRetryLimit=(\\d+)').Groups[1].Value)
        return
    }
    if ($command.StartsWith('containerapp|job|show')) {
        if ($command.Contains('properties.template')) {
            return '{"containers":[{"name":"sql-bootstrap","image":"old-image","env":[{"name":"DB_DATABASE","value":"DataIngestion"},{"name":"DB_SERVER","value":"sql.database.windows.net"}],"resources":{"cpu":0.5,"memory":"1Gi"}}]}'
        }
        return "$global:retryLimit"
    }
    if ($command.StartsWith('containerapp|job|start')) {
        $index = [Array]::IndexOf($args, '--yaml')
        if ($index -ge 0) {
            $global:templatePath = $args[$index + 1]
            $global:template = Get-Content -Raw $global:templatePath | ConvertFrom-Json
        }
        ${failStart ? '$global:LASTEXITCODE = 1; return' : '$global:started = $true; return \'{"name":"execution"}\''}
    }
    if ($command.StartsWith('containerapp|job|execution|list')) {
        if ($global:started) { return '[{"name":"execution","properties":{"status":"Succeeded"}}]' }
        return '[]'
    }
}
$failed = $false
try { & '${script}' ${parameters} | Out-Null } catch { $failed = $true }
@{ failed=$failed; commands=@($global:commands); template=$global:template; templateExists=($global:templatePath -and (Test-Path $global:templatePath)) } | ConvertTo-Json -Depth 10 -Compress
`;
    const output = execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', harness], { encoding: 'utf8' });
    const lines = output.trim().split(/\r?\n/);
    return JSON.parse(lines[lines.length - 1]) as Result;
}

describe('postdeploy reset orchestration (mock Azure CLI)', () => {
    jest.setTimeout(60_000);
    const prepare = '-Prepare -ConfirmEnvironment test -ExpectedUsers 2 -BootstrapImage test.azurecr.io/api:release';

    it('keeps normal postdeploy non-destructive without local SQL admin settings and updates the worker', () => {
        const result = run('');
        expect(result.failed).toBe(false);
        expect(result.commands.some(command => command.includes('reset-application-data'))).toBe(false);
        expect(result.commands.some(command => command.startsWith('role|assignment|create'))).toBe(false);
        expect(result.commands.some(command => command.startsWith('containerapp|job|update|--name|worker'))).toBe(true);
    });

    describe('targeted telemetry reconciliation (mock Azure CLI)', () => {
        it('does not mutate Azure without explicit execution', () => {
            const result = run('-ConfirmEnvironment test', false, false, 'sync-telemetry.ps1');
            expect(result.failed).toBe(false);
            expect(result.commands.some(command => command.includes('|update|') || command.includes('|secret|set|'))).toBe(false);
        });

        it('updates only telemetry on the four existing workloads', () => {
            const result = run('-ConfirmEnvironment test -Execute', false, false, 'sync-telemetry.ps1');
            expect(result.failed).toBe(false);
            expect(result.commands.filter(command => command.includes('|update|'))).toHaveLength(4);
            expect(result.commands.filter(command => command.includes('|secret|set|'))).toHaveLength(2);
            expect(result.commands.some(command => command.includes('AZURE_FOUNDRY_MODEL=') || command.includes('CORS_ORIGIN='))).toBe(false);
            expect(result.commands.some(command => command.startsWith('role|'))).toBe(false);
        });
    });

    it('defaults preparation to inspection and restores temporary privileges and retries', () => {
        const result = run(prepare);
        expect(result.failed).toBe(false);
        expect(result.template?.containers[0].args).toEqual([
            'dist/scripts/bootstrapSql.js', 'inspect-reset', 'DataIngestion', '2', 'https://sttest.blob.core.windows.net/',
        ]);
        expect(result.commands.filter(command => command.startsWith('role|assignment|create'))).toHaveLength(5);
        expect(result.commands.filter(command => command.startsWith('role|assignment|delete'))).toHaveLength(5);
        expect(result.commands.some(command => command.includes('replicaRetryLimit=0'))).toBe(true);
        expect(result.commands.some(command => command.includes('replicaRetryLimit=2'))).toBe(true);
        expect(result.commands.some(command => command.includes('--display-name|actual-admin'))).toBe(true);
        expect(result.commands.some(command => command.startsWith('containerapp|job|update|--name|worker'))).toBe(false);
    });

    it('requires explicit execution and uses only an execution image/argument override', () => {
        const result = run(`${prepare} -ExecuteReset`);
        expect(result.failed).toBe(false);
        expect(result.template?.containers[0].args[1]).toBe('reset-application-data');
        expect(result.template?.containers[0]).toMatchObject({
            name: 'sql-bootstrap', image: 'test.azurecr.io/api:release',
            env: [{ name: 'DB_DATABASE', value: 'DataIngestion' }, { name: 'DB_SERVER', value: 'sql.database.windows.net' }],
            resources: { cpu: 0.5 },
        });
        expect(result.templateExists).toBe(false);
        expect(result.commands.filter(command => command.startsWith('containerapp|job|update')).every(command => !command.includes('--args'))).toBe(true);
    });

    it('restores the actual administrator and temporary roles when job start fails', () => {
        const result = run(`${prepare} -ExecuteReset`, true);
        expect(result.failed).toBe(true);
        expect(result.commands.filter(command => command.startsWith('role|assignment|delete'))).toHaveLength(5);
        expect(result.commands.some(command => command.includes('--object-id|33333333-3333-3333-3333-333333333333'))).toBe(true);
        expect(result.commands.some(command => command.includes('replicaRetryLimit=2'))).toBe(true);
        expect(result.templateExists).toBe(false);
    });

    it.each([['-ExecuteReset', false], [prepare.replace('ConfirmEnvironment test', 'ConfirmEnvironment other'), false], [prepare, true]])(
        'refuses incomplete confirmation or non-empty messaging: %s',
        (parameters, backlog) => {
            const result = run(parameters, false, backlog);
            expect(result.failed).toBe(true);
            expect(result.commands.some(command => command.startsWith('role|assignment|create'))).toBe(false);
            expect(result.commands.some(command => command.startsWith('sql|server|ad-admin|update'))).toBe(false);
        },
    );
});
