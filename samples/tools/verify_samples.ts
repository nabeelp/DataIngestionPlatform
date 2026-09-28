// =============================================================================
// Verifies every sample in samples/manifest.json against the backend's real reader, validation engine and
// example analyzer (no database or server needed). Upload-time rejections mirror upload.routes.ts and
// upload.controller.ts (allowed extensions, size limit, CSV for sheet-table definitions).
//
//   cd Back-End
//   node --max-old-space-size=8192 -r ts-node/register/transpile-only ../samples/tools/verify_samples.ts [--skip-large] [--only <text>]
// =============================================================================

import fs from 'fs';
import path from 'path';
import { readRecords } from '../../Back-End/src/services/validation/FileRecordReader';
import {
    createDefinitionSchemaEvaluator,
    createRuleEvaluator,
    scopeToSheet,
    type RowEvaluator,
} from '../../Back-End/src/services/validation/ValidationEngine';
import {
    assertPublishable,
    buildContractSnapshot,
    schemaCheckName,
    validationTables,
    type ContractSnapshot,
} from '../../Back-End/src/services/validation/DefinitionContract';
import { analyzeExampleFile, ExampleFileError } from '../../Back-End/src/services/validation/ExampleFileAnalyzer';

const SAMPLES = path.resolve(__dirname, '..');
const ALLOWED_UPLOAD_EXTENSIONS = ['.csv', '.tsv', '.txt', '.xlsx', '.xls'];
const EXCEL_TYPES = ['xlsx', 'xls'];
const EXAMPLE_EXTENSIONS = ['.csv', '.xlsx'];
const EXAMPLE_LIMIT_BYTES = 10 * 1024 * 1024;

interface Definition {
    name: string;
    columns: { name: string; type: string; required: boolean }[];
    tables: { sheet: string; columns: { name: string; type: string; required: boolean }[] }[];
    rules: { name: string; ruleType: string; expression: string; severity: string; table: string | null }[];
}

interface Entry {
    file: string;
    kind: 'upload' | 'example';
    definition?: string;
    expected: Record<string, any>;
}

const args = process.argv.slice(2);
const skipLarge = args.includes('--skip-large');
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : undefined;

const definitions: Record<string, Definition> = JSON.parse(fs.readFileSync(path.join(SAMPLES, 'definitions', 'sample_definitions.json'), 'utf8'));
const manifest: { uploadLimitBytes: number; files: Entry[] } = JSON.parse(fs.readFileSync(path.join(SAMPLES, 'manifest.json'), 'utf8'));

const contracts = new Map<string, ContractSnapshot>();
for (const [key, definition] of Object.entries(definitions)) {
    const rules = definition.rules.map((rule, index) => ({
        Id: `${key}-${index + 1}`, Name: rule.name, RuleType: rule.ruleType, Severity: rule.severity,
        ExecutionOrder: index + 1, SqlQuery: rule.expression, TableName: rule.table,
    }));
    const contract = buildContractSnapshot(definition.columns, rules, definition.tables);
    assertPublishable(contract);
    contracts.set(key, contract);
}

const sameSet = (a: string[] = [], b: string[] = []) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

async function runUpload(entry: Entry, filePath: string): Promise<Record<string, any>> {
    const contract = contracts.get(entry.definition!)!;
    const extension = path.extname(filePath).toLowerCase();
    const fileType = extension.slice(1);
    const size = fs.statSync(filePath).size;
    if (!ALLOWED_UPLOAD_EXTENSIONS.includes(extension)) return { status: 'UPLOAD_REJECTED', reason: 'extension' };
    if (size > manifest.uploadLimitBytes) return { status: 'UPLOAD_REJECTED', reason: 'size' };
    if (contract.tables.length > 0 && !EXCEL_TYPES.includes(fileType)) return { status: 'UPLOAD_REJECTED', reason: 'csv for sheet tables' };

    const checks: { name: string; severity: string; evaluator: RowEvaluator }[] = [];
    for (const table of validationTables(contract)) {
        const schema = createDefinitionSchemaEvaluator(table.columns);
        checks.push({
            name: schemaCheckName(table.sheet), severity: 'Error',
            evaluator: table.sheet === null ? schema : scopeToSheet(schema, table.sheet, { reportMissing: true }),
        });
    }
    for (const rule of contract.rules) {
        const evaluator = createRuleEvaluator(rule.RuleType, rule.SqlQuery);
        checks.push({ name: rule.Name, severity: rule.Severity, evaluator: rule.Table ? scopeToSheet(evaluator, rule.Table, { reportMissing: false }) : evaluator });
    }

    let summary;
    try {
        summary = await readRecords(filePath, fileType, {
            onHeaders: (headers, sheet) => checks.forEach(check => check.evaluator.onHeaders(headers, sheet)),
            onRow: (row, rowNumber, sheet) => checks.forEach(check => check.evaluator.onRow(row, rowNumber, sheet)),
        });
    } catch (error) {
        return { status: 'READ_ERROR', error: (error as Error).message };
    }

    const failedChecks: string[] = [];
    const warningChecks: string[] = [];
    const errorCounts: Record<string, number> = {};
    for (const check of checks) {
        const result = check.evaluator.result();
        if (result.passed) continue;
        errorCounts[check.name] = result.errorCount;
        if (result.errors.length > 100) throw new Error(`More than 100 samples stored for ${check.name}`);
        (check.severity === 'Warning' ? warningChecks : failedChecks).push(check.name);
    }
    const status = failedChecks.length > 0 ? 'FAILED' : warningChecks.length > 0 ? 'WARNING' : 'PASSED';
    return { status, failedChecks, warningChecks, errorCounts, rows: summary.rowCount, sheets: summary.sheets.map(s => s.name) };
}

function compareUpload(expected: Record<string, any>, actual: Record<string, any>): string[] {
    const problems: string[] = [];
    if (expected.status !== actual.status) problems.push(`status ${actual.status} (expected ${expected.status})${actual.error ? `: ${actual.error}` : ''}`);
    if (['PASSED', 'WARNING', 'FAILED'].includes(actual.status)) {
        if (!sameSet(expected.failedChecks, actual.failedChecks)) problems.push(`failed checks [${actual.failedChecks.join('; ')}] (expected [${(expected.failedChecks || []).join('; ')}])`);
        if (!sameSet(expected.warningChecks, actual.warningChecks)) problems.push(`warning checks [${actual.warningChecks.join('; ')}] (expected [${(expected.warningChecks || []).join('; ')}])`);
        if (expected.rows !== undefined && expected.rows !== actual.rows) problems.push(`rows ${actual.rows} (expected ${expected.rows})`);
        // Guards against vacuous passes (for example headers that match nothing, so every row looks blank).
        if (expected.rows === undefined && actual.status !== 'FAILED' && actual.rows === 0) problems.push('no data rows were read');
        for (const [name, count] of Object.entries(expected.errorCounts || {})) {
            if ((actual.errorCounts[name] ?? 0) !== count) problems.push(`"${name}" issues ${actual.errorCounts[name] ?? 0} (expected ${count})`);
        }
    }
    return problems;
}

async function runExample(entry: Entry, filePath: string): Promise<string[]> {
    const expected = entry.expected;
    const extension = path.extname(filePath).toLowerCase();
    let outcome: { result: string; error?: string; analysis?: Awaited<ReturnType<typeof analyzeExampleFile>> };
    if (!EXAMPLE_EXTENSIONS.includes(extension)) {
        outcome = { result: 'REJECTED', error: 'Example files must be CSV (.csv) or Excel workbooks (.xlsx)' };
    } else if (fs.statSync(filePath).size > EXAMPLE_LIMIT_BYTES) {
        outcome = { result: 'REJECTED', error: `Example files are limited to ${EXAMPLE_LIMIT_BYTES / (1024 * 1024)} MB` };
    } else {
        try {
            outcome = { result: 'PROPOSAL', analysis: await analyzeExampleFile(filePath, extension.slice(1)) };
        } catch (error) {
            if (!(error instanceof ExampleFileError)) throw error;
            outcome = { result: 'REJECTED', error: error.message };
        }
    }

    const problems: string[] = [];
    if (outcome.result !== expected.result) problems.push(`result ${outcome.result} (expected ${expected.result})${outcome.error ? `: ${outcome.error}` : ''}`);
    if (outcome.result === 'REJECTED' && expected.errorContains && !outcome.error!.includes(expected.errorContains)) {
        problems.push(`error "${outcome.error}" does not contain "${expected.errorContains}"`);
    }
    const analysis = outcome.analysis;
    if (!analysis || expected.result !== 'PROPOSAL') return problems;

    const populated = analysis.sheets.filter(sheet => sheet.columns.length > 0);
    const layout = analysis.fileType === 'xlsx' && populated.length > 1 ? 'sheets' : 'single';
    if (expected.layout && expected.layout !== layout) problems.push(`layout ${layout} (expected ${expected.layout})`);
    if (expected.sheets && !sameSet(expected.sheets.map(String), populated.map(sheet => String(sheet.name)))) {
        problems.push(`sheets [${populated.map(s => s.name).join(', ')}] (expected [${expected.sheets.join(', ')}])`);
    }
    const warnings = [...analysis.warnings, ...analysis.sheets.flatMap(sheet => sheet.warnings)];
    for (const text of expected.warningsContain || []) {
        if (!warnings.some(warning => warning.includes(text))) problems.push(`no warning containing "${text}" (got: ${warnings.join(' | ') || 'none'})`);
    }
    for (const [sheetName, columns] of Object.entries(expected.columns || {}) as [string, Record<string, [string, boolean]>][]) {
        const sheet = analysis.sheets.find(s => String(s.name) === sheetName || (sheetName === 'null' && s.name === null));
        if (!sheet) { problems.push(`sheet ${sheetName} not analyzed`); continue; }
        for (const [name, [type, required]] of Object.entries(columns)) {
            const column = sheet.columns.find(c => c.name === name);
            if (!column) problems.push(`column ${name} missing`);
            else if (column.type !== type || column.required !== required) problems.push(`column ${name} is ${column.type}/${column.required ? 'required' : 'optional'} (expected ${type}/${required ? 'required' : 'optional'})`);
        }
    }
    const suggested = analysis.sheets.flatMap(sheet => sheet.suggestedRules.map(rule => rule.name));
    for (const name of expected.suggestedRules || []) if (!suggested.includes(name)) problems.push(`rule "${name}" not suggested (got: ${suggested.join(', ') || 'none'})`);
    for (const name of expected.notSuggested || []) if (suggested.includes(name)) problems.push(`rule "${name}" unexpectedly suggested`);
    return problems;
}

async function main(): Promise<void> {
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    for (const entry of manifest.files) {
        if ((skipLarge && entry.file.startsWith('05-large/')) || (only && !entry.file.includes(only))) { skipped++; continue; }
        const filePath = path.join(SAMPLES, entry.file);
        if (!fs.existsSync(filePath)) { console.log(`SKIP  ${entry.file} (not generated)`); skipped++; continue; }
        const started = Date.now();
        let problems: string[];
        if (entry.kind === 'upload') {
            problems = compareUpload(entry.expected, await runUpload(entry, filePath));
        } else {
            problems = await runExample(entry, filePath);
        }
        const elapsed = `${((Date.now() - started) / 1000).toFixed(1)}s`;
        if (problems.length === 0) {
            passed++;
            console.log(`OK    ${entry.file} (${entry.expected.status || entry.expected.result}, ${elapsed})`);
        } else {
            failed++;
            console.log(`FAIL  ${entry.file} (${elapsed})\n      - ${problems.join('\n      - ')}`);
        }
    }
    console.log(`\n${passed} matched, ${failed} mismatched, ${skipped} skipped`);
    process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
