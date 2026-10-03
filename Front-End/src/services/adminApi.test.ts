import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFileDefinitionVersions, getQueueStats, publishFileDefinitionVersion } from './adminApi';

afterEach(() => vi.unstubAllGlobals());

const stubFetch = (status: number, body: unknown) => {
  vi.stubGlobal('localStorage', { getItem: () => 'tkn' });
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('definition version API', () => {
  it('loads the version history and draft changes for a definition', async () => {
    const fetchMock = stubFetch(200, {
      success: true,
      activeVersionNumber: 2,
      hasUnpublishedChanges: true,
      changes: { columns: { added: ['Email'], removed: [], changed: [] }, rules: { added: [], removed: [], changed: [] } },
      versions: [{ id: 'v2', versionNumber: 2, status: 'Active' }],
    });

    describe('queue monitoring API', () => {
      it('returns Service Bus availability and SQL upload throughput', async () => {
        stubFetch(200, {
          success: true,
          stats: { available: false, validation: null, delivery: null },
          recentUploadThroughput: { windowMinutes: 60, uploads: 12, uploadsPerMinute: 0.2 },
        });

        await expect(getQueueStats()).resolves.toEqual({
          stats: { available: false, validation: null, delivery: null },
          recentUploadThroughput: { windowMinutes: 60, uploads: 12, uploadsPerMinute: 0.2 },
        });
      });
    });

    const history = await getFileDefinitionVersions('def/1');

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/admin/file-definitions/def%2F1/versions');
    expect(history).toMatchObject({ activeVersionNumber: 2, hasUnpublishedChanges: true, versions: [{ versionNumber: 2 }] });
  });

  it('publishes the draft with a change note', async () => {
    const fetchMock = stubFetch(201, { success: true, version: { id: 'v3', versionNumber: 3, status: 'Active' } });

    const version = await publishFileDefinitionVersion('def-1', 'Add Email');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/admin/file-definitions/def-1/versions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ changeNote: 'Add Email' });
    expect(version.versionNumber).toBe(3);
  });

  it('surfaces the server message when there is nothing to publish', async () => {
    stubFetch(409, { success: false, message: 'There are no changes to publish; version 2 is already active' });

    await expect(publishFileDefinitionVersion('def-1')).rejects.toThrow('There are no changes to publish; version 2 is already active');
  });
});
