import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, History, UploadCloud, X } from 'lucide-react';
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
  embedded?: boolean;
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
  const tables = version.tables && version.tables.length > 0
    ? version.tables
    : [{ sheet: null as string | null, columns: version.columns }];
  return (
    <div className="mt-3 space-y-3 text-sm">
      {version.definitionMetadata ? (
        <dl className="grid gap-2 rounded border border-gray-200 bg-gray-50 p-3 sm:grid-cols-2">
          <div><dt className="text-xs font-semibold uppercase text-gray-500">Name</dt><dd>{version.definitionMetadata.name}</dd></div>
          <div><dt className="text-xs font-semibold uppercase text-gray-500">Status</dt><dd>{version.definitionMetadata.status}</dd></div>
          <div><dt className="text-xs font-semibold uppercase text-gray-500">Delivery folder</dt><dd>{version.definitionMetadata.deliveryFolder || 'None'}</dd></div>
          <div><dt className="text-xs font-semibold uppercase text-gray-500">Reusable template</dt><dd>{version.definitionMetadata.templateFilename || 'None'}</dd></div>
          {version.definitionMetadata.description && (
            <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase text-gray-500">Description</dt><dd>{version.definitionMetadata.description}</dd></div>
          )}
        </dl>
      ) : (
        <p className="rounded border border-gray-200 bg-gray-50 p-3 text-gray-500">Metadata was not recorded for this legacy version.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-2">
        {tables.map(table => (
          <div key={table.sheet ?? ''}>
            <p className="text-xs font-semibold uppercase text-gray-500 mb-1">
              {table.sheet === null ? 'Columns' : `Sheet "${table.sheet}"`}
            </p>
            <ul className="space-y-1">
              {table.columns.map(column => (
                <li key={column.name}>
                  <span className="font-medium">{column.name}</span>{' '}
                  <span className="text-gray-500">{column.type}{column.required ? ', required' : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
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
                {rule.table && <span className="text-xs text-gray-500">[{rule.table}] </span>}
                <span className="text-gray-500">
                  {rule.ruleType} ({rule.severity}): {rule.naturalLanguageText ? <q>{rule.naturalLanguageText}</q> : <code>{rule.expression}</code>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>
    </div>
  );
}

export default function DefinitionVersionsModal({ definitionId, definitionName, onClose, onPublished, embedded = false }: Props) {
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
    <div className={embedded ? '' : 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4'}>
      <div
        {...(embedded ? { role: 'region' } : { role: 'dialog', 'aria-modal': true })}
        aria-labelledby="versions-title"
        className={embedded
          ? 'w-full rounded-lg border border-gray-200 bg-white shadow-sm'
          : 'bg-white rounded-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto'}
      >
        <div className="flex items-center justify-between p-4 border-b">
          <h2 id="versions-title" className="text-lg font-bold flex items-center gap-2">
            <History size={20} /> Versions: {definitionName}
          </h2>
          <button
            onClick={onClose}
            className="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            aria-label={embedded ? 'Back to definition' : 'Close versions'}
          >
            {embedded ? <><ArrowLeft size={18} /> Definition</> : <X size={24} />}
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
                  <ChangeList label="Definition details" changes={history.changes.metadata} />
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
                                {version.tables && version.tables.length > 0
                                  ? `${plural(version.tables.length, 'sheet')} · ${plural(version.tables.reduce((sum, t) => sum + t.columns.length, 0), 'column')}`
                                  : plural(version.columns.length, 'column')} · {plural(version.rules.length, 'rule')}
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
