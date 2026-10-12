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
  });

  it('maps admin draft state and sheet-table fallback', () => {
    const definition = mapDefinitionSummary({
      id: 'definition-2',
      name: 'Workbook',
      description: '',
      status: 'Active',
      hasUnpublishedChanges: true,
      tables: [{ sheet: 'Orders', columns: [{ name: 'OrderId', type: 'string', required: true }] }],
    });

    expect(definition.hasUnpublishedChanges).toBe(true);
    expect(definition.tables[0].sheet).toBe('Orders');
  });
});
