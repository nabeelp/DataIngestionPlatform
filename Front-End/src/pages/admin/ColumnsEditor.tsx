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
  showType?: boolean;
  allowStructureChanges?: boolean;
  showDescription?: boolean;
}

/**
 * Edit the persisted column metadata. Specialized validation constraints belong in rules.
 */
export default function ColumnsEditor({
  columns,
  onChange,
  hints,
  sheet,
  label = 'Columns',
  showType = true,
  allowStructureChanges = true,
  showDescription = true,
}: Props) {
  const update = (index: number, changes: Partial<FileDefinitionColumn>) =>
    onChange(columns.map((column, i) => (i === index ? { ...column, ...changes } : column)));

  const updateRequired = (index: number, required: boolean) => {
    update(index, {
      required,
      mustExist: required,
      nullable: !required,
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="block text-sm font-medium text-gray-700">{label}</span>
        {allowStructureChanges && (
          <button
            type="button"
            onClick={() => onChange([...columns, { name: '', description: '', type: 'string', required: false, mustExist: false, nullable: true }])}
            className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            <Plus size={16} /> Add column
          </button>
        )}
      </div>

      {columns.map((col, index) => {
        const hint = hints[hintKey(sheet, col.name)];
        return (
          <div key={index} className="mb-3 rounded-md border border-gray-200 bg-gray-50 p-3">
            <div className={`grid gap-3 ${showType ? 'sm:grid-cols-[minmax(0,1fr)_11rem_auto]' : 'sm:grid-cols-[minmax(0,1fr)_auto]'}`}>
              <label className="text-xs font-medium text-gray-600">
                Name
                <input
                  type="text"
                  value={col.name}
                  onChange={(e) => update(index, { name: e.target.value })}
                  placeholder="Column name"
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  required
                />
              </label>
              {showType && (
                <label className="text-xs font-medium text-gray-600">
                  Data type
                  <select
                    aria-label={`Type for ${col.name || index + 1}`}
                    value={col.type}
                    onChange={(e) => update(index, { type: e.target.value })}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white"
                  >
                    <option value="string">String</option>
                    <option value="integer">Integer</option>
                    <option value="decimal">Decimal</option>
                    <option value="date">Date</option>
                    <option value="datetime">DateTime</option>
                    <option value="boolean">Boolean</option>
                  </select>
                </label>
              )}
              {allowStructureChanges && columns.length > 1 && (
                <button
                  type="button"
                  onClick={() => onChange(columns.filter((_, i) => i !== index))}
                  className="self-end rounded p-2 text-red-600 hover:bg-red-50"
                  aria-label={`Remove column ${col.name || index + 1}`}
                >
                  <X size={18} />
                </button>
              )}
            </div>
            <div className={`mt-3 grid gap-3 ${showDescription ? 'sm:grid-cols-[auto_minmax(0,1fr)]' : 'sm:grid-cols-1'} sm:items-start`}>
              <label className="flex items-center gap-2 pt-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={col.required}
                  onChange={(e) => updateRequired(index, e.target.checked)}
                  className="rounded border-gray-300"
                />
                Required
              </label>
              {showDescription && (
                <label className="text-xs font-medium text-gray-600">
                  Description (optional)
                  <textarea
                    aria-label={`Description for ${col.name || index + 1}`}
                    value={col.description ?? ''}
                    onChange={(e) => update(index, { description: e.target.value })}
                    rows={2}
                    maxLength={500}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                  />
                </label>
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
