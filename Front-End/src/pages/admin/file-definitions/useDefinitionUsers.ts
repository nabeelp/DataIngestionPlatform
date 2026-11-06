import { useEffect, useState } from 'react';
import type { IFileDefinitionUser } from '../../../services/adminApi';
import {
  useAssignDefinitionUsersMutation,
  useDefinitionAccessQuery,
  useRemoveDefinitionUserMutation,
} from '../../../services/hooks/definitions';

const NO_USERS: IFileDefinitionUser[] = [];

/** State and handlers of the "Manage Users" dialog of a file definition. */
export function useDefinitionUsers(setError: (message: string | null) => void) {
  const [showUserModal, setShowUserModal] = useState(false);
  const [selectedDefinitionId, setSelectedDefinitionId] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const accessQuery = useDefinitionAccessQuery(selectedDefinitionId || null);
  const assignedUsers = accessQuery.data?.assignedUsers ?? NO_USERS;
  const availableUsers = accessQuery.data?.availableUsers ?? NO_USERS;
  const loadingUsers = Boolean(selectedDefinitionId) && accessQuery.isPending;
  const { mutateAsync: assignUsers } = useAssignDefinitionUsersMutation();
  const { mutateAsync: removeUser } = useRemoveDefinitionUserMutation();

  const loadFailed = accessQuery.isError;
  useEffect(() => {
    if (loadFailed) setError('Failed to load users for this definition');
  }, [loadFailed, setError]);

  const handleManageUsers = (defId: string) => {
    setSelectedDefinitionId(defId);
    setSelectedUserIds([]);
    setShowUserModal(true);
  };

  const handleCloseUserModal = () => {
    setShowUserModal(false);
    setSelectedDefinitionId('');
    setSelectedUserIds([]);
    setUserSearch('');
  };

  const handleRemoveUser = async (userId: string) => {
    if (!confirm('Remove this user from the file definition?')) return;
    
    try {
      await removeUser({ definitionId: selectedDefinitionId, userId });
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
      await assignUsers({ definitionId: selectedDefinitionId, userIds: selectedUserIds });
      setSelectedUserIds([]);
      setError(null);
    } catch (err) {
      console.error('Failed to assign users:', err);
      setError('Failed to assign users');
    }
  };

  return {
    showUserModal,
    selectedDefinitionId,
    assignedUsers,
    availableUsers,
    selectedUserIds,
    loadingUsers,
    userSearch,
    setUserSearch,
    handleManageUsers,
    handleCloseUserModal,
    handleRemoveUser,
    toggleAvailableUser,
    handleAssignSelectedUsers,
  };
}
