import { emptyDefinitionContract, parseDefinitionContract } from '../src/models/contractMapper';
import { mapVersionRow } from '../src/models/FileDefinitionVersion.model';

describe('definition contract persistence mapping', () => {
    it('stores a definition as the full versioned contract and reads it back unchanged', () => {
        const contract = emptyDefinitionContract();
        contract.tables[0].columns = [
            { name: 'Amount', type: 'decimal', mustExist: true, nullable: false, precision: 12, scale: 2 },
            { name: 'Comment', type: 'string', mustExist: true, nullable: true },
        ];

        expect(parseDefinitionContract(JSON.stringify(contract))).toEqual(contract);
        expect(contract).toMatchObject({
            schemaVersion: 1,
            layout: 'single',
            encoding: 'auto',
            rules: [],
            lookups: {},
        });
    });

    it('round-trips sheet tables without collapsing their independent schemas', () => {
        const contract = emptyDefinitionContract();
        contract.layout = 'sheets';
        contract.tables = [
            { sheet: 'Orders', headerRow: 2, allowExtraColumns: false, minRows: 1, maxRows: null, columns: [{ name: 'OrderId', type: 'string', mustExist: true, nullable: false }] },
            { sheet: 'Lines', headerRow: null, allowExtraColumns: true, minRows: null, maxRows: 500, columns: [{ name: 'Quantity', type: 'integer', mustExist: true, nullable: false }] },
        ];

        const parsed = parseDefinitionContract(JSON.stringify(contract));

        expect(parsed.layout).toBe('sheets');
        expect(parsed.tables.map(table => table.sheet)).toEqual(['Orders', 'Lines']);
        expect(parsed.tables[0]).toMatchObject({ headerRow: 2, allowExtraColumns: false, minRows: 1 });
        expect(parsed.tables[1].columns[0].name).toBe('Quantity');
    });

    it('rejects malformed stored contract JSON rather than returning an empty contract', () => {
        expect(() => parseDefinitionContract('{')).toThrow('Stored definition contract is not valid JSON.');
        expect(() => parseDefinitionContract({ schemaVersion: 2 })).toThrow('Stored definition contract does not match schema version 1.');
    });

    it('drops unsupported properties from stored columns', () => {
        const contract = parseDefinitionContract({
            schemaVersion: 1,
            layout: 'single',
            ignoredSheets: [],
            encoding: 'auto',
            tables: [{
                sheet: null,
                headerRow: null,
                allowExtraColumns: true,
                minRows: null,
                maxRows: null,
                columns: [{
                    name: 'Amount',
                    description: 'Legacy metadata',
                    type: 'decimal',
                    mustExist: true,
                    nullable: false,
                }],
            }],
            rules: [],
            lookups: {},
        });

        expect(contract.tables[0].columns[0]).toEqual({
            name: 'Amount',
            type: 'decimal',
            mustExist: true,
            nullable: false,
        });
    });

    it('maps a stored full version contract to the model projection', () => {
        const contract = emptyDefinitionContract();
        contract.tables[0].columns = [{
            name: 'Date',
            type: 'date',
            mustExist: true,
            nullable: false,
        }];

        const version = mapVersionRow({
            Id: 'version-id',
            FileDefinitionId: 'definition-id',
            VersionNumber: 1,
            Status: 'Active',
            Contract: JSON.stringify(contract),
            ChangeNote: null,
            CreatedBy: null,
            CreatedByName: null,
            ActivatedAt: new Date('2026-01-01T00:00:00Z'),
            SupersededAt: null,
        });

        expect(version.Contract).toEqual(contract);
        expect(version).not.toHaveProperty('Columns');
        expect(version).not.toHaveProperty('Rules');
    });
});
