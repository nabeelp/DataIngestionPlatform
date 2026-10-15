import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DefinitionContract } from '../../src/contracts/definition-contract';

export interface GoldenValue { column: string; value: string | null }
export interface GoldenExample {
    table: string;
    values: GoldenValue[];
    expectedValid: boolean;
    relatedRows: Array<{ table: string; values: GoldenValue[] }>;
}
type GoldenRows = Record<string, Array<Record<string, string | null>>>;
export interface GoldenCase {
    id: string;
    category: 'builtin' | 'row-sql' | 'query-sql' | 'cross-sheet' | 'reject';
    definition: string;
    request: string;
    expected: { decision: 'mapped' | 'natural_language' | 'rejected'; type?: string; mode?: 'row' | 'query' };
    referenceProposal: Record<string, unknown> & {
        decision: string;
        type: string;
        table: string | null;
        params: Record<string, unknown>;
        examples: GoldenExample[];
    };
    data?: { violating: GoldenRows; clean: GoldenRows };
    expectedFailures?: Array<{ sheet: string | null; row: number | null }>;
    expectedSeverity?: 'Error' | 'Warning';
}
interface GoldenDefinition {
    layout: 'single' | 'sheets';
    tables: Array<{ sheet: string | null; columns: Array<[string, string]> }>;
}
export interface GoldenCorpus {
    definitions: Record<string, GoldenDefinition>;
    cases: GoldenCase[];
}

const corpusPath = path.resolve(__dirname, '..', '..', '..', 'samples', 'nl-rules', 'golden.json');

export function loadGoldenCorpus(): GoldenCorpus {
    return JSON.parse(readFileSync(corpusPath, 'utf8')) as GoldenCorpus;
}

/** The corpus keeps one `examples` list with a verdict; the model returns separate passing and failing lists. */
export function modelOutput(proposal: GoldenCase['referenceProposal']): Record<string, unknown> {
    const { examples, ...rest } = proposal;
    const withoutVerdict = (example: GoldenExample) => ({
        table: example.table,
        values: example.values,
        relatedRows: example.relatedRows,
    });
    return {
        ...rest,
        passingExamples: examples.filter(example => example.expectedValid).map(withoutVerdict),
        failingExamples: examples.filter(example => !example.expectedValid).map(withoutVerdict),
    };
}

/** The order of the examples after the backend combines the model's lists: passing first, then failing. */
export function combinedExamples(proposal: GoldenCase['referenceProposal']): GoldenExample[] {
    return [
        ...proposal.examples.filter(example => example.expectedValid),
        ...proposal.examples.filter(example => !example.expectedValid),
    ];
}

export function goldenContract(corpus: GoldenCorpus, name: string): DefinitionContract {
    const definition = corpus.definitions[name];
    return {
        schemaVersion: 1,
        layout: definition.layout,
        ignoredSheets: [],
        encoding: 'auto',
        tables: definition.tables.map(table => ({
            sheet: table.sheet,
            headerRow: 1,
            allowExtraColumns: true,
            minRows: null,
            maxRows: null,
            columns: table.columns.map(([columnName, type]) => ({
                name: columnName,
                type,
                mustExist: true,
                nullable: true,
                format: null,
                decimalSeparator: '.',
                thousandsSeparator: null,
                precision: null,
                scale: null,
                maxLength: null,
                unique: false,
            })),
        })),
        rules: [],
        lookups: {},
    } as unknown as DefinitionContract;
}
