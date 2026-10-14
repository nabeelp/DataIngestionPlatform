import { useEffect, useState } from 'react';
import { getRecentUploads } from '../../services/uploadApi';
import { runDraftDryRun, type DraftContext } from './ruleDraftApi';

interface Props {
  context: DraftContext;
  /** The saved definition whose past uploads can be previewed; null while the definition is being created. */
  definitionId: string | null;
}

interface UploadOption {
  Id: string;
  OriginalFilename: string;
  Status: string;
}

const PREVIEWABLE = ['VALIDATED', 'VALIDATION_PASSED', 'VALIDATION_FAILED', 'DELIVERED'];

/** Preview the unsaved structure and rules on a past upload of the definition. */
export default function DryRunSection({ context, definitionId }: Props) {
  const [uploads, setUploads] = useState<UploadOption[]>([]);
  const [selected, setSelected] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!definitionId) return;
    let active = true;
    getRecentUploads(50).then(response => {
      if (!active) return;
      const matching = response.uploads
        .filter(upload => upload.FileDefinitionId === definitionId && PREVIEWABLE.includes(upload.Status))
        .map(upload => ({ Id: upload.Id, OriginalFilename: upload.OriginalFilename, Status: upload.Status }));
      setUploads(matching);
      setSelected(matching[0]?.Id ?? '');
    }).catch(failure => {
      if (active) setError(failure instanceof Error ? failure.message : 'Could not load recent uploads.');
    });
    return () => { active = false; };
  }, [definitionId]);

  const run = async () => {
    if (!selected) return;
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      setResult(await runDraftDryRun(context, selected));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not run the validation preview.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="space-y-2 border-t border-slate-100 pt-4" aria-label="Dry run">
      <div>
        <p className="text-xs font-bold text-slate-600">Dry run against a recent upload</p>
        <p className="text-[11px] text-slate-500">
          Preview your unsaved structure and rules on an earlier upload. Cell values are not shown.
        </p>
      </div>
      {!definitionId ? (
        <p className="text-xs text-slate-500">Available once the definition has been created and has uploads.</p>
      ) : uploads.length > 0 ? (
        <div className="flex gap-2">
          <select
            aria-label="Recent upload for dry run"
            value={selected}
            onChange={event => setSelected(event.target.value)}
            className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-2 text-xs"
          >
            {uploads.map(upload => (
              <option key={upload.Id} value={upload.Id}>{upload.OriginalFilename} — {upload.Status}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={running || !selected}
            onClick={() => void run()}
            className="rounded bg-slate-700 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {running ? 'Running…' : 'Dry run'}
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-500">No completed uploads are available for this definition.</p>
      )}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      {result && (
        <div role="status" className="rounded bg-slate-50 p-3 text-xs text-slate-700">
          <p className="font-semibold">Preview status: {String(result.status ?? 'unknown')}</p>
          <p>{Array.isArray(result.structuralIssues) ? result.structuralIssues.length : 0} structural issue(s)</p>
          {Array.isArray(result.checks) && (
            <ul className="mt-2 space-y-1">
              {result.checks.map((item, index) => {
                if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
                const check = item as Record<string, unknown>;
                return (
                  <li key={String(check.id ?? index)}>
                    {String(check.name ?? 'Check')}: {String(check.status ?? 'unknown')}
                    {typeof check.issueCount === 'number' ? ` (${check.issueCount} issue(s))` : ''}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
