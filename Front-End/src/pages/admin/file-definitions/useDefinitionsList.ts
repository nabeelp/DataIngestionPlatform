import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { exportFileDefinition, type FileDefinitionAdmin } from '../../../services/adminApi';
import {
  useAdminDefinitionsQuery,
  useDefinitionUserCountsQuery,
  useDeleteDefinitionMutation,
} from '../../../services/hooks/definitions';

export type StatusFilter = 'all' | 'active' | 'inactive' | 'unpublished';

const NO_DEFINITIONS: FileDefinitionAdmin[] = [];
const NO_COUNTS: Record<string, number> = {};

const matchesFilters = (definition: FileDefinitionAdmin, searchTerm: string, statusFilter: StatusFilter): boolean => {
  const query = searchTerm.trim().toLowerCase();
  const matchesSearch = !query
    || definition.name.toLowerCase().includes(query)
    || definition.description.toLowerCase().includes(query);
  const matchesStatus = statusFilter === 'all'
    || (statusFilter === 'active' && definition.status === 'Active')
    || (statusFilter === 'inactive' && definition.status === 'Inactive')
    || (statusFilter === 'unpublished' && Boolean(definition.hasUnpublishedChanges));
  return matchesSearch && matchesStatus;
};

interface Options {
  isDefinitionWorkspace: boolean;
  setError: (message: string | null) => void;
}

/** The definitions list: loading, filtering, user counts, deletion, download and `?definitionId=` deep links. */
export function useDefinitionsList({ isDefinitionWorkspace, setError }: Options) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const handledDeepLink = useRef('');
  const definitionsQuery = useAdminDefinitionsQuery();
  const definitions = definitionsQuery.data?.definitions ?? NO_DEFINITIONS;
  const [reloading, setReloading] = useState(false);
  const loading = definitionsQuery.isPending || reloading;
  const userCountsQuery = useDefinitionUserCountsQuery(definitions.length > 0);
  const definitionUserCounts = userCountsQuery.data ?? NO_COUNTS;
  const { mutateAsync: removeDefinition } = useDeleteDefinitionMutation();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const filteredDefinitions = definitions.filter(definition => matchesFilters(definition, searchTerm, statusFilter));

  const initialLoadFailed = definitionsQuery.isError && !definitionsQuery.data;
  useEffect(() => {
    if (initialLoadFailed) setError('Failed to load file definitions');
  }, [initialLoadFailed, setError]);

  useEffect(() => {
    if (isDefinitionWorkspace) return;
    const definitionId = searchParams.get('definitionId');
    if (!definitionId || definitions.length === 0) return;
    const deepLinkKey = `${definitionId}:${searchParams.get('view') ?? ''}`;
    if (handledDeepLink.current === deepLinkKey) return;
    const definition = definitions.find(item => item.id === definitionId);
    if (!definition) return;
    handledDeepLink.current = deepLinkKey;
    if (searchParams.get('view') === 'versions') {
      navigate(`/admin/file-definitions/${encodeURIComponent(definition.id)}/versions`, { replace: true });
    }
    if (searchParams.get('view') === 'edit') {
      navigate(`/admin/file-definitions/${encodeURIComponent(definition.id)}/edit`, { replace: true });
    }
  }, [definitions, isDefinitionWorkspace, navigate, searchParams]);

  // Joins a refresh that a mutation already started instead of cancelling and repeating it.
  const refetchDefinitions = () => definitionsQuery.refetch({ cancelRefetch: false });

  const fetchDefinitions = async (): Promise<FileDefinitionAdmin[]> => {
    setReloading(true);
    setError(null);
    try {
      const result = await refetchDefinitions();
      if (result.isError) {
        console.error('Failed to fetch file definitions:', result.error);
        setError('Failed to load file definitions');
        return [];
      }
      return result.data?.definitions ?? [];
    } finally {
      setReloading(false);
    }
  };

  // Refresh version metadata without replacing the current workspace with the page spinner.
  const refreshVersionStates = async () => {
    const result = await refetchDefinitions();
    if (result.isError) console.error('Failed to refresh file definitions:', result.error);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this file definition?')) return;
    
    try {
      setError(null);
      await removeDefinition(id);
      await fetchDefinitions();
    } catch (err) {
      console.error('Failed to delete file definition:', err);
      setError('Failed to delete file definition');
    }
  };

  const handleDownload = async (definitionId: string) => {
    try {
      await exportFileDefinition(definitionId);
    } catch (error) {
      console.error('Download failed:', error);
      setError('Failed to download file definition');
    }
  };

  return {
    definitions,
    filteredDefinitions,
    loading,
    definitionUserCounts,
    searchTerm,
    setSearchTerm,
    statusFilter,
    setStatusFilter,
    fetchDefinitions,
    refreshVersionStates,
    handleDelete,
    handleDownload,
  };
}
