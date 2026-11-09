import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DefinitionContract } from '../contracts/definition-contract';
import type { RuleConfig } from '../contracts/rule-config';
import { createFileDefinitionAdmin, getFileDefinitionVersions, getQueueStats, publishFileDefinitionVersion, removeTemplate, updateFileDefinitionAdmin } from './adminApi';

afterEach(() => vi.unstubAllGlobals());

const stubFetch = (status: number, body: unknown) => {
  vi.stubGlobal('localStorage', { getItem: () => 'tkn' });
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('definition version API', () => {
  it('sends the fixed validation contract when creating a definition', async () => {
    const fetchMock = stubFetch(201, { success: true, definition: { id: 'def-1' } });
    const contract: DefinitionContract = {
      schemaVersion: 1,
      layout: 'single',
      ignoredSheets: ['Notes'],
      encoding: 'utf-8',
      tables: [{
        sheet: null,
        headerRow: 2,
        allowExtraColumns: false,
        minRows: 1,
        maxRows: 20,
        columns: [{
          name: 'Amount',
          type: 'decimal' as const,
          mustExist: true,
          nullable: false,
          decimalSeparator: ',',
          thousandsSeparator: '.',
          precision: 10,
          scale: 2,
          maxLength: 12,
          unique: true,
        }],
      }],
      rules: [],
      lookups: {},
    };

    const rule: RuleConfig = {
      id: 'rule-1',
      name: 'Amount range',
      description: '',
      severity: 'Error',
      executionOrder: 1,
      enabled: true,
      table: null,
      type: 'range',
      params: { column: 'Amount', min: 0, max: 100 },
    } as RuleConfig;

    await createFileDefinitionAdmin({ name: 'Transactions', contract, rules: [rule] });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.contract).toEqual(contract);
    expect(body.rules).toEqual([rule]);
    expect(body).not.toHaveProperty('columns');
    expect(body).not.toHaveProperty('tables');
  });

  it('saves the whole draft with the contract, rules and revision when updating', async () => {
    const fetchMock = stubFetch(200, { success: true, definition: { id: 'def-1' }, revision: 'rev-2' });
    const contract = { schemaVersion: 1, layout: 'single', ignoredSheets: [], encoding: 'auto', tables: [], rules: [], lookups: {} } as unknown as DefinitionContract;

    const saved = await updateFileDefinitionAdmin('def-1', { name: 'Transactions', contract, rules: [], revision: 'rev-1' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/admin/file-definitions/def-1');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ name: 'Transactions', contract, rules: [], revision: 'rev-1' });
    expect(saved).toMatchObject({ id: 'def-1', revision: 'rev-2' });
  });

  it('loads the version history and draft changes for a definition', async () => {
    const fetchMock = stubFetch(200, {
      success: true,
      activeVersionNumber: 2,
      hasUnpublishedChanges: true,
      changes: {
        metadata: { added: [], removed: [], changed: ['Description'] },
        columns: { added: ['Email'], removed: [], changed: [] },
        rules: { added: [], removed: [], changed: [] },
      },
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

  it('removes a reusable template from the definition draft', async () => {
    const fetchMock = stubFetch(200, { success: true });

    await removeTemplate('def/1');

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/admin/file-definitions/def%2F1/template');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
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
