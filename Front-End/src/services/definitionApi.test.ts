import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadTemplate, getFileDefinitions, mapDefinitionSummary } from './definitionApi';

afterEach(() => vi.unstubAllGlobals());

describe('downloadTemplate', () => {
  it('calls the backend template route for the definition', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'tkn' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: 'No template available for this definition' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(downloadTemplate('def/1')).rejects.toThrow('No template available for this definition');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/definitions/def%2F1/template');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tkn');
  });
  it('saves the file under the server filename, or a template name when the header is missing', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('document', { createElement: () => link, body: { appendChild: vi.fn() } });
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:template', revokeObjectURL: vi.fn() });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('xlsx', { headers: { 'Content-Disposition': 'attachment; filename=customers.xlsx' } }))
      .mockResolvedValueOnce(new Response('xlsx'));
    vi.stubGlobal('fetch', fetchMock);

    await downloadTemplate('def-1');
    expect(link.download).toBe('customers.xlsx');
    await downloadTemplate('def-1');
    expect(link.download).toBe('def-1-template.xlsx');
  });

  it('uses a readable message when the failure body is not JSON', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad gateway', { status: 502 })));
    await expect(downloadTemplate('def-1')).rejects.toThrow('Failed to download template');
  });
});

describe('getFileDefinitions', () => {
  it('maps the PascalCase rows of GET /definitions', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      total: 1,
      definitions: [{
        Id: 'd1', Name: 'Customers', Description: '', Status: 'Active', CreatedAt: 'a', UpdatedAt: 'b',
        TemplateFilename: 'template.xlsx', Contract: null, ActiveVersion: null,
      }],
    }))));

    const result = await getFileDefinitions();
    expect(result.total).toBe(1);
    expect(result.definitions[0]).toMatchObject({ id: 'd1', name: 'Customers', hasTemplate: true });
  });
});

describe('definition summary mapping', () => {
  it('maps published structure, version, and enabled rule counts', () => {
    const definition = mapDefinitionSummary({
      Id: 'definition-1',
      Name: 'Customers',
      Description: 'Customer master data',
      Status: 'Active',
      CreatedAt: '2026-09-01',
      UpdatedAt: '2026-10-01',
      ActiveVersion: { id: 'version-2', versionNumber: 2, activatedAt: '2026-10-01' },
      Contract: {
        schemaVersion: 1,
        layout: 'single',
        ignoredSheets: [],
        encoding: 'utf-8',
        tables: [{
          sheet: null,
          headerRow: 1,
          allowExtraColumns: false,
          minRows: null,
          maxRows: null,
          columns: [{ name: 'CustomerId', type: 'string', mustExist: true, nullable: false }],
        }],
        rules: [
          { id: 'r1', name: 'Unique id', description: '', severity: 'Error', executionOrder: 1, enabled: true, table: null, type: 'unique', params: { columns: ['CustomerId'] } },
          { id: 'r2', name: 'Advisory', description: '', severity: 'Warning', executionOrder: 2, enabled: true, table: null, type: 'pattern', params: { column: 'CustomerId', pattern: '^C' } },
          { id: 'r3', name: 'Disabled', description: '', severity: 'Error', executionOrder: 3, enabled: false, table: null, type: 'unique', params: { columns: ['CustomerId'] } },
        ],
        lookups: {},
      },
    });

    expect(definition).toMatchObject({
      id: 'definition-1',
      name: 'Customers',
      activeVersion: { versionNumber: 2 },
      ruleCounts: { total: 2, errors: 1, warnings: 1 },
      tables: [{ sheet: null }],
    });
    expect(definition.columns.map(column => column.name)).toEqual(['CustomerId']);
    expect(definition.tables[0].columns[0]).toMatchObject({ mustExist: true, nullable: false });
  });

  it('maps one table per sheet from the contract', () => {
    const definition = mapDefinitionSummary({
      Id: 'definition-2',
      Name: 'Workbook',
      Description: '',
      Status: 'Active',
      CreatedAt: '2026-09-01',
      UpdatedAt: '2026-10-01',
      ActiveVersion: null,
      Contract: {
        schemaVersion: 1,
        layout: 'sheets',
        ignoredSheets: ['Notes'],
        encoding: 'auto',
        tables: [
          { sheet: 'Orders', headerRow: null, allowExtraColumns: true, minRows: null, maxRows: null, columns: [{ name: 'OrderId', type: 'integer', mustExist: true, nullable: false }] },
          { sheet: 'Refunds', headerRow: null, allowExtraColumns: true, minRows: null, maxRows: null, columns: [{ name: 'Reason', type: 'string', mustExist: true, nullable: true }] },
        ],
        rules: [],
        lookups: {},
      },
    });

    expect(definition.tables.map(table => table.sheet)).toEqual(['Orders', 'Refunds']);
    expect(definition.columns.map(column => column.name)).toEqual(['OrderId', 'Reason']);
    expect(definition.ruleCounts).toEqual({ total: 0, errors: 0, warnings: 0 });
  });

  it('has no tables until a version with a contract is published', () => {
    const definition = mapDefinitionSummary({
      Id: 'definition-3',
      Name: 'Draft',
      Description: '',
      Status: 'Active',
      CreatedAt: '2026-09-01',
      UpdatedAt: '2026-09-01',
      Contract: null,
      ActiveVersion: null,
    });

    expect(definition.contract).toBeNull();
    expect(definition.tables).toEqual([]);
    expect(definition.columns).toEqual([]);
    expect(definition.activeVersion).toBeNull();
  });
});
