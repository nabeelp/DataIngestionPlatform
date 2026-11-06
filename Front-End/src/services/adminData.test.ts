import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DefinitionContract } from '../contracts/definition-contract';
import {
  analyzeExampleFile,
  exportFileDefinition,
  getAdminStats,
  getAuditLogs,
  getAvailableUsers,
  getDefinitionAccessLists,
  getUsers,
  updateUser,
  uploadTemplate,
} from './adminApi';
import { saveDefinition } from './admin/definitionSave';

const stubFetch = (...responses: Array<{ status?: number; body: unknown }>) => {
  const fetchMock = vi.fn();
  for (const { status = 200, body } of responses) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

beforeEach(() => vi.stubGlobal('localStorage', { getItem: () => 'tkn' }));
afterEach(() => vi.unstubAllGlobals());

describe('admin users and audit logs', () => {
  it('lists users with only the filters that are set', async () => {
    const fetchMock = stubFetch({ body: { success: true, users: [], total: 0, page: 1, limit: 50 } });
    await getUsers({ search: '', page: 2 });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/admin/users?page=2');
  });

  it('keeps the server message when a user update fails', async () => {
    stubFetch({ status: 409, body: { success: false, message: 'Cannot demote the last admin' } });
    await expect(updateUser('u/1', { role: 'user' })).rejects.toThrow('Cannot demote the last admin');
  });

  it('maps the PascalCase audit log rows the API returns', async () => {
    const fetchMock = stubFetch({
      body: {
        success: true,
        total: 1,
        page: 1,
        limit: 20,
        logs: [{
          Id: 'log-1', UserId: 'u1', Action: 'LOGIN', EntityType: 'USER', EntityId: 'u1',
          Details: { ip: 'x' }, IpAddress: '10.0.0.1', UserAgent: 'agent', Timestamp: '2026-10-01T10:00:00.000Z',
        }],
      },
    });

    const result = await getAuditLogs({ page: 1, limit: 20, action: 'LOGIN', entityType: '' });

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/admin/audit-logs?page=1&limit=20&action=LOGIN');
    expect(result).toMatchObject({ total: 1, page: 1, limit: 20 });
    expect(result.logs).toEqual([{
      id: 'log-1', userId: 'u1', action: 'LOGIN', entityType: 'USER', entityId: 'u1',
      details: { ip: 'x' }, ipAddress: '10.0.0.1', userAgent: 'agent', timestamp: '2026-10-01T10:00:00.000Z',
    }]);
  });

  it('unwraps the admin stats', async () => {
    stubFetch({ body: { success: true, stats: { totalUsers: 3 } } });
    await expect(getAdminStats()).resolves.toMatchObject({ totalUsers: 3 });
  });
});

describe('definition access lists', () => {
  const user = (id: string) => ({ id, email: `${id}@x.com`, username: id, firstName: null, lastName: null });

  it('offers only users that are not assigned yet', async () => {
    const fetchMock = stubFetch(
      { body: { success: true, users: [user('a')] } },
      { body: { success: true, users: [user('a'), user('b')] } },
    );
    const lists = await getDefinitionAccessLists('def/1');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/admin/file-definitions/def%2F1/users');
    expect(lists.assignedUsers.map(item => item.id)).toEqual(['a']);
    expect(lists.availableUsers.map(item => item.id)).toEqual(['b']);
  });

  it('surfaces a failure to list the assignable users', async () => {
    stubFetch({ status: 500, body: { success: false, message: 'Directory unavailable' } });
    await expect(getAvailableUsers()).rejects.toThrow('Directory unavailable');
  });
});

describe('multipart uploads', () => {
  it('posts the example file as FormData without a Content-Type', async () => {
    const fetchMock = stubFetch({ body: { success: true, fileName: 'a.csv', fileType: 'csv', sheets: [] } });
    const file = new File(['a,b'], 'a.csv');

    const analysis = await analyzeExampleFile(file);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/admin/file-definitions/analyze-example');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBeInstanceOf(File);
    expect(init.headers).toEqual({ Authorization: 'Bearer tkn' });
    expect(analysis).toEqual({ fileName: 'a.csv', fileType: 'csv', sheets: [], warnings: [] });
  });

  it('uses the fixed failure messages of the template and example calls', async () => {
    stubFetch({ status: 500, body: {} }, { status: 500, body: {} });
    await expect(uploadTemplate('d1', new File(['x'], 't.xlsx'))).rejects.toThrow('Failed to upload template');
    await expect(analyzeExampleFile(new File(['x'], 'a.csv'))).rejects.toThrow('Failed to analyze the example file');
  });
});

describe('exportFileDefinition', () => {
  it('saves the definition JSON under a name derived from the definition', async () => {
    stubFetch({ body: { success: true, name: 'My Orders!', columns: [] } });
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('document', { createElement: () => link, body: { appendChild: vi.fn() } });
    const createObjectURL = vi.fn().mockReturnValue('blob:export');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });

    await exportFileDefinition('d1');

    expect(link.download).toBe('my_orders_-definition.json');
    expect(link.click).toHaveBeenCalledOnce();
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
  });
});

describe('saveDefinition', () => {
  const contract = { schemaVersion: 1, layout: 'single', ignoredSheets: [], encoding: 'auto', tables: [], rules: [], lookups: {} } as unknown as DefinitionContract;
  const payload = { name: 'Orders', description: '', status: 'Active', deliveryFolder: null, contract };
  const base = { payload, rules: [], revision: 'rev-1', templateFile: null, removeStoredTemplate: false, changeNote: '' };

  it('creates a definition and uploads its template without publishing', async () => {
    const fetchMock = stubFetch(
      { status: 201, body: { success: true, definition: { id: 'new-1' } } },
      { body: { success: true, templateFilename: 't.xlsx' } },
    );

    const result = await saveDefinition({ ...base, editingId: null, templateFile: new File(['x'], 't.xlsx') });

    expect(result).toEqual({ savedId: 'new-1', publishedVersion: null });
    expect(fetchMock.mock.calls.map(call => [call[1].method, call[0]])).toEqual([
      ['POST', '/api/v1/admin/file-definitions'],
      ['POST', '/api/v1/admin/file-definitions/new-1/template-upload'],
    ]);
  });

  it('updates, removes the template, publishes and reports the new revision', async () => {
    const fetchMock = stubFetch(
      { body: { success: true, definition: { id: 'def-1' }, revision: 'rev-2' } },
      { body: { success: true } },
      { status: 201, body: { success: true, version: { id: 'v3', versionNumber: 3 } } },
    );
    const onRevision = vi.fn();

    const result = await saveDefinition({
      ...base, editingId: 'def-1', removeStoredTemplate: true, changeNote: 'Add Email', onRevision,
    });

    expect(onRevision).toHaveBeenCalledWith('rev-2');
    expect(result).toEqual({ savedId: 'def-1', publishedVersion: { versionNumber: 3 } });
    expect(fetchMock.mock.calls.map(call => [call[1].method, call[0]])).toEqual([
      ['PUT', '/api/v1/admin/file-definitions/def-1'],
      ['DELETE', '/api/v1/admin/file-definitions/def-1/template'],
      ['POST', '/api/v1/admin/file-definitions/def-1/versions'],
    ]);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ changeNote: 'Add Email' });
  });

  it('stops at the first failing step', async () => {
    const fetchMock = stubFetch({ status: 409, body: { success: false, message: 'The draft changed' } });
    await expect(saveDefinition({ ...base, editingId: 'def-1' })).rejects.toThrow('The draft changed');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
