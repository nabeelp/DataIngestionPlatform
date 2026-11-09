import { useState } from 'react';
import type { AdminUser } from '../../services/adminApi';
import {
  useAdminUsersQuery,
  useCreateUserMutation,
  useDeleteUserMutation,
  useUnlockUserMutation,
  useUpdateUserMutation,
} from '../../services/hooks/users';
import { Plus, Edit, Trash2, X, Check, Unlock, Search } from 'lucide-react';
import CreateUserModal, { EMPTY_NEW_USER, type NewUserForm } from './user-management/CreateUserModal';
import EditUserModal, { EMPTY_EDIT_USER, type EditUserForm } from './user-management/EditUserModal';

export default function AdminUsers() {
  const [actionError, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [search, setSearch] = useState('');
  const [newUser, setNewUser] = useState<NewUserForm>(EMPTY_NEW_USER);
  const [formData, setFormData] = useState<EditUserForm>(EMPTY_EDIT_USER);

  const usersQuery = useAdminUsersQuery({ search });
  const users = usersQuery.data?.users ?? [];
  const loading = usersQuery.isFetching;
  const error = actionError ?? (usersQuery.isError ? 'Failed to load users' : null);
  const { mutateAsync: createUser } = useCreateUserMutation();
  const { mutateAsync: updateUser } = useUpdateUserMutation();
  const { mutateAsync: unlockUser } = useUnlockUserMutation();
  const { mutateAsync: deleteUser } = useDeleteUserMutation();

  const handleEdit = (user: AdminUser) => {
    setEditingUser(user);
    setFormData({
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      role: user.role,
      isActive: user.isActive
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    try {
      setError(null);
      await updateUser({ id: editingUser.id, updates: formData });
      closeModal();
    } catch (err) {
      console.error('Failed to update user:', err);
      setError('Failed to update user');
    }
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setCreateError(null);
    setNewUser(EMPTY_NEW_USER);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setIsCreating(true);

    try {
      await createUser(newUser);
      closeCreateModal();
    } catch (err) {
      console.error('Failed to create user:', err);
      setCreateError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setIsCreating(false);
    }
  };

  const handleUnlock = async (userId: string) => {
    try {
      setError(null);
      await unlockUser(userId);
    } catch (err) {
      console.error('Failed to unlock user:', err);
      setError('Failed to unlock user');
    }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    
    try {
      setError(null);
      await deleteUser(userId);
    } catch (err) {
      console.error('Failed to delete user:', err);
      setError('Failed to delete user');
    }
  };

  const handleToggleActive = async (user: AdminUser) => {
    try {
      setError(null);
      await updateUser({ id: user.id, updates: { isActive: !user.isActive } });
    } catch (err) {
      console.error('Failed to update user status:', err);
      setError('Failed to update user status');
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingUser(null);
    setFormData(EMPTY_EDIT_USER);
  };

  const isLocked = (user: AdminUser) => {
    if (!user.lockedUntil) return false;
    return new Date(user.lockedUntil) > new Date();
  };

  if (loading) {
    return (
      <div className="w-full">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">User Management</h1>
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
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">User Management</h1>
        
        {/* Search */}
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm w-full sm:w-64"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setCreateError(null);
              setShowCreateModal(true);
            }}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
          >
            <Plus size={18} />
            Add User
          </button>
        </div>
      </div>
      
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
      
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {user.email}
                  </td>
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {user.firstName} {user.lastName}
                  </td>
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      user.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                    }`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
                    {isLocked(user) ? (
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
                        Locked
                      </span>
                    ) : user.isActive ? (
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                        Active
                      </span>
                    ) : (
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <button 
                      onClick={() => handleEdit(user)}
                      className="text-blue-600 hover:text-blue-900 mr-2 sm:mr-3"
                      title="Edit"
                    >
                      <Edit size={18} />
                    </button>
                    {isLocked(user) && (
                      <button 
                        onClick={() => handleUnlock(user.id)}
                        className="text-green-600 hover:text-green-900 mr-2 sm:mr-3"
                        title="Unlock"
                      >
                        <Unlock size={18} />
                      </button>
                    )}
                    <button 
                      onClick={() => handleToggleActive(user)}
                      className={`mr-2 sm:mr-3 ${user.isActive ? 'text-yellow-600 hover:text-yellow-900' : 'text-green-600 hover:text-green-900'}`}
                      title={user.isActive ? 'Deactivate' : 'Activate'}
                    >
                      {user.isActive ? <X size={18} /> : <Check size={18} />}
                    </button>
                    <button 
                      onClick={() => handleDelete(user.id)}
                      className="text-red-600 hover:text-red-900"
                      title="Delete"
                    >
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {users.length === 0 && (
          <div className="p-8 text-center text-gray-500">
            No users found
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreateUserModal
          user={newUser}
          onChange={setNewUser}
          error={createError}
          isCreating={isCreating}
          onSubmit={handleCreateSubmit}
          onClose={closeCreateModal}
        />
      )}

      {/* Edit Modal */}
      {showModal && editingUser && (
        <EditUserModal
          user={editingUser}
          form={formData}
          onChange={setFormData}
          onSubmit={handleSubmit}
          onClose={closeModal}
        />
      )}
    </div>
  );
}
