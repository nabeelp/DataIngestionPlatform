import { useState, useEffect } from 'react';
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
  FileDefinitionAdmin,
  FileDefinitionColumn,
  IFileDefinitionUser,
  InitialRule
} from '../../services/adminApi';

import { Plus, Edit, Trash2, X, Check, Users, History } from 'lucide-react';
import { Download, FileText, Upload } from 'lucide-react';
import DefinitionVersionsModal from './DefinitionVersionsModal';
import ExampleFileAssistant from './ExampleFileAssistant';
import { rulesForColumns, type ColumnHint, type ExampleProposal } from './exampleProposal';

const INITIAL_COLUMNS: FileDefinitionColumn[] = [
  { name: 'Column1', type: 'string', required: true }
];

export default function FileDefinitions() {
  const [definitions, setDefinitions] = useState<FileDefinitionAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    columns: INITIAL_COLUMNS,
    status: 'Active',
    deliveryFolder: ''
  });

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
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [currentTemplateFilename, setCurrentTemplateFilename] = useState<string | null>(null);
  const [versionsFor, setVersionsFor] = useState<FileDefinitionAdmin | null>(null);
  const [notice, setNotice] = useState<{ text: string; definition?: FileDefinitionAdmin } | null>(null);
  const [exampleHints, setExampleHints] = useState<Record<string, ColumnHint>>({});
  const [pendingRules, setPendingRules] = useState<InitialRule[]>([]);

  const editingDefinition = editingId ? definitions.find(def => def.id === editingId) : undefined;

  useEffect(() => {
    fetchDefinitions();
  }, []);

  // Fetch user counts for table
  useEffect(() => {
    const fetchUserCounts = async () => {
      if (definitions.length === 0) return;
      try {
        setLoadingCounts(true);
        const counts = await getFileDefinitionUserCounts();
        setDefinitionUserCounts(counts);
      } catch (error) {
        console.error('Failed to fetch user counts:', error);
      } finally {
        setLoadingCounts(false);
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

  // Refresh without the page spinner so an open modal stays mounted.
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
      columns: formData.columns,
      status: formData.status,
      deliveryFolder: formData.deliveryFolder.trim() || null
    };
    const initialRules = editingId ? [] : rulesForColumns(pendingRules, formData.columns).kept;

    let savedId: string | null = null;
    const wasEditing = Boolean(editingId);
    let succeeded = false;
    try {
      setUploading(true);
      setError(null);
      const saved = editingId
        ? await updateFileDefinitionAdmin(editingId, payload)
        : await createFileDefinitionAdmin(initialRules.length > 0 ? { ...payload, rules: initialRules } : payload);
      savedId = saved?.id || editingId;
    } catch (err) {
      console.error('Failed to save file definition:', err);
      setError(err instanceof Error ? err.message : 'Failed to save file definition');
      setUploading(false);
      return;
    }

    try {
      if (templateFile) {
        if (!savedId) {
          throw new Error('Definition was saved, but its id was not returned');
        }
        await uploadTemplate(savedId, templateFile);
      }
      succeeded = true;
      closeModal();
    } catch (err) {
      console.error('Failed to upload template:', err);
      // Keep the modal open in edit mode so the admin can retry the template upload.
      if (savedId) setEditingId(savedId);
      setError(`Definition saved, but the template upload failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setUploading(false);
      const refreshed = await fetchDefinitions();
      const current = refreshed.find(def => def.id === savedId);
      if (succeeded && current) {
        if (!wasEditing) {
          const ruleText = initialRules.length > 0 ? ` It includes ${initialRules.length} rule${initialRules.length === 1 ? '' : 's'}.` : '';
          setNotice({ text: `"${current.name}" was created and published as version ${current.activeVersion?.versionNumber ?? 1}.${ruleText}` });
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

  const handleEdit = (def: FileDefinitionAdmin) => {
    setEditingId(def.id);
    setFormData({
      name: def.name,
      description: def.description || '',
      columns: def.columns,
      status: def.status,
      deliveryFolder: def.deliveryFolder || ''
    });
    setCurrentTemplateFilename(def.templateFilename || null);
    setTemplateFile(null);
    setExampleHints({});
    setPendingRules([]);
    setShowModal(true);
  };

  const applyExample = (proposal: ExampleProposal) => {
    setFormData(prev => ({
      ...prev,
      name: prev.name.trim() ? prev.name : proposal.suggestedName,
      columns: proposal.columns,
    }));
    setExampleHints(proposal.hints);
    setPendingRules(proposal.rules);
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

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
    setTemplateFile(null);
    setCurrentTemplateFilename(null);
    setExampleHints({});
    setPendingRules([]);
    setFormData({
      name: '',
      description: '',
      columns: INITIAL_COLUMNS,
      status: 'Active',
      deliveryFolder: ''
    });
    setError(null);
  };

  const addColumn = () => {
    setFormData(prev => ({
      ...prev,
      columns: [...prev.columns, { name: '', type: 'string', required: false }]
    }));
  };

  const removeColumn = (index: number) => {
    setFormData(prev => ({
      ...prev,
      columns: prev.columns.filter((_, i) => i !== index)
    }));
  };

  const updateColumn = (index: number, field: keyof FileDefinitionColumn, value: any) => {
    setFormData(prev => ({
      ...prev,
      columns: prev.columns.map((col, i) => 
        i === index ? { ...col, [field]: value } : col
      )
    }));
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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">File Definitions</h1>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm flex items-center gap-2"
        >
          <Plus size={18} />
          Add Definition
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
                onClick={() => { setVersionsFor(notice.definition!); setNotice(null); }}
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

      {definitions.length === 0 ? (
        <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">
          No file definitions found. Click "Add Definition" to create one.
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
                {definitions.map((def) => {
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
                        {def.columns?.length || 0} columns
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
                          onClick={() => handleEdit(def)}
                          className="text-blue-600 hover:text-blue-900 mr-3"
                          title="Edit"
                        >
                          <Edit size={18} />
                        </button>
                        <button
                          onClick={() => setVersionsFor(def)}
                          className="text-purple-600 hover:text-purple-900 mr-3"
                          title="Versions"
                          aria-label={`Versions for ${def.name}`}
                        >
                          <History size={18} />
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
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-bold">
                {editingId ? 'Edit File Definition' : 'Add File Definition'}
              </h2>
              <button onClick={closeModal} className="text-gray-500 hover:text-gray-700">
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-4">
              {editingDefinition?.activeVersion && (
                <p className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-900">
                  Column changes are saved as a draft. Uploads keep using v{editingDefinition.activeVersion.versionNumber} until
                  you publish a new version from Versions. Name, status, delivery folder and template apply immediately.
                </p>
              )}
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700" role="alert">
                  {error}
                </div>
              )}
              <ExampleFileAssistant allowRules={!editingId} onApply={applyExample} />
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="mb-4">
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

              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Columns *
                  </label>
                  <button
                    type="button"
                    onClick={addColumn}
                    className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                  >
                    <Plus size={16} /> Add Column
                  </button>
                </div>
                
                {formData.columns.map((col, index) => (
                  <div key={index} className="mb-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={col.name}
                      onChange={(e) => updateColumn(index, 'name', e.target.value)}
                      placeholder="Column name"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      required
                    />
                    <select
                      value={col.type}
                      onChange={(e) => updateColumn(index, 'type', e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    >
                      <option value="string">String</option>
                      <option value="integer">Integer</option>
                      <option value="decimal">Decimal</option>
                      <option value="datetime">DateTime</option>
                      <option value="boolean">Boolean</option>
                    </select>
                    <label className="flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        checked={col.required}
                        onChange={(e) => updateColumn(index, 'required', e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      Required
                    </label>
                    {formData.columns.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeColumn(index)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <X size={18} />
                      </button>
                    )}
                  </div>
                  {exampleHints[col.name] && (
                    <p className="mt-0.5 ml-1 text-xs text-gray-500">
                      Example: {exampleHints[col.name].filledRows}/{exampleHints[col.name].rowsAnalyzed} rows filled
                      {exampleHints[col.name].sampleValues.length > 0 && ` · e.g. ${exampleHints[col.name].sampleValues.join(', ')}`}
                    </p>
                  )}
                  </div>
                ))}
              </div>

              {!editingId && pendingRules.length > 0 && (
                <div className="mb-4">
                  <p className="block text-sm font-medium text-gray-700 mb-2">Rules published with version 1</p>
                  <ul className="space-y-1">
                    {pendingRules.map(rule => {
                      const skipped = rulesForColumns([rule], formData.columns).skipped.length > 0;
                      return (
                        <li key={rule.name} className="flex items-center justify-between gap-2 text-sm bg-gray-50 border border-gray-200 rounded-md px-3 py-1.5">
                          <span className={skipped ? 'text-gray-400 line-through' : 'text-gray-800'}>
                            {rule.name} <code className="text-xs bg-white px-1 rounded">{rule.expression}</code>
                          </span>
                          <span className="flex items-center gap-2">
                            {skipped && <span className="text-xs text-amber-700">Column removed; will be skipped</span>}
                            <button
                              type="button"
                              onClick={() => setPendingRules(prev => prev.filter(r => r.name !== rule.name))}
                              className="text-red-600 hover:text-red-700"
                              aria-label={`Remove rule ${rule.name}`}
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

              {/* Delivery Section */}
              <div className="mb-4">
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
                {currentTemplateFilename && (
                  <div className="mb-2 p-2 bg-gray-50 rounded-md text-sm text-gray-600">
                    Current: {currentTemplateFilename}
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

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Check size={18} />
                  {uploading ? 'Saving...' : (editingId ? 'Update' : 'Create')}
                </button>
              </div>
            </form>
          </div>
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

      {versionsFor && (
        <DefinitionVersionsModal
          definitionId={versionsFor.id}
          definitionName={versionsFor.name}
          onClose={() => setVersionsFor(null)}
          onPublished={version => {
            setNotice({ text: `"${versionsFor.name}" version ${version.versionNumber} is now active. New uploads are validated against it.` });
            void refreshVersionStates();
          }}
        />
      )}
    </div>
  );
}

