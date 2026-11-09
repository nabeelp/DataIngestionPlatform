import type { QueryClient } from '@tanstack/react-query';
import type { AuditLogParams } from './admin/auditLogs';
import type { UserListParams } from './admin/users';

/**
 * Query keys for server state. Keys nest by feature so one `invalidateQueries({ queryKey })` on a parent key
 * refreshes every list and detail below it.
 */
export const queryKeys = {
  definitions: {
    all: ['definitions'] as const,
    user: () => ['definitions', 'user'] as const,
    admin: () => ['definitions', 'admin'] as const,
    userCounts: () => ['definitions', 'admin', 'user-counts'] as const,
    versions: (definitionId: string) => ['definitions', 'versions', definitionId] as const,
    access: (definitionId: string) => ['definitions', 'access', definitionId] as const,
    publishedRules: (definitionId: string) => ['definitions', 'published-rules', definitionId] as const,
  },
  users: {
    all: ['users'] as const,
    list: (params: UserListParams) => ['users', 'list', params] as const,
  },
  auditLogs: {
    all: ['audit-logs'] as const,
    list: (params: AuditLogParams) => ['audit-logs', 'list', params] as const,
  },
  uploads: {
    all: ['uploads'] as const,
    lists: () => ['uploads', 'list'] as const,
    list: (page: number) => ['uploads', 'list', page] as const,
    recents: () => ['uploads', 'recent'] as const,
    recent: (limit: number) => ['uploads', 'recent', limit] as const,
    detail: (uploadId: string) => ['uploads', 'detail', uploadId] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
    user: (days: number) => ['dashboard', 'user', days] as const,
    adminStats: () => ['dashboard', 'admin', 'stats'] as const,
    adminQueue: () => ['dashboard', 'admin', 'queue'] as const,
  },
  compliance: {
    report: (days: number) => ['compliance', days] as const,
  },
  lookups: {
    all: ['lookups'] as const,
    list: (search: string = '') => ['lookups', 'list', search] as const,
  },
};

type Invalidation = Promise<void>[];

const settle = (work: Invalidation): Promise<void> => Promise.all(work).then(() => undefined);

/** Definitions changed (saved, published, deleted, access changed): every definition view and the admin counts. */
export const invalidateDefinitions = (client: QueryClient): Promise<void> =>
  settle([
    client.invalidateQueries({ queryKey: queryKeys.definitions.all }),
    client.invalidateQueries({ queryKey: queryKeys.dashboard.adminStats() }),
  ]);

/** Users changed: the user lists, the access pickers that offer them, and the admin counts. */
export const invalidateUsers = (client: QueryClient): Promise<void> =>
  settle([
    client.invalidateQueries({ queryKey: queryKeys.users.all }),
    client.invalidateQueries({ queryKey: ['definitions', 'access'] }),
    client.invalidateQueries({ queryKey: queryKeys.definitions.userCounts() }),
    client.invalidateQueries({ queryKey: queryKeys.dashboard.adminStats() }),
  ]);

/** An upload was created, changed or deleted: every upload list and detail plus the dashboards built from them. */
export const invalidateUploads = (client: QueryClient): Promise<void> =>
  settle([
    client.invalidateQueries({ queryKey: queryKeys.uploads.all }),
    client.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
  ]);

/** Like `invalidateUploads` but leaves upload details alone (used when the detail page itself is going away). */
export const invalidateUploadLists = (client: QueryClient): Promise<void> =>
  settle([
    client.invalidateQueries({ queryKey: queryKeys.uploads.lists() }),
    client.invalidateQueries({ queryKey: queryKeys.uploads.recents() }),
    client.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
  ]);

export const invalidateLookups = (client: QueryClient): Promise<void> =>
  client.invalidateQueries({ queryKey: queryKeys.lookups.all });
