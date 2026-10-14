import { useId, type ChangeEvent } from 'react';
import type { RuleConfig } from '../../contracts/rule-config';

type Params = Record<string, unknown>;
type RuleType = Exclude<RuleConfig['type'], 'naturalLanguage'>;

interface Props {
  type: RuleType;
  params: Params;
  onChange: (params: Params) => void;
  lookupIds?: string[];
  /** Reference lists a lookup rule can use (preferred over bare ids). */
  lookups?: Array<{ id: string; name: string }>;
  /** Columns of the definition, offered as suggestions in column fields. */
  columns?: string[];
  /** Column fields are disabled while a sheet-scoped rule has no sheet. */
  columnsDisabled?: boolean;
  /** Tables (sheets) of the definition, for rules that compare tables. */
  tables?: string[];
  /** Columns available in each sheet, for rules that reference more than one table. */
  columnsByTable?: Record<string, string[]>;
}

const value = (params: Params, key: string): string =>
  typeof params[key] === 'string' ? params[key] as string : '';

const numberValue = (params: Params, key: string): string =>
  typeof params[key] === 'number' ? String(params[key]) : '';

const strings = (params: Params, key: string): string[] =>
  Array.isArray(params[key]) ? (params[key] as unknown[]).filter((item): item is string => typeof item === 'string') : [];

const setNumber = (onChange: Props['onChange'], params: Params, key: string, input: string) => {
  const parsed = input.trim() === '' ? undefined : Number(input);
  onChange({ ...params, [key]: parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined });
};

const Input = ({
  label,
  value: inputValue,
  onChange,
  type = 'text',
  min,
  max,
  step,
  suggestions,
}: {
  label: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  type?: 'text' | 'number' | 'date';
  min?: number;
  max?: number;
  step?: string;
  suggestions?: string[];
}) => {
  const listId = useId();
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-medium text-slate-600">{label}</span>
      <input
        aria-label={label}
        type={type}
        value={inputValue}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        list={suggestions && suggestions.length > 0 ? listId : undefined}
        className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {suggestions && suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map(suggestion => <option key={suggestion} value={suggestion} />)}
        </datalist>
      )}
    </label>
  );
};

const Select = ({
  label,
  value: selected,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) => (
  <label className="block space-y-1">
    <span className="block text-xs font-medium text-slate-600">{label}</span>
    <select
      aria-label={label}
      value={selected}
      onChange={event => onChange(event.target.value)}
      disabled={disabled}
      className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
    >
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>
);

const ColumnSelect = ({
  label,
  value: selected,
  columns,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  columns: string[];
  disabled: boolean;
  onChange: (value: string) => void;
}) => (
  <Select
    label={label}
    value={selected}
    disabled={disabled}
    options={[
      { value: '', label: disabled ? 'Choose a sheet first' : 'Choose a column' },
      ...columns.map(column => ({ value: column, label: column })),
    ]}
    onChange={onChange}
  />
);

const ColumnsSelect = ({
  label,
  selected,
  columns,
  disabled,
  onChange,
}: {
  label: string;
  selected: string[];
  columns: string[];
  disabled: boolean;
  onChange: (columns: string[]) => void;
}) => (
  <label className="block space-y-1">
    <span className="block text-xs font-medium text-slate-600">{label}</span>
    <select
      multiple
      aria-label={label}
      value={selected}
      disabled={disabled}
      onChange={event => onChange(Array.from(event.target.selectedOptions, option => option.value))}
      className="min-h-24 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
    >
      {disabled ? <option value="">Choose a sheet first</option> : columns.map(column => <option key={column} value={column}>{column}</option>)}
    </select>
    {!disabled && <span className="block text-[11px] text-slate-500">Select one or more columns.</span>}
  </label>
);

const Checkbox = ({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <label className="flex items-center gap-2 text-xs text-slate-700">
    <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
    {label}
  </label>
);

function AggregateReferenceFields({
  label,
  reference,
  onChange,
  tables,
  columnsByTable,
}: {
  label: string;
  reference: Record<string, unknown>;
  onChange: (reference: Record<string, unknown>) => void;
  tables: string[];
  columnsByTable: Record<string, string[]>;
}) {
  const selectedTable = value(reference, 'table');
  const columns = columnsByTable[selectedTable] ?? [];
  const selectedColumn = value(reference, 'column');
  const tableOptions = tables.length > 0
    ? tables.map(table => ({ value: table, label: table }))
    : [{ value: value(reference, 'table'), label: 'Enter a table name below' }];
  return (
    <fieldset className="space-y-2 rounded-md border border-slate-200 p-3">
      <legend className="px-1 text-xs font-semibold text-slate-700">{label}</legend>
      {tables.length > 0 ? (
        <Select
          label={`${label} table`}
          value={value(reference, 'table')}
          options={tableOptions}
          onChange={table => {
            const nextColumns = columnsByTable[table] ?? [];
            const column = nextColumns.some(item => item.toLowerCase() === selectedColumn.toLowerCase()) ? selectedColumn : '';
            onChange({ ...reference, table, column });
          }}
        />
      ) : (
        <Input label={`${label} table`} value={value(reference, 'table')} onChange={event => onChange({ ...reference, table: event.target.value })} />
      )}
      <ColumnSelect
        label={`${label} column`}
        value={value(reference, 'column')}
        columns={columns}
        disabled={!selectedTable}
        onChange={column => onChange({ ...reference, column })}
      />
      <Select
        label={`${label} function`}
        value={value(reference, 'fn') || 'sum'}
        options={['sum', 'min', 'max', 'avg', 'count', 'countDistinct'].map(fn => ({ value: fn, label: fn }))}
        onChange={fn => onChange({ ...reference, fn })}
      />
    </fieldset>
  );
}

export default function RuleConfigFields({
  type,
  params,
  onChange,
  lookupIds = [],
  lookups = [],
  columns = [],
  columnsDisabled = false,
  tables = [],
  columnsByTable = {},
}: Props) {
  const text = (key: string, label = key) => (
    <Input
      label={label}
      value={value(params, key)}
      onChange={event => onChange({ ...params, [key]: event.target.value })}
    />
  );
  const column = (key: string, label: string) => (
    <ColumnSelect
      label={label}
      value={value(params, key)}
      columns={columns}
      disabled={columnsDisabled}
      onChange={next => onChange({ ...params, [key]: next })}
    />
  );
  const numeric = (key: string, label = key, min?: number) => (
    <Input
      label={label}
      type="number"
      min={min}
      value={numberValue(params, key)}
      onChange={event => setNumber(onChange, params, key, event.target.value)}
    />
  );
  const checkbox = (key: string, label = key, defaultValue = true) => (
    <Checkbox
      label={label}
      checked={typeof params[key] === 'boolean' ? params[key] as boolean : defaultValue}
      onChange={checked => onChange({ ...params, [key]: checked })}
    />
  );

  switch (type) {
    case 'unique':
      return (
        <ColumnsSelect
          label="Columns"
          selected={strings(params, 'columns')}
          columns={columns}
          disabled={columnsDisabled}
          onChange={selected => onChange({ ...params, columns: selected })}
        />
      );
    case 'enum':
      return (
        <div className="space-y-3">
          {column('column', 'Column')}
          <Input
            label="Allowed values (comma-separated)"
            value={strings(params, 'values').join(', ')}
            onChange={event => onChange({
              ...params,
              values: event.target.value.split(',').map(item => item.trim()).filter(Boolean),
            })}
          />
          <div className="flex gap-5">{checkbox('caseSensitive', 'Case sensitive')}{checkbox('trim', 'Trim whitespace')}</div>
        </div>
      );
    case 'range':
      return (
        <div className="space-y-3">
          {column('column', 'Column')}
          <div className="grid grid-cols-2 gap-3">{numeric('min', 'Minimum')}{numeric('max', 'Maximum')}</div>
          <div className="flex gap-5">{checkbox('minInclusive', 'Minimum is inclusive')}{checkbox('maxInclusive', 'Maximum is inclusive')}</div>
        </div>
      );
    case 'pattern':
      return (
        <div className="space-y-3">
          {column('column', 'Column')}
          {text('pattern', 'Regular expression')}
          {checkbox('caseSensitive', 'Case sensitive')}
        </div>
      );
    case 'length':
      return (
        <div className="space-y-3">
          {column('column', 'Column')}
          <div className="grid grid-cols-2 gap-3">{numeric('min', 'Minimum length', 0)}{numeric('max', 'Maximum length', 0)}</div>
        </div>
      );
    case 'lookup':
      return (
        <div className="space-y-3">
          {column('column', 'Column')}
          {lookups.length > 0 || lookupIds.length > 0 ? (
            <Select
              label="Lookup"
              value={value(params, 'lookupId')}
              options={[
                { value: '', label: 'Choose a lookup' },
                ...(lookups.length > 0 ? lookups.map(lookup => ({ value: lookup.id, label: lookup.name })) : lookupIds.map(id => ({ value: id, label: id }))),
              ]}
              onChange={lookupId => onChange({ ...params, lookupId })}
            />
          ) : text('lookupId', 'Lookup ID')}
          {checkbox('caseSensitive', 'Case sensitive')}
        </div>
      );
    case 'dateRange':
      return (
        <div className="space-y-3">
          {column('column', 'Column')}
          <div className="grid grid-cols-2 gap-3">{text('min', 'Minimum date')}{text('max', 'Maximum date')}</div>
          <p className="text-[11px] text-slate-500">Use an ISO date or a supported relative date expression; leave an unused bound blank.</p>
        </div>
      );
    case 'conditionalRequired': {
      const when = params.when && typeof params.when === 'object' && !Array.isArray(params.when)
        ? params.when as Record<string, unknown>
        : { column: '', op: 'eq', value: '' };
      const updateWhen = (updates: Record<string, unknown>) => onChange({ ...params, when: { ...when, ...updates } });
      const op = value(when, 'op') || 'eq';
      return (
        <div className="space-y-3">
          <ColumnsSelect
            label="Required columns"
            selected={strings(params, 'columns')}
            columns={columns}
            disabled={columnsDisabled}
            onChange={selected => onChange({ ...params, columns: selected })}
          />
          <ColumnSelect
            label="Condition column"
            value={value(when, 'column')}
            columns={columns}
            disabled={columnsDisabled}
            onChange={next => updateWhen({ column: next })}
          />
          <Select
            label="Condition"
            value={op}
            options={[
              { value: 'eq', label: 'equals' }, { value: 'ne', label: 'does not equal' },
              { value: 'in', label: 'is one of' }, { value: 'empty', label: 'is empty' },
              { value: 'notEmpty', label: 'is not empty' },
            ]}
            onChange={next => {
              const condition = next === 'in' ? { column: value(when, 'column'), op: next, values: [''] }
                : next === 'empty' || next === 'notEmpty' ? { column: value(when, 'column'), op: next }
                  : { column: value(when, 'column'), op: next, value: '' };
              onChange({ ...params, when: condition });
            }}
          />
          {op === 'in' ? (
            <Input
              label="Values (comma-separated)"
              value={Array.isArray(when.values) ? (when.values as unknown[]).filter((item): item is string => typeof item === 'string').join(', ') : ''}
              onChange={event => updateWhen({ values: event.target.value.split(',').map(item => item.trim()).filter(Boolean) })}
            />
          ) : op === 'eq' || op === 'ne' ? (
            <Input label="Condition value" value={value(when, 'value')} onChange={event => updateWhen({ value: event.target.value })} />
          ) : null}
        </div>
      );
    }
    case 'compare':
      return (
        <div className="grid grid-cols-2 gap-3">
          {column('left', 'Left column')}
          <Select label="Comparison" value={value(params, 'op') || 'eq'} options={[
            { value: 'lt', label: '<' }, { value: 'le', label: '<=' }, { value: 'eq', label: '=' },
            { value: 'ne', label: '!=' }, { value: 'ge', label: '>=' }, { value: 'gt', label: '>' },
          ]} onChange={op => onChange({ ...params, op })} />
          {column('right', 'Right column')}
          <Select label="Compare as" value={value(params, 'as') || 'string'} options={[
            { value: 'number', label: 'Number' }, { value: 'date', label: 'Date' }, { value: 'string', label: 'String' },
          ]} onChange={as => onChange({ ...params, as })} />
        </div>
      );
    case 'rowCount':
      return <div className="grid grid-cols-2 gap-3">{numeric('min', 'Minimum rows', 0)}{numeric('max', 'Maximum rows', 0)}</div>;
    case 'aggregate':
      return (
        <div className="space-y-3">
          {column('column', 'Column')}
          <Select label="Aggregate function" value={value(params, 'fn') || 'sum'} options={[
            'sum', 'min', 'max', 'avg', 'count', 'countDistinct',
          ].map(fn => ({ value: fn, label: fn }))} onChange={fn => onChange({ ...params, fn })} />
          <div className="grid grid-cols-2 gap-3">{numeric('min', 'Minimum result')}{numeric('max', 'Maximum result')}</div>
        </div>
      );
    case 'reconcile': {
      const left = params.left && typeof params.left === 'object' && !Array.isArray(params.left)
        ? params.left as Record<string, unknown>
        : {};
      const right = params.right && typeof params.right === 'object' && !Array.isArray(params.right)
        ? params.right as Record<string, unknown>
        : {};
      return (
        <div className="space-y-3">
          <AggregateReferenceFields
            label="Left aggregate"
            reference={left}
            tables={tables}
            columnsByTable={columnsByTable}
            onChange={reference => onChange({ ...params, left: reference })}
          />
          <AggregateReferenceFields
            label="Right aggregate"
            reference={right}
            tables={tables}
            columnsByTable={columnsByTable}
            onChange={reference => onChange({ ...params, right: reference })}
          />
          {numeric('tolerance', 'Allowed difference', 0)}
        </div>
      );
    }
  }
}
