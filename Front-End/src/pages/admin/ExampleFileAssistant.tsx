import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, FileSpreadsheet, Loader2, Wand2 } from 'lucide-react';
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
  onProposalChange: (proposal: ExampleProposal | null) => void;
  embedded?: boolean;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

const sheetSummary = (sheet: ExampleSheet) =>
  sheet.columns.length === 0 ? 'empty' : `${plural(sheet.columns.length, 'column')}, ${plural(sheet.rowsAnalyzed, 'row')}`;

/**
 * Upload an example CSV/XLSX file, review the proposed columns and candidate rules, and apply them to the
 * definition form. A workbook with several populated sheets becomes one table per sheet. Nothing is saved
 * until the form is submitted.
 */
export default function ExampleFileAssistant({ allowRules, onProposalChange, embedded = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ExampleAnalysis | null>(null);
  const [includedSheets, setIncludedSheets] = useState<Set<number>>(new Set());
  const [selectedRules, setSelectedRules] = useState<Set<string>>(new Set());

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setAnalysis(null);
    setError(null);
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      setError('Choose a CSV (.csv) or Excel workbook (.xlsx) example.');
      return;
    }
    setAnalyzing(true);
    try {
      const result = await analyzeExampleFile(file);
      setAnalysis(result);
      setIncludedSheets(new Set(populatedSheetIndexes(result)));
      setSelectedRules(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze the example file');
    } finally {
      setAnalyzing(false);
    }
  };

  const sheetTables = analysis ? proposesSheetTables(analysis) : false;

  const toggle = <T,>(setter: (update: (prev: Set<T>) => Set<T>) => void, value: T) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const setSheetRules = (target: ExampleSheet, selected: boolean) => {
    setSelectedRules(prev => {
      const next = new Set(prev);
      for (const rule of target.suggestedRules) {
        const key = suggestionKey(target.name, rule.name);
        if (selected) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  };

  const updateColumn = (
    sheetIndex: number,
    columnIndex: number,
    changes: Partial<Pick<ExampleSheet['columns'][number], 'type' | 'required'>>,
  ) => {
    setAnalysis(current => {
      if (!current) return current;
      return {
        ...current,
        sheets: current.sheets.map((sheet, currentSheetIndex) => currentSheetIndex === sheetIndex
          ? {
              ...sheet,
              columns: sheet.columns.map((column, currentColumnIndex) => currentColumnIndex === columnIndex
                ? { ...column, ...changes }
                : column),
            }
          : sheet),
      };
    });
  };

  const proposal = useMemo(() => {
    if (!analysis) return null;
    if (sheetTables && includedSheets.size === 0) return null;
    if (!sheetTables && analysis.sheets[defaultSheetIndex(analysis)]?.columns.length === 0) return null;
    const rules = allowRules ? selectedRules : new Set<string>();
    return sheetTables
      ? proposalFromSheets(analysis, [...includedSheets].sort((a, b) => a - b), rules)
      : proposalFromSheet(analysis, defaultSheetIndex(analysis), rules);
  }, [allowRules, analysis, includedSheets, selectedRules, sheetTables]);

  useEffect(() => {
    onProposalChange(proposal);
  }, [onProposalChange, proposal]);

  return (
    <section aria-label="Start from an example file" className={embedded ? 'mt-4 border-t border-blue-200 pt-4' : 'mb-4 p-3 border border-dashed border-blue-300 bg-blue-50/40 rounded-md'}>
      {!embedded && (
        <div className="flex items-start gap-2 mb-2">
          <Wand2 size={18} className="text-blue-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-gray-800">Start from an example file (optional)</p>
            <p className="text-xs text-gray-600">
              Upload a CSV or XLSX example to propose columns from its header row and data, plus candidate rules (allowed values
              for repeating categories and ranges for numeric columns). A workbook with several sheets becomes one table per
              sheet. You review everything before saving; the example is not stored.
            </p>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        aria-label="Example file"
        accept=".csv,.xlsx"
        disabled={analyzing}
        onClick={(event) => {
          event.currentTarget.value = '';
        }}
        onChange={(e) => handleFile(e.target.files?.[0])}
        className="w-full text-sm file:mr-4 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-100 file:text-blue-700 hover:file:bg-blue-200"
      />

      {analyzing && (
        <p className="mt-2 text-sm text-gray-600 flex items-center gap-2">
          <Loader2 size={16} className="animate-spin" /> Analyzing example...
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}

      {analysis && (
        <div className="mt-3 space-y-3">
          {analysis.fileType === 'csv' && (
            <p className="text-xs text-gray-600 flex items-center gap-1">
              <FileSpreadsheet size={14} /> CSV file — a single table (CSV files have no sheets).
            </p>
          )}

          {analysis.warnings.length > 0 && (
            <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2 space-y-1">
              {analysis.warnings.map(warning => (
                <li key={warning} className="flex gap-1"><AlertTriangle size={14} className="shrink-0 mt-px" />{warning}</li>
              ))}
            </ul>
          )}

          <div className="space-y-3" aria-label={sheetTables ? 'Sheets to include' : 'Detected table'}>
            {analysis.sheets.map((sheet, index) => {
              const included = !sheetTables || includedSheets.has(index);
              const rulesSelectable = allowRules && included;
              const label = sheet.name ?? 'CSV table';
              return (
                <section
                  key={`${label}-${index}`}
                  aria-label={`Detected table ${label}`}
                  className={`rounded-md border transition-colors ${
                    included ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-100 text-gray-400'
                  }`}
                >
                  <div className="flex items-center gap-3 p-3">
                    {sheetTables && (
                      <input
                        type="checkbox"
                        aria-label={`Include sheet ${label}`}
                        checked={included}
                        disabled={sheet.columns.length === 0}
                        onChange={() => toggle(setIncludedSheets, index)}
                        className="rounded border-gray-300"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className={`text-sm font-semibold ${included ? 'text-gray-900' : 'text-gray-500'}`}>{label}</h3>
                      <p className="text-xs">{sheetSummary(sheet)} · Header row {sheet.headerRow ?? '-'}</p>
                    </div>
                    {included ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
                  </div>

                  {included && (
                    <div className="space-y-3 border-t border-gray-200 p-3">
                      <p className="text-xs text-gray-600">
                        {plural(sheet.rowsAnalyzed, 'data row')} analyzed{sheet.truncated ? ' (first rows only)' : ''}
                      </p>
                      {sheet.warnings.length > 0 && (
                        <ul className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                          {sheet.warnings.map(warning => (
                            <li key={warning} className="flex gap-1"><AlertTriangle size={14} className="mt-px shrink-0" />{warning}</li>
                          ))}
                        </ul>
                      )}
                      {sheet.columns.length > 0 && (
                        <div className="overflow-x-auto rounded-md border border-gray-200">
                          <table className="min-w-full text-xs" aria-label={`Proposed columns for ${label}`}>
                            <thead className="bg-gray-50 text-gray-500">
                              <tr>
                                <th className="px-2 py-1.5 text-left font-medium">Column</th>
                                <th className="w-24 px-2 py-1.5 text-left font-medium">Type</th>
                                <th className="px-2 py-1.5 text-left font-medium">Required</th>
                                <th className="px-2 py-1.5 text-left font-medium">Filled</th>
                                <th className="px-2 py-1.5 text-left font-medium">Examples</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {sheet.columns.map((column, columnIndex) => (
                                <tr key={column.name}>
                                  <td className="px-2 py-1.5 font-medium text-gray-900">{column.name}</td>
                                  <td className="w-24 px-2 py-1.5">
                                    <select
                                      aria-label={`Type for ${column.name} in ${label}`}
                                      value={column.type}
                                      onChange={event => updateColumn(index, columnIndex, { type: event.target.value })}
                                      className="w-24 rounded border border-gray-300 bg-white px-2 py-1 text-xs"
                                    >
                                      <option value="string">String</option>
                                      <option value="integer">Integer</option>
                                      <option value="decimal">Decimal</option>
                                      <option value="date">Date</option>
                                      <option value="datetime">DateTime</option>
                                      <option value="boolean">Boolean</option>
                                    </select>
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <label className="inline-flex items-center gap-1.5">
                                      <input
                                        type="checkbox"
                                        aria-label={`Required for ${column.name} in ${label}`}
                                        checked={column.required}
                                        onChange={event => updateColumn(index, columnIndex, {
                                          required: event.target.checked,
                                        })}
                                        className="rounded border-gray-300"
                                      />
                                      <span>{column.required ? 'Yes' : 'No'}</span>
                                    </label>
                                  </td>
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
                            <legend className="mb-1 text-xs font-medium text-gray-700">
                              Suggested rules for {label} (published with version 1 if selected)
                            </legend>
                            <div className="mb-1 flex gap-3 text-xs">
                              <button type="button" onClick={() => setSheetRules(sheet, true)} className="text-blue-700 underline hover:text-blue-900">
                                Select all suggested rules
                              </button>
                              <button type="button" onClick={() => setSheetRules(sheet, false)} className="text-blue-700 underline hover:text-blue-900">
                                Clear
                              </button>
                            </div>
                            {sheet.suggestedRules.map(rule => {
                              const key = suggestionKey(sheet.name, rule.name);
                              return (
                                <label key={key} className={`mb-1 flex items-start gap-2 text-xs ${rulesSelectable ? 'text-gray-700' : 'text-gray-400'}`}>
                                  <input
                                    type="checkbox"
                                    checked={selectedRules.has(key)}
                                    onChange={() => toggle(setSelectedRules, key)}
                                    className="mt-0.5 rounded border-gray-300"
                                  />
                                  <span>
                                    <span className="font-medium">{rule.ruleType}</span> <code className="rounded bg-gray-100 px-1">{rule.expression}</code>
                                    <span className="block text-gray-500">{rule.reason}.</span>
                                  </span>
                                </label>
                              );
                            })}
                          </fieldset>
                        ) : (
                          <p className="text-xs text-gray-500">
                            {sheet.suggestedRules.length} rule suggestion{sheet.suggestedRules.length === 1 ? ' is' : 's are'} available when creating a definition.
                          </p>
                        )
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
