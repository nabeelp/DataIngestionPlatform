const { test } = require('node:test');
const assert = require('node:assert/strict');
const verify = require('./verify-deployment-commit.cjs');

const successful = {
    head_sha: 'merged-sha', head_branch: 'main', event: 'push',
    run_number: 12, run_attempt: 1, status: 'completed', conclusion: 'success',
    html_url: 'https://github.com/example/repo/actions/runs/12',
};

async function check(runs, ref = 'refs/heads/main') {
    const errors = [];
    const messages = [];
    const queries = [];
    await verify({
        context: { ref, sha: 'merged-sha', repo: { owner: 'example', repo: 'repo' } },
        github: { rest: { actions: { listWorkflowRuns: async query => {
            queries.push(query);
            return { data: { workflow_runs: runs } };
        } } } },
        core: { setFailed: error => errors.push(error), info: message => messages.push(message) },
    });
    return { errors, messages, queries };
}

test('accepts only successful main push CI for the exact selected SHA', async () => {
    const result = await check([successful]);
    assert.equal(result.errors.length, 0);
    assert.equal(result.messages.length, 1);
    assert.deepEqual(result.queries[0], {
        owner: 'example', repo: 'repo', workflow_id: 'ci.yml', branch: 'main',
        event: 'push', head_sha: 'merged-sha', per_page: 100,
    });
});

test('rejects non-main dispatch before querying CI', async () => {
    const result = await check([successful], 'refs/heads/feature');
    assert.equal(result.errors.length, 1);
    assert.equal(result.queries.length, 0);
});

for (const [name, runs] of [
    ['missing CI', []],
    ['different SHA', [{ ...successful, head_sha: 'pr-sha' }]],
    ['PR run', [{ ...successful, event: 'pull_request' }]],
    ['different branch', [{ ...successful, head_branch: 'feature' }]],
    ['pending CI', [{ ...successful, status: 'in_progress', conclusion: null }]],
    ['failed CI', [{ ...successful, conclusion: 'failure' }]],
    ['cancelled CI', [{ ...successful, conclusion: 'cancelled' }]],
    ['newer failed run', [successful, { ...successful, run_number: 13, conclusion: 'failure' }]],
    ['failed rerun', [successful, { ...successful, run_attempt: 2, conclusion: 'failure' }]],
]) {
    test(`rejects ${name}`, async () => {
        assert.equal((await check(runs)).errors.length, 1);
    });
}
