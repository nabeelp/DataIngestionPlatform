import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { queryKeys } from '../../services/queryKeys';
import RuleList from './RuleList';
import { getPublishedRules } from './ruleDraftApi';

interface Props {
  definitionId: string;
  layout: 'single' | 'sheets';
  /** Where an admin edits the rules; omitted for people who can only read them. */
  editHref?: string;
}

/** The rules new uploads of a definition are validated against (read only). */
export default function PublishedRulesSection({ definitionId, layout, editHref }: Props) {
  const published = useQuery({
    queryKey: queryKeys.definitions.publishedRules(definitionId),
    queryFn: () => getPublishedRules(definitionId),
  });
  const rules = published.data ? published.data.rules.filter(rule => rule.enabled) : null;
  const versionNumber = published.data?.versionNumber ?? null;
  const error = published.isError ? published.error.message || 'Failed to load the rules' : null;
  return (
    <section className="mt-4 border-t border-gray-200 pt-4" aria-label="Validation rules">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
          <ShieldCheck size={16} className="text-blue-600" aria-hidden="true" />
          Validation rules{versionNumber ? <span className="text-[10px] font-semibold text-gray-500">v{versionNumber}</span> : null}
        </h3>
        {editHref && <Link to={editHref} className="text-xs font-semibold text-blue-700 hover:text-blue-900">Edit rules</Link>}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-700">{error}</p>
      ) : rules === null ? (
        <p role="status" className="text-xs text-gray-500">Loading rules…</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-gray-500">
            Files you upload are also checked against these rules. Contact an admin to request changes.
          </p>
          <RuleList
            rules={rules}
            layout={layout}
            emptyMessage="This definition has no extra rules. Uploads are checked against the columns above."
          />
        </>
      )}
    </section>
  );
}
