import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadTemplate, mapDefinitionSummary } from './definitionApi';

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
});

describe('definition summary mapping', () => {
  it('maps published structure, version, and enabled rule counts', () => {
    const definition = mapDefinitionSummary({
      Id: 'definition-1',
      Name: 'Customers',
      Description: 'Customer master data',
      Status: 'Active',
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
          { id: 'r1', name: 'Required', description: '', severity: 'Error', executionOrder: 1, enabled: true, table: null, type: 'required', params: { columns: ['CustomerId'] } },
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
      HasUnpublishedChanges: true,
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

    expect(definition.hasUnpublishedChanges).toBe(true);
    expect(definition.tables.map(table => table.sheet)).toEqual(['Orders', 'Refunds']);
    expect(definition.columns.map(column => column.name)).toEqual(['OrderId', 'Reason']);
    expect(definition.ruleCounts).toEqual({ total: 0, errors: 0, warnings: 0 });
  });

  it('has no tables until a version with a contract is published', () => {
    const definition = mapDefinitionSummary({ Id: 'definition-3', Name: 'Draft', Status: 'Active' });

    expect(definition.contract).toBeNull();
    expect(definition.tables).toEqual([]);
    expect(definition.columns).toEqual([]);
    expect(definition.activeVersion).toBeNull();
  });
});
