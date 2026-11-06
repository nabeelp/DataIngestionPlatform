import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { createQueryClient } from './queryClient';
import {
  invalidateDefinitions,
  invalidateLookups,
  invalidateUploadLists,
  invalidateUploads,
  invalidateUsers,
  queryKeys,
} from './queryKeys';

const seeded = () => {
  const client = new QueryClient();
  const data = {
    userDefinitions: queryKeys.definitions.user(),
    adminDefinitions: queryKeys.definitions.admin(),
    userCounts: queryKeys.definitions.userCounts(),
    versions: queryKeys.definitions.versions('d1'),
    access: queryKeys.definitions.access('d1'),
    publishedRules: queryKeys.definitions.publishedRules('d1'),
    users: queryKeys.users.list({ search: 'a' }),
    auditLogs: queryKeys.auditLogs.list({ page: 1 }),
    uploadList: queryKeys.uploads.list(1),
    uploadRecent: queryKeys.uploads.recent(5),
    uploadDetail: queryKeys.uploads.detail('u1'),
    userDashboard: queryKeys.dashboard.user(7),
    adminStats: queryKeys.dashboard.adminStats(),
    compliance: queryKeys.compliance.report(30),
    lookups: queryKeys.lookups.list(),
  };
  for (const key of Object.values(data)) client.setQueryData(key, { fresh: true });
  const stale = () => Object.entries(data)
    .filter(([, key]) => client.getQueryState(key)?.isInvalidated)
    .map(([name]) => name)
    .sort();
  return { client, stale };
};

describe('queryKeys', () => {
  it('nests keys under their feature root', () => {
    expect(queryKeys.definitions.versions('d1').slice(0, 1)).toEqual(queryKeys.definitions.all);
    expect(queryKeys.uploads.detail('u1').slice(0, 1)).toEqual(queryKeys.uploads.all);
    expect(queryKeys.dashboard.user(7).slice(0, 1)).toEqual(queryKeys.dashboard.all);
    expect(queryKeys.definitions.userCounts().slice(0, 2)).toEqual(queryKeys.definitions.admin());
  });

  it('differs per parameter and is equal for equal parameters', () => {
    expect(queryKeys.uploads.list(1)).not.toEqual(queryKeys.uploads.list(2));
    expect(queryKeys.users.list({ search: 'a' })).toEqual(queryKeys.users.list({ search: 'a' }));
    expect(queryKeys.users.list({ search: 'a' })).not.toEqual(queryKeys.users.list({ search: 'b' }));
    expect(queryKeys.lookups.list()).toEqual(queryKeys.lookups.list(''));
  });
});

describe('invalidation helpers', () => {
  it('invalidates every definition view and the admin counts when definitions change', async () => {
    const { client, stale } = seeded();
    await invalidateDefinitions(client);
    expect(stale()).toEqual([
      'access', 'adminDefinitions', 'adminStats', 'publishedRules', 'userCounts', 'userDefinitions', 'versions',
    ]);
  });

  it('invalidates upload lists, details and dashboards when an upload changes', async () => {
    const { client, stale } = seeded();
    await invalidateUploads(client);
    expect(stale()).toEqual(['adminStats', 'uploadDetail', 'uploadList', 'uploadRecent', 'userDashboard']);
  });

  it('leaves upload details alone when only the lists change', async () => {
    const { client, stale } = seeded();
    await invalidateUploadLists(client);
    expect(stale()).toEqual(['adminStats', 'uploadList', 'uploadRecent', 'userDashboard']);
  });

  it('invalidates user lists, access pickers and counts when users change', async () => {
    const { client, stale } = seeded();
    await invalidateUsers(client);
    expect(stale()).toEqual(['access', 'adminStats', 'userCounts', 'users']);
  });

  it('invalidates only lookups when lookups change', async () => {
    const { client, stale } = seeded();
    await invalidateLookups(client);
    expect(stale()).toEqual(['lookups']);
  });
});

describe('createQueryClient', () => {
  it('retries once, does not refetch on window focus and keeps data briefly fresh', () => {
    const defaults = createQueryClient().getDefaultOptions().queries;
    expect(defaults).toMatchObject({ retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 });
  });

  it('serves an invalidated query through fetchQuery again', async () => {
    const client = createQueryClient();
    let calls = 0;
    const queryFn = async () => ++calls;
    const key = queryKeys.uploads.list(1);
    expect(await client.fetchQuery({ queryKey: key, queryFn })).toBe(1);
    expect(await client.fetchQuery({ queryKey: key, queryFn })).toBe(1);
    await invalidateUploads(client);
    expect(await client.fetchQuery({ queryKey: key, queryFn, staleTime: 0 })).toBe(2);
  });
});
