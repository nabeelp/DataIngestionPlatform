import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, History, UploadCloud, X } from 'lucide-react';
import {
  getFileDefinitionVersions,
  publishFileDefinitionVersion,
  type ContractChanges,
  type DefinitionVersion,
  type DefinitionVersionHistory,
} from '../../services/adminApi';

interface Props {
  definitionId: string;
  definitionName: string;
  onClose: () => void;
  onPublished: (version: DefinitionVersion) => void;
}

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleString() : '-');

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

function ChangeList({ label, changes }: { label: string; changes: ContractChanges }) {
  const rows: Array<[string, string[], string]> = [
    ['Added', changes.added, 'text-green-700'],
    ['Changed', changes.changed, 'text-amber-700'],
    ['Removed', changes.removed, 'text-red-700'],
  ];
  const visible = rows.filter(([, names]) => names.length > 0);
  if (visible.length === 0) return null;
  return (
    <div className="mb-2">
      <p className="text-xs font-semibold uppercase text-gray-500">{label}</p>
      <ul className="text-sm">
        {visible.map(([kind, names, color]) => (
          <li key={kind}>
            <span className={`font-medium ${color}`}>{kind}:</span> {names.join(', ')}
          </li>
        ))}
      </ul>
    </div>
  );
}

function VersionDetails({ version }: { version: DefinitionVersion }) {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2 text-sm">
      <div>
        <p className="text-xs font-semibold uppercase text-gray-500 mb-1">Columns</p>
        <ul className="space-y-1">
          {version.columns.map(column => (
            <li key={column.name}>
              <span className="font-medium">{column.name}</span>{' '}
              <span className="text-gray-500">{column.type}{column.required ? ', required' : ''}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase text-gray-500 mb-1">Rules</p>
        {version.rules.length === 0 ? (
          <p className="text-gray-500">No rules</p>
        ) : (
          <ul className="space-y-1">
            {version.rules.map(rule => (
              <li key={rule.id}>
                <span className="font-medium">{rule.name}</span>{' '}
                <span className="text-gray-500">{rule.ruleType} ({rule.severity}): <code>{rule.expression}</code></span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function DefinitionVersionsModal({ definitionId, definitionName, onClose, onPublished }: Props) {
  const [history, setHistory] = useState<DefinitionVersionHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [changeNote, setChangeNote] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setHistory(await getFileDefinitionVersions(definitionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load versions');
    } finally {
      setLoading(false);
    }
  }, [definitionId]);

  useEffect(() => {
    load();
  }, [load]);

  const handlePublish = async () => {
    try {
      setPublishing(true);
      setError(null);
      const version = await publishFileDefinitionVersion(definitionId, changeNote);
      setChangeNote('');
      onPublished(version);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish version');
    } finally {
      setPublishing(false);
    }
  };

  const active = history?.activeVersionNumber ?? null;
  const nextVersion = (history?.versions[0]?.versionNumber ?? 0) + 1;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="versions-title" className="bg-white rounded-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 id="versions-title" className="text-lg font-bold flex items-center gap-2">
            <History size={20} /> Versions: {definitionName}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700" aria-label="Close versions">
            <X size={24} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700" role="alert">{error}</div>
          )}

          {loading && !history ? (
            <p className="text-sm text-gray-500">Loading versions...</p>
          ) : history && (
            <>
              {history.hasUnpublishedChanges ? (
                <section aria-label="Unpublished changes" className="p-4 rounded-lg border border-amber-200 bg-amber-50">
                  <h3 className="font-semibold text-amber-900 mb-1">Unpublished changes</h3>
                  <p className="text-sm text-amber-900 mb-3">
                    {active
                      ? `Uploads are still validated against v${active}. Publish to apply these changes to new uploads.`
                      : 'This definition has not been published yet.'}
                  </p>
                  <ChangeList label="Columns" changes={history.changes.columns} />
                  <ChangeList label="Rules" changes={history.changes.rules} />
                  <label htmlFor="changeNote" className="block text-sm font-medium text-gray-700 mt-3 mb-1">
                    Change note (optional)
                  </label>
                  <textarea
                    id="changeNote"
                    value={changeNote}
                    onChange={e => setChangeNote(e.target.value)}
                    maxLength={500}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="What changed and why"
                  />
                  <div className="flex justify-end mt-3">
                    <button
                      onClick={handlePublish}
                      disabled={publishing}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm flex items-center gap-2 disabled:opacity-50"
                    >
                      <UploadCloud size={16} />
                      {publishing ? 'Publishing...' : `Publish version ${nextVersion}`}
                    </button>
                  </div>
                </section>
              ) : (
                <p className="p-3 rounded-lg border border-green-200 bg-green-50 text-sm text-green-800">
                  No unpublished changes. New uploads are validated against v{active}.
                </p>
              )}

              <section aria-label="Version history">
                <h3 className="font-semibold text-gray-900 mb-2">History</h3>
                <ul className="divide-y border rounded-lg">
                  {history.versions.map(version => {
                    const expanded = expandedId === version.id;
                    return (
                      <li key={version.id} className="p-3" data-testid={`version-${version.versionNumber}`}>
                        <button
                          type="button"
                          onClick={() => setExpandedId(expanded ? null : version.id)}
                          className="w-full flex items-start justify-between gap-3 text-left"
                          aria-expanded={expanded}
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">v{version.versionNumber}</span>
                              <span className={`px-2 text-xs leading-5 font-semibold rounded-full ${
                                version.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'
                              }`}>
                                {version.status}
                              </span>
                              <span className="text-xs text-gray-500">
                                {plural(version.columns.length, 'column')} · {plural(version.rules.length, 'rule')}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                              Activated {formatDate(version.activatedAt)}{version.createdByName ? ` by ${version.createdByName}` : ''}
                              {version.supersededAt ? ` · superseded ${formatDate(version.supersededAt)}` : ''}
                            </p>
                            {version.changeNote && <p className="text-sm text-gray-700 mt-1">{version.changeNote}</p>}
                          </div>
                          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                        </button>
                        {expanded && <VersionDetails version={version} />}
                      </li>
                    );
                  })}
                </ul>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
