import { useState, FormEvent } from 'react';
import { Search, Plus, Edit, Trash2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useDeleteLookupMutation, useLookupsQuery, useSaveLookupMutation } from '../services/hooks/lookups';
import type { Lookup } from '../services/lookupApi';

interface LookupForm {
  name: string;
  description: string;
  values: string;
}

const EMPTY_FORM: LookupForm = { name: '', description: '', values: '' };

const parseValues = (text: string): string[] =>
  Array.from(new Set(text.split(/[\n,]/).map(value => value.trim()).filter(Boolean)));

export default function Lookups() {
  const { user } = useAuth();
  const isAdmin = user?.Role === 'admin';

  const lookupsQuery = useLookupsQuery();
  const lookups = lookupsQuery.data ?? [];
  const loading = lookupsQuery.isFetching;
  const [actionError, setError] = useState<string | null>(null);
  const error = actionError ?? (lookupsQuery.isError ? lookupsQuery.error.message || 'Failed to load lookups' : null);
  const [searchTerm, setSearchTerm] = useState('');
  const { mutateAsync: saveLookup } = useSaveLookupMutation();
  const { mutateAsync: removeLookup } = useDeleteLookupMutation();
  const fetchLookups = () => {
    setError(null);
    void lookupsQuery.refetch();
  };

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<LookupForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowModal(true);
  };

  const openEdit = (lookup: Lookup) => {
    setEditingId(lookup.id);
    setForm({ name: lookup.name, description: lookup.description, values: lookup.values.join('\n') });
    setFormError(null);
    setShowModal(true);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const values = parseValues(form.values);
    if (values.length === 0) {
      setFormError('Enter at least one value');
      return;
    }

    const input = { name: form.name.trim(), description: form.description.trim(), values };
    try {
      setSaving(true);
      setFormError(null);
      await saveLookup({ id: editingId, input });
      setError(null);
      setShowModal(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save lookup');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (lookup: Lookup) => {
    if (!confirm(`Delete lookup "${lookup.name}"?`)) return;
    try {
      setError(null);
      await removeLookup(lookup.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete lookup');
    }
  };

  const filteredLookups = lookups.filter(lookup =>
    lookup.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lookup.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatDate = (dateString: string): string =>
    new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  if (loading) {
    return (
      <div className="w-full">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4 sm:mb-6">Lookups</h1>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Lookups</h1>
        {isAdmin && (
          <button
            onClick={openCreate}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm flex items-center gap-2 w-full sm:w-auto justify-center"
          >
            <Plus size={16} />
            Add Lookup
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-md flex items-center justify-between" role="alert">
          <span>{error}</span>
          <button onClick={fetchLookups} className="text-sm underline">Retry</button>
        </div>
      )}

      <div className="mb-6 relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
        <input
          type="text"
          placeholder="Search lookups..."
          aria-label="Search lookups"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {filteredLookups.map((lookup) => (
          <div key={lookup.id} className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-900 truncate">{lookup.name}</h3>
              <span className="text-xs text-gray-500 flex-shrink-0 ml-2">{lookup.values.length} values</span>
            </div>
            <p className="text-xs text-gray-500 mb-4">{lookup.description}</p>
            <div className="flex flex-wrap gap-1 mb-4">
              {lookup.values.slice(0, 5).map((value) => (
                <span key={value} className="text-[10px] px-2 py-1 bg-gray-100 text-gray-700 rounded">
                  {value}
                </span>
              ))}
              {lookup.values.length > 5 && (
                <span className="text-[10px] px-2 py-1 text-gray-500">
                  +{lookup.values.length - 5} more
                </span>
              )}
            </div>
            <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
              <p className="text-[10px] text-gray-400">Updated: {formatDate(lookup.updatedAt || lookup.createdAt)}</p>
              {isAdmin && (
                <div className="flex gap-2">
                  <button onClick={() => openEdit(lookup)} className="text-blue-600 hover:text-blue-800" aria-label={`Edit ${lookup.name}`}>
                    <Edit size={16} />
                  </button>
                  <button onClick={() => handleDelete(lookup)} className="text-red-600 hover:text-red-800" aria-label={`Delete ${lookup.name}`}>
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {filteredLookups.length === 0 && !error && (
        <div className="text-center py-12">
          <Search size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">{lookups.length === 0 ? 'No lookups have been created yet' : 'No lookups match your search'}</p>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-bold">{editingId ? 'Edit Lookup' : 'Add Lookup'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-gray-700" aria-label="Close">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-4 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700" role="alert">{formError}</div>
              )}
              <div>
                <label htmlFor="lookupName" className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input
                  id="lookupName"
                  required
                  maxLength={100}
                  pattern="[A-Za-z0-9_.\-]+"
                  value={form.name}
                  onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="currency_codes"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="lookupDescription" className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input
                  id="lookupDescription"
                  maxLength={500}
                  value={form.description}
                  onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="lookupValues" className="block text-sm font-medium text-gray-700 mb-1">Values *</label>
                <textarea
                  id="lookupValues"
                  required
                  rows={8}
                  value={form.values}
                  onChange={(e) => setForm(prev => ({ ...prev, values: e.target.value }))}
                  placeholder={'USD\nEUR\nGBP'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                />
                <p className="mt-1 text-xs text-gray-500">One value per line or comma-separated. Duplicates are removed.</p>
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">
                  {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
