/**
 * Opt-in live evaluation of natural-language rule generation.
 *
 * Calls the configured Citadel model (billable) for each golden prompt, runs the normal proposal pipeline
 * (which validates the rule and tests its examples in the Python rules service), and writes a JSON report.
 * Score the data behavior of the generated rules with: Validation-Service/scripts/score_nl_eval.py <report>
 *
 * Prerequisites: CITADEL_* settings and the rules service running (RULES_SERVICE_* settings).
 *
 * Usage: npm run eval:nl-rules -- --yes [--category cross-sheet] [--only id1,id2] [--repeat 2] [--out report.json]
 */
/* eslint-disable no-console -- This is an interactive command-line evaluator; stdout is its user interface. */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { appConfig } from '../src/config/appConfig';
import { proposeNaturalLanguageRule, type RuleDiagnosticEvent } from '../src/services/naturalLanguageRule';
import { goldenContract, loadGoldenCorpus } from '../tests/helpers/goldenCorpus';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
};

export function liveEvaluationConfirmed(
    commandArgs: string[],
    environment: NodeJS.ProcessEnv = process.env,
): boolean {
    return commandArgs.includes('--yes') || environment.npm_config_yes === 'true';
}

/** The rules service must know the cross-sheet contract, or every cross-sheet proposal is rejected for the wrong reason. */
export function rulesServiceSupportsCrossSheet(health: unknown): boolean {
    const features = (health as { features?: unknown } | null)?.features;
    return Array.isArray(features) && features.includes('nl-cross-sheet-v1');
}

async function assertRulesServiceIsCurrent(): Promise<void> {
    const url = new URL('/healthz', appConfig.rulesService.url);
    let health: unknown = null;
    try {
        health = await (await fetch(url)).json();
    } catch {
        throw new Error(`The rules service at ${appConfig.rulesService.url} is not reachable. Start it before the evaluation.`);
    }
    if (!rulesServiceSupportsCrossSheet(health)) {
        throw new Error(`The rules service at ${appConfig.rulesService.url} predates the cross-sheet changes (it does not report `
            + 'the nl-cross-sheet-v1 feature). Restart it from the current Validation-Service code, then re-run. '
            + 'Pass --skip-service-check to evaluate anyway.');
    }
}

interface CategorySummary {
    total: number;
    /** Cases lost to an outage (rules service down, connection dropped); not evidence about model quality. */
    infrastructureErrors: number;
    decisionMatch: number;
    typeMatch: number;
    runnable: number;
    recoveredAfterCorrection: number;
    corrected: number;
    errors: number;
    modelCalls: number;
    inputTokens: number;
    outputTokens: number;
}

const MAX_CONSECUTIVE_INFRASTRUCTURE_ERRORS = 3;

/** Failures caused by the environment rather than by what the model proposed. */
export function isInfrastructureFailure(message: string): boolean {
    return /rules service could not complete|could not connect|call to the model failed|did not respond within|(?:Citadel|Foundry) returned an error \(5\d\d\)|rate-limiting|stopped before returning a complete proposal/i
        .test(message);
}

export async function main(): Promise<void> {
    const corpus = loadGoldenCorpus();
    const only = flag('only')?.split(',').map(value => value.trim());
    const category = flag('category');
    const repeat = Math.max(1, Number(flag('repeat') ?? 1));
    const cases = corpus.cases.filter(item => (!only || only.includes(item.id)) && (!category || item.category === category));
    // Per review: up to two rule proposals plus one examples-only rewrite.
    const maxCalls = cases.length * repeat * 3;

    console.log(`Selected ${cases.length} case(s) x ${repeat} run(s); up to ${maxCalls} model calls to `
        + `${appConfig.azure.citadel.model} through Citadel.`);
    if (!liveEvaluationConfirmed(args)) {
        console.log('Nothing was called. Re-run with `npm run eval:nl-rules --yes` '
            + 'or `npm run eval:nl-rules -- --yes` to confirm the model calls and their cost.');
        return;
    }
    if (!args.includes('--skip-service-check')) await assertRulesServiceIsCurrent();

    const results: Array<Record<string, unknown>> = [];
    let consecutiveInfrastructureErrors = 0;
    let abortedReason: string | null = null;
    evaluation:
    for (const item of cases) {
        for (let run = 1; run <= repeat; run++) {
            const diagnostics: RuleDiagnosticEvent[] = [];
            const started = Date.now();
            const record: Record<string, unknown> = {
                id: item.id, run, category: item.category, definition: item.definition, request: item.request,
                expectedDecision: item.expected.decision, expectedType: item.expected.type ?? null,
                expectedMode: item.expected.mode ?? null,
            };
            try {
                const result = await proposeNaturalLanguageRule(
                    goldenContract(corpus, item.definition),
                    item.request,
                    { onDiagnostic: event => diagnostics.push(event) },
                );
                if (result.outcome === 'rejected') {
                    record.outcome = 'rejected';
                    record.reason = result.reason;
                    record.decisionMatch = item.expected.decision === 'rejected';
                } else {
                    const params = result.config.params as unknown as { mode?: string };
                    record.outcome = result.outcome;
                    record.type = result.config.type;
                    record.mode = params.mode ?? null;
                    record.decisionMatch = item.expected.decision === result.outcome;
                    record.typeMatch = item.expected.type === result.config.type;
                    record.modeMatch = item.expected.mode ? item.expected.mode === params.mode : null;
                    record.config = result.config;
                }
            } catch (error) {
                record.outcome = 'error';
                record.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
                record.decisionMatch = false;
                record.infrastructureError = isInfrastructureFailure(String(record.error));
            }
            const calls = diagnostics.filter(event => event.kind === 'model-call');
            const sum = (key: 'inputTokens' | 'outputTokens') =>
                calls.reduce((total, event) => total + (event[key] ?? 0), 0);
            Object.assign(record, {
                attempts: calls.filter(event => event.purpose === 'rule').length,
                modelCalls: calls.length,
                inputTokens: sum('inputTokens'),
                outputTokens: sum('outputTokens'),
                elapsedMs: Date.now() - started,
                // Each model call's proposal and each validator problem, for diagnosing failures (contains model output).
                diagnostics,
            });
            results.push(record);
            console.log(`${record.decisionMatch ? 'ok  ' : 'MISS'} ${item.id} -> ${String(record.outcome)} `
                + `(${calls.length} model call(s), ${record.elapsedMs} ms)`);
            consecutiveInfrastructureErrors = record.infrastructureError ? consecutiveInfrastructureErrors + 1 : 0;
            if (consecutiveInfrastructureErrors >= MAX_CONSECUTIVE_INFRASTRUCTURE_ERRORS) {
                abortedReason = `Stopped after ${MAX_CONSECUTIVE_INFRASTRUCTURE_ERRORS} consecutive infrastructure failures `
                    + `(last: ${String(record.error).slice(0, 160)}). Check the rules service and network, then re-run.`;
                console.warn(`\n${abortedReason}\n`);
                break evaluation;
            }
        }
    }

    const summary: Record<string, CategorySummary> = {};
    for (const record of results) {
        const key = String(record.category);
        const entry = summary[key] ?? (summary[key] = {
            total: 0, infrastructureErrors: 0, decisionMatch: 0, typeMatch: 0, runnable: 0, recoveredAfterCorrection: 0,
            corrected: 0, errors: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0,
        });
        entry.total++;
        if (record.infrastructureError) entry.infrastructureErrors++;
        if (record.decisionMatch) entry.decisionMatch++;
        if (record.typeMatch) entry.typeMatch++;
        if (record.config) entry.runnable++;
        if (record.outcome === 'error') entry.errors++;
        // A review needed correction when the validator reported a failure for any of its attempts.
        if ((record.diagnostics as RuleDiagnosticEvent[]).some(event => event.kind === 'validation-failure')) {
            entry.corrected++;
            if (record.config) entry.recoveredAfterCorrection++;
        }
        entry.modelCalls += Number(record.modelCalls);
        entry.inputTokens += Number(record.inputTokens);
        entry.outputTokens += Number(record.outputTokens);
    }
    console.table(summary);

    const out = path.resolve(flag('out') ?? path.join('eval-results', `nl-rules-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({
        generatedAt: new Date().toISOString(),
        model: appConfig.azure.citadel.model,
        // Non-null when the run stopped early; the results below are then incomplete.
        aborted: abortedReason,
        summary,
        results,
    }, null, 2));
    console.log(`Report written to ${out}\nScore data behavior: python Validation-Service/scripts/score_nl_eval.py "${out}"`);
}

if (require.main === module) {
    main().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
