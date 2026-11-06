import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import DefinitionsTable from './file-definitions/DefinitionsTable';
import DefinitionWorkspace from './file-definitions/DefinitionWorkspace';
import ManageUsersModal from './file-definitions/ManageUsersModal';
import { useDefinitionEditor, type DefinitionNotice } from './file-definitions/useDefinitionEditor';
import { useDefinitionRoute } from './file-definitions/useDefinitionRoute';
import { useDefinitionsList } from './file-definitions/useDefinitionsList';
import { useDefinitionUsers } from './file-definitions/useDefinitionUsers';

export { buildDefinitionContract } from './file-definitions/definitionForm';
export type { DefinitionForm } from './file-definitions/definitionForm';

export default function FileDefinitions() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const route = useDefinitionRoute();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<DefinitionNotice | null>(null);
  const list = useDefinitionsList({ isDefinitionWorkspace: route.isDefinitionWorkspace, setError });
  const users = useDefinitionUsers(setError);
  const editor = useDefinitionEditor({
    route,
    definitions: list.definitions,
    fetchDefinitions: list.fetchDefinitions,
    setError,
    setNotice,
  });

  if (list.loading) {
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
      {!route.isDefinitionWorkspace && (
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

      <DefinitionsTable
        definitions={list.definitions}
        filteredDefinitions={list.filteredDefinitions}
        userCounts={list.definitionUserCounts}
        searchTerm={list.searchTerm}
        onSearchTermChange={list.setSearchTerm}
        statusFilter={list.statusFilter}
        onStatusFilterChange={list.setStatusFilter}
        onManageUsers={users.handleManageUsers}
        onDownload={list.handleDownload}
        onDelete={list.handleDelete}
      />
        </>
      )}

      {route.isDefinitionWorkspace && (
        <DefinitionWorkspace
          editor={editor}
          route={route}
          error={error}
          token={token}
          setNotice={setNotice}
          refreshVersionStates={list.refreshVersionStates}
        />
      )}

      {users.showUserModal && (
        <ManageUsersModal
          definitionName={list.definitions.find(d => d.id === users.selectedDefinitionId)?.name}
          loading={users.loadingUsers}
          assignedUsers={users.assignedUsers}
          availableUsers={users.availableUsers}
          selectedUserIds={users.selectedUserIds}
          userSearch={users.userSearch}
          onUserSearchChange={users.setUserSearch}
          onToggleAvailableUser={users.toggleAvailableUser}
          onRemoveUser={users.handleRemoveUser}
          onAssignSelected={users.handleAssignSelectedUsers}
          onClose={users.handleCloseUserModal}
        />
      )}

    </div>
  );
}
