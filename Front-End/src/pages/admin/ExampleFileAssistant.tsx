import { useRef, useState } from 'react';
import { AlertTriangle, FileSpreadsheet, Loader2, Wand2 } from 'lucide-react';
import { analyzeExampleFile, type ExampleAnalysis, type ExampleSheet } from '../../services/adminApi';
import {
  defaultSheetIndex,
  populatedSheetIndexes,
  proposalFromSheet,
  proposalFromSheets,
  proposesSheetTables,
  suggestionKey,
  type ExampleProposal,
} from './exampleProposal';

interface Props {
  /** Rule suggestions are only offered when creating a definition, so they publish with version 1. */
  allowRules: boolean;
  onApply: (proposal: ExampleProposal) => void;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

const sheetSummary = (sheet: ExampleSheet) =>
  sheet.columns.length === 0 ? 'empty' : `${plural(sheet.columns.length, 'column')}, ${plural(sheet.rowsAnalyzed, 'row')}`;

/**
 * Upload an example CSV/XLSX file, review the proposed columns and candidate rules, and apply them to the
 * definition form. A workbook with several populated sheets becomes one table per sheet. Nothing is saved
 * until the form is submitted.
 */
export default function ExampleFileAssistant({ allowRules, onApply }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ExampleAnalysis | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [includedSheets, setIncludedSheets] = useState<Set<number>>(new Set());
  const [selectedRules, setSelectedRules] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState<string | null>(null);

  const reset = () => {
    setAnalysis(null);
    setApplied(null);
    setError(null);
    setSelectedRules(new Set());
    setIncludedSheets(new Set());
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setAnalysis(null);
    setApplied(null);
    setError(null);
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      setError('Choose a CSV (.csv) or Excel workbook (.xlsx) example.');
      return;
    }
    setAnalyzing(true);
    try {
      const result = await analyzeExampleFile(file);
      setAnalysis(result);
      setPreviewIndex(defaultSheetIndex(result));
      setIncludedSheets(new Set(populatedSheetIndexes(result)));
      setSelectedRules(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze the example file');
    } finally {
      setAnalyzing(false);
    }
  };

  const sheetTables = analysis ? proposesSheetTables(analysis) : false;
  const sheet = analysis?.sheets[previewIndex];
  const rulesSelectable = allowRules && (!sheetTables || includedSheets.has(previewIndex));

  const toggle = <T,>(setter: (update: (prev: Set<T>) => Set<T>) => void, value: T) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const apply = () => {
    if (!analysis || !sheet) return;
    const rules = allowRules ? selectedRules : new Set<string>();
    const proposal = sheetTables
      ? proposalFromSheets(analysis, [...includedSheets].sort((a, b) => a - b), rules)
      : proposalFromSheet(analysis, previewIndex, rules);
    onApply(proposal);
    setApplied(proposal.source);
  };

  if (applied) {
    return (
      <section aria-label="Start from an example file" className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md text-sm text-green-900 flex flex-wrap items-center justify-between gap-2">
        <span>{sheetTables ? 'Sheet tables' : 'Columns'} from <strong>{applied}</strong> were applied. Review them below before saving.</span>
        <button type="button" onClick={reset} className="text-green-800 underline hover:text-green-950">
          Use another example
        </button>
      </section>
    );
  }

  return (
    <section aria-label="Start from an example file" className="mb-4 p-3 border border-dashed border-blue-300 bg-blue-50/40 rounded-md">
      <div className="flex items-start gap-2 mb-2">
        <Wand2 size={18} className="text-blue-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-gray-800">Start from an example file (optional)</p>
          <p className="text-xs text-gray-600">
            Upload a CSV or XLSX example to propose columns from its header row and data. A workbook with several sheets
            becomes one table per sheet. You review everything before saving; the example is not stored.
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        aria-label="Example file"
        accept=".csv,.xlsx"
        disabled={analyzing}
        onChange={(e) => handleFile(e.target.files?.[0])}
        className="w-full text-sm file:mr-4 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-100 file:text-blue-700 hover:file:bg-blue-200"
      />

      {analyzing && (
        <p className="mt-2 text-sm text-gray-600 flex items-center gap-2">
          <Loader2 size={16} className="animate-spin" /> Analyzing example...
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}

      {analysis && sheet && (
        <div className="mt-3 space-y-3">
          {sheetTables && (
            <fieldset>
              <legend className="text-xs font-medium text-gray-700 mb-1">Sheets to include (one table each)</legend>
              {analysis.sheets.map((s, index) => (
                <label key={`${s.name}-${index}`} className={`flex items-center gap-2 text-xs mb-1 ${s.columns.length === 0 ? 'text-gray-400' : 'text-gray-700'}`}>
                  <input
                    type="checkbox"
                    checked={includedSheets.has(index)}
                    disabled={s.columns.length === 0}
                    onChange={() => toggle(setIncludedSheets, index)}
                    className="rounded border-gray-300"
                  />
                  <span><span className="font-medium">{s.name}</span> — {sheetSummary(s)}</span>
                </label>
              ))}
              <p className="mt-1 text-xs text-gray-500">
                Uploaded workbooks must contain every included sheet (matched by name, ignoring case). Other sheets are not validated.
              </p>
            </fieldset>
          )}

          {analysis.fileType === 'xlsx' ? (
            <div>
              <label htmlFor="example-sheet" className="block text-xs font-medium text-gray-700 mb-1">
                {sheetTables ? 'Preview sheet' : 'Sheet'}
              </label>
              <select
                id="example-sheet"
                value={previewIndex}
                onChange={(e) => {
                  setPreviewIndex(Number(e.target.value));
                  if (!sheetTables) setSelectedRules(new Set());
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white"
              >
                {analysis.sheets.map((s, index) => (
                  <option key={`${s.name}-${index}`} value={index} disabled={s.columns.length === 0}>
                    {s.name} — {sheetSummary(s)}
                  </option>
                ))}
              </select>
              {!sheetTables && (
                <p className="mt-1 text-xs text-gray-500">
                  These columns will apply to every sheet of an uploaded workbook. Switch to one table per sheet in the editor to validate sheets separately.
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-600 flex items-center gap-1">
              <FileSpreadsheet size={14} /> CSV file — a single table (CSV files have no sheets).
            </p>
          )}

          <p className="text-xs text-gray-600">
            Header row {sheet.headerRow ?? '-'} · {plural(sheet.rowsAnalyzed, 'data row')} analyzed
            {sheet.truncated ? ' (first rows only)' : ''}
          </p>

          {[...analysis.warnings, ...sheet.warnings].length > 0 && (
            <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2 space-y-1">
              {[...analysis.warnings, ...sheet.warnings].map(warning => (
                <li key={warning} className="flex gap-1"><AlertTriangle size={14} className="shrink-0 mt-px" />{warning}</li>
              ))}
            </ul>
          )}

          {sheet.columns.length > 0 && (
            <div className="overflow-x-auto border border-gray-200 rounded-md bg-white">
              <table className="min-w-full text-xs" aria-label="Proposed columns">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Column</th>
                    <th className="px-2 py-1.5 text-left font-medium">Type</th>
                    <th className="px-2 py-1.5 text-left font-medium">Required</th>
                    <th className="px-2 py-1.5 text-left font-medium">Filled</th>
                    <th className="px-2 py-1.5 text-left font-medium">Examples</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sheet.columns.map(column => (
                    <tr key={column.name}>
                      <td className="px-2 py-1.5 font-medium text-gray-900">{column.name}</td>
                      <td className="px-2 py-1.5">{column.type}</td>
                      <td className="px-2 py-1.5">{column.required ? 'Yes' : 'No'}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{column.filledRows}/{sheet.rowsAnalyzed}</td>
                      <td className="px-2 py-1.5 text-gray-500 truncate max-w-[12rem]" title={column.sampleValues.join(', ')}>
                        {column.sampleValues.join(', ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {sheet.suggestedRules.length > 0 && (
            allowRules ? (
              <fieldset>
                <legend className="text-xs font-medium text-gray-700 mb-1">
                  Suggested rules{sheetTables ? ` for sheet "${sheet.name}"` : ''} (published with version 1 if selected)
                </legend>
                {sheet.suggestedRules.map(rule => {
                  const key = suggestionKey(sheet.name, rule.name);
                  return (
                    <label key={key} className={`flex items-start gap-2 text-xs mb-1 ${rulesSelectable ? 'text-gray-700' : 'text-gray-400'}`}>
                      <input
                        type="checkbox"
                        checked={rulesSelectable && selectedRules.has(key)}
                        disabled={!rulesSelectable}
                        onChange={() => toggle(setSelectedRules, key)}
                        className="mt-0.5 rounded border-gray-300"
                      />
                      <span>
                        <span className="font-medium">{rule.ruleType}</span> <code className="bg-gray-100 px-1 rounded">{rule.expression}</code>
                        <span className="block text-gray-500">{rule.reason}. Only values seen in the example would be allowed.</span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ) : (
              <p className="text-xs text-gray-500">
                {sheet.suggestedRules.length} rule suggestion{sheet.suggestedRules.length === 1 ? ' is' : 's are'} available when creating a definition; add rules to an
                existing definition from the Rules page.
              </p>
            )
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={reset} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">
              Discard
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={sheetTables ? includedSheets.size === 0 : sheet.columns.length === 0}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {sheetTables ? `Use ${plural(includedSheets.size, 'sheet table')}` : 'Use these columns'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
