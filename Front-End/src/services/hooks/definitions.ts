import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getFileDefinitions } from '../definitionApi';
import {
  addUsersToFileDefinition,
  getDefinitionAccessLists,
  getFileDefinitionUserCounts,
  removeUserFromFileDefinition,
} from '../admin/fileDefinitionAccess';
import { deleteFileDefinitionAdmin, getFileDefinitionsAdmin } from '../admin/fileDefinitions';
import { saveDefinition, type SaveDefinitionInput } from '../admin/definitionSave';
import { getFileDefinitionVersions, publishFileDefinitionVersion } from '../admin/fileDefinitionVersions';
import { invalidateDefinitions, queryKeys } from '../queryKeys';

/** Definitions the signed-in user may upload against (published contract). */
export const useDefinitionsQuery = () =>
  useQuery({ queryKey: queryKeys.definitions.user(), queryFn: getFileDefinitions });

/** The workspace edits straight from this list, so it is re-read on every visit rather than served from cache. */
export const useAdminDefinitionsQuery = () =>
  useQuery({ queryKey: queryKeys.definitions.admin(), queryFn: getFileDefinitionsAdmin, staleTime: 0, gcTime: 0 });

export const useDefinitionUserCountsQuery = (enabled: boolean) =>
  useQuery({ queryKey: queryKeys.definitions.userCounts(), queryFn: getFileDefinitionUserCounts, enabled });

export const useDefinitionVersionsQuery = (definitionId: string) =>
  useQuery({
    queryKey: queryKeys.definitions.versions(definitionId),
    queryFn: () => getFileDefinitionVersions(definitionId),
    staleTime: 0,
  });

/** Assigned and assignable users of a definition; always re-read when the dialog opens. */
export const useDefinitionAccessQuery = (definitionId: string | null) =>
  useQuery({
    queryKey: queryKeys.definitions.access(definitionId ?? ''),
    queryFn: () => getDefinitionAccessLists(definitionId ?? ''),
    enabled: Boolean(definitionId),
    staleTime: 0,
    gcTime: 0,
  });

/** Saves, uploads the template of and publishes a definition draft as one operation. */
export const useSaveDefinitionMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveDefinitionInput) => saveDefinition(input),
    onSettled: () => { void invalidateDefinitions(client); },
  });
};

export const useDeleteDefinitionMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (definitionId: string) => deleteFileDefinitionAdmin(definitionId),
    onSuccess: () => { void invalidateDefinitions(client); },
  });
};

export const usePublishDefinitionVersionMutation = (definitionId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (changeNote?: string) => publishFileDefinitionVersion(definitionId, changeNote),
    onSuccess: () => { void invalidateDefinitions(client); },
  });
};

const invalidateAccess = (client: ReturnType<typeof useQueryClient>, definitionId: string) => {
  void client.invalidateQueries({ queryKey: queryKeys.definitions.access(definitionId) });
  void client.invalidateQueries({ queryKey: queryKeys.definitions.userCounts() });
};

export const useAssignDefinitionUsersMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ definitionId, userIds }: { definitionId: string; userIds: string[] }) =>
      addUsersToFileDefinition(definitionId, userIds),
    onSuccess: (_data, { definitionId }) => invalidateAccess(client, definitionId),
  });
};

export const useRemoveDefinitionUserMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ definitionId, userId }: { definitionId: string; userId: string }) =>
      removeUserFromFileDefinition(definitionId, userId),
    onSuccess: (_data, { definitionId }) => invalidateAccess(client, definitionId),
  });
};
