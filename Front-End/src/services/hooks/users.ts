import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createUser, deleteUser, getUsers, unlockUser, updateUser, type UserListParams } from '../admin/users';
import { invalidateUsers, queryKeys } from '../queryKeys';

export const useAdminUsersQuery = (params: UserListParams) =>
  useQuery({ queryKey: queryKeys.users.list(params), queryFn: () => getUsers(params), staleTime: 0 });

type CreateUserInput = Parameters<typeof createUser>[0];
type UpdateUserInput = Parameters<typeof updateUser>[1];

export const useCreateUserMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (user: CreateUserInput) => createUser(user),
    onSuccess: () => { void invalidateUsers(client); },
  });
};

export const useUpdateUserMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: UpdateUserInput }) => updateUser(id, updates),
    onSuccess: () => { void invalidateUsers(client); },
  });
};

export const useUnlockUserMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unlockUser(id),
    onSuccess: () => { void invalidateUsers(client); },
  });
};

export const useDeleteUserMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: () => { void invalidateUsers(client); },
  });
};
