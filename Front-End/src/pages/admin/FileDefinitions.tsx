import { useState, useEffect, useRef } from 'react';
import { 
  getFileDefinitionsAdmin, 
  createFileDefinitionAdmin, 
  updateFileDefinitionAdmin, 
  deleteFileDefinitionAdmin,
  getFileDefinitionUsers,
  addUsersToFileDefinition,
  removeUserFromFileDefinition,
  getAvailableUsers,
  getFileDefinitionUserCounts,
  exportFileDefinition,
  uploadTemplate,
  removeTemplate,
  publishFileDefinitionVersion,
  FileDefinitionAdmin,
  FileDefinitionColumn,
  FileDefinitionTable,
  IFileDefinitionUser,
  InitialRule
} from '../../services/adminApi';
import type { Column as ContractColumn, DefinitionContract, Table as ContractTable } from '../../contracts/definition-contract';

import { ArrowLeft, Check, FilePlus2, FileUp, Plus, Trash2, Users, X } from 'lucide-react';
import { Download } from 'lucide-react';
import DefinitionVersionsModal from './DefinitionVersionsModal';
import ExampleFileAssistant from './ExampleFileAssistant';
import { rulesForLayout, type DefinitionLayout, type ExampleProposal } from './exampleProposal';
import { Link, useMatch, useNavigate, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';

const INITIAL_COLUMNS: FileDefinitionColumn[] = [
  { name: 'Column1', type: 'string', required: true, mustExist: true, nullable: false }
];
const EMPTY_COLUMN: FileDefinitionColumn = {
  name: '',
  type: 'string',
  required: false,
  mustExist: false,
  nullable: true,
};

const EMPTY_CONTRACT: DefinitionContract = {
  schemaVersion: 1,
  layout: 'single',
  ignoredSheets: [],
  encoding: 'auto',
  tables: [{
    sheet: null,
    headerRow: null,
    allowExtraColumns: true,
    minRows: null,
    maxRows: null,
    columns: [{ name: 'Column1', type: 'string', mustExist: true, nullable: false }],
  }],
  rules: [],
  lookups: {},
};

export interface DefinitionForm {
  name: string;
  description: string;
  layout: DefinitionLayout;
  columns: FileDefinitionColumn[];
  tables: FileDefinitionTable[];
  status: string;
  deliveryFolder: string;
  contract: DefinitionContract;
}

const EMPTY_FORM: DefinitionForm = {
  name: '',
  description: '',
  layout: 'single',
  columns: INITIAL_COLUMNS,
  tables: [],
  status: 'Active',
  deliveryFolder: '',
  contract: EMPTY_CONTRACT,
};

const pendingRuleKey = (rule: InitialRule) => `${rule.table ?? ''}\u0000${rule.name}`;

const toEditorColumn = (column: ContractColumn | FileDefinitionColumn): FileDefinitionColumn => {
  const required = 'required' in column && typeof column.required === 'boolean'
    ? column.required
    : (column.mustExist ?? false) && !(column.nullable ?? true);
  return { ...column, required };
};

const toEditorTable = (legacy: FileDefinitionTable | undefined, contract: ContractTable | undefined): FileDefinitionTable => ({
  sheet: legacy?.sheet ?? contract?.sheet ?? '',
  headerRow: contract ? contract.headerRow : legacy?.headerRow ?? null,
  allowExtraColumns: contract ? contract.allowExtraColumns : legacy?.allowExtraColumns ?? true,
  minRows: contract ? contract.minRows : legacy?.minRows ?? null,
  maxRows: contract ? contract.maxRows : legacy?.maxRows ?? null,
  columns: (contract?.columns.length ? contract.columns : legacy?.columns ?? []).map(toEditorColumn),
});

const toContractColumn = ({ required, ...column }: FileDefinitionColumn): ContractColumn => ({
  ...column,
  mustExist: required,
  nullable: !required,
} as ContractColumn);

export const buildDefinitionContract = (form: DefinitionForm): DefinitionContract => {
  const tableDefaults = form.contract.tables;
  const tables: ContractTable[] = form.layout === 'single'
    ? [{
        ...tableDefaults[0],
        sheet: null,
        headerRow: tableDefaults[0]?.headerRow ?? null,
        allowExtraColumns: tableDefaults[0]?.allowExtraColumns ?? true,
        minRows: tableDefaults[0]?.minRows ?? null,
        maxRows: tableDefaults[0]?.maxRows ?? null,
        columns: form.columns.map(toContractColumn),
      }]
    : form.tables.map((table, index) => ({
        ...tableDefaults[index],
        sheet: table.sheet,
        headerRow: table.headerRow !== undefined ? table.headerRow : tableDefaults[index]?.headerRow ?? null,
        allowExtraColumns: table.allowExtraColumns ?? tableDefaults[index]?.allowExtraColumns ?? true,
        minRows: table.minRows !== undefined ? table.minRows : tableDefaults[index]?.minRows ?? null,
        maxRows: table.maxRows !== undefined ? table.maxRows : tableDefaults[index]?.maxRows ?? null,
        columns: table.columns.map(toContractColumn),
      }));

  const fallbackTable: ContractTable = {
    sheet: form.layout === 'single' ? null : 'Sheet1',
    headerRow: null,
    allowExtraColumns: true,
    minRows: null,
    maxRows: null,
    columns: [],
  };
  return {
    ...form.contract,
    schemaVersion: 1,
    layout: form.layout,
    tables: [tables[0] ?? fallbackTable, ...tables.slice(1)],
  };
};

function BasicColumnsEditor({
  columns,
  onChange,
  tableLabel,
}: {
  columns: FileDefinitionColumn[];
  onChange: (columns: FileDefinitionColumn[]) => void;
  tableLabel: string;
}) {
  const update = (index: number, changes: Partial<FileDefinitionColumn>) => {
    onChange(columns.map((column, current) => current === index ? { ...column, ...changes } : column));
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-gray-600">{columns.length} column{columns.length === 1 ? '' : 's'}</p>
        <button
          type="button"
          onClick={() => onChange([...columns, { ...EMPTY_COLUMN }])}
          className="flex items-center gap-1 rounded-md border border-blue-300 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
        >
          <Plus size={16} /> Add column
        </button>
      </div>
      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table className="min-w-full text-xs" aria-label={`Columns for ${tableLabel}`}>
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Column</th>
              <th className="w-24 px-2 py-1.5 text-left font-medium">Type</th>
              <th className="w-28 px-2 py-1.5 text-left font-medium">Required</th>
              <th className="w-12 px-2 py-1.5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {columns.map((column, index) => (
              <tr key={index}>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    aria-label={`Column name ${index + 1} in ${tableLabel}`}
                    value={column.name}
                    onChange={event => update(index, { name: event.target.value })}
                    placeholder="Column name"
                    required
                    className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs"
                  />
                </td>
                <td className="w-24 px-2 py-1.5">
                  <select
                    aria-label={`Data type for ${column.name || `column ${index + 1}`}`}
                    value={column.type}
                    onChange={event => update(index, { type: event.target.value })}
                    className="w-24 rounded border border-gray-300 bg-white px-2 py-1 text-xs"
                  >
                    <option value="string">String</option>
                    <option value="integer">Integer</option>
                    <option value="decimal">Decimal</option>
                    <option value="date">Date</option>
                    <option value="datetime">DateTime</option>
                    <option value="boolean">Boolean</option>
                  </select>
                </td>
                <td className="w-28 px-2 py-1.5">
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      aria-label={`Required for ${column.name || `column ${index + 1}`} in ${tableLabel}`}
                      checked={column.required}
                      onChange={event => update(index, {
                        required: event.target.checked,
                        mustExist: event.target.checked,
                        nullable: !event.target.checked,
                      })}
                      className="rounded border-gray-300"
                    />
                    <span>{column.required ? 'Yes' : 'No'}</span>
                  </label>
                </td>
                <td className="w-12 px-2 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => onChange(columns.filter((_, current) => current !== index))}
                    disabled={columns.length === 1}
                    className="rounded p-1.5 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30"
                    aria-label={`Remove column ${column.name || index + 1}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function FileDefinitions() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const newDefinitionMatch = useMatch('/admin/file-definitions/new');
  const editDefinitionMatch = useMatch('/admin/file-definitions/:definitionId/edit');
  const versionsDefinitionMatch = useMatch('/admin/file-definitions/:definitionId/versions');
  const isDefinitionWorkspace = Boolean(newDefinitionMatch || editDefinitionMatch || versionsDefinitionMatch);
  const routeDefinitionId = editDefinitionMatch?.params.definitionId ?? versionsDefinitionMatch?.params.definitionId;
  const handledDeepLink = useRef('');
  const initializedWorkspace = useRef('');
  const [definitions, setDefinitions] = useState<FileDefinitionAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<DefinitionForm>(EMPTY_FORM);

  // User management state
  const [showUserModal, setShowUserModal] = useState(false);
  const [selectedDefinitionId, setSelectedDefinitionId] = useState('');
  const [assignedUsers, setAssignedUsers] = useState<IFileDefinitionUser[]>([]);
  const [availableUsers, setAvailableUsers] = useState<IFileDefinitionUser[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  // User counts for table
  const [definitionUserCounts, setDefinitionUserCounts] = useState<Record<string, number>>({});
  const [uploading, setUploading] = useState(false);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [currentTemplateFilename, setCurrentTemplateFilename] = useState<string | null>(null);
  const [removeTemplateRequested, setRemoveTemplateRequested] = useState(false);
  const [notice, setNotice] = useState<{ text: string; definition?: FileDefinitionAdmin } | null>(null);
  const [pendingRules, setPendingRules] = useState<InitialRule[]>([]);
  const [showContractSettings, setShowContractSettings] = useState(false);
  const [creationPath, setCreationPath] = useState<'example' | 'clean' | null>(null);
  const [wizardStep, setWizardStep] = useState(1);
  const [changeNote, setChangeNote] = useState('');
  const [exampleProposal, setExampleProposal] = useState<ExampleProposal | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'unpublished'>('all');

  const editingDefinition = editingId ? definitions.find(def => def.id === editingId) : undefined;
  const filteredDefinitions = definitions.filter(definition => {
    const query = searchTerm.trim().toLowerCase();
    const matchesSearch = !query
      || definition.name.toLowerCase().includes(query)
      || definition.description.toLowerCase().includes(query);
    const matchesStatus = statusFilter === 'all'
      || (statusFilter === 'active' && definition.status === 'Active')
      || (statusFilter === 'inactive' && definition.status === 'Inactive')
      || (statusFilter === 'unpublished' && Boolean(definition.hasUnpublishedChanges));
    return matchesSearch && matchesStatus;
  });

  useEffect(() => {
    fetchDefinitions();
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

  useEffect(() => {
    if (newDefinitionMatch) {
      if (initializedWorkspace.current === 'new') return;
      initializedWorkspace.current = 'new';
      setEditingId(null);
      setFormData(EMPTY_FORM);
      setCurrentTemplateFilename(null);
      setTemplateFile(null);
      setRemoveTemplateRequested(false);
      setPendingRules([]);
      setShowContractSettings(false);
      setCreationPath(null);
      setWizardStep(1);
      setChangeNote('');
      setExampleProposal(null);
      setError(null);
      return;
    }

    if (!routeDefinitionId || definitions.length === 0) return;
    const workspaceKey = `edit:${routeDefinitionId}`;
    if (initializedWorkspace.current === workspaceKey) return;
    const definition = definitions.find(item => item.id === routeDefinitionId);
    if (!definition) {
      initializedWorkspace.current = workspaceKey;
      setError('File definition not found');
      return;
    }
    initializedWorkspace.current = workspaceKey;
    populateEditor(definition);
  }, [definitions, newDefinitionMatch, routeDefinitionId]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (uploading) return;

    const payload = {
      name: formData.name,
      description: formData.description,
      columns: formData.layout === 'single' ? formData.columns : [],
      tables: formData.layout === 'sheets' ? formData.tables : [],
      status: editingId ? formData.status : 'Active',
      deliveryFolder: formData.deliveryFolder.trim() || null,
      contract: buildDefinitionContract(formData),
    };
    const initialRules = editingId ? [] : rulesForLayout(pendingRules, formData).kept;

    let savedId: string | null = null;
    const wasEditing = Boolean(editingId);
    let succeeded = false;
    let publishedVersion: { versionNumber: number } | null = null;

    try {
      setUploading(true);
      setError(null);

      const saved = editingId
        ? await updateFileDefinitionAdmin(editingId, payload)
        : await createFileDefinitionAdmin(initialRules.length > 0 ? { ...payload, rules: initialRules } : payload);
      savedId = saved?.id || editingId;
      if (templateFile) {
        if (!savedId) {
          throw new Error('Definition was saved, but its id was not returned');
        }
        await uploadTemplate(savedId, templateFile);
      } else if (editingId && removeTemplateRequested && currentTemplateFilename) {
        await removeTemplate(editingId);
      }
      if (editingId) {
        const published = await publishFileDefinitionVersion(editingId, changeNote || undefined);
        publishedVersion = { versionNumber: published.versionNumber };
      }
      succeeded = true;
      closeWorkspace();
    } catch (err) {
      console.error('Failed to publish file definition:', err);
      setError(err instanceof Error ? err.message : 'Failed to publish file definition');
    } finally {
      setUploading(false);
      const refreshed = await fetchDefinitions();
      const current = refreshed.find(def => def.id === savedId);
      if (succeeded && current) {
        if (!wasEditing) {
          const ruleText = initialRules.length > 0 ? ` It includes ${initialRules.length} rule${initialRules.length === 1 ? '' : 's'}.` : '';
          setNotice({ text: `"${current.name}" was created and published as version ${current.activeVersion?.versionNumber ?? 1}.${ruleText}` });
        } else if (publishedVersion) {
          setNotice({ text: `"${current.name}" was published as version ${publishedVersion.versionNumber}.` });
        } else if (current.hasUnpublishedChanges) {
          setNotice({
            text: `"${current.name}" has unpublished changes. Uploads keep using v${current.activeVersion?.versionNumber ?? '-'} until you publish a new version.`,
            definition: current,
          });
        } else {
          setNotice({ text: `"${current.name}" was saved.` });
        }
      }
    }
  };

  const populateEditor = (def: FileDefinitionAdmin) => {
    const contract = def.contract ?? EMPTY_CONTRACT;
    const legacyTables = def.tables ?? [];
    const tables = legacyTables.length > 0
      ? legacyTables.map((table, index) => toEditorTable(table, def.contract?.tables[index]))
      : def.contract?.layout === 'sheets'
        ? def.contract.tables.map(table => toEditorTable(undefined, table))
        : [];
    const layout: DefinitionLayout = def.contract?.layout ?? (tables.length > 0 ? 'sheets' : 'single');
    const singleContractTable = contract.tables[0];
    setEditingId(def.id);
    setFormData({
      name: def.name,
      description: def.description || '',
      layout,
      columns: (singleContractTable?.columns.length ? singleContractTable.columns : def.columns).length > 0
        ? (singleContractTable?.columns.length ? singleContractTable.columns : def.columns).map(toEditorColumn)
        : INITIAL_COLUMNS,
      tables,
      status: def.status,
      deliveryFolder: def.deliveryFolder || '',
      contract: {
        ...EMPTY_CONTRACT,
        ...contract,
        schemaVersion: 1,
        layout,
        ignoredSheets: contract.ignoredSheets ?? [],
        encoding: contract.encoding ?? 'auto',
        rules: contract.rules ?? [],
        lookups: contract.lookups ?? {},
        tables: contract.tables.length ? contract.tables : EMPTY_CONTRACT.tables,
      },
    });
    setCurrentTemplateFilename(def.templateFilename || null);
    setTemplateFile(null);
    setRemoveTemplateRequested(false);
    setPendingRules([]);
    setShowContractSettings(false);
    setCreationPath('clean');
    setExampleProposal(null);
    setWizardStep(1);
    setChangeNote('');
  };

  const applyExample = (proposal: ExampleProposal) => {
    setFormData(prev => ({
      ...prev,
      name: prev.name.trim() ? prev.name : proposal.suggestedName,
      layout: proposal.layout,
      columns: proposal.layout === 'single' ? proposal.columns : prev.columns,
      tables: proposal.layout === 'sheets' ? proposal.tables : prev.tables,
    }));
    setPendingRules(proposal.rules);
  };

  const stepLabels = creationPath === 'example'
    ? ['Details', 'Example file', 'Tables and columns', 'Review']
    : ['Details', 'Tables and columns', 'Review'];
  const finalWizardStep = stepLabels.length;
  const structureWizardStep = creationPath === 'example' ? 3 : 2;
  const isStructureWizardStep = wizardStep === structureWizardStep;
  const isReviewStep = wizardStep === finalWizardStep;
  const nextPublishedVersionNumber = editingDefinition?.activeVersion ? editingDefinition.activeVersion.versionNumber + 1 : 1;

  const canMoveToNextStep = () => {
    if (editingId) {
      if (wizardStep === 1) return Boolean(formData.name.trim());
      if (wizardStep === 2) {
        const tables = formData.layout === 'single'
          ? [{ sheet: null, columns: formData.columns }]
          : formData.tables;
        return tables.length > 0
          && tables.every(table => table.columns.length > 0 && table.columns.every(column => column.name.trim()))
          && (tables.length === 1 || tables.every(table => table.sheet?.trim()));
      }
      return true;
    }
    if (wizardStep === 1) return Boolean(formData.name.trim()) && Boolean(creationPath);
    if (creationPath === 'example' && wizardStep === 2) return Boolean(exampleProposal);
    if (wizardStep === structureWizardStep) {
      const tables = formData.layout === 'single'
        ? [{ sheet: null, columns: formData.columns }]
        : formData.tables;
      return tables.length > 0
        && tables.every(table => table.columns.length > 0 && table.columns.every(column => column.name.trim()))
        && (tables.length === 1 || tables.every(table => table.sheet?.trim()));
    }
    return true;
  };

  const cleanSlateTables = formData.layout === 'single'
    ? [{
        ...formData.contract.tables[0],
        sheet: 'Table 1',
        columns: formData.columns,
      }]
    : formData.tables;
  const summaryTables: FileDefinitionTable[] = formData.layout === 'single'
    ? [{
        sheet: 'Single table',
        headerRow: formData.contract.tables[0]?.headerRow ?? null,
        allowExtraColumns: formData.contract.tables[0]?.allowExtraColumns ?? true,
        minRows: formData.contract.tables[0]?.minRows ?? null,
        maxRows: formData.contract.tables[0]?.maxRows ?? null,
        columns: formData.columns,
      }]
    : formData.tables;

  const updateCleanSlateTable = (index: number, changes: Partial<FileDefinitionTable>) => {
    setFormData(prev => {
      if (prev.layout === 'single') {
        return {
          ...prev,
          columns: changes.columns ?? prev.columns,
          contract: {
            ...prev.contract,
            tables: [{
              ...prev.contract.tables[0],
              ...changes,
              sheet: null,
              columns: prev.contract.tables[0]?.columns ?? [],
            }],
          },
        };
      }
      return {
        ...prev,
        tables: prev.tables.map((table, current) => current === index ? { ...table, ...changes } : table),
      };
    });
  };

  const addCleanSlateTable = () => {
    setFormData(prev => {
      const first = prev.layout === 'single'
        ? prev.tables[0] ?? { sheet: 'Table 1', columns: prev.columns }
        : null;
      const existing = prev.layout === 'single' ? [first!] : prev.tables;
      return {
        ...prev,
        layout: 'sheets',
        tables: [...existing, { sheet: `Table ${existing.length + 1}`, columns: [{ ...EMPTY_COLUMN }] }],
      };
    });
  };

  const removeCleanSlateTable = (index: number) => {
    setFormData(prev => {
      const remaining = prev.tables.filter((_, current) => current !== index);
      if (remaining.length === 1) {
        return {
          ...prev,
          layout: 'single',
          columns: remaining[0].columns,
          tables: remaining,
        };
      }
      return { ...prev, tables: remaining };
    });
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

  const closeWorkspace = () => {
    setEditingId(null);
    setTemplateFile(null);
    setRemoveTemplateRequested(false);
    setCurrentTemplateFilename(null);
    setPendingRules([]);
    setShowContractSettings(false);
    setCreationPath(null);
    setExampleProposal(null);
    setWizardStep(1);
    setChangeNote('');
    setFormData(EMPTY_FORM);
    setError(null);
    initializedWorkspace.current = '';
    navigate('/admin/file-definitions');
  };

  const handleManageUsers = async (defId: string) => {
    try {
      setLoadingUsers(true);
      setSelectedDefinitionId(defId);
      setSelectedUserIds([]);

      // Load assigned users
      const assignedData = await getFileDefinitionUsers(defId);
      setAssignedUsers(assignedData.users);

      // Load all available users and filter out already assigned
      const availableData = await getAvailableUsers();
      const allAvailable = availableData.users || [];
      const filteredAvailable = allAvailable.filter(
        user => !assignedData.users.some((assigned: IFileDefinitionUser) => assigned.id === user.id)
      );
      setAvailableUsers(filteredAvailable);

    } catch (error) {
      console.error('Failed to load users:', error);
      setError('Failed to load users for this definition');
    } finally {
      setLoadingUsers(false);
      setShowUserModal(true);
    }
  };

  const handleCloseUserModal = () => {
    setShowUserModal(false);
    setSelectedDefinitionId('');
    setAssignedUsers([]);
    setAvailableUsers([]);
    setSelectedUserIds([]);
    setUserSearch('');
  };

  const handleRemoveUser = async (userId: string) => {
    if (!confirm('Remove this user from the file definition?')) return;
    
    try {
      await removeUserFromFileDefinition(selectedDefinitionId, userId);
      
      // Refresh lists
      const assignedData = await getFileDefinitionUsers(selectedDefinitionId);
      setAssignedUsers(assignedData.users);

      // Refresh available
      const availableData = await getAvailableUsers();
      const allAvailable = availableData.users || [];
      const filteredAvailable = allAvailable.filter(
        user => !assignedData.users.some((assigned: IFileDefinitionUser) => assigned.id === user.id)
      );
      setAvailableUsers(filteredAvailable);
      
      setError(null);
    } catch (err) {
      console.error('Failed to remove user:', err);
      setError('Failed to remove user');
    }
  };

  const toggleAvailableUser = (userId: string, checked: boolean) => {
    setSelectedUserIds(prev => 
      checked 
        ? [...prev, userId]
        : prev.filter(id => id !== userId)
    );
  };

  const handleAssignSelectedUsers = async () => {
    if (selectedUserIds.length === 0) return;
    
    try {
      await addUsersToFileDefinition(selectedDefinitionId, selectedUserIds);
      
      // Refresh lists
      const assignedData = await getFileDefinitionUsers(selectedDefinitionId);
      setAssignedUsers(assignedData.users);

      const availableData = await getAvailableUsers();
      const allAvailable = availableData.users || [];
      const filteredAvailable = allAvailable.filter(
        user => !assignedData.users.some((assigned: IFileDefinitionUser) => assigned.id === user.id)
      );
      setAvailableUsers(filteredAvailable);
      
      setSelectedUserIds([]);
      setError(null);
    } catch (err) {
      console.error('Failed to assign users:', err);
      setError('Failed to assign users');
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

  const handleTemplateFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setTemplateFile(file);
    if (file) setRemoveTemplateRequested(false);
  };




  if (loading) {
    return (
      <div className="w-full">
        <div className="flex justify-between items-center mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">File Definitions</h1>
        </div>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {!isDefinitionWorkspace && (
        <>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">File Definitions</h1>
        <button
          onClick={() => navigate('/admin/file-definitions/new')}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm flex items-center gap-2"
        >
          <Plus size={18} />
          New definition
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {notice && (
        <div role="status" className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 text-sm flex flex-wrap items-center justify-between gap-2">
          <span>{notice.text}</span>
          <div className="flex items-center gap-3">
            {notice.definition && (
              <button
                onClick={() => navigate(`/admin/file-definitions/${encodeURIComponent(notice.definition!.id)}/versions`)}
                className="px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-xs font-semibold"
              >
                Review &amp; publish
              </button>
            )}
            <button onClick={() => setNotice(null)} className="text-blue-700 hover:text-blue-900" aria-label="Dismiss">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {definitions.length > 0 && (
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative min-w-0 flex-1 sm:max-w-md">
            <span className="sr-only">Search file definitions</span>
            <Search size={18} className="pointer-events-none absolute left-3 top-3 text-gray-400" aria-hidden="true" />
            <input
              type="search"
              value={searchTerm}
              onChange={event => setSearchTerm(event.target.value)}
              placeholder="Search definitions"
              className="min-h-11 w-full rounded-md border border-gray-300 py-2 pl-10 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            Status
            <select
              value={statusFilter}
              onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}
              className="min-h-11 rounded-md border border-gray-300 bg-white px-3 py-2"
            >
              <option value="all">All definitions</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="unpublished">Draft changes</option>
            </select>
          </label>
        </div>
      )}

      {definitions.length === 0 ? (
        <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">
          No file definitions found. Select "New definition" to create one.
        </div>
      ) : (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Columns</th>
                  <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Version</th>
                  <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Users</th>
                  <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredDefinitions.map((def) => {
                  const userCount = definitionUserCounts[def.id] || 0;
                  return (
                    <tr key={def.id} className="hover:bg-gray-50">
                      <td className="px-4 sm:px-6 py-4">
                        <div className="text-sm font-medium text-gray-900">{def.name}</div>
                        {def.description && (
                          <div className="text-sm text-gray-500 truncate max-w-xs">{def.description}</div>
                        )}
                      </td>
                      <td className="px-4 sm:px-6 py-4 text-sm whitespace-nowrap text-gray-500">
                        {def.tables && def.tables.length > 0
                          ? `${def.tables.length} sheet${def.tables.length === 1 ? '' : 's'}, ${def.tables.reduce((sum, t) => sum + t.columns.length, 0)} columns`
                          : `${def.columns?.length || 0} columns`}
                      </td>
                      <td className="px-4 sm:px-6 py-4">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          def.status === 'Active' 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-gray-100 text-gray-800'
                        }`}>
                          {def.status}
                        </span>
                      </td>
                      <td className="px-4 sm:px-6 py-4 text-sm whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1">
                          <span className="font-medium text-gray-900">
                            {def.activeVersion ? `v${def.activeVersion.versionNumber}` : 'Not published'}
                          </span>
                          {def.hasUnpublishedChanges && def.activeVersion && (
                            <span
                              title="Has unpublished changes"
                              className="px-2 text-xs leading-5 font-semibold rounded-full bg-amber-100 text-amber-800"
                            >
                              Unpublished
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 sm:px-6 py-4 text-sm whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                            {userCount} users
                          </span>
                          <button
                            onClick={() => handleManageUsers(def.id)}
                            className="text-indigo-600 hover:text-indigo-900 p-1 rounded hover:bg-indigo-50"
                            title="Manage Users"
                          >
                            <Users size={18} />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 sm:px-6 py-4 text-sm whitespace-nowrap">
                        <button
                          onClick={() => navigate(`/admin/file-definitions/${encodeURIComponent(def.id)}/edit`)}
                          className="mr-3 font-semibold text-blue-700 hover:text-blue-900"
                        >
                          Edit
                        </button>
                        <Link
                          to={`/admin/rules?definitionId=${encodeURIComponent(def.id)}`}
                          className="mr-3 font-semibold text-blue-700 hover:text-blue-900"
                        >
                          Rules
                        </Link>
                        <button
                          onClick={() => navigate(`/admin/file-definitions/${encodeURIComponent(def.id)}/versions`)}
                          className="mr-3 font-semibold text-purple-700 hover:text-purple-900"
                        >
                          Versions
                        </button>
                        <button
                          onClick={() => handleDownload(def.id)}
                          className="text-green-600 hover:text-green-900 mr-3"
                          title="Download Definition"
                        >
                          <Download size={18} />
                        </button>
                        <button
                          onClick={() => handleDelete(def.id)}
                          className="text-red-600 hover:text-red-900"
                          title="Delete"
                        >
                          <Trash2 size={18} />
                        </button>

                      </td>
                    </tr>
                  );
                })}
                {filteredDefinitions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-sm text-gray-500">
                      No definitions match the current search and status filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
        </>
      )}

      {isDefinitionWorkspace && (
        <div className="mx-auto w-full max-w-6xl">
          <div className="mb-4 flex flex-col gap-4 border-b border-gray-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              {editingId && (
                <button
                  type="button"
                  onClick={closeWorkspace}
                  className="mt-0.5 flex min-h-11 min-w-11 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  aria-label="Back to file definitions"
                >
                  <ArrowLeft size={20} />
                </button>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-blue-700">File Definitions</p>
                <h1 id="definition-editor-title" className="truncate text-xl font-bold text-gray-900 sm:text-2xl">
                  {editingId ? formData.name || 'Edit definition' : 'Create a new definition'}
                </h1>
                <p className="mt-1 text-sm text-gray-600">
                  {editingDefinition?.activeVersion
                    ? `Published v${editingDefinition.activeVersion.versionNumber}${editingDefinition.hasUnpublishedChanges ? ' · Draft changes' : ''}`
                    : 'Configure the structure, then publish version 1.'}
                </p>
              </div>
            </div>
            {editingId && (
              <nav aria-label="Definition workspace" className="flex flex-wrap gap-2 text-sm">
                <Link
                  to={`/admin/file-definitions/${encodeURIComponent(editingId)}/edit`}
                  aria-current={editDefinitionMatch ? 'page' : undefined}
                  className={`rounded-md px-3 py-2 font-semibold ${editDefinitionMatch ? 'bg-blue-100 text-blue-800' : 'text-gray-700 hover:bg-gray-100'}`}
                >
                  Definition
                </Link>
                <Link to={`/admin/rules?definitionId=${encodeURIComponent(editingId)}`} className="rounded-md px-3 py-2 font-semibold text-gray-700 hover:bg-gray-100">Rules</Link>
                <Link
                  to={`/admin/file-definitions/${encodeURIComponent(editingId)}/versions`}
                  aria-current={versionsDefinitionMatch ? 'page' : undefined}
                  className={`rounded-md px-3 py-2 font-semibold ${versionsDefinitionMatch ? 'bg-blue-100 text-blue-800' : 'text-gray-700 hover:bg-gray-100'}`}
                >
                  Versions
                </Link>
              </nav>
            )}
          </div>

          {versionsDefinitionMatch && editingDefinition && (
            <DefinitionVersionsModal
              definitionId={editingDefinition.id}
              definitionName={editingDefinition.name}
              embedded
              onClose={() => navigate(`/admin/file-definitions/${encodeURIComponent(editingDefinition.id)}/edit`)}
              onPublished={version => {
                setNotice({ text: `"${editingDefinition.name}" version ${version.versionNumber} is now active. New uploads are validated against it.` });
                void refreshVersionStates();
              }}
            />
          )}

          {!versionsDefinitionMatch && (
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <form onSubmit={handleSubmit} className="p-4 sm:p-6">
              {editingDefinition?.activeVersion && (
                <p className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-900">
                  Edit the definition below, then publish a new version when you are ready. Uploads keep using v{editingDefinition.activeVersion.versionNumber} until the new version is published.
                </p>
              )}
              <div className="mb-6 rounded-md border border-blue-200 bg-blue-50 p-4">
                <h2 className="font-semibold text-blue-950">Create and publish in one workspace</h2>
                <p className="mt-1 text-sm text-blue-900">
                  {editingId
                    ? `Update the definition details and structure, then review and publish version ${nextPublishedVersionNumber}.`
                    : 'Capture the definition details, choose how you want to start, then review and publish version 1.'}
                </p>
                <ol
                  className={`mt-3 grid gap-2 text-sm ${stepLabels.length === 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}
                  aria-label="Definition setup steps"
                >
                  {stepLabels.map((label, index) => (
                    <li
                      key={label}
                      className={`rounded px-3 py-2 font-medium ${
                        wizardStep === index + 1
                          ? 'bg-blue-600 text-white'
                          : index + 1 < wizardStep
                            ? 'bg-blue-100 text-blue-900'
                            : 'bg-white/80 text-blue-900'
                      }`}
                    >
                      {index + 1}. {label}
                    </li>
                  ))}
                </ol>
              </div>
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700" role="alert">
                  {error}
                </div>
              )}

              {wizardStep === 1 && (
                <>
                  <div className="mb-4">
                    <label htmlFor="definition-name" className="block text-sm font-medium text-gray-700 mb-2">
                      Name *
                    </label>
                    <input
                      id="definition-name"
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>

                  <div className="mb-5">
                    <label htmlFor="definition-description" className="block text-sm font-medium text-gray-700 mb-2">
                      Description
                    </label>
                    <textarea
                      id="definition-description"
                      value={formData.description}
                      onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {!editingId && (
                  <section className="mb-5" aria-labelledby="definition-start-heading">
                    <h2 id="definition-start-heading" className="mb-2 text-sm font-medium text-gray-700">
                      How would you like to define the file structure?
                    </h2>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        aria-pressed={creationPath === 'example'}
                        onClick={() => {
                          setCreationPath('example');
                          setExampleProposal(null);
                          setPendingRules([]);
                        }}
                        className={`w-full rounded-lg border p-4 text-left transition-colors ${
                          creationPath === 'example' ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-300'
                        }`}
                      >
                        <span className="flex items-start gap-3">
                          <span className={`rounded-md p-2 ${creationPath === 'example' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                            <FileUp size={20} aria-hidden="true" />
                          </span>
                          <span className="min-w-0">
                            <span className="block font-semibold text-gray-900">Start from an example file</span>
                            <span className="mt-1 block text-sm text-gray-600">
                              Upload a representative CSV or Excel file to propose tables, columns, and suggested rules.
                            </span>
                          </span>
                        </span>
                      </button>

                      <button
                        type="button"
                        aria-pressed={creationPath === 'clean'}
                        onClick={() => {
                          setCreationPath('clean');
                          setExampleProposal(null);
                          setPendingRules([]);
                          setFormData(prev => ({
                            ...prev,
                            layout: 'single',
                            columns: INITIAL_COLUMNS.map(column => ({ ...column })),
                            tables: [],
                            contract: {
                              ...prev.contract,
                              layout: 'single',
                              tables: [{
                                ...EMPTY_CONTRACT.tables[0],
                                columns: EMPTY_CONTRACT.tables[0].columns.map(column => ({ ...column })),
                              }],
                            },
                          }));
                        }}
                        className={`w-full rounded-lg border p-4 text-left transition-colors ${
                          creationPath === 'clean' ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-300'
                        }`}
                      >
                        <span className="flex items-start gap-3">
                          <span className={`rounded-md p-2 ${creationPath === 'clean' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                            <FilePlus2 size={20} aria-hidden="true" />
                          </span>
                          <span className="min-w-0">
                            <span className="block font-semibold text-gray-900">Start from a clean slate</span>
                            <span className="mt-1 block text-sm text-gray-600">
                              Define the layout and columns yourself when no example file is available yet.
                            </span>
                          </span>
                        </span>
                      </button>
                    </div>
                  </section>
                  )}
                </>
              )}

              {((creationPath === 'example' && wizardStep === 2) || isStructureWizardStep) && (
                <section className="mb-5" aria-live="polite">
                  {creationPath === 'example' && wizardStep === 2 ? (
                    <>
                      <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                        Upload the example file, review the suggested sheets, then continue to tables and columns.
                      </div>
                      <ExampleFileAssistant allowRules onProposalChange={setExampleProposal} embedded />
                    </>
                  ) : (
                    <div>
                      <div className="mb-3 flex flex-wrap items-start justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 p-3">
                        <div>
                          <h3 className="text-sm font-semibold text-blue-950">Define tables and columns</h3>
                          <p className="mt-1 text-sm text-blue-900">
                            Add the tables you need. A single table supports CSV and workbooks with one shared structure;
                            adding another table creates a named multi-sheet workbook definition.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={addCleanSlateTable}
                          className="flex items-center gap-1 rounded-md border border-blue-300 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                        >
                          <Plus size={16} /> Add table
                        </button>
                      </div>
                      <div className="space-y-4">
                        {cleanSlateTables.map((table, tableIndex) => (
                          <section
                            key={tableIndex}
                            aria-label={`Table ${tableIndex + 1}`}
                            className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50/50"
                          >
                            <div className="flex items-center gap-3 p-3">
                              {cleanSlateTables.length === 1 ? (
                                <div className="flex-1">
                                  <p className="text-sm font-semibold text-gray-900">Table 1</p>
                                  <p className="text-xs text-gray-500">The name is not matched for a single-table definition.</p>
                                </div>
                              ) : (
                                <label className="flex-1 text-xs font-medium text-gray-600">
                                  Table name *
                                  <input
                                    type="text"
                                    value={table.sheet}
                                    maxLength={31}
                                    onChange={event => updateCleanSlateTable(tableIndex, { sheet: event.target.value })}
                                    required
                                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm"
                                  />
                                </label>
                              )}
                              <button
                                type="button"
                                onClick={() => removeCleanSlateTable(tableIndex)}
                                disabled={cleanSlateTables.length === 1}
                                className="rounded p-2 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30"
                                aria-label={`Remove table ${table.sheet || tableIndex + 1}`}
                              >
                                <Trash2 size={18} />
                              </button>
                            </div>
                            <div className="border-t border-gray-200 bg-white p-3">
                              <details className="mb-3 rounded-md border border-gray-200 p-3">
                                <summary className="cursor-pointer text-xs font-medium text-gray-700">
                                  Table settings
                                </summary>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                                  <label className="text-xs text-gray-600">
                                    Header row
                                    <input
                                      aria-label={`Header row for ${table.sheet}`}
                                      type="number"
                                      min="1"
                                      value={table.headerRow ?? ''}
                                      onChange={event => updateCleanSlateTable(tableIndex, {
                                        headerRow: event.target.value === '' ? null : Number(event.target.value),
                                      })}
                                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
                                    />
                                  </label>
                                  <label className="flex items-center gap-2 text-xs text-gray-700">
                                    <input
                                      type="checkbox"
                                      checked={table.allowExtraColumns ?? true}
                                      onChange={event => updateCleanSlateTable(tableIndex, { allowExtraColumns: event.target.checked })}
                                      className="rounded border-gray-300"
                                    />
                                    Allow extra columns
                                  </label>
                                  {(['minRows', 'maxRows'] as const).map(field => (
                                    <label key={field} className="text-xs text-gray-600">
                                      {field === 'minRows' ? 'Minimum rows' : 'Maximum rows'}
                                      <input
                                        aria-label={`${field === 'minRows' ? 'Minimum rows' : 'Maximum rows'} for ${table.sheet}`}
                                        type="number"
                                        min="0"
                                        value={table[field] ?? ''}
                                        onChange={event => updateCleanSlateTable(tableIndex, {
                                          [field]: event.target.value === '' ? null : Number(event.target.value),
                                        })}
                                        className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
                                      />
                                    </label>
                                  ))}
                                </div>
                              </details>
                              <BasicColumnsEditor
                                columns={table.columns}
                                onChange={columns => updateCleanSlateTable(tableIndex, { columns })}
                                tableLabel={table.sheet || `Table ${tableIndex + 1}`}
                              />
                            </div>
                          </section>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              )}

              {editingId && wizardStep === 1 && (
                <div className="mb-5 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Status
                    </label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>
                </div>
              )}

              {wizardStep === 2 && (
                <details
                  open={showContractSettings}
                  onToggle={event => setShowContractSettings(event.currentTarget.open)}
                  className="mb-4 rounded-md border border-gray-200 p-3"
                >
                  <summary className="cursor-pointer font-medium text-gray-800">File contract settings</summary>
                  <p className="mt-1 text-xs text-gray-500">Advanced parsing options for text files and Excel workbooks.</p>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-sm text-gray-700">
                      Text encoding
                      <select
                        aria-label="Text encoding"
                        value={formData.contract.encoding}
                        onChange={e => setFormData(prev => ({
                          ...prev,
                          contract: { ...prev.contract, encoding: e.target.value as DefinitionContract['encoding'] },
                        }))}
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      >
                        <option value="auto">Auto detect</option>
                        <option value="utf-8">UTF-8</option>
                        <option value="utf-16">UTF-16</option>
                        <option value="windows-1252">Windows-1252</option>
                        <option value="iso-8859-1">ISO-8859-1</option>
                      </select>
                    </label>
                    <label className="text-sm text-gray-700">
                      Ignored workbook sheets
                      <textarea
                        aria-label="Ignored workbook sheets"
                        value={formData.contract.ignoredSheets.join('\n')}
                        onChange={e => setFormData(prev => ({
                          ...prev,
                          contract: {
                            ...prev.contract,
                            ignoredSheets: e.target.value.split('\n').map(sheet => sheet.trim()).filter(Boolean),
                          },
                        }))}
                        rows={3}
                        placeholder="One sheet name per line"
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      />
                      <span className="mt-1 block text-xs text-gray-500">These workbook sheets are skipped during validation.</span>
                    </label>
                  </div>
                </details>
              )}

              {!editingId && pendingRules.length > 0 && (
                <div className="mb-4">
                  <p className="block text-sm font-medium text-gray-700 mb-2">Rules published with version 1</p>
                  <ul className="space-y-1">
                    {pendingRules.map(rule => {
                      const skipped = rulesForLayout([rule], formData).skipped.length > 0;
                      const key = pendingRuleKey(rule);
                      return (
                        <li key={key} className="flex items-center justify-between gap-2 text-sm bg-gray-50 border border-gray-200 rounded-md px-3 py-1.5">
                          <span className={skipped ? 'text-gray-400 line-through' : 'text-gray-800'}>
                            {rule.table && <span className="text-xs text-gray-500 mr-1">{rule.table} ›</span>}
                            {rule.name} <code className="text-xs bg-white px-1 rounded">{rule.expression}</code>
                          </span>
                          <span className="flex items-center gap-2">
                            {skipped && <span className="text-xs text-amber-700">Sheet or column removed; will be skipped</span>}
                            <button
                              type="button"
                              onClick={() => setPendingRules(prev => prev.filter(r => pendingRuleKey(r) !== key))}
                              className="text-red-600 hover:text-red-700"
                              aria-label={`Remove rule ${rule.name}${rule.table ? ` for ${rule.table}` : ''}`}
                            >
                              <X size={16} />
                            </button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {editingId && wizardStep === 1 && (
                <details className="mb-4 rounded-md border border-gray-200 p-3">
                  <summary className="cursor-pointer font-medium text-gray-800">Delivery and reusable template</summary>
                  <p className="mt-1 text-xs text-gray-500">Optional settings for what happens after validation and for helping users prepare files.</p>
                {/* Delivery Section */}
                <div className="mt-4 mb-4">
                  <label htmlFor="deliveryFolder" className="block text-sm font-medium text-gray-700 mb-2">
                    Delivery folder (optional)
                  </label>
                  <input
                    id="deliveryFolder"
                    type="text"
                    value={formData.deliveryFolder}
                    onChange={(e) => setFormData(prev => ({ ...prev, deliveryFolder: e.target.value }))}
                    placeholder="e.g. finance/customers"
                    maxLength={200}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Relative to the server delivery root. Leave empty to finish uploads as validated without delivery.
                  </p>
                </div>

                {/* Template Attachment Section */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Template File (Excel/CSV - optional)
                  </label>
                  {currentTemplateFilename && !removeTemplateRequested && (
                    <div className="mb-2 p-2 bg-gray-50 rounded-md text-sm text-gray-600">
                      <span>Current: {currentTemplateFilename}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setTemplateFile(null);
                          setRemoveTemplateRequested(true);
                        }}
                        className="ml-3 font-semibold text-red-600 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                  {removeTemplateRequested && (
                    <div className="mb-2 flex items-center justify-between rounded-md bg-amber-50 p-2 text-sm text-amber-900">
                      <span>The current template will be removed when this version is published.</span>
                      <button type="button" onClick={() => setRemoveTemplateRequested(false)} className="font-semibold underline">
                        Undo
                      </button>
                    </div>
                  )}
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv,.txt"
                    onChange={handleTemplateFileChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  />
                  {templateFile && (
                    <div className="mt-1 text-xs text-gray-500">
                      Selected: {templateFile.name}
                    </div>
                  )}
                </div>
                </details>
              )}

              {isReviewStep && (
                <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-4">
                  <h3 className="text-base font-semibold text-blue-950">Review and publish</h3>
                  <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="rounded bg-white p-3">
                      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Name</dt>
                      <dd className="mt-1 text-sm font-semibold text-gray-900">{formData.name || 'Untitled definition'}</dd>
                    </div>
                    <div className="rounded bg-white p-3">
                      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{editingId ? 'Publishing' : 'Starting point'}</dt>
                      <dd className="mt-1 text-sm font-semibold text-gray-900">
                        {editingId ? `Version ${nextPublishedVersionNumber}` : creationPath === 'example' ? 'Example file' : 'Clean slate'}
                      </dd>
                    </div>
                    <div className="rounded bg-white p-3">
                      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Layout</dt>
                      <dd className="mt-1 text-sm font-semibold text-gray-900">{formData.layout === 'single' ? 'Single table' : 'Multiple tables'}</dd>
                    </div>
                    <div className="rounded bg-white p-3">
                      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Tables &amp; columns</dt>
                      <dd className="mt-1 text-sm font-semibold text-gray-900">
                        {formData.layout === 'single'
                          ? `${formData.columns.length} columns in one table`
                          : `${formData.tables.length} table${formData.tables.length === 1 ? '' : 's'} (${formData.tables.reduce((total, table) => total + table.columns.length, 0)} columns)`}
                      </dd>
                    </div>
                  </dl>
                  {formData.description && (
                    <div className="mt-3 rounded bg-white p-3 text-sm text-gray-700">
                      <span className="font-medium text-gray-900">Description:</span> {formData.description}
                    </div>
                  )}
                  {editingId && (
                    <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                      <div className="rounded bg-white p-3">
                        <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Status</dt>
                        <dd className="mt-1 text-sm font-semibold text-gray-900">{formData.status}</dd>
                      </div>
                      <div className="rounded bg-white p-3">
                        <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Delivery folder</dt>
                        <dd className="mt-1 text-sm font-semibold text-gray-900">{formData.deliveryFolder || 'None'}</dd>
                      </div>
                      <div className="rounded bg-white p-3">
                        <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Reusable template</dt>
                        <dd className="mt-1 text-sm font-semibold text-gray-900">
                          {templateFile?.name || (removeTemplateRequested ? 'Remove current template' : currentTemplateFilename || 'None')}
                        </dd>
                      </div>
                    </dl>
                  )}
                  <div className="mt-3 space-y-3">
                    {summaryTables.map((table, tableIndex) => (
                      <section key={`${table.sheet}-${tableIndex}`} className="rounded bg-white p-3" aria-label={`Review table ${table.sheet}`}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <h4 className="font-semibold text-gray-900">{table.sheet}</h4>
                            <p className="text-xs text-gray-500">
                              Header row {table.headerRow ?? 'Auto detect'} · {table.allowExtraColumns ?? true ? 'Extra columns allowed' : 'Exact columns only'}
                              {' · '}Rows {table.minRows ?? 0}–{table.maxRows ?? 'Unlimited'}
                            </p>
                          </div>
                          <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800">
                            {table.columns.length} column{table.columns.length === 1 ? '' : 's'}
                          </span>
                        </div>
                        <ul className="mt-3 divide-y divide-gray-100 rounded border border-gray-200">
                          {table.columns.map(column => (
                            <li key={column.name} className="grid gap-1 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_8rem_8rem]">
                              <div>
                                <span className="font-medium text-gray-900">{column.name}</span>
                              </div>
                              <span className="text-gray-600">{column.type}</span>
                              <span className="text-gray-600">
                                {column.required ? 'Required' : 'Optional'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                  {pendingRules.length > 0 && (
                    <div className="mt-3 rounded bg-white p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Suggested rules</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
                        {pendingRules.map(rule => (
                          <li key={pendingRuleKey(rule)}>{rule.name}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {editingId && isReviewStep && (
                <div className="mb-4 rounded-md border border-gray-200 bg-gray-50 p-3">
                  <label htmlFor="change-note" className="mb-2 block text-sm font-medium text-gray-700">
                    Change note (optional)
                  </label>
                  <textarea
                    id="change-note"
                    value={changeNote}
                    onChange={e => setChangeNote(e.target.value)}
                    maxLength={500}
                    rows={2}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Describe the changes included in this version"
                  />
                </div>
              )}

              <div className="sticky bottom-0 -mx-4 flex justify-between gap-3 border-t bg-white px-4 pt-4 pb-1 shadow-[0_-8px_16px_-16px_rgba(15,23,42,0.5)]">
                <button
                  type="button"
                  onClick={closeWorkspace}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  {editingId ? 'Back to definitions' : 'Cancel'}
                </button>

                {wizardStep < finalWizardStep ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      if (wizardStep === 2 && creationPath === 'example' && exampleProposal) {
                        applyExample(exampleProposal);
                      }
                      setWizardStep(prev => prev + 1);
                    }}
                    disabled={!canMoveToNextStep()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={uploading || !canMoveToNextStep()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Check size={18} />
                    {uploading
                      ? 'Publishing...'
                      : `Publish version ${editingId ? nextPublishedVersionNumber : 1}`}
                  </button>
                )}
              </div>

            </form>
          </div>
          )}
        </div>
      )}

      {/* Manage Users Modal */}
      {showUserModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-bold">
                Manage Users - {definitions.find(d => d.id === selectedDefinitionId)?.name || 'Loading...'}
              </h2>
              <button 
                onClick={handleCloseUserModal} 
                className="text-gray-500 hover:text-gray-700"
              >
                <X size={24} />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              {loadingUsers ? (
                <div className="flex items-center justify-center h-32">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : (
                <>
                  {/* Assigned Users */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <Users size={20} className="text-green-600" />
                      Assigned Users ({assignedUsers.length})
                    </h3>
                    {assignedUsers.length === 0 ? (
                      <p className="text-gray-500 text-sm">No users assigned to this file definition.</p>
                    ) : (
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {assignedUsers.map((user) => (
                          <div key={user.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                            <div>
                              <div className="font-medium text-sm">{user.firstName} {user.lastName}</div>
                              <div className="text-xs text-gray-500">{user.email}</div>
                            </div>
                            <button
                              onClick={() => handleRemoveUser(user.id)}
                              className="text-red-600 hover:text-red-900 p-1 rounded hover:bg-red-50"
                              title="Remove User"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Available Users */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <Users size={20} className="text-blue-600" />
                      Available Users ({availableUsers.length})
                    </h3>
                    <div className="mb-3">
                      <input
                        type="text"
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                        placeholder="Search available users..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    {availableUsers.length === 0 ? (
                      <p className="text-gray-500 text-sm">No available users to assign.</p>
                    ) : (
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {availableUsers
                          .filter(user => 
                            userSearch === '' || 
                            user.firstName?.toLowerCase().includes(userSearch.toLowerCase()) ||
                            user.lastName?.toLowerCase().includes(userSearch.toLowerCase()) ||
                            user.email.toLowerCase().includes(userSearch.toLowerCase())
                          )
                          .map((user) => (
                            <label key={user.id} className="flex items-center p-3 hover:bg-gray-50 rounded-lg cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedUserIds.includes(user.id)}
                                onChange={(e) => toggleAvailableUser(user.id, e.target.checked)}
                                className="rounded border-gray-300 mr-3"
                              />
                              <div>
                                <div className="font-medium text-sm">{user.firstName} {user.lastName}</div>
                                <div className="text-xs text-gray-500">{user.email}</div>
                              </div>
                            </label>
                          ))}
                      </div>
                    )}
                    {selectedUserIds.length > 0 && (
                      <button
                        onClick={handleAssignSelectedUsers}
                        className="mt-3 w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 flex items-center justify-center gap-2"
                      >
                        Assign {selectedUserIds.length} Selected User{selectedUserIds.length > 1 ? 's' : ''}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end p-4 border-t gap-3">
              <button
                onClick={handleCloseUserModal}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
