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

const ROOT = path.resolve(__dirname, '..', '..');
const SAMPLES = path.join(ROOT, 'samples');
const OUTPUT = path.join(ROOT, 'Validation-Service', 'tests', 'golden', 'node-baseline');
const ALLOWED_UPLOAD_EXTENSIONS = new Set(['.csv', '.tsv', '.txt', '.xlsx', '.xls']);
const EXCEL_TYPES = new Set(['xls', 'xlsx']);

interface Definition {
    name: string;
    columns: { name: string; type: string; required: boolean }[];
    tables: { sheet: string; columns: { name: string; type: string; required: boolean }[] }[];
    rules: { name: string; ruleType: string; expression: string; severity: string; table: string | null }[];
}

interface ManifestEntry {
    file: string;
    kind: 'upload' | 'example';
    definition?: string;
}

interface Check {
    name: string;
    severity: string;
    evaluator: RowEvaluator;
}

const definitions: Record<string, Definition> = JSON.parse(
    fs.readFileSync(path.join(SAMPLES, 'definitions', 'sample_definitions.json'), 'utf8'),
);
const manifest: { uploadLimitBytes: number; files: ManifestEntry[] } = JSON.parse(
    fs.readFileSync(path.join(SAMPLES, 'manifest.json'), 'utf8'),
);

const contracts = new Map<string, ContractSnapshot>();
for (const [key, definition] of Object.entries(definitions)) {
    const rules = definition.rules.map((rule, index) => ({
        Id: `${key}-${index + 1}`,
        Name: rule.name,
        RuleType: rule.ruleType,
        Severity: rule.severity,
        ExecutionOrder: index + 1,
        SqlQuery: rule.expression,
        TableName: rule.table,
    }));
    const contract = buildContractSnapshot(definition.columns, rules, definition.tables);
    assertPublishable(contract);
    contracts.set(key, contract);
}

function checkResults(checks: Check[]) {
    return checks.map(({ name, severity, evaluator }) => {
        const result = evaluator.result();
        return {
            name,
            severity,
            status: result.passed ? 'PASSED' : severity === 'Warning' ? 'WARNING' : 'FAILED',
            errorCount: result.errorCount,
            issues: result.errors.slice(0, 100),
        };
    });
}

async function capture(entry: ManifestEntry): Promise<Record<string, unknown>> {
    if (!entry.definition) throw new Error(`Upload fixture has no definition: ${entry.file}`);
    const contract = contracts.get(entry.definition);
    if (!contract) throw new Error(`Unknown sample definition: ${entry.definition}`);
    const filePath = path.join(SAMPLES, entry.file);
    if (!fs.existsSync(filePath)) throw new Error(`Sample fixture is missing: ${entry.file}`);

    const extension = path.extname(filePath).toLowerCase();
    const fileType = extension.slice(1);
    const fileSize = fs.statSync(filePath).size;
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(extension)) {
        return { file: entry.file, definition: entry.definition, outcome: 'UPLOAD_REJECTED', reason: 'unsupported_extension', checks: [] };
    }
    if (fileSize > manifest.uploadLimitBytes) {
        return { file: entry.file, definition: entry.definition, outcome: 'UPLOAD_REJECTED', reason: 'file_size_limit', checks: [] };
    }
    if (contract.tables.length > 0 && !EXCEL_TYPES.has(fileType)) {
        return { file: entry.file, definition: entry.definition, outcome: 'UPLOAD_REJECTED', reason: 'sheet_tables_require_workbook', checks: [] };
    }

    const checks: Check[] = [];
    for (const table of validationTables(contract)) {
        const evaluator = createDefinitionSchemaEvaluator(table.columns);
        checks.push({
            name: schemaCheckName(table.sheet),
            severity: 'Error',
            evaluator: table.sheet === null ? evaluator : scopeToSheet(evaluator, table.sheet, { reportMissing: true }),
        });
    }
    for (const rule of contract.rules) {
        const evaluator = createRuleEvaluator(rule.RuleType, rule.SqlQuery);
        checks.push({
            name: rule.Name,
            severity: rule.Severity,
            evaluator: rule.Table ? scopeToSheet(evaluator, rule.Table, { reportMissing: false }) : evaluator,
        });
    }

    try {
        const summary = await readRecords(filePath, fileType, {
            onHeaders: (headers, sheet) => checks.forEach(check => check.evaluator.onHeaders(headers, sheet)),
            onRow: (row, rowNumber, sheet) => checks.forEach(check => check.evaluator.onRow(row, rowNumber, sheet)),
        });
        const results = checkResults(checks);
        const failed = results.some(result => result.status === 'FAILED');
        const warnings = results.some(result => result.status === 'WARNING');
        return {
            file: entry.file,
            definition: entry.definition,
            outcome: 'VALIDATED',
            uploadStatus: failed ? 'FAILED' : warnings ? 'WARNING' : 'PASSED',
            rowCount: summary.rowCount,
            checks: results,
        };
    } catch {
        return {
            file: entry.file,
            definition: entry.definition,
            outcome: 'READ_ERROR',
            checks: [],
        };
    }
}

async function main(): Promise<void> {
    const entries = manifest.files.filter(entry => entry.kind === 'upload');
    let rejected = 0;
    for (const entry of entries) {
        const result = await capture(entry);
        if (result.outcome === 'UPLOAD_REJECTED') rejected++;
        const destination = path.join(OUTPUT, `${entry.file}.json`);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
        console.log(`${String(result.outcome).padEnd(15)} ${entry.file}`);
    }
    console.log(`Captured ${entries.length} upload fixtures; ${rejected} were rejected before validation.`);
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Node baseline capture failed');
    process.exitCode = 1;
});
