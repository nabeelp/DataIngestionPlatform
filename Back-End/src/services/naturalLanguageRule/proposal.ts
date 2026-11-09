import { randomUUID } from 'node:crypto';
import type { DefinitionContract } from '../../contracts/definition-contract';
import type { RuleConfig } from '../../contracts/rule-config';
import { appConfig } from '../../config/appConfig';
import { logger } from '../../utils/logger';
import { RulesServiceError } from '../RulesServiceClient';
import { MAX_ATTEMPTS } from './constants';
import { ModelCallError, RuleGenerationCancelledError, RuleGenerationError } from './errors';
import { requestExamples, requestProposal } from './modelRequests';
import type {
    ModelExamples,
    ModelProposal,
    NaturalLanguageRuleOptions,
    NaturalLanguageRuleResult,
    PreviousAttempt,
    Report,
    RuleDiagnosticEvent,
} from './types';
import { failureSummary, validateProposal, type CheckedProposal } from './validation';

const rejected = (reason: string): NaturalLanguageRuleResult => ({ outcome: 'rejected', reason });

/**
 * Review a plain-language rule against a draft held by the client. Nothing is saved: the proposed RuleConfig is
 * returned for the workspace to add to its draft.
 */
export async function proposeNaturalLanguageRule(
    contract: DefinitionContract,
    request: string,
    options: NaturalLanguageRuleOptions = {},
    existing?: Pick<RuleConfig, 'id' | 'enabled' | 'executionOrder'>,
): Promise<NaturalLanguageRuleResult> {
    const executionOrder = existing?.executionOrder;
    const enabled = existing?.enabled ?? true;
    const result = await reviewNaturalLanguageRule(contract, request, options, {
        id: existing?.id ?? randomUUID(),
        enabled,
        ...(executionOrder !== undefined ? { executionOrder } : {}),
    }, existing ? 'Regenerated' : 'Proposed');
    // The rules service reviews every rule as enabled; the rule keeps the state it had.
    return result.outcome === 'rejected' ? result : { ...result, config: { ...result.config, enabled } };
}

async function reviewNaturalLanguageRule(
    contract: DefinitionContract,
    request: string,
    options: NaturalLanguageRuleOptions,
    identity: { id: string; enabled: boolean; executionOrder?: number },
    verb: 'Regenerated' | 'Proposed',
): Promise<NaturalLanguageRuleResult> {
    const started = Date.now();
    const report: Report = (level, message) => {
        try {
            options.onProgress?.({ level, message, elapsedMs: Date.now() - started });
        } catch {
            // A closed response stream must not stop rule authoring.
        }
    };
    const assertNotCancelled = () => {
        if (options.signal?.aborted) throw new RuleGenerationCancelledError();
    };
    if (!request.trim()) throw new RuleGenerationError('A Natural Language rule request is required', 400);

    const tableCount = contract.tables.length;
    const columnCount = contract.tables.reduce((count, table) => count + table.columns.length, 0);
    report('info', `Read the draft schema: ${tableCount} table(s), ${columnCount} column(s)`);
    const executionOrder = identity.executionOrder
        ?? Math.max(0, ...contract.rules.map(rule => rule.executionOrder)) + 1;
    const configIdentity = { ...identity, executionOrder };
    let previousAttempt: PreviousAttempt | null = null;
    // Rewriting only the examples is tried once per review; the validated rule is kept while it is.
    let examplesRegenerated = false;
    const diagnose = (event: RuleDiagnosticEvent) => {
        try {
            options.onDiagnostic?.(event);
        } catch {
            // An evaluation hook must never change the outcome of authoring.
        }
    };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        assertNotCancelled();
        const { model } = appConfig.azure.citadel;
        report('info', `Asking ${model} through Citadel to review the rule (attempt ${attempt} of ${MAX_ATTEMPTS})`);
        let generated: ModelProposal;
        try {
            generated = await requestProposal(request, contract, previousAttempt, report, options.signal);
        } catch (error) {
            if (error instanceof ModelCallError && error.retryable && attempt < MAX_ATTEMPTS) {
                report('warning', `${error.message}. Retrying`);
                continue;
            }
            if (error instanceof ModelCallError) report('error', error.message);
            throw error;
        }
        diagnose({
            kind: 'model-call', purpose: 'rule', attempt, responseId: generated.responseId,
            inputTokens: generated.usage.inputTokens, outputTokens: generated.usage.outputTokens,
            proposal: generated.proposal,
        });

        if (generated.proposal.decision === 'rejected') {
            const reason = generated.proposal.reason.trim().slice(0, 1000) || 'The request is ambiguous or cannot be implemented safely.';
            report('warning', 'The model cannot implement this rule request');
            return rejected(reason);
        }
        report('info', generated.proposal.decision === 'mapped'
            ? `The model selected the declarative ${generated.proposal.type} rule type`
            : 'The model selected a Natural Language SQL rule');

        const check = async (candidate: ModelProposal): Promise<CheckedProposal> => {
            try {
                return await validateProposal(candidate, request, contract, configIdentity, report);
            } catch (error) {
                if (options.signal?.aborted) throw new RuleGenerationCancelledError();
                if (error instanceof RulesServiceError) {
                    const reason = error.statusCode === 504
                        ? 'Rule validation timed out. Nothing was saved. Retry shortly; if it persists, ask an administrator to check rules service availability.'
                        : error.statusCode === 503
                            ? 'Rule validation could not start because the rules service credentials are unavailable. Nothing was saved. Ask an administrator to check the service authentication configuration.'
                            : 'The rules service could not complete validation. Nothing was saved. Ask an administrator to check connectivity and service health before retrying.';
                    report('error', reason);
                    logger.warn(`[NATURAL_LANGUAGE_RULE_VALIDATION] ${JSON.stringify({
                        responseId: /^resp_[a-zA-Z0-9_-]{1,100}$/.test(candidate.responseId) ? candidate.responseId : 'unknown',
                        attempt, phase: 'service', statusCode: error.statusCode,
                    })}`);
                    throw new RuleGenerationError(reason,
                        error.statusCode === 503 || error.statusCode === 504 ? error.statusCode : 502);
                }
                const serviceError = error as { statusCode?: unknown; message?: unknown };
                if (typeof serviceError.statusCode === 'number' && [502, 503, 504].includes(serviceError.statusCode)) {
                    const reason = 'The rules service could not complete validation. Nothing was saved. '
                        + 'Ask an administrator to check service availability before retrying.';
                    report('error', reason);
                    throw new RuleGenerationError(reason, serviceError.statusCode as 502 | 503 | 504);
                }
                throw error;
            }
        };

        let checked = await check(generated);
        if ('problem' in checked && checked.scope === 'examples' && !examplesRegenerated) {
            examplesRegenerated = true;
            diagnose({
                kind: 'validation-failure', attempt, phase: checked.phase, scope: checked.scope,
                problem: checked.problem, paths: checked.paths,
            });
            report('warning', `${failureSummary(checked)}. ${checked.details.join(' ')} Asking the model to rewrite only the examples; the proposed rule is kept.`);
            let fresh: ModelExamples | null = null;
            try {
                fresh = await requestExamples(request, contract, generated.proposal, checked.problem, report, options.signal);
            } catch (error) {
                if (!(error instanceof ModelCallError)) throw error;
                report('warning', `${error.message}. Keeping the original failure`);
            }
            if (fresh) {
                diagnose({
                    kind: 'model-call', purpose: 'examples', attempt, responseId: fresh.responseId,
                    inputTokens: fresh.usage.inputTokens, outputTokens: fresh.usage.outputTokens,
                    proposal: fresh.examples,
                });
                generated = { ...generated, proposal: { ...generated.proposal, examples: fresh.examples } };
                checked = await check(generated);
            }
        }
        const proposal = generated.proposal;
        if ('problem' in checked) {
            diagnose({
                kind: 'validation-failure', attempt, phase: checked.phase, scope: checked.scope,
                problem: checked.problem, paths: checked.paths,
            });
            const summary = failureSummary(checked);
            const reference = /^resp_[a-zA-Z0-9_-]{1,100}$/.test(generated.responseId)
                ? generated.responseId : 'unavailable';
            logger.warn(`[NATURAL_LANGUAGE_RULE_VALIDATION] ${JSON.stringify({
                responseId: reference,
                attempt,
                phase: checked.phase,
                paths: checked.paths,
                failedExamples: checked.failedExamples,
                details: checked.details,
            })}`);
            const contextFailure = checked.paths.some(path =>
                /^\$\.(?:rules|tables|lookups|layout|encoding|schemaVersion|ignoredSheets)\b/.test(path));
            const details = checked.details.join(' ');
            if (contextFailure) {
                const reason = `The proposed rule was not saved. ${summary}. ${details} Response reference: ${reference}.`;
                report('error', reason);
                return rejected(reason);
            }
            if (previousAttempt || attempt >= MAX_ATTEMPTS) {
                const reason = `The proposed rule was not saved. ${summary} after correction. ${details} `
                    + `Response reference: ${reference}.`;
                report('error', reason);
                return rejected(reason);
            }
            previousAttempt = { problem: checked.problem };
            report('warning', `${summary}. ${details} Asking the model for one correction.`);
            continue;
        }

        assertNotCancelled();
        report('success', `${verb} rule "${checked.config.name}"`);
        return { outcome: checked.outcome, reason: proposal.reason, config: checked.config };
    }

    throw new RuleGenerationError('The model could not produce a valid RuleConfig after retrying');
}
