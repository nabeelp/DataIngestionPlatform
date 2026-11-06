import { CheckCircle2, Columns3, FileSpreadsheet, ShieldCheck } from 'lucide-react';
import type { DefinitionSummary } from '../services/definitionApi';

interface Props {
  definition: DefinitionSummary;
  actions?: React.ReactNode;
  compact?: boolean;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

export default function DefinitionContextCard({
  definition,
  actions,
  compact = false,
}: Props) {
  const sheetCount = definition.tables.filter(table => table.sheet !== null).length;
  const structure = sheetCount > 0
    ? `${plural(sheetCount, 'sheet')}, ${plural(definition.columns.length, 'column')}`
    : `Single table, ${plural(definition.columns.length, 'column')}`;

  return (
    <section
      aria-label={`Selected definition: ${definition.name}`}
      className="rounded-xl border border-blue-200 bg-blue-50/70 p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" />
            <h2 className="font-semibold text-slate-900">{definition.name}</h2>
            {definition.activeVersion ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                <CheckCircle2 className="mr-1 inline h-3 w-3" aria-hidden="true" />
                Published v{definition.activeVersion.versionNumber}
              </span>
            ) : (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                Not published
              </span>
            )}
          </div>
          {definition.description && !compact && (
            <p className="mt-1 text-sm text-slate-600">{definition.description}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-700">
            <span className="inline-flex items-center gap-1.5">
              <Columns3 className="h-4 w-4 text-slate-500" aria-hidden="true" />
              {structure}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-slate-500" aria-hidden="true" />
              {plural(definition.ruleCounts.total, 'active rule')}
              {definition.ruleCounts.warnings > 0 && ` (${plural(definition.ruleCounts.warnings, 'warning')})`}
            </span>
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
    </section>
  );
}
