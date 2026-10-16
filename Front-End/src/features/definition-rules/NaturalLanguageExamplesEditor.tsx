import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

export interface NaturalLanguageExampleRow {
  table: string;
  values: Record<string, string>;
}

export interface NaturalLanguageExample {
  table: string;
  values: Record<string, string>;
  expectedValid: boolean;
  source: 'model' | 'admin';
  /** Rows seeded in other sheets so a cross-sheet query rule can find or miss matching data. */
  relatedRows?: NaturalLanguageExampleRow[];
}

interface ExampleResult {
  index: number;
  table: string;
  expectedValid: boolean;
  actualValid: boolean;
  passed: boolean;
  error: string | null;
}

interface Props {
  examples: NaturalLanguageExample[];
  tableOptions: string[];
  /** Query rules can read several sheets, so their examples can seed rows in the other sheets. */
  allowRelatedRows?: boolean;
  results: ExampleResult[] | null;
  running: boolean;
  onChange: (examples: NaturalLanguageExample[]) => void;
  onRun: () => void;
}

const isStringRecord = (value: unknown): value is Record<string, string> =>
  !!value && typeof value === 'object' && !Array.isArray(value) &&
  Object.values(value).every(item => typeof item === 'string');

function RelatedRowsEditor({
  example,
  index,
  onChange,
}: {
  example: NaturalLanguageExample;
  index: number;
  onChange: (rows: NaturalLanguageExampleRow[]) => void;
}) {
  const [draft, setDraft] = useState(() => JSON.stringify(example.relatedRows ?? [], null, 2));
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <textarea
        aria-label={`Example ${index + 1} related rows as JSON`}
        rows={3}
        value={draft}
        onChange={event => {
          setDraft(event.target.value);
          try {
            const parsed: unknown = JSON.parse(event.target.value);
            if (!Array.isArray(parsed) || parsed.some(row => !row || typeof row !== 'object' ||
              typeof (row as { table?: unknown }).table !== 'string' || !isStringRecord((row as { values?: unknown }).values))) {
              throw new Error('Related rows must be a JSON array of { "table": "Sheet", "values": { "Column": "text" } }.');
            }
            setError(null);
            onChange(parsed as NaturalLanguageExampleRow[]);
          } catch (parseError) {
            setError(parseError instanceof SyntaxError ? 'Enter valid JSON.' : (parseError as Error).message);
          }
        }}
        className="w-full min-w-56 rounded border border-slate-300 p-2 font-mono text-xs"
      />
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

function ExampleValuesEditor({
  example,
  onChange,
}: {
  example: NaturalLanguageExample;
  onChange: (values: Record<string, string>) => void;
}) {
  const [draft, setDraft] = useState(() => JSON.stringify(example.values, null, 2));
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <textarea
        aria-label="Example values as JSON"
        rows={3}
        value={draft}
        onChange={event => {
          setDraft(event.target.value);
          try {
            const parsed: unknown = JSON.parse(event.target.value);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
              Object.values(parsed).some(value => typeof value !== 'string')) {
              throw new Error('Values must be a JSON object with string values.');
            }
            setError(null);
            onChange(parsed as Record<string, string>);
          } catch (parseError) {
            setError(parseError instanceof SyntaxError ? 'Enter valid JSON string values.' : (parseError as Error).message);
          }
        }}
        className="w-full min-w-56 rounded border border-slate-300 p-2 font-mono text-xs"
      />
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

export default function NaturalLanguageExamplesEditor({
  examples,
  tableOptions,
  allowRelatedRows = false,
  results,
  running,
  onChange,
  onRun,
}: Props) {
  const update = (index: number, changes: Partial<NaturalLanguageExample>) =>
    onChange(examples.map((example, i) => i === index ? { ...example, ...changes } : example));

  return (
    <section className="space-y-3" aria-label="Natural Language examples">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-xs font-bold text-slate-700">Examples</h4>
          <p className="text-[11px] text-slate-500">
            Edit examples as string-valued JSON, then run them through the Python rule engine.
            {allowRelatedRows && ' For a rule that reads several sheets, add related rows to seed the other sheets (for example the matching customer).'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange([...examples, {
            table: tableOptions[0] || 'File',
            values: {},
            expectedValid: true,
            source: 'admin',
          }])}
          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
        >
          <Plus size={14} /> Add example
        </button>
      </div>

      {examples.length === 0 ? (
        <p className="rounded border border-dashed border-slate-300 p-3 text-xs text-slate-500">No examples are configured.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="p-2">Table</th>
                <th className="p-2">Expected</th>
                <th className="p-2">Values</th>
                {allowRelatedRows && <th className="p-2">Related rows (other sheets)</th>}
                <th className="p-2">Source</th>
                <th className="p-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {examples.map((example, index) => {
                const result = results?.find(item => item.index === index + 1);
                return (
                  <tr key={`${index}-${example.table}`}>
                    <td className="w-36 p-2 align-top">
                      {tableOptions.length > 0 ? (
                        <select
                          aria-label={`Example ${index + 1} table`}
                          value={example.table}
                          onChange={event => update(index, { table: event.target.value, source: 'admin' })}
                          className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                        >
                          {tableOptions.map(table => <option key={table} value={table}>{table}</option>)}
                        </select>
                      ) : (
                        <input
                          aria-label={`Example ${index + 1} table`}
                          value={example.table}
                          onChange={event => update(index, { table: event.target.value, source: 'admin' })}
                          className="w-full rounded border border-slate-300 px-2 py-1.5"
                        />
                      )}
                    </td>
                    <td className="w-28 p-2 align-top">
                      <select
                        aria-label={`Example ${index + 1} expected result`}
                        value={String(example.expectedValid)}
                        onChange={event => update(index, { expectedValid: event.target.value === 'true', source: 'admin' })}
                        className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                      >
                        <option value="true">Pass</option>
                        <option value="false">Fail</option>
                      </select>
                      {result && (
                        <p className={`mt-1 font-semibold ${result.passed ? 'text-emerald-700' : 'text-red-700'}`}>
                          {result.passed ? 'Passed' : 'Mismatch'} (actual: {result.actualValid ? 'pass' : 'fail'})
                        </p>
                      )}
                    </td>
                    <td className="min-w-64 p-2 align-top">
                      <ExampleValuesEditor
                        example={example}
                        onChange={values => update(index, { values, source: 'admin' })}
                      />
                    </td>
                    {allowRelatedRows && (
                      <td className="min-w-64 p-2 align-top">
                        <RelatedRowsEditor
                          example={example}
                          index={index}
                          onChange={relatedRows => update(index, { relatedRows, source: 'admin' })}
                        />
                      </td>
                    )}
                    <td className="p-2 align-top capitalize text-slate-500">{example.source}</td>
                    <td className="p-2 align-top">
                      <button
                        type="button"
                        aria-label={`Remove example ${index + 1}`}
                        onClick={() => onChange(examples.filter((_, i) => i !== index))}
                        className="rounded p-1 text-red-600 hover:bg-red-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {results && (
        <div role="status" className={`rounded p-2 text-xs ${results.every(result => result.passed) ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>
          {results.every(result => result.passed)
            ? `All ${results.length} examples matched their expected result.`
            : 'One or more examples did not match their expected result.'}
        </div>
      )}

      <button
        type="button"
        disabled={running || examples.length === 0}
        onClick={onRun}
        className="rounded bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running ? 'Running examples…' : 'Run examples'}
      </button>
    </section>
  );
}
