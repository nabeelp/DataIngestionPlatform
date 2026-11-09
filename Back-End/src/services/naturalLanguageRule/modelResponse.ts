import type { RuleConfig } from '../../contracts/rule-config';
import type { RuleSeverity } from '../../interfaces/rule.interface';
import { ModelCallError } from './errors';
import type { Decision, Proposal, ProposalExample, ProposalExampleValue } from './types';
import { isObject } from './util';

function normalizeProposalParams(type: RuleConfig['type'], value: Record<string, unknown>): Record<string, unknown> {
    const params = Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null));
    if (type === 'naturalLanguage') {
        if (!Array.isArray(value.tableColumns)) {
            throw new ModelCallError('The model returned malformed table-column declarations', true);
        }
        const columns: Record<string, string[]> = {};
        for (const entry of value.tableColumns) {
            if (!isObject(entry) || typeof entry.table !== 'string' || !Array.isArray(entry.columns)
                || entry.columns.some(column => typeof column !== 'string')
                || Object.prototype.hasOwnProperty.call(columns, entry.table)) {
                throw new ModelCallError('The model returned malformed table-column declarations', true);
            }
            columns[entry.table] = entry.columns as string[];
        }
        delete params.tableColumns;
        params.columns = columns;
        params.failWhen = value.failWhen;
        params.query = value.query;
    } else if (type === 'conditionalRequired' && isObject(value.when)) {
        params.when = Object.fromEntries(Object.entries(value.when).filter(([, item]) => item !== null));
    }
    return params;
}

function readExampleValues(raw: unknown): ProposalExampleValue[] {
    if (!Array.isArray(raw)) throw new ModelCallError('The model returned malformed example values', true);
    const seen = new Set<string>();
    const values: ProposalExampleValue[] = [];
    for (const item of raw) {
        if (!isObject(item) || typeof item.column !== 'string'
            || (item.value !== null && typeof item.value !== 'string') || seen.has(item.column)) {
            throw new ModelCallError('The model returned malformed example values', true);
        }
        seen.add(item.column);
        values.push({ column: item.column, value: item.value as string | null });
    }
    return values;
}

function readExample(raw: unknown, label: string, expectedValid: boolean | undefined): ProposalExample {
    if (!isObject(raw) || typeof raw.table !== 'string' || !Array.isArray(raw.values)
        || (raw.relatedRows !== undefined && !Array.isArray(raw.relatedRows))) {
        throw new ModelCallError('The model returned malformed examples', true);
    }
    const valid = expectedValid ?? raw.expectedValid;
    if (typeof valid !== 'boolean') throw new ModelCallError('The model returned malformed examples', true);
    const relatedRows = ((raw.relatedRows ?? []) as unknown[]).map(row => {
        if (!isObject(row) || typeof row.table !== 'string') {
            throw new ModelCallError('The model returned malformed related example rows', true);
        }
        return { table: row.table, values: readExampleValues(row.values) };
    });
    return { label, table: raw.table, values: readExampleValues(raw.values), expectedValid: valid, relatedRows };
}

/** Reads passingExamples/failingExamples; a single legacy `examples` array with expectedValid is also accepted. */
function readExamples(value: Record<string, unknown>): ProposalExample[] | null {
    if (Array.isArray(value.passingExamples) && Array.isArray(value.failingExamples)) {
        return [
            ...value.passingExamples.map((item: unknown, index: number) => readExample(item, `passingExamples[${index}]`, true)),
            ...value.failingExamples.map((item: unknown, index: number) => readExample(item, `failingExamples[${index}]`, false)),
        ];
    }
    if (Array.isArray(value.examples)) {
        return value.examples.map((item: unknown, index: number) => readExample(item, `examples[${index}]`, undefined));
    }
    return null;
}

function parseModelJson(text: string, what: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        throw new ModelCallError(`The model returned malformed ${what} JSON`, true);
    }
}

export function readExamplesResponse(text: string): ProposalExample[] {
    const value = parseModelJson(text, 'examples');
    const examples = isObject(value) ? readExamples(value) : null;
    if (!examples) throw new ModelCallError('The model returned examples with missing or invalid fields', true);
    return examples;
}

export function readProposal(text: string): Proposal {
    const value = parseModelJson(text, 'proposal');
    if (!isObject(value) || !['mapped', 'natural_language', 'rejected'].includes(String(value.decision))
        || typeof value.reason !== 'string' || typeof value.name !== 'string'
        || !['Error', 'Warning'].includes(String(value.severity))
        || (value.table !== null && typeof value.table !== 'string')
        || typeof value.type !== 'string' || !isObject(value.params)) {
        throw new ModelCallError('The model returned a proposal with missing or invalid fields', true);
    }
    const examples = readExamples(value);
    if (!examples) throw new ModelCallError('The model returned a proposal with missing or invalid fields', true);

    const params = normalizeProposalParams(value.type as RuleConfig['type'], value.params);

    return {
        decision: value.decision === 'mapped' && value.type === 'naturalLanguage'
            ? 'natural_language'
            : value.decision as Decision,
        reason: value.reason,
        name: value.name,
        severity: value.severity as RuleSeverity,
        table: value.table as string | null,
        type: value.type as RuleConfig['type'],
        params,
        examples,
    };
}
