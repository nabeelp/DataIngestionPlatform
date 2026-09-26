import { Plus, X } from 'lucide-react';
import type { FileDefinitionColumn } from '../../services/adminApi';
import { hintKey, type ColumnHint } from './exampleProposal';

interface Props {
  columns: FileDefinitionColumn[];
  onChange: (columns: FileDefinitionColumn[]) => void;
  /** Example-file hints, keyed by hintKey(sheet, column). */
  hints: Record<string, ColumnHint>;
  /** Sheet the columns belong to (null for a single-table definition). */
  sheet: string | null;
  label?: string;
}

/**
 * Edit a list of definition columns: name, type and required, with optional hints from an example file.
 */
export default function ColumnsEditor({ columns, onChange, hints, sheet, label = 'Columns *' }: Props) {
  const update = (index: number, field: keyof FileDefinitionColumn, value: string | boolean) =>
    onChange(columns.map((column, i) => (i === index ? { ...column, [field]: value } : column)));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="block text-sm font-medium text-gray-700">{label}</span>
        <button
          type="button"
          onClick={() => onChange([...columns, { name: '', type: 'string', required: false }])}
          className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
        >
          <Plus size={16} /> Add Column
        </button>
      </div>

      {columns.map((col, index) => {
        const hint = hints[hintKey(sheet, col.name)];
        return (
          <div key={index} className="mb-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={col.name}
                onChange={(e) => update(index, 'name', e.target.value)}
                placeholder="Column name"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                required
              />
              <select
                value={col.type}
                onChange={(e) => update(index, 'type', e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="string">String</option>
                <option value="integer">Integer</option>
                <option value="decimal">Decimal</option>
                <option value="datetime">DateTime</option>
                <option value="boolean">Boolean</option>
              </select>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={col.required}
                  onChange={(e) => update(index, 'required', e.target.checked)}
                  className="rounded border-gray-300"
                />
                Required
              </label>
              {columns.length > 1 && (
                <button
                  type="button"
                  onClick={() => onChange(columns.filter((_, i) => i !== index))}
                  className="text-red-600 hover:text-red-700"
                  aria-label={`Remove column ${col.name || index + 1}`}
                >
                  <X size={18} />
                </button>
              )}
            </div>
            {hint && (
              <p className="mt-0.5 ml-1 text-xs text-gray-500">
                Example: {hint.filledRows}/{hint.rowsAnalyzed} rows filled
                {hint.sampleValues.length > 0 && ` · e.g. ${hint.sampleValues.join(', ')}`}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
