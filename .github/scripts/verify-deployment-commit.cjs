module.exports = async ({ github, context, core }) => {
    if (context.ref !== 'refs/heads/main') {
        core.setFailed('Deployments must be dispatched from main after the PR is merged.');
        return;
    }
    const { data } = await github.rest.actions.listWorkflowRuns({
        ...context.repo,
        workflow_id: 'ci.yml',
        branch: 'main',
        event: 'push',
        head_sha: context.sha,
        per_page: 100,
    });
    const run = data.workflow_runs
        .filter(run => run.head_sha === context.sha && run.head_branch === 'main' && run.event === 'push')
        .sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt)[0];
    if (!run || run.status !== 'completed' || run.conclusion !== 'success') {
        core.setFailed(`The latest main push CI run for ${context.sha} must complete successfully before deployment.`);
        return;
    }
    core.info(`Approved source ${context.sha}; successful CI: ${run.html_url}`);
};
