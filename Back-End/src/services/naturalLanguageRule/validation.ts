import type { DefinitionContract } from '../../contracts/definition-contract';
import type { RuleConfig } from '../../contracts/rule-config';
import { RulesServiceClient } from '../RulesServiceClient';
import { MAX_EXAMPLES } from './constants';
import { configFor } from './proposalConfig';
import type { ModelProposal, Report } from './types';

export interface ProposalFailure {
    problem: string;
    phase: 'configuration' | 'validation' | 'examples';
    /** `examples` failures are about example shape only, so the validated rule can be kept and only examples regenerated. */
    scope: 'rule' | 'examples';
    paths: string[];
    failedExamples: number[];
    details: string[];
}

export type CheckedProposal = { config: RuleConfig; outcome: 'mapped' | 'natural_language' } | ProposalFailure;

function safeValidationPaths(errors: Array<{ path: string }>): string[] {
    const field = '(?:rule|rules|params|table|tables|columns|sheet|headerRow|allowExtraColumns|minRows|maxRows'
        + '|name|type|mustExist|nullable|format|decimalSeparator|thousandsSeparator|precision|scale|maxLength'
        + '|unique|schemaVersion|layout|ignoredSheets|encoding|lookups|examples|values|expectedValid|source'
        + '|mode|failWhen|query|message|explanation|request|provenance|id|description|severity|executionOrder|enabled)';
    const safePath = new RegExp(`^\\$(?:\\.${field}|\\[\\d{1,5}\\])*$`);
    return [...new Set(errors.slice(0, 10).map(error =>
        error.path.length <= 200 && safePath.test(error.path) ? error.path : '$'))];
}

export function failureSummary(failure: ProposalFailure): string {
    const contextFailure = failure.paths.some(path => /^\$\.(?:rules|tables|lookups|layout|encoding|schemaVersion|ignoredSheets)\b/.test(path));
    const phase = contextFailure ? 'Draft definition validation'
        : failure.phase === 'examples' ? 'Candidate example testing'
        : failure.phase === 'validation' ? 'Candidate rule validation' : 'Proposal configuration';
    const location = failure.failedExamples.length
        ? ` for example(s) ${failure.failedExamples.join(', ')}`
        : failure.paths.length ? ` at ${failure.paths.join(', ')}` : '';
    return `${phase} failed${location}`;
}

function validationDetail(error: { path: string; message: string }): string {
    const existingRule = error.path.match(/^\$\.rules\[(\d{1,5})\](?:\.|$)/);
    if (existingRule) {
        return `Existing draft rule ${Number(existingRule[1]) + 1} has an invalid configuration. `
            + 'Open the definition\'s rules and repair that rule; changing this request will not fix it.';
    }
    // Match known validator messages, but never echo payloads embedded in schema/engine errors.
    const explanations: Array<[RegExp, string]> = [
        [/^Function `[^`]+` is not allowed\.$|^Natural-language SQL contains an expression that is not allowed\.$/,
            'The generated SQL uses an unsupported function. Describe the rule using supported comparisons or ask an administrator to review the SQL.'],
        [/^Natural-language SQL could not be parsed\.$/,
            'The generated SQL has invalid syntax. Split the request into simpler conditions or ask an administrator to review the SQL.'],
        [/^Only query-mode examples can seed related rows\.$/,
            'Related example rows are only valid for query rules. Remove them or use a query rule across the sheets.'],
        [/^Example refers to an unknown table "|^Example values contain undeclared columns\.$/,
            'An example uses a sheet or column that is not declared. Every example row must use declared sheets and columns.'],
        [/^Natural-language SQL (?:references an undeclared column|has an ambiguous or undeclared column)\.$|^Rule references undeclared column "/,
            'The rule references a column that is not declared in the definition. Use the defined column names and specify which table each belongs to.'],
        [/^Natural-language SQL references an unregistered table\.$|^Rule references undeclared table "/,
            'The rule references a table that is not declared in the definition or not declared in the rule\'s columns. '
            + 'Select the correct definition, use its defined table names, and list every sheet a cross-sheet query reads.'],
        [/^Query-mode rules must declare columns for at least one table\.$|^Query-mode (?:table|columns for table) "/,
            'The cross-sheet rule is missing the sheets or columns it reads. Name each sheet the check compares and the columns it uses.'],
        [/^Column names must be unique, ignoring case and surrounding whitespace\.$/,
            'The definition contains duplicate column names. Rename or remove duplicate columns in the definition before retrying.'],
        [/^Table sheet names must be unique\.$/,
            'The definition contains duplicate sheet names. Give each table a unique sheet name before retrying.'],
        [/^Natural-language SQL exceeds the 4-KB limit\.$/,
            'The generated SQL exceeds the 4-KB size limit. Split the request into smaller rules.'],
        [/^Natural-language rules may reference at most 20 columns\.$/,
            'The rule uses more than 20 columns. Split it into rules that each reference at most 20 columns.'],
        [/^Row-mode SQL must be a boolean expression, not a query\.$/,
            'The generated row rule contains a query instead of a true/false condition. Specify a per-row condition or request a whole-file check.'],
        [/^Query-mode SQL must be a single SELECT statement\.$/,
            'The generated whole-file rule is not a single SELECT query. Describe one whole-file check per rule.'],
        [/^Natural-language SQL must contain exactly one statement\.$/,
            'The generated SQL contains multiple statements. Split the request into one check per rule.'],
        [/^Natural-language SQL cannot use qualified table names\.$/,
            'The generated SQL uses an external or qualified table name. Rules can use only tables in this definition.'],
        [/^Natural-language SQL uses a data type that is not allowed\.$/,
            'The generated SQL casts to an unsupported data type. Ask an administrator to review the rule\'s casts.'],
        [/^(?:A sheet-layout rule must target a declared table|A single-layout rule cannot target an undeclared table)\.$/,
            'The rule targets a table that is not available in this definition. Select a defined table before retrying.'],
        [/^(?:A single-layout row rule must declare one table's columns|A row rule must declare columns for its target table)\.$|^Query-mode columns for table "/,
            'The generated rule is missing its table/column declarations. Specify the table and columns the check should use.'],
    ];
    const known = explanations.find(([pattern]) => pattern.test(error.message));
    if (known) return known[1];
    if (/is not valid under any of the given schemas|is not of type|Field required|is a required property|Input should|should have at least/.test(error.message)) {
        return 'A required configuration field is missing or has an invalid type or value. '
            + 'Review the indicated field in the rule editor or definition settings before retrying.';
    }
    if (error.path === '$.rule') {
        return 'The generated rule could not execute against the definition\'s column types. '
            + 'Check type conversions and ask an administrator to review the expression.';
    }
    return 'The validator returned an unrecognized failure; its raw details were withheld because they may contain data. '
        + 'Ask an administrator to investigate using the response reference below.';
}

function validationDetails(errors: Array<{ path: string; message: string }>): string[] {
    return [...new Set(errors.slice(0, 3).map(validationDetail))];
}

export async function validateProposal(
    generated: ModelProposal,
    request: string,
    contract: DefinitionContract,
    identity: { id: string; executionOrder: number; enabled: boolean },
    report: Report,
): Promise<CheckedProposal> {
    const proposal = generated.proposal;
    if (proposal.decision === 'rejected') {
        return {
            problem: proposal.reason.trim() || 'The model could not explain why the request was rejected.',
            phase: 'configuration', scope: 'rule', paths: [], failedExamples: [],
            details: ['The model did not provide a supported rule decision. Clarify the check and the table/columns it should use.'],
        };
    }
    const prepared = configFor(proposal, request, contract, generated, identity);
    if (!prepared.config) return {
        problem: prepared.problem ?? 'The proposal is not a valid RuleConfig.',
        phase: 'configuration', scope: prepared.scope ?? 'rule', paths: [], failedExamples: [],
        details: [prepared.detail ?? prepared.problem ?? 'The proposal is not a valid RuleConfig.',
            'Specify the target table, exact column names, and passing and failing cases before retrying.'],
    };

    report('info', 'Validating the proposed RuleConfig with the Python rules service');
    const validation = await RulesServiceClient.validateRule(contract, prepared.config);
    if (!validation.ok) {
        return {
            problem: validation.errors.map(error => `${error.path}: ${error.message}`).join('; ')
                || 'The Python rules service rejected the RuleConfig.',
            phase: 'validation',
            scope: 'rule',
            paths: safeValidationPaths(validation.errors),
            failedExamples: [],
            details: validation.errors.length ? validationDetails(validation.errors)
                : ['The validator rejected the candidate without returning a reason. Ask an administrator to investigate using the response reference below.'],
        };
    }
    const normalizedRule = validation.normalizedRule ?? prepared.config;
    if (proposal.decision === 'natural_language') {
        report('info', `Testing all ${prepared.examples!.length} model examples with the Python rules service`);
        const test = await RulesServiceClient.testRule(contract, normalizedRule, prepared.examples);
        if (!test.ok || test.results.length !== prepared.examples!.length || test.results.some(result => !result.passed)) {
            const failingResults = test.results.filter(result => !result.passed
                && Number.isInteger(result.index) && result.index >= 1 && result.index <= MAX_EXAMPLES);
            const details = validationDetails(test.errors);
            const labelOf = (index: number): string => proposal.examples[index - 1]?.label ?? `example ${index}`;
            const feedback: string[] = [];
            for (const result of failingResults.slice(0, 3)) {
                details.push(result.error
                    ? `Example ${result.index} could not be evaluated. ${validationDetail({ path: '$.rule', message: result.error })}`
                    : `Example ${result.index} was expected to ${result.expectedValid ? 'pass' : 'fail'} but the rule `
                        + `${result.actualValid ? 'accepted' : 'rejected'} it. Clarify the passing and failing cases in your request.`);
            }
            for (const result of failingResults.slice(0, 8)) {
                feedback.push(result.error
                    ? `${labelOf(result.index)} could not be evaluated: ${validationDetail({ path: '$.rule', message: result.error })}`
                    : `${labelOf(result.index)} was expected to ${result.expectedValid ? 'pass' : 'fail'} but the rule `
                        + `${result.actualValid ? 'accepted' : 'rejected'} it`);
            }
            if (feedback.length > 0) {
                feedback.push('Decide whether the SQL or the example is wrong and fix it so the examples reflect the request');
            }
            if (test.results.length !== prepared.examples!.length) {
                details.push(`The test service returned ${test.results.length} results for ${prepared.examples!.length} examples. `
                    + 'Ask an administrator to check the rules service before retrying.');
            }
            return {
                problem: [test.errors.map(error => `${error.path}: ${error.message}`).join('; ')
                    || 'One or more model examples did not pass in the Python rules service.', ...feedback].join('. '),
                phase: 'examples',
                scope: 'rule',
                paths: safeValidationPaths(test.errors),
                failedExamples: failingResults.slice(0, MAX_EXAMPLES).map(result => result.index),
                details: details.length ? details.slice(0, 3)
                    : ['The test service rejected the examples without returning a reason. Ask an administrator to investigate using the response reference below.'],
            };
        }
    }
    report('success', 'The Python rules service accepted the RuleConfig and its examples');
    return { config: normalizedRule, outcome: proposal.decision };
}
