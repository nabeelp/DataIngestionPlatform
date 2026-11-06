import { X } from 'lucide-react';

export interface NewUserForm {
  email: string;
  username: string;
  password: string;
  firstName: string;
  lastName: string;
  role: string;
}

export const EMPTY_NEW_USER: NewUserForm = {
  email: '',
  username: '',
  password: '',
  firstName: '',
  lastName: '',
  role: 'user',
};

interface CreateUserModalProps {
  user: NewUserForm;
  onChange: (update: (current: NewUserForm) => NewUserForm) => void;
  error: string | null;
  isCreating: boolean;
  onSubmit: (event: React.FormEvent) => void;
  onClose: () => void;
}

export default function CreateUserModal({ user: newUser, onChange: setNewUser, error: createError, isCreating, onSubmit, onClose }: CreateUserModalProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold">Add User</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isCreating}
            className="text-gray-500 hover:text-gray-700 disabled:opacity-50"
            aria-label="Close Add User form"
          >
            <X size={24} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="p-4">
          {createError && (
            <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {createError}
            </div>
          )}

          <p className="mb-4 text-sm text-gray-600">
            This account will sign in with email and password, not Microsoft SSO. There is no password
            reset or change flow yet, so use a strong initial password and share it through a separate
            secure channel.
          </p>

          <div className="mb-4">
            <label htmlFor="new-user-email" className="block text-sm font-medium text-gray-700 mb-2">
              Email
            </label>
            <input
              id="new-user-email"
              type="email"
              autoComplete="email"
              required
              value={newUser.email}
              onChange={(e) => setNewUser(prev => ({ ...prev, email: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="new-user-username" className="block text-sm font-medium text-gray-700 mb-2">
              Username
            </label>
            <input
              id="new-user-username"
              type="text"
              autoComplete="username"
              required
              minLength={3}
              maxLength={50}
              value={newUser.username}
              onChange={(e) => setNewUser(prev => ({ ...prev, username: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="new-user-password" className="block text-sm font-medium text-gray-700 mb-2">
              Initial Password
            </label>
            <input
              id="new-user-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={newUser.password}
              onChange={(e) => setNewUser(prev => ({ ...prev, password: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">Use at least 8 characters.</p>
          </div>

          <div className="mb-4">
            <label htmlFor="new-user-first-name" className="block text-sm font-medium text-gray-700 mb-2">
              First Name (optional)
            </label>
            <input
              id="new-user-first-name"
              type="text"
              autoComplete="given-name"
              maxLength={100}
              value={newUser.firstName}
              onChange={(e) => setNewUser(prev => ({ ...prev, firstName: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="new-user-last-name" className="block text-sm font-medium text-gray-700 mb-2">
              Last Name (optional)
            </label>
            <input
              id="new-user-last-name"
              type="text"
              autoComplete="family-name"
              maxLength={100}
              value={newUser.lastName}
              onChange={(e) => setNewUser(prev => ({ ...prev, lastName: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="new-user-role" className="block text-sm font-medium text-gray-700 mb-2">
              Role
            </label>
            <select
              id="new-user-role"
              value={newUser.role}
              onChange={(e) => setNewUser(prev => ({ ...prev, role: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              disabled={isCreating}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isCreating}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {isCreating ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
