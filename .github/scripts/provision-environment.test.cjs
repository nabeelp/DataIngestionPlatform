const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepare, verify } = require('./provision-environment.cjs');

const guid = '12345678-1234-1234-1234-123456789abc';
const env = {
    AZURE_ENV_NAME: 'sbfracent',
    SQL_ADMIN_OBJECT_ID: guid,
    SQL_ADMIN_LOGIN: 'existing-admin',
    RULES_SERVICE_API_CLIENT_ID: guid,
    RULES_SERVICE_API_AUDIENCE: `api://${guid}`,
    RULES_SERVICE_API_ROLE_ID: guid,
    MS_CLIENT_ID: guid,
    CITADEL_SUBSCRIPTION_KEY: 'synthetic-test-key',
};

function prepareRunner() {
    const calls = [];
    return {
        calls,
        run: (command, args) => {
            calls.push([command, args]);
            if (args[1] === 'get-value') return 'ca-dataingest-api-sbfracent';
            return '';
        },
    };
}

test('prepares non-secret provisioning settings without persisting the subscription key', () => {
    const runner = prepareRunner();
    prepare(env, runner.run);
    const settings = Object.fromEntries(runner.calls.filter(([, args]) => args[1] === 'set')
        .map(([, args]) => [args[2], args[3]]));
    assert.equal(settings.SQL_ADMIN_LOGIN, env.SQL_ADMIN_LOGIN);
    assert.equal(settings.RULES_SERVICE_API_ROLE_ID, guid);
    assert.equal(settings.CITADEL_MODEL, 'gpt-6-luna');
    assert.equal(settings.CITADEL_ENDPOINT, 'https://np-aigw-apim.azure-api.net/models');
    assert.equal(settings.CITADEL_SUBSCRIPTION_KEY_HEADER, 'api-key');
    assert.equal(settings.CITADEL_SUBSCRIPTION_KEY, undefined);
    assert.ok(!JSON.stringify(runner.calls).includes(env.CITADEL_SUBSCRIPTION_KEY));
});

test('preserves explicit workload, model, worker and telemetry overrides', () => {
    const calls = [];
    prepare({
        ...env, WORKLOAD_NAME: 'custom', CITADEL_MODEL: 'custom-model',
        CITADEL_SUBSCRIPTION_KEY_HEADER: 'Ocp-Apim-Subscription-Key',
        WORKER_CPU: '4', WORKER_MEMORY: '8Gi', APPLICATIONINSIGHTS_SAMPLING_RATIO: '0.5',
    }, (command, args) => {
        calls.push(args);
        return args[1] === 'get-value' ? 'ca-custom-api-sbfracent' : '';
    });
    assert.ok(calls.some(args => args[2] === 'CITADEL_MODEL' && args[3] === 'custom-model'));
    assert.ok(calls.some(args => args[2] === 'CITADEL_SUBSCRIPTION_KEY_HEADER' && args[3] === 'Ocp-Apim-Subscription-Key'));
    assert.ok(calls.some(args => args[2] === 'WORKER_CPU' && args[3] === '4'));
    assert.ok(calls.some(args => args[2] === 'APPLICATIONINSIGHTS_SAMPLING_RATIO' && args[3] === '0.5'));
});

for (const name of Object.keys(env)) {
    test(`rejects missing ${name} before invoking CLI commands`, () => {
        const runner = prepareRunner();
        assert.throws(() => prepare({ ...env, [name]: '' }, runner.run), new RegExp(name));
        assert.equal(runner.calls.length, 0);
    });
}

for (const [name, setting] of [
    ['SQL_ADMIN_OBJECT_ID', '00000000-0000-0000-0000-000000000000'],
    ['MS_CLIENT_ID', 'invalid'],
    ['RULES_SERVICE_API_ROLE_ID', 'invalid'],
    ['RULES_SERVICE_API_AUDIENCE', 'invalid'],
    ['WORKLOAD_NAME', 'invalid/name'],
    ['CITADEL_ENDPOINT', 'http://insecure.example/models'],
    ['CITADEL_SUBSCRIPTION_KEY_HEADER', 'invalid header'],
    ['CITADEL_SUBSCRIPTION_KEY_HEADER', 'api-key\r\nInjected'],
]) {
    test(`rejects invalid ${name} before invoking CLI commands`, () => {
        const runner = prepareRunner();
        assert.throws(() => prepare({ ...env, [name]: setting }, runner.run), new RegExp(name));
        assert.equal(runner.calls.length, 0);
    });
}

test('rejects resource naming drift before persisting settings', () => {
    const runner = prepareRunner();
    assert.throws(() => prepare({ ...env, WORKLOAD_NAME: 'other' }, runner.run), /different resources/);
    assert.equal(runner.calls.length, 1);
});

function verificationFixture() {
    const identity = '/subscriptions/test/resourceGroups/rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/api';
    const vault = {
        id: '/subscriptions/test/resourceGroups/rg/providers/Microsoft.KeyVault/vaults/vault',
        uri: 'https://vault.vault.azure.net/',
    };
    const app = {
        identities: { [identity]: { principalId: guid } },
        secrets: [{
            name: 'citadel-subscription-key',
            keyVaultUrl: `${vault.uri}secrets/citadel-subscription-key`,
            identity,
        }],
        env: [
            { name: 'CITADEL_SUBSCRIPTION_KEY', secretRef: 'citadel-subscription-key' },
            { name: 'CITADEL_ENDPOINT', value: 'https://np-aigw-apim.azure-api.net/models' },
            { name: 'CITADEL_MODEL', value: 'gpt-6-luna' },
            { name: 'CITADEL_SUBSCRIPTION_KEY_HEADER', value: 'api-key' },
        ],
    };
    const fixture = { app, vault, enabled: 'true', assignments: '1', calls: [] };
    fixture.run = (command, args) => {
        fixture.calls.push([command, args]);
        if (command === 'azd') {
            if (args[2] === 'API_IDENTITY_PRINCIPAL_ID') return guid;
            if (args[2] === 'CITADEL_ENDPOINT') return app.env[1].value;
            if (args[2] === 'CITADEL_MODEL') return 'gpt-6-luna';
            if (args[2] === 'CITADEL_SUBSCRIPTION_KEY_HEADER') return 'api-key';
            return args[2];
        }
        if (args[0] === 'keyvault') return JSON.stringify(vault);
        if (args[0] === 'resource') return fixture.enabled;
        if (args[0] === 'containerapp') return JSON.stringify(app);
        if (args[0] === 'acr') return '/subscriptions/test/resourceGroups/rg/providers/Microsoft.ContainerRegistry/registries/registry';
        if (args[0] === 'role') return fixture.assignments;
        throw new Error(`Unexpected command: ${command}`);
    };
    return fixture;
}

test('verifies metadata, API references and all four ACR pull assignments without reading secret values', () => {
    const fixture = verificationFixture();
    verify(fixture.run);
    assert.equal(fixture.calls.filter(([, args]) => args[0] === 'role').length, 4);
    const metadataArgs = fixture.calls.find(([, args]) => args[0] === 'resource')[1];
    assert.equal(metadataArgs[metadataArgs.indexOf('--query') + 1], 'properties.attributes.enabled');
    assert.ok(!fixture.calls.some(([, args]) => args[0] === 'keyvault' && args[1] === 'secret'));
});

for (const [name, mutate, expected] of [
    ['disabled secret', fixture => { fixture.enabled = 'false'; }, /missing or disabled/],
    ['missing metadata', fixture => { fixture.enabled = ''; }, /missing or disabled/],
    ['missing API secret', fixture => { fixture.app.secrets = []; }, /expected Key Vault/],
    ['wrong vault', fixture => { fixture.app.secrets[0].keyVaultUrl = 'https://other.vault.azure.net/secrets/key'; }, /expected Key Vault/],
    ['unassigned identity', fixture => { fixture.app.identities = {}; }, /managed identity/],
    ['wrong API identity', fixture => { Object.values(fixture.app.identities)[0].principalId = 'other-principal'; }, /managed identity/],
    ['wrong secret reference', fixture => { fixture.app.env[0].secretRef = 'old-key'; }, /secret reference/],
    ['literal key', fixture => { fixture.app.env[0].value = 'synthetic-literal'; }, /literal value/],
    ['model drift', fixture => { fixture.app.env[2].value = 'old-model'; }, /CITADEL_MODEL/],
    ['header drift', fixture => { fixture.app.env[3].value = 'wrong-header'; }, /CITADEL_SUBSCRIPTION_KEY_HEADER/],
    ['missing header', fixture => { fixture.app.env.splice(3, 1); }, /CITADEL_SUBSCRIPTION_KEY_HEADER/],
    ['missing endpoint', fixture => { fixture.app.env.splice(1, 1); }, /CITADEL_ENDPOINT/],
    ['missing AcrPull', fixture => { fixture.assignments = '0'; }, /AcrPull/],
    ['invalid role count', fixture => { fixture.assignments = 'invalid'; }, /AcrPull/],
]) {
    test(`verification rejects ${name}`, () => {
        const fixture = verificationFixture();
        mutate(fixture);
        assert.throws(() => verify(fixture.run), expected);
    });
}

test('CLI failures propagate rather than reporting successful verification', () => {
    assert.throws(() => verify(() => { throw new Error('CLI failure'); }), /CLI failure/);
});

test('workflow keeps provisioning opt-in, secret-bound and ordered before application deployment', () => {
    const workflow = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'azure-deploy.yml'), 'utf8');
    const prepareIndex = workflow.indexOf('- name: Validate provisioning inputs');
    const provisionIndex = workflow.indexOf('- name: Provision infrastructure and configure identities');
    const verifyIndex = workflow.indexOf('- name: Verify provisioned Citadel references');
    const deployIndex = workflow.indexOf('- name: Deploy all application services');
    const finalIndex = workflow.indexOf('- name: Verify Citadel configuration after application deployment');
    assert.ok([prepareIndex, provisionIndex, verifyIndex, deployIndex, finalIndex].every(index => index >= 0));
    assert.ok(prepareIndex < provisionIndex && provisionIndex < verifyIndex && verifyIndex < deployIndex && deployIndex < finalIndex);
    const provisionStep = workflow.slice(provisionIndex, verifyIndex);
    assert.match(provisionStep, /if: inputs\.deployment_target == 'provision'/);
    assert.match(provisionStep, /CITADEL_SUBSCRIPTION_KEY: \$\{\{ secrets\.CITADEL_SUBSCRIPTION_KEY \}\}/);
    assert.match(provisionStep, /azd provision --environment "\$AZURE_ENV_NAME" --no-prompt/);
    assert.match(workflow.slice(deployIndex, finalIndex), /inputs\.deployment_target == 'all' \|\| inputs\.deployment_target == 'provision'/);
    assert.match(workflow, /default: all/);
});
