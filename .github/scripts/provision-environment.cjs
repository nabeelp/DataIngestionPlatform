const { execFileSync } = require('node:child_process');

function run(command, args) {
    try {
        return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (error) {
        if (error.status == null && !error.code) throw error;
        throw new Error(`${command} ${args[0]} ${args[1]} failed (${error.code || `exit code ${error.status}`}); command output withheld to protect secrets.`);
    }
}

function value(runCommand, name) {
    const result = runCommand('azd', ['env', 'get-value', name]);
    if (!result.trim()) throw new Error(`Required azd environment value '${name}' is missing.`);
    return result.trim();
}

function prepare(env, runCommand = run) {
    const required = [
        'SQL_ADMIN_OBJECT_ID', 'SQL_ADMIN_LOGIN', 'RULES_SERVICE_API_CLIENT_ID',
        'RULES_SERVICE_API_AUDIENCE', 'RULES_SERVICE_API_ROLE_ID', 'MS_CLIENT_ID',
    ];
    for (const name of [...required, 'AZURE_ENV_NAME', 'CITADEL_SUBSCRIPTION_KEY']) {
        if (!env[name]?.trim()) throw new Error(`Required provisioning setting '${name}' is empty.`);
    }
    for (const name of ['SQL_ADMIN_OBJECT_ID', 'RULES_SERVICE_API_CLIENT_ID', 'RULES_SERVICE_API_ROLE_ID', 'MS_CLIENT_ID']) {
        if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(env[name]) ||
            env[name] === '00000000-0000-0000-0000-000000000000') {
            throw new Error(`Provisioning setting '${name}' must be a non-zero GUID.`);
        }
    }
    if (!/^(api|https):\/\/\S+$/.test(env.RULES_SERVICE_API_AUDIENCE)) {
        throw new Error('RULES_SERVICE_API_AUDIENCE must be an api:// or HTTPS audience.');
    }
    const settings = {
        ...Object.fromEntries(required.map(name => [name, env[name]])),
        WORKLOAD_NAME: env.WORKLOAD_NAME || 'dataingest',
        CITADEL_ENDPOINT: env.CITADEL_ENDPOINT || 'https://np-aigw-apim.azure-api.net/models',
        CITADEL_MODEL: env.CITADEL_MODEL || 'gpt-6-luna',
        WORKER_CPU: env.WORKER_CPU || '2',
        WORKER_MEMORY: env.WORKER_MEMORY || '4Gi',
        APPLICATIONINSIGHTS_SAMPLING_RATIO: env.APPLICATIONINSIGHTS_SAMPLING_RATIO || '1',
        APPLICATIONINSIGHTS_BROWSER_SAMPLING_PERCENTAGE: env.APPLICATIONINSIGHTS_BROWSER_SAMPLING_PERCENTAGE || '100',
    };
    if (!/^[a-zA-Z0-9-]{3,12}$/.test(settings.WORKLOAD_NAME)) {
        throw new Error('WORKLOAD_NAME must contain 3 to 12 letters, numbers or hyphens.');
    }
    if (!/^https:\/\/[^/\s]+(?:\/[^\s]*)?$/.test(settings.CITADEL_ENDPOINT)) {
        throw new Error('CITADEL_ENDPOINT must be an HTTPS URL.');
    }
    const existingApi = value(runCommand, 'API_CONTAINER_APP_NAME');
    if (existingApi !== `ca-${settings.WORKLOAD_NAME}-api-${env.AZURE_ENV_NAME}`) {
        throw new Error('WORKLOAD_NAME and AZURE_ENV_NAME do not match the existing API; refusing to provision different resources.');
    }
    for (const [name, setting] of Object.entries(settings)) {
        runCommand('azd', ['env', 'set', name, setting]);
    }
}

function verify(runCommand = run) {
    const resourceGroup = value(runCommand, 'AZURE_RESOURCE_GROUP');
    const apiName = value(runCommand, 'API_CONTAINER_APP_NAME');
    const vaultName = value(runCommand, 'KEY_VAULT_NAME');
    const vault = JSON.parse(runCommand('az', [
        'keyvault', 'show', '--name', vaultName, '--resource-group', resourceGroup,
        '--query', '{id:id,uri:properties.vaultUri}', '--output', 'json',
    ]));
    const enabled = runCommand('az', [
        'resource', 'show', '--ids', `${vault.id}/secrets/citadel-subscription-key`,
        '--api-version', '2024-11-01', '--query', 'properties.attributes.enabled', '--output', 'tsv',
    ]);
    if (enabled.toLowerCase() !== 'true') throw new Error('The Citadel Key Vault secret is missing or disabled.');

    const app = JSON.parse(runCommand('az', [
        'containerapp', 'show', '--name', apiName, '--resource-group', resourceGroup,
        '--query', '{identities:identity.userAssignedIdentities,secrets:properties.configuration.secrets,env:properties.template.containers[0].env}',
        '--output', 'json',
    ]));
    const secret = app.secrets?.find(item => item.name === 'citadel-subscription-key');
    if (secret?.keyVaultUrl !== `${vault.uri}secrets/citadel-subscription-key` ||
        !secret.identity || app.identities?.[secret.identity]?.principalId !== value(runCommand, 'API_IDENTITY_PRINCIPAL_ID')) {
        throw new Error('The API Citadel secret must reference the expected Key Vault using an assigned managed identity.');
    }
    const subscriptionKey = app.env?.find(item => item.name === 'CITADEL_SUBSCRIPTION_KEY');
    if (subscriptionKey?.secretRef !== 'citadel-subscription-key' || subscriptionKey.value != null) {
        throw new Error('CITADEL_SUBSCRIPTION_KEY must use the Citadel secret reference, not a literal value.');
    }
    for (const name of ['CITADEL_ENDPOINT', 'CITADEL_MODEL']) {
        if (app.env?.find(item => item.name === name)?.value !== value(runCommand, name)) {
            throw new Error(`The API '${name}' does not match the provisioning configuration.`);
        }
    }
    const registryId = runCommand('az', [
        'acr', 'show', '--name', value(runCommand, 'AZURE_CONTAINER_REGISTRY_NAME'),
        '--resource-group', resourceGroup, '--query', 'id', '--output', 'tsv',
    ]);
    for (const name of [
        'API_IDENTITY_PRINCIPAL_ID', 'WORKER_IDENTITY_PRINCIPAL_ID',
        'SQL_BOOTSTRAP_IDENTITY_PRINCIPAL_ID', 'FRONTEND_IDENTITY_PRINCIPAL_ID',
    ]) {
        const count = Number(runCommand('az', [
            'role', 'assignment', 'list', '--scope', registryId,
            '--assignee-object-id', value(runCommand, name),
            '--query', "[?roleDefinitionName=='AcrPull'] | length(@)", '--output', 'tsv',
        ]));
        if (!Number.isInteger(count) || count < 1) throw new Error(`'${name}' has no AcrPull assignment.`);
    }
}

module.exports = { prepare, verify };

if (require.main === module) {
    try {
        if (process.argv[2] === 'prepare') prepare(process.env);
        else if (process.argv[2] === 'verify') verify();
        else throw new Error('Expected prepare or verify.');
        console.log(`Provisioning ${process.argv[2]} checks succeeded; no secret values were printed.`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
