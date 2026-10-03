import type { ChangeEvent } from 'react';
import type { RuleConfig } from '../contracts/rule-config';

type Params = Record<string, unknown>;
type RuleType = Exclude<RuleConfig['type'], 'naturalLanguage'>;

interface Props {
  type: RuleType;
  params: Params;
  onChange: (params: Params) => void;
  lookupIds?: string[];
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
}: {
  label: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  type?: 'text' | 'number' | 'date';
  min?: number;
  max?: number;
  step?: string;
}) => (
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
      className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  </label>
);

const Select = ({
  label,
  value: selected,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) => (
  <label className="block space-y-1">
    <span className="block text-xs font-medium text-slate-600">{label}</span>
    <select
      aria-label={label}
      value={selected}
      onChange={event => onChange(event.target.value)}
      className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
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
}: {
  label: string;
  reference: Record<string, unknown>;
  onChange: (reference: Record<string, unknown>) => void;
  tables: string[];
}) {
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
          onChange={table => onChange({ ...reference, table })}
        />
      ) : (
        <Input label={`${label} table`} value={value(reference, 'table')} onChange={event => onChange({ ...reference, table: event.target.value })} />
      )}
      <Input label={`${label} column`} value={value(reference, 'column')} onChange={event => onChange({ ...reference, column: event.target.value })} />
      <Select
        label={`${label} function`}
        value={value(reference, 'fn') || 'sum'}
        options={['sum', 'min', 'max', 'avg', 'count', 'countDistinct'].map(fn => ({ value: fn, label: fn }))}
        onChange={fn => onChange({ ...reference, fn })}
      />
    </fieldset>
  );
}

export default function RuleConfigFields({ type, params, onChange, lookupIds = [] }: Props) {
  const text = (key: string, label = key) => (
    <Input label={label} value={value(params, key)} onChange={event => onChange({ ...params, [key]: event.target.value })} />
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
    case 'columnsPresent':
    case 'required':
    case 'unique':
      return (
        <Input
          label="Columns (comma-separated)"
          value={strings(params, 'columns').join(', ')}
          onChange={event => onChange({
            ...params,
            columns: event.target.value.split(',').map(item => item.trim()).filter(Boolean),
          })}
        />
      );
    case 'type':
      return (
        <div className="grid grid-cols-2 gap-3">
          {text('column', 'Column')}
          <Select
            label="Data type"
            value={value(params, 'dataType') || 'string'}
            options={['string', 'integer', 'decimal', 'date', 'datetime', 'boolean'].map(item => ({ value: item, label: item }))}
            onChange={dataType => onChange({ ...params, dataType })}
          />
          {text('format', 'Format (optional)')}
          {text('decimalSeparator', 'Decimal separator (optional)')}
          {text('thousandsSeparator', 'Thousands separator (optional)')}
        </div>
      );
    case 'enum':
      return (
        <div className="space-y-3">
          {text('column', 'Column')}
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
          {text('column', 'Column')}
          <div className="grid grid-cols-2 gap-3">{numeric('min', 'Minimum')}{numeric('max', 'Maximum')}</div>
          <div className="flex gap-5">{checkbox('minInclusive', 'Minimum is inclusive')}{checkbox('maxInclusive', 'Maximum is inclusive')}</div>
        </div>
      );
    case 'pattern':
      return (
        <div className="space-y-3">
          {text('column', 'Column')}
          {text('pattern', 'Regular expression')}
          {checkbox('caseSensitive', 'Case sensitive')}
        </div>
      );
    case 'length':
      return (
        <div className="space-y-3">
          {text('column', 'Column')}
          <div className="grid grid-cols-2 gap-3">{numeric('min', 'Minimum length', 0)}{numeric('max', 'Maximum length', 0)}</div>
        </div>
      );
    case 'lookup':
      return (
        <div className="space-y-3">
          {text('column', 'Column')}
          {lookupIds.length > 0 ? (
            <Select
              label="Lookup"
              value={value(params, 'lookupId')}
              options={[{ value: '', label: 'Choose a lookup' }, ...lookupIds.map(id => ({ value: id, label: id }))]}
              onChange={lookupId => onChange({ ...params, lookupId })}
            />
          ) : text('lookupId', 'Lookup ID')}
          {checkbox('caseSensitive', 'Case sensitive')}
        </div>
      );
    case 'dateRange':
      return (
        <div className="space-y-3">
          {text('column', 'Column')}
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
          <Input
            label="Required columns (comma-separated)"
            value={strings(params, 'columns').join(', ')}
            onChange={event => onChange({
              ...params,
              columns: event.target.value.split(',').map(item => item.trim()).filter(Boolean),
            })}
          />
          <Input label="Condition column" value={value(when, 'column')} onChange={event => updateWhen({ column: event.target.value })} />
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
          {text('left', 'Left column')}
          <Select label="Comparison" value={value(params, 'op') || 'eq'} options={[
            { value: 'lt', label: '<' }, { value: 'le', label: '<=' }, { value: 'eq', label: '=' },
            { value: 'ne', label: '!=' }, { value: 'ge', label: '>=' }, { value: 'gt', label: '>' },
          ]} onChange={op => onChange({ ...params, op })} />
          {text('right', 'Right column')}
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
          {text('column', 'Column')}
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
            tables={[]}
            onChange={reference => onChange({ ...params, left: reference })}
          />
          <AggregateReferenceFields
            label="Right aggregate"
            reference={right}
            tables={[]}
            onChange={reference => onChange({ ...params, right: reference })}
          />
          {numeric('tolerance', 'Allowed difference', 0)}
        </div>
      );
    }
  }
}
