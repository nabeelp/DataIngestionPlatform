import { Plus, X } from 'lucide-react';
import type { DateFormat } from '../../contracts/definition-contract';
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
 * Edit definition columns and their fixed contract fields, with optional example-file hints.
 */
export default function ColumnsEditor({ columns, onChange, hints, sheet, label = 'Columns *' }: Props) {
  const update = (index: number, field: keyof FileDefinitionColumn, value: string | boolean | number | null | undefined | DateFormat) =>
    onChange(columns.map((column, i) => (i === index ? { ...column, [field]: value } : column)));

  const updateMustExist = (index: number, mustExist: boolean) => {
    onChange(columns.map((current, i) => i === index
      ? { ...current, mustExist, required: mustExist && !(current.nullable ?? !current.required) }
      : current));
  };

  const updateNullable = (index: number, nullable: boolean) => {
    onChange(columns.map((current, i) => i === index
      ? { ...current, nullable, required: (current.mustExist ?? current.required) && !nullable }
      : current));
  };

  const updateNumber = (index: number, field: 'precision' | 'scale' | 'maxLength', value: string) =>
    update(index, field, value === '' ? null : Number(value));

  const formatValue = (format: FileDefinitionColumn['format']) =>
    Array.isArray(format) ? format.join(', ') : format ?? '';

  const updateFormat = (index: number, value: string) => {
    const formats = value.split(',').map(format => format.trim()).filter(Boolean);
    const format: DateFormat | null = formats.length > 1 ? formats as [string, ...string[]] : formats[0] ?? null;
    update(index, 'format', format);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="block text-sm font-medium text-gray-700">{label}</span>
        <button
          type="button"
          onClick={() => onChange([...columns, { name: '', type: 'string', required: false, mustExist: false, nullable: true }])}
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
                <option value="date">Date</option>
                <option value="datetime">DateTime</option>
                <option value="boolean">Boolean</option>
              </select>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={col.mustExist ?? col.required}
                  onChange={(e) => updateMustExist(index, e.target.checked)}
                  className="rounded border-gray-300"
                />
                Must exist
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
            <div className="mt-2 ml-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="flex items-center gap-1 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={col.nullable ?? !col.required}
                  onChange={(e) => updateNullable(index, e.target.checked)}
                  className="rounded border-gray-300"
                />
                Nullable
              </label>
              <label className="text-xs text-gray-600">
                Format
                <input
                  aria-label={`Format for ${col.name || index + 1}`}
                  type="text"
                  value={formatValue(col.format)}
                  onChange={(e) => updateFormat(index, e.target.value)}
                  placeholder="e.g. yyyy-MM-dd"
                  className="mt-0.5 w-full px-2 py-1 border border-gray-300 rounded text-xs"
                />
              </label>
              <label className="text-xs text-gray-600">
                Decimal separator
                <input
                  aria-label={`Decimal separator for ${col.name || index + 1}`}
                  type="text"
                  value={col.decimalSeparator ?? ''}
                  onChange={(e) => update(index, 'decimalSeparator', e.target.value || undefined)}
                  className="mt-0.5 w-full px-2 py-1 border border-gray-300 rounded text-xs"
                />
              </label>
              <label className="text-xs text-gray-600">
                Thousands separator
                <input
                  aria-label={`Thousands separator for ${col.name || index + 1}`}
                  type="text"
                  value={col.thousandsSeparator ?? ''}
                  onChange={(e) => update(index, 'thousandsSeparator', e.target.value || null)}
                  className="mt-0.5 w-full px-2 py-1 border border-gray-300 rounded text-xs"
                />
              </label>
              {(['precision', 'scale', 'maxLength'] as const).map(field => (
                <label key={field} className="text-xs text-gray-600">
                  {field === 'maxLength' ? 'Max length' : field[0].toUpperCase() + field.slice(1)}
                  <input
                    aria-label={`${field === 'maxLength' ? 'Max length' : field} for ${col.name || index + 1}`}
                    type="number"
                    min="0"
                    value={col[field] ?? ''}
                    onChange={(e) => updateNumber(index, field, e.target.value)}
                    className="mt-0.5 w-full px-2 py-1 border border-gray-300 rounded text-xs"
                  />
                </label>
              ))}
              <label className="flex items-center gap-1 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={col.unique ?? false}
                  onChange={(e) => update(index, 'unique', e.target.checked)}
                  className="rounded border-gray-300"
                />
                Unique
              </label>
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
