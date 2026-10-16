import { parseResetOptions, resetBlobs, resetContainers, resetTables, validateResetInventory } from '../src/scripts/resetApplicationData';

describe('application reset safeguards', () => {
    const args = ['inspect-reset', 'DataIngestion', '2', 'https://sttest.blob.core.windows.net/'];

    it('leaves normal bootstrap non-destructive and makes inspection explicit', () => {
        expect(parseResetOptions([], 'DataIngestion')).toBeUndefined();
        expect(parseResetOptions(args, 'DataIngestion')).toMatchObject({ execute: false, expectedUsers: 2 });
        expect(parseResetOptions(['reset-application-data', ...args.slice(1)], 'DataIngestion'))
            .toMatchObject({ execute: true });
    });

    it.each([
        ['reset-application-data'],
        ['reset-application-data', 'OtherDatabase', '2', args[3]],
        ['reset-application-data', 'DataIngestion', '0', args[3]],
        ['reset-application-data', 'DataIngestion', '2', 'http://localhost:10000'],
        [...args, 'unexpected'],
    ])('rejects invalid reset arguments %j', (...invalid) => {
        expect(() => parseResetOptions(invalid, 'DataIngestion')).toThrow('Reset requires');
    });

    it('requires exactly the known application tables and excludes Users from deletion', () => {
        const inventory = ['Users', ...resetTables].map(name => ({ schemaName: 'dbo', name }));
        expect(() => validateResetInventory(inventory)).not.toThrow();
        expect(resetTables).not.toContain('Users');
        expect(() => validateResetInventory(inventory.slice(1))).toThrow('inventory');
        expect(() => validateResetInventory([...inventory, { schemaName: 'dbo', name: 'Unexpected' }])).toThrow('inventory');
        expect(() => validateResetInventory(inventory.map(table => ({ ...table, schemaName: 'other' })))).toThrow('inventory');
        expect(resetTables.indexOf('Uploads')).toBeLessThan(resetTables.indexOf('FileDefinitionVersions'));
        expect(resetTables.indexOf('FileDefinitionVersions')).toBeLessThan(resetTables.indexOf('FileDefinitions'));
    });

    function storage(remain = false) {
        const deleted = jest.fn().mockResolvedValue({ succeeded: true });
        const passes = new Map<string, number>();
        const client = {
            getContainerClient: jest.fn((name: string) => ({
                async *listBlobsFlat() {
                    const pass = passes.get(name) ?? 0;
                    passes.set(name, pass + 1);
                    if (pass === 0 || remain) {
                        yield { name: 'artifact' };
                        yield { name: 'artifact', snapshot: 'snapshot' };
                    }
                },
                getBlobClient: jest.fn(() => ({ deleteIfExists: deleted })),
            })),
        };
        return { client, deleted };
    }

    it('inventories all containers without deleting anything', async () => {
        const { client, deleted } = storage();
        const counts = await resetBlobs(client, false);
        expect(Object.keys(counts)).toEqual([...resetContainers]);
        expect(Object.values(counts)).toEqual([1, 1, 1, 1, 1]);
        expect(deleted).not.toHaveBeenCalled();
    });

    it('deletes each blob once with its snapshots and verifies emptiness', async () => {
        const { client, deleted } = storage();
        await resetBlobs(client, true);
        expect(deleted).toHaveBeenCalledTimes(5);
        expect(deleted).toHaveBeenCalledWith({ deleteSnapshots: 'include' });
    });

    it('fails explicitly if artifacts remain', async () => {
        const { client } = storage(true);
        await expect(resetBlobs(client, true)).rejects.toThrow('cleanup incomplete');
    });
});
