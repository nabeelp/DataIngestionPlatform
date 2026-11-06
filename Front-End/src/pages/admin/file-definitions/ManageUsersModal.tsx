import { Trash2, Users, X } from 'lucide-react';
import type { IFileDefinitionUser } from '../../../services/adminApi';

interface ManageUsersModalProps {
  definitionName?: string;
  loading: boolean;
  assignedUsers: IFileDefinitionUser[];
  availableUsers: IFileDefinitionUser[];
  selectedUserIds: string[];
  userSearch: string;
  onUserSearchChange: (value: string) => void;
  onToggleAvailableUser: (userId: string, checked: boolean) => void;
  onRemoveUser: (userId: string) => void;
  onAssignSelected: () => void;
  onClose: () => void;
}

export default function ManageUsersModal({
  definitionName,
  loading,
  assignedUsers,
  availableUsers,
  selectedUserIds,
  userSearch,
  onUserSearchChange,
  onToggleAvailableUser,
  onRemoveUser,
  onAssignSelected,
  onClose,
}: ManageUsersModalProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold">
            Manage Users - {definitionName || 'Loading...'}
          </h2>
          <button 
            onClick={onClose} 
            className="text-gray-500 hover:text-gray-700"
          >
            <X size={24} />
          </button>
        </div>
        
        <div className="p-6 space-y-6">
          {loading ? (
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
                          onClick={() => onRemoveUser(user.id)}
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
                    onChange={(e) => onUserSearchChange(e.target.value)}
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
                            onChange={(e) => onToggleAvailableUser(user.id, e.target.checked)}
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
                    onClick={onAssignSelected}
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
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
