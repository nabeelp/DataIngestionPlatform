// =============================================================================
// Natural Language Rule Runtime - compile and sandbox model-generated rule code
// A natural-language rule's TypeScript defines `validateRow(row, rowNumber, sheet?)`. It is type-checked when the rule is
// authored, then transpiled and run in a QuickJS (WebAssembly) sandbox for every upload: the code has no access to
// Node.js, the file system, the network or environment variables, and is bounded by time and memory limits.
// =============================================================================

import ts from 'typescript';
import {
    newQuickJSWASMModuleFromVariant,
    type QuickJSContext,
    type QuickJSHandle,
    type QuickJSRuntime,
    type QuickJSSyncVariant,
    type QuickJSWASMModule,
} from 'quickjs-emscripten-core';
import releaseSyncVariant from '@jitl/quickjs-wasmfile-release-sync';
import { IssueCollector, displayValue, sameSheet, withSheet, type EvaluationResult, type RowEvaluator } from './ValidationEngine';

export class RuleCodeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RuleCodeError';
    }
}

export interface SandboxLimits {
    /** CPU budget for one rule across a whole upload. */
    timeLimitMs: number;
    memoryLimitBytes: number;
}

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = { timeLimitMs: 20_000, memoryLimitBytes: 64 * 1024 * 1024 };

export const MAX_RULE_CODE_LENGTH = 20_000;
const BATCH_SIZE = 500;
const MAX_STACK_BYTES = 1024 * 1024;
const MAX_MESSAGE_LENGTH = 500;

/** Types and function contracts provided to model-generated rule code. */
export const RULE_CODE_ENVIRONMENT = `type CellValue = string | number | boolean | null;
type Row = Readonly<Record<string, CellValue>>;
`;

// -----------------------------------------------------------------------------
// Compilation
// -----------------------------------------------------------------------------

const ENV_FILE = '/rule/env.d.ts';
const RULE_FILE = '/rule/rule.ts';
const CHECK_FILE = '/rule/check.ts';
const SIGNATURE_CHECK = `const __validateRowSignature: (row: Row, rowNumber: number, sheet?: string) => string | null = validateRow;
`;

const COMPILER_OPTIONS: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.None,
    lib: ['lib.es2020.d.ts'],
    types: [],
    strict: true,
    noEmitOnError: true,
    skipLibCheck: true,
    newLine: ts.NewLineKind.LineFeed,
};

// Standard library declarations are immutable, so they are parsed once per process.
const libFiles = new Map<string, ts.SourceFile>();
const transpiled = new Map<string, string>();
const MAX_TRANSPILE_CACHE = 200;

const formatDiagnostics = (diagnostics: readonly ts.Diagnostic[]): string =>
    diagnostics.slice(0, 5).map(diagnostic => {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
        if (!diagnostic.file || diagnostic.start === undefined) return message;
        const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
        const file = diagnostic.file.fileName === RULE_FILE ? 'rule.ts' : diagnostic.file.fileName.replace('/rule/', '');
        return `${file}(${line + 1},${character + 1}): ${message}`;
    }).join('; ');

const assertScript = (source: string): void => {
    if (!source.trim()) throw new RuleCodeError('The rule code is empty');
    if (source.length > MAX_RULE_CODE_LENGTH) throw new RuleCodeError(`The rule code exceeds ${MAX_RULE_CODE_LENGTH} characters`);
    const file = ts.createSourceFile(RULE_FILE, source, ts.ScriptTarget.ES2020, false, ts.ScriptKind.TS);
    if (ts.isExternalModule(file)) throw new RuleCodeError('The rule code must not use import or export');
};

/**
 * Type-check rule code against the row contract and, when present, the whole-file validator contract.
 * Throws a RuleCodeError describing the first problems.
 */
export function typeCheckRuleCode(source: string): void {
    assertScript(source);
    const ruleFile = ts.createSourceFile(RULE_FILE, source, ts.ScriptTarget.ES2020, true);
    const declaresFileValidator = ruleFile.statements.some(statement =>
        (ts.isFunctionDeclaration(statement) && statement.name?.text === 'validateFile') ||
        (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration =>
            ts.isIdentifier(declaration.name) && declaration.name.text === 'validateFile')));
    const checkFile = SIGNATURE_CHECK + (declaresFileValidator
        ? 'const __validateFileSignature: () => string | null = validateFile;\n'
        : '');
    const virtualFiles = new Map([[ENV_FILE, RULE_CODE_ENVIRONMENT], [RULE_FILE, source], [CHECK_FILE, checkFile]]);
    const host = ts.createCompilerHost(COMPILER_OPTIONS, true);
    const readLibFile = host.getSourceFile.bind(host);
    const fileExists = host.fileExists.bind(host);
    const readFile = host.readFile.bind(host);

    host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
        const text = virtualFiles.get(fileName);
        if (text !== undefined) return ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2020, true);
        const cached = libFiles.get(fileName);
        if (cached) return cached;
        const file = readLibFile(fileName, languageVersion, onError, shouldCreate);
        if (file) libFiles.set(fileName, file);
        return file;
    };
    host.fileExists = fileName => virtualFiles.has(fileName) || fileExists(fileName);
    host.readFile = fileName => virtualFiles.get(fileName) ?? readFile(fileName);
    host.writeFile = () => undefined;

    const program = ts.createProgram([ENV_FILE, RULE_FILE, CHECK_FILE], COMPILER_OPTIONS, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.length > 0) throw new RuleCodeError(`The rule code does not compile: ${formatDiagnostics(diagnostics)}`);
}

/**
 * Transpile rule TypeScript to the JavaScript the sandbox runs (syntax errors only; type-checking happens at authoring).
 */
export function transpileRuleCode(source: string): string {
    const cached = transpiled.get(source);
    if (cached !== undefined) return cached;
    assertScript(source);
    const output = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None, removeComments: true },
        reportDiagnostics: true,
        fileName: 'rule.ts',
    });
    if (output.diagnostics?.length) throw new RuleCodeError(`The rule code does not compile: ${formatDiagnostics(output.diagnostics)}`);
    if (transpiled.size >= MAX_TRANSPILE_CACHE) transpiled.clear();
    transpiled.set(source, output.outputText);
    return output.outputText;
}

// -----------------------------------------------------------------------------
// Sandbox
// -----------------------------------------------------------------------------

let quickJs: Promise<QuickJSWASMModule> | null = null;

// The variant's own loader uses a dynamic import(); loading its CommonJS build works in Node.js and under Jest.
const sandboxVariant: QuickJSSyncVariant = {
    ...(releaseSyncVariant as QuickJSSyncVariant),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    importModuleLoader: () => Promise.resolve(require('@jitl/quickjs-wasmfile-release-sync/emscripten-module')),
};

/** Load the QuickJS WebAssembly module (once per process). */
export function loadRuleSandbox(): Promise<QuickJSWASMModule> {
    quickJs ??= newQuickJSWASMModuleFromVariant(sandboxVariant).catch(error => {
        quickJs = null;
        throw error;
    });
    return quickJs;
}

// Runs before the rule code, so the rule cannot replace the helpers the engine relies on.
const PRELUDE = `(function () {
  const parse = JSON.parse, stringify = JSON.stringify, freeze = Object.freeze, InternalError = globalThis.InternalError;
  const describe = e => (e && typeof e.message === 'string' ? e.message : String(e));
  Object.defineProperty(globalThis, '__runBatch', { value: function (json) {
    if (typeof validateRow !== 'function') return stringify({ error: 'The rule code does not define a validateRow function' });
    const batch = parse(json);
    const failures = [];
    for (let i = 0; i < batch.length; i++) {
      let result;
      try { result = validateRow(freeze(batch[i][1]), batch[i][0], batch[i][2]); }
      catch (e) {
        if (e instanceof InternalError && (e.message === 'out of memory' || e.message === 'interrupted')) throw e;
        return stringify({ error: 'validateRow threw on row ' + batch[i][0] + ': ' + describe(e) });
      }
      if (result === null || result === undefined) continue;
      if (typeof result !== 'string') return stringify({ error: 'validateRow must return a string or null (row ' + batch[i][0] + ')' });
      failures.push([i, result]);
    }
    return stringify({ failures: failures });
  } });
  Object.defineProperty(globalThis, '__finishRule', { value: function () {
    if (typeof validateFile !== 'function') return stringify({ failure: null });
    let result;
    try { result = validateFile(); }
    catch (e) {
      if (e instanceof InternalError && (e.message === 'out of memory' || e.message === 'interrupted')) throw e;
      return stringify({ error: 'validateFile threw: ' + describe(e) });
    }
    if (result === null || result === undefined) return stringify({ failure: null });
    if (typeof result !== 'string') return stringify({ error: 'validateFile must return a string or null' });
    return stringify({ failure: result });
  } });
})();`;

type CellValue = string | number | boolean | null;

const toCell = (value: unknown): CellValue => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    return String(value);
};

interface PendingRow {
    rowNumber: number;
    values: Record<string, CellValue>;
    sheet?: string;
    ruleSheet?: string;
}

export interface SandboxedRowEvaluator extends RowEvaluator {
    /** Release the sandbox. Safe to call more than once; result() also releases it. */
    dispose(): void;
}

/**
 * Evaluator for a natural-language rule. Rows are passed to `validateRow` in file order, in batches, within one
 * sandbox, so the code may keep state across rows (for example to detect duplicates). Any configuration problem,
 * runtime error, or exceeded limit fails the rule with a descriptive issue.
 */
export function createNaturalLanguageRuleEvaluator(
    quickjs: QuickJSWASMModule,
    source: string,
    columns: string[],
    limits: SandboxLimits = DEFAULT_SANDBOX_LIMITS,
    columnsBySheet?: Record<string, string[]>,
): SandboxedRowEvaluator {
    const issues = new IssueCollector();
    let runtime: QuickJSRuntime | null = null;
    let context: QuickJSContext | null = null;
    let runBatch: QuickJSHandle | null = null;
    let deadline = 0;
    let usedMs = 0;
    let stopped = false;
    let columnsPresent = true;
    let pending: PendingRow[] = [];
    let lastRow: PendingRow | null = null;
    let finalResult: EvaluationResult | null = null;

    const dispose = () => {
        try {
            runBatch?.dispose();
            context?.dispose();
            runtime?.dispose();
        } catch {
            // A leaked handle must not hide the rule's outcome.
        }
        runBatch = null;
        context = null;
        runtime = null;
    };

    const stop = (error: string) => {
        issues.add({ error });
        stopped = true;
        pending = [];
        dispose();
    };

    const sandboxMessage = (vm: QuickJSContext, handle: QuickJSHandle): string => {
        const error = vm.dump(handle) as { message?: unknown } | unknown;
        handle.dispose();
        const message = typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : String(error);
        if (message === 'interrupted') return `Rule exceeded its time limit of ${Math.round(limits.timeLimitMs / 1000)} seconds`;
        if (message === 'out of memory') return `Rule exceeded its memory limit of ${Math.round(limits.memoryLimitBytes / 1048576)} MB`;
        return `Rule execution error: ${message}`;
    };

    const evaluate = (vm: QuickJSContext, code: string): string | null => {
        const result = vm.evalCode(code, 'rule.js');
        if (result.error) return sandboxMessage(vm, result.error);
        result.value.dispose();
        return null;
    };

    try {
        const javascript = transpileRuleCode(source);
        const start = Date.now();
        deadline = start + limits.timeLimitMs;
        runtime = quickjs.newRuntime();
        runtime.setMemoryLimit(limits.memoryLimitBytes);
        runtime.setMaxStackSize(MAX_STACK_BYTES);
        runtime.setInterruptHandler(() => Date.now() > deadline);
        context = runtime.newContext();
        const failure = evaluate(context, PRELUDE) ?? evaluate(context, javascript);
        usedMs += Date.now() - start;
        if (failure) {
            stop(failure.startsWith('Rule exceeded') ? failure : `Rule configuration error: ${failure.replace('Rule execution error: ', '')}`);
        } else {
            runBatch = context.getProp(context.global, '__runBatch');
        }
    } catch (error) {
        stop(`Rule configuration error: ${error instanceof Error ? error.message : 'Invalid rule code'}`);
    }

    const flush = () => {
        if (stopped || pending.length === 0 || !context || !runBatch) return;
        const rows = pending;
        pending = [];
        const start = Date.now();
        deadline = start + Math.max(limits.timeLimitMs - usedMs, 0);
        const argument = context.newString(JSON.stringify(rows.map(row => [row.rowNumber, row.values, row.ruleSheet ?? row.sheet ?? ''])));
        const result = context.callFunction(runBatch, context.undefined, argument);
        argument.dispose();
        usedMs += Date.now() - start;
        if (result.error) {
            stop(sandboxMessage(context, result.error));
            return;
        }
        const text = context.getString(result.value);
        result.value.dispose();

        let output: { error?: unknown; failures?: unknown };
        try {
            output = JSON.parse(text);
        } catch {
            stop('Rule execution error: the sandbox returned an invalid result');
            return;
        }
        if (typeof output.error === 'string') {
            stop(`Rule execution error: ${output.error.slice(0, MAX_MESSAGE_LENGTH)}`);
            return;
        }
        for (const failure of Array.isArray(output.failures) ? output.failures : []) {
            const row = Array.isArray(failure) && typeof failure[0] === 'number' ? rows[failure[0]] : undefined;
            if (!row) continue;
            const message = String(failure[1]).slice(0, MAX_MESSAGE_LENGTH).trim() || 'Row does not satisfy the rule';
            const value = columns.length === 1 ? displayValue(row.values[columns[0]]) : displayValue(JSON.stringify(row.values));
            issues.add(withSheet({ row: row.rowNumber, column: columns.length === 1 ? columns[0] : undefined, value, error: message }, row.sheet));
        }
    };

    const finish = () => {
        if (stopped || !context) return;
        const start = Date.now();
        deadline = start + Math.max(limits.timeLimitMs - usedMs, 0);
        const finishRule = context.getProp(context.global, '__finishRule');
        const result = context.callFunction(finishRule, context.undefined);
        finishRule.dispose();
        usedMs += Date.now() - start;
        if (result.error) {
            stop(sandboxMessage(context, result.error));
            return;
        }
        const text = context.getString(result.value);
        result.value.dispose();
        try {
            const output = JSON.parse(text) as { error?: unknown; failure?: unknown };
            if (typeof output.error === 'string') {
                stop(`Rule execution error: ${output.error.slice(0, MAX_MESSAGE_LENGTH)}`);
            } else if (typeof output.failure === 'string' && output.failure.trim()) {
                const issue = { error: output.failure.slice(0, MAX_MESSAGE_LENGTH).trim() };
                issues.add(lastRow ? withSheet({ ...issue, row: lastRow.rowNumber }, lastRow.sheet) : issue);
            }
        } catch {
            stop('Rule execution error: the sandbox returned an invalid final result');
        }
    };

    return {
        onHeaders(headers, sheet) {
            if (stopped) return;
            flush();
            const selection = columnsBySheet
                ? Object.entries(columnsBySheet).find(([name]) => sheet !== undefined && sameSheet(name, sheet))
                : undefined;
            const selected = columnsBySheet ? selection?.[1] : columns;
            if (!selected) return;
            const headerSet = new Set(headers);
            const missing = selected.filter(column => !headerSet.has(column));
            for (const column of missing) {
                issues.add(withSheet({ column, value: null, error: `Column "${column}" not found` }, sheet));
            }
            columnsPresent = missing.length === 0;
        },
        onRow(row, rowNumber, sheet) {
            if (stopped || !columnsPresent) return;
            const selection = columnsBySheet
                ? Object.entries(columnsBySheet).find(([name]) => sheet !== undefined && sameSheet(name, sheet))
                : undefined;
            const selected = columnsBySheet ? selection?.[1] : columns;
            if (!selected) return;
            const values: Record<string, CellValue> = {};
            for (const column of selected) values[column] = toCell(row[column]);
            const accepted = { rowNumber, values, sheet, ruleSheet: selection?.[0] };
            lastRow = accepted;
            pending.push(accepted);
            if (pending.length >= BATCH_SIZE) flush();
        },
        result() {
            if (!finalResult) {
                flush();
                finish();
                dispose();
                finalResult = issues.result();
            }
            return finalResult;
        },
        dispose,
    };
}

export interface RuleExample {
    values: Record<string, string | null>;
    expectedValid: boolean;
    sheet?: string;
}

/**
 * Run rule code against its examples (in order, as one file). Returns a description of the first mismatch, or null.
 */
export function findExampleMismatch(
    quickjs: QuickJSWASMModule,
    source: string,
    columns: string[],
    examples: RuleExample[],
    limits: SandboxLimits = { ...DEFAULT_SANDBOX_LIMITS, timeLimitMs: 5_000 },
    columnsBySheet?: Record<string, string[]>,
): string | null {
    const evaluator = createNaturalLanguageRuleEvaluator(quickjs, source, columns, limits, columnsBySheet);
    examples.forEach((example, index) => {
        const sheet = example.sheet || undefined;
        const headers = columnsBySheet
            ? Object.entries(columnsBySheet).find(([name]) => sheet !== undefined && sameSheet(name, sheet))?.[1] ?? []
            : columns;
        evaluator.onHeaders(headers, sheet);
        evaluator.onRow(example.values, index + 1, sheet);
    });
    const result = evaluator.result();

    const general = result.errors.find(issue => issue.row === undefined);
    if (general) return general.error;
    const failures = new Map(result.errors.map(issue => [issue.row, issue.error]));
    for (const [index, example] of examples.entries()) {
        const message = failures.get(index + 1);
        if ((message === undefined) !== example.expectedValid) {
            return `Example ${index + 1} ${JSON.stringify(example.values)} was expected to ${example.expectedValid ? 'pass' : 'fail'}, but it ${message === undefined ? 'passed' : `failed ("${message}")`}`;
        }
    }
    return null;
}
