import { useState } from 'react';
import {
  addUsersToFileDefinition,
  getAvailableUsers,
  getFileDefinitionUsers,
  removeUserFromFileDefinition,
  type IFileDefinitionUser,
} from '../../../services/adminApi';

/** State and handlers of the "Manage Users" dialog of a file definition. */
export function useDefinitionUsers(setError: (message: string | null) => void) {
  const [showUserModal, setShowUserModal] = useState(false);
  const [selectedDefinitionId, setSelectedDefinitionId] = useState('');
  const [assignedUsers, setAssignedUsers] = useState<IFileDefinitionUser[]>([]);
  const [availableUsers, setAvailableUsers] = useState<IFileDefinitionUser[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  // Loads the assigned users, then the available users without the already assigned ones.
  const loadUserLists = async (definitionId: string) => {
    const assignedData = await getFileDefinitionUsers(definitionId);
    setAssignedUsers(assignedData.users);

    const availableData = await getAvailableUsers();
    const allAvailable = availableData.users || [];
    const filteredAvailable = allAvailable.filter(
      user => !assignedData.users.some((assigned: IFileDefinitionUser) => assigned.id === user.id)
    );
    setAvailableUsers(filteredAvailable);
  };

  const handleManageUsers = async (defId: string) => {
    try {
      setLoadingUsers(true);
      setSelectedDefinitionId(defId);
      setSelectedUserIds([]);
      await loadUserLists(defId);
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
      await loadUserLists(selectedDefinitionId);
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
      await loadUserLists(selectedDefinitionId);
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
