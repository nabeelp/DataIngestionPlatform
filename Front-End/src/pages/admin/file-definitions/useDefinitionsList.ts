import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  deleteFileDefinitionAdmin,
  exportFileDefinition,
  getFileDefinitionsAdmin,
  getFileDefinitionUserCounts,
  type FileDefinitionAdmin,
} from '../../../services/adminApi';

export type StatusFilter = 'all' | 'active' | 'inactive' | 'unpublished';

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
  const [definitions, setDefinitions] = useState<FileDefinitionAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [definitionUserCounts, setDefinitionUserCounts] = useState<Record<string, number>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const filteredDefinitions = definitions.filter(definition => matchesFilters(definition, searchTerm, statusFilter));

  // Initial load only; later refreshes are explicit.
  useEffect(() => {
    fetchDefinitions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Fetch user counts for table
  useEffect(() => {
    const fetchUserCounts = async () => {
      if (definitions.length === 0) return;
      try {
        const counts = await getFileDefinitionUserCounts();
        setDefinitionUserCounts(counts);
      } catch (error) {
        console.error('Failed to fetch user counts:', error);
      }
    };

    fetchUserCounts();
  }, [definitions]);

  const fetchDefinitions = async (): Promise<FileDefinitionAdmin[]> => {
    try {
      setLoading(true);
      setError(null);
      const data = await getFileDefinitionsAdmin();
      setDefinitions(data.definitions);
      return data.definitions;
    } catch (err) {
      console.error('Failed to fetch file definitions:', err);
      setError('Failed to load file definitions');
      return [];
    } finally {
      setLoading(false);
    }
  };

  // Refresh version metadata without replacing the current workspace with the page spinner.
  const refreshVersionStates = async () => {
    try {
      const data = await getFileDefinitionsAdmin();
      setDefinitions(data.definitions);
    } catch (err) {
      console.error('Failed to refresh file definitions:', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this file definition?')) return;
    
    try {
      setError(null);
      await deleteFileDefinitionAdmin(id);
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
