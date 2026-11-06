import { Download, Search, Trash2, Users } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { FileDefinitionAdmin } from '../../../services/adminApi';
import type { StatusFilter } from './useDefinitionsList';

interface DefinitionsTableProps {
  definitions: FileDefinitionAdmin[];
  filteredDefinitions: FileDefinitionAdmin[];
  userCounts: Record<string, number>;
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (value: StatusFilter) => void;
  onManageUsers: (definitionId: string) => void;
  onDownload: (definitionId: string) => void;
  onDelete: (definitionId: string) => void;
}

const columnCount = (def: FileDefinitionAdmin) => def.contract.layout === 'sheets'
  ? `${def.contract.tables.length} sheet${def.contract.tables.length === 1 ? '' : 's'}, ${def.contract.tables.reduce((sum, t) => sum + t.columns.length, 0)} columns`
  : `${def.contract.tables[0]?.columns.length ?? 0} columns`;

/** The search/status filters and the table of file definitions. */
export default function DefinitionsTable({
  definitions,
  filteredDefinitions,
  userCounts,
  searchTerm,
  onSearchTermChange,
  statusFilter,
  onStatusFilterChange,
  onManageUsers,
  onDownload,
  onDelete,
}: DefinitionsTableProps) {
  const navigate = useNavigate();

  return (
    <>
      {definitions.length > 0 && (
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative min-w-0 flex-1 sm:max-w-md">
            <span className="sr-only">Search file definitions</span>
            <Search size={18} className="pointer-events-none absolute left-3 top-3 text-gray-400" aria-hidden="true" />
            <input
              type="search"
              value={searchTerm}
              onChange={event => onSearchTermChange(event.target.value)}
              placeholder="Search definitions"
              className="min-h-11 w-full rounded-md border border-gray-300 py-2 pl-10 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            Status
            <select
              value={statusFilter}
              onChange={event => onStatusFilterChange(event.target.value as StatusFilter)}
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
                  const userCount = userCounts[def.id] || 0;
                  return (
                    <tr key={def.id} className="hover:bg-gray-50">
                      <td className="px-4 sm:px-6 py-4">
                        <div className="text-sm font-medium text-gray-900">{def.name}</div>
                        {def.description && (
                          <div className="text-sm text-gray-500 truncate max-w-xs">{def.description}</div>
                        )}
                      </td>
                      <td className="px-4 sm:px-6 py-4 text-sm whitespace-nowrap text-gray-500">
                        {columnCount(def)}
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
                            onClick={() => onManageUsers(def.id)}
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
                          to={`/admin/file-definitions/${encodeURIComponent(def.id)}/edit?step=rules`}
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
                          onClick={() => onDownload(def.id)}
                          className="text-green-600 hover:text-green-900 mr-3"
                          title="Download Definition"
                        >
                          <Download size={18} />
                        </button>
                        <button
                          onClick={() => onDelete(def.id)}
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
  );
}
