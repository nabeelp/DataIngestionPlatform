import {
    contractFromLegacyColumns,
    emptyDefinitionContract,
    legacyColumnsFromContract,
    legacySnapshotFromContract,
    legacyTablesFromContract,
    parseDefinitionContract,
} from '../src/models/contractMapper';
import { mapVersionRow } from '../src/models/FileDefinitionVersion.model';

describe('definition contract persistence mapping', () => {
    it('stores a single-table definition as the full versioned contract', () => {
        const columns = [
            { name: 'Amount', type: 'decimal' as const, required: true },
            { name: 'Comment', type: 'string' as const, required: false },
        ];
        const contract = contractFromLegacyColumns(columns);

        expect(contract).toMatchObject({
            schemaVersion: 1,
            layout: 'single',
            encoding: 'auto',
            tables: [{
                sheet: null,
                headerRow: null,
                allowExtraColumns: true,
                minRows: null,
                maxRows: null,
                columns: [
                    { name: 'Amount', type: 'decimal', mustExist: true, nullable: false },
                    { name: 'Comment', type: 'string', mustExist: true, nullable: true },
                ],
            }],
            rules: [],
            lookups: {},
        });
        expect(legacyColumnsFromContract(parseDefinitionContract(JSON.stringify(contract)))).toEqual(columns);
    });

    it('round-trips sheet tables without collapsing their independent schemas', () => {
        const tables = [
            { sheet: 'Orders', columns: [{ name: 'OrderId', type: 'string' as const, required: true }] },
            { sheet: 'Lines', columns: [{ name: 'Quantity', type: 'integer' as const, required: true }] },
        ];
        const contract = contractFromLegacyColumns([], tables);

        expect(contract.layout).toBe('sheets');
        expect(legacyTablesFromContract(contract)).toEqual(tables);
        expect(legacySnapshotFromContract(contract)).toMatchObject({ columns: [], tables });
    });

    it('rejects malformed stored contract JSON rather than returning an empty contract', () => {
        expect(() => parseDefinitionContract('{')).toThrow('Stored definition contract is not valid JSON.');
        expect(() => parseDefinitionContract({ schemaVersion: 2 })).toThrow('Stored definition contract does not match schema version 1.');
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
        expect(version.Columns).toEqual([{ name: 'Date', type: 'date', required: true }]);
        expect(version.Tables).toEqual([]);
    });
});
