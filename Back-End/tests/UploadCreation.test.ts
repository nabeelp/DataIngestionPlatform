const mocks = {
    findVersion: jest.fn(),
    ensureActiveVersion: jest.fn(),
    create: jest.fn(),
    invalidate: jest.fn(),
};

jest.mock('../src/models/Upload.model', () => ({ Upload: { create: mocks.create } }));
jest.mock('../src/services/DefinitionVersion.service', () => ({
    DefinitionVersionService: { findVersion: mocks.findVersion, ensureActiveVersion: mocks.ensureActiveVersion },
}));
jest.mock('../src/services/MemoryCache.service', () => ({ cacheService: { invalidateUploadProgress: mocks.invalidate } }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { createUpload } from '../src/services/upload/uploadCreation';

const dto = (overrides: Record<string, unknown> = {}) => ({
    FileDefinitionId: 'def-1', OriginalFilename: 'a.csv', StoredFilename: 'u_a.csv', FileSize: 3, FileType: 'csv', ...overrides,
});

beforeEach(() => {
    mocks.create.mockImplementation(async (value: Record<string, unknown>) => ({ Id: 'upload-1', ...value }));
    mocks.invalidate.mockResolvedValue(undefined);
});

describe('creating an upload', () => {
    it('pins the upload to the version that is active now', async () => {
        mocks.ensureActiveVersion.mockResolvedValue({ Id: 'v2', FileDefinitionId: 'def-1', VersionNumber: 2 });

        const upload = await createUpload(dto() as never, 'user-1');

        expect(mocks.ensureActiveVersion).toHaveBeenCalledWith('def-1', 'user-1');
        expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ FileDefinitionVersionId: 'v2' }), 'user-1');
        expect(upload.Id).toBe('upload-1');
        expect(mocks.invalidate).toHaveBeenCalledWith('upload-1');
    });

    it('uses the requested version when it belongs to the definition', async () => {
        mocks.findVersion.mockResolvedValue({ Id: 'v1', FileDefinitionId: 'def-1', VersionNumber: 1 });

        await createUpload(dto({ FileDefinitionVersionId: 'v1' }) as never, 'user-1');

        expect(mocks.ensureActiveVersion).not.toHaveBeenCalled();
        expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ FileDefinitionVersionId: 'v1' }), 'user-1');
    });

    it.each([
        ['unknown', null],
        ['another definition', { Id: 'v9', FileDefinitionId: 'other-def', VersionNumber: 1 }],
    ])('refuses a version that is %s', async (_label, version) => {
        mocks.findVersion.mockResolvedValue(version);

        await expect(createUpload(dto({ FileDefinitionVersionId: 'v9' }) as never, 'user-1'))
            .rejects.toThrow('not valid for this definition');
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it('does not create the upload when pinning fails', async () => {
        mocks.ensureActiveVersion.mockRejectedValue(new Error('definition missing'));

        await expect(createUpload(dto() as never, 'user-1')).rejects.toThrow('definition missing');
        expect(mocks.create).not.toHaveBeenCalled();
        expect(mocks.invalidate).not.toHaveBeenCalled();
    });
});
