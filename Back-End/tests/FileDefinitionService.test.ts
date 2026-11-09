import type { IFileDefinition } from '../src/interfaces/fileDefinition.interface';

const mocks = {
    definition: {
        create: jest.fn(),
        delete: jest.fn(),
        update: jest.fn(),
        findById: jest.fn(),
        findAll: jest.fn(),
        getAllowedUsers: jest.fn(),
        addUserAccess: jest.fn(),
        removeUserAccess: jest.fn(),
    },
    rule: { create: jest.fn(), delete: jest.fn() },
    versions: { ensureActiveVersion: jest.fn(), getDraftContract: jest.fn() },
    query: jest.fn(),
};

jest.mock('../src/models/FileDefinition.model', () => ({ FileDefinition: mocks.definition }));
jest.mock('../src/models/Rule.model', () => ({ Rule: mocks.rule }));
jest.mock('../src/services/DefinitionVersion.service', () => ({ DefinitionVersionService: mocks.versions }));
jest.mock('../src/config/database', () => ({ getConnection: async () => ({ request: () => ({ query: mocks.query }) }) }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { FileDefinitionService } from '../src/services/FileDefinition.service';

const contract = { schemaVersion: 1, layout: 'single', ignoredSheets: [], encoding: 'auto', tables: [], rules: [], lookups: {} };
const definition = { Id: 'def-1', Name: 'Orders', Description: '', Contract: contract, Status: 'Active', CreatedAt: new Date(), UpdatedAt: new Date() } as unknown as IFileDefinition;
const dto = { Name: 'Orders', Description: '', Contract: contract as never };
const rule = (id: string) => ({ Config: { id } as never, IsEnabled: true });

beforeEach(() => {
    mocks.definition.create.mockResolvedValue(definition);
    mocks.rule.create.mockImplementation(async (value: { Config: { id: string } }) => ({ Id: value.Config.id }));
    mocks.rule.delete.mockResolvedValue(undefined);
    mocks.definition.delete.mockResolvedValue(undefined);
    mocks.versions.ensureActiveVersion.mockResolvedValue({});
});

describe('creating a definition', () => {
    it('creates the rules with it and publishes version 1 for the creator', async () => {
        const created = await FileDefinitionService.createDefinition(dto, 'admin-1', [rule('r1'), rule('r2')]);

        expect(created).toBe(definition);
        expect(mocks.rule.create).toHaveBeenCalledTimes(2);
        expect(mocks.rule.create).toHaveBeenCalledWith(expect.objectContaining({ FileDefinitionId: 'def-1' }), 'admin-1');
        expect(mocks.versions.ensureActiveVersion).toHaveBeenCalledWith('def-1', 'admin-1');
    });

    it('removes the half-created definition and its rules when a rule cannot be saved', async () => {
        const failure = new Error('rule storage failed');
        mocks.rule.create.mockResolvedValueOnce({ Id: 'r1' }).mockRejectedValueOnce(failure);

        await expect(FileDefinitionService.createDefinition(dto, 'admin-1', [rule('r1'), rule('r2'), rule('r3')]))
            .rejects.toBe(failure);

        expect(mocks.rule.delete).toHaveBeenCalledTimes(1);
        expect(mocks.rule.delete).toHaveBeenCalledWith('r1');
        expect(mocks.definition.delete).toHaveBeenCalledWith('def-1');
        expect(mocks.versions.ensureActiveVersion).not.toHaveBeenCalled();
    });

    it('still reports the original failure when the clean-up itself fails', async () => {
        const failure = new Error('rule storage failed');
        mocks.rule.create.mockRejectedValueOnce(failure);
        mocks.definition.delete.mockRejectedValueOnce(new Error('cleanup failed'));

        await expect(FileDefinitionService.createDefinition(dto, 'admin-1', [rule('r1')])).rejects.toBe(failure);
    });

    it('does not publish when the definition itself cannot be created', async () => {
        mocks.definition.create.mockRejectedValueOnce(new Error('duplicate name'));

        await expect(FileDefinitionService.createDefinition(dto, 'admin-1')).rejects.toThrow('duplicate name');

        expect(mocks.versions.ensureActiveVersion).not.toHaveBeenCalled();
    });
});

describe('updating and deleting a definition', () => {
    it('reports an unknown definition', async () => {
        mocks.definition.update.mockResolvedValue(null);

        await expect(FileDefinitionService.updateDefinition('missing', { Name: 'x' })).rejects.toThrow('File definition not found');
    });

    it('returns the updated definition', async () => {
        mocks.definition.update.mockResolvedValue(definition);

        await expect(FileDefinitionService.updateDefinition('def-1', { Name: 'Orders' })).resolves.toBe(definition);
    });

    it('propagates storage errors when deleting', async () => {
        mocks.definition.delete.mockRejectedValueOnce(new Error('referenced by uploads'));

        await expect(FileDefinitionService.deleteDefinition('def-1')).rejects.toThrow('referenced by uploads');
    });
});

describe('user access', () => {
    it('refuses an empty list of users', async () => {
        await expect(FileDefinitionService.addUsersToDefinition('def-1', [])).rejects.toThrow('non-empty array');
        expect(mocks.definition.addUserAccess).not.toHaveBeenCalled();
    });

    it('adds each user and returns the resulting assignment list', async () => {
        mocks.definition.getAllowedUsers.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);

        const users = await FileDefinitionService.addUsersToDefinition('def-1', ['u1', 'u2']);

        expect(mocks.definition.addUserAccess.mock.calls).toEqual([['def-1', 'u1'], ['def-1', 'u2']]);
        expect(users).toHaveLength(2);
    });

    it('counts users per definition', async () => {
        mocks.query.mockResolvedValue({ recordset: [{ FileDefinitionId: 'a', userCount: 2 }, { FileDefinitionId: 'b', userCount: 5 }] });

        await expect(FileDefinitionService.getAllDefinitionUserCounts()).resolves.toEqual({ a: 2, b: 5 });
    });
});

describe('exporting a definition', () => {
    it('exports the full draft contract rather than only the saved structure', async () => {
        const draft = { ...contract, rules: [{ id: 'r1' }] };
        mocks.definition.findById.mockResolvedValue({ ...definition, TemplateFilename: null });
        mocks.versions.getDraftContract.mockResolvedValue(draft);

        const exported = await FileDefinitionService.exportDefinition('def-1');

        expect(exported).toMatchObject({ id: 'def-1', name: 'Orders', contract: draft, status: 'Active', templateFilename: null });
        expect(exported).not.toHaveProperty('columns');
    });

    it('refuses to export an unknown definition', async () => {
        mocks.definition.findById.mockResolvedValue(null);

        await expect(FileDefinitionService.exportDefinition('missing')).rejects.toThrow('File definition not found');
    });
});
