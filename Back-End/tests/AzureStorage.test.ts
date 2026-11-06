import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';

const mocks = {
    config: { connectionString: 'UseDevelopmentStorage=true' as string | undefined, accountUrl: undefined as string | undefined },
    fromConnectionString: jest.fn(),
    ctor: jest.fn(),
    credential: jest.fn(),
    container: {
        exists: jest.fn(),
        create: jest.fn(),
        getBlockBlobClient: jest.fn(),
    },
    blob: {
        uploadStream: jest.fn(),
        getProperties: jest.fn(),
        download: jest.fn(),
        deleteIfExists: jest.fn(),
    },
    getContainerClient: jest.fn(),
};

jest.mock('../src/config/appConfig', () => ({
    appConfig: {
        azure: {
            storage: {
                get connectionString() { return mocks.config.connectionString; },
                get accountUrl() { return mocks.config.accountUrl; },
                containerName: 'uploads',
            },
        },
    },
}));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('@azure/identity', () => ({ DefaultAzureCredential: function (this: unknown) { return mocks.credential(); } }));
jest.mock('@azure/storage-blob', () => {
    class FakeService {
        constructor(...args: unknown[]) { mocks.ctor(...args); }
        static fromConnectionString(...args: unknown[]) { mocks.fromConnectionString(...args); return new FakeService(); }
        getContainerClient(name: string) { return mocks.getContainerClient(name); }
    }
    return { BlobServiceClient: FakeService };
});

import { AzureStorageService } from '../src/services/AzureStorage.service';

let directory: string;

beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), 'azure-storage-test-'));
    mocks.config.connectionString = 'UseDevelopmentStorage=true';
    mocks.config.accountUrl = undefined;
    mocks.container.exists.mockResolvedValue(true);
    mocks.container.create.mockResolvedValue(undefined);
    mocks.container.getBlockBlobClient.mockReturnValue(mocks.blob);
    mocks.getContainerClient.mockReturnValue(mocks.container);
    mocks.blob.uploadStream.mockImplementation(async (stream: Readable) => { for await (const chunk of stream) void chunk; });
    mocks.blob.getProperties.mockResolvedValue({ contentLength: 11 });
    mocks.blob.deleteIfExists.mockResolvedValue({ succeeded: true });
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe('configuration', () => {
    it('uses the connection string when present', () => {
        new AzureStorageService();

        expect(mocks.fromConnectionString).toHaveBeenCalledWith('UseDevelopmentStorage=true');
    });

    it('authenticates with the default credential for an account URL', () => {
        mocks.config.connectionString = undefined;
        mocks.config.accountUrl = 'https://account.blob.core.windows.net';
        mocks.credential.mockReturnValue({ kind: 'credential' });

        new AzureStorageService();

        expect(mocks.ctor).toHaveBeenCalledWith('https://account.blob.core.windows.net', { kind: 'credential' });
    });

    it('refuses to start without storage settings', () => {
        mocks.config.connectionString = undefined;

        expect(() => new AzureStorageService()).toThrow('AZURE_STORAGE_CONNECTION_STRING');
    });
});

describe('uploading a file', () => {
    const file = (content: string) => {
        const target = path.join(directory, 'sample.csv');
        writeFileSync(target, content);
        return target;
    };

    it('streams the file, records the stored size and returns the SHA-256 of what was sent', async () => {
        const result = await new AzureStorageService().uploadFile(file('id,amount\n1,2\n'), 'upload-1/sample.csv');

        expect(result).toEqual({
            containerName: 'uploads',
            blobName: 'upload-1/sample.csv',
            size: 11,
            sha256: createHash('sha256').update('id,amount\n1,2\n').digest('hex'),
        });
        expect(mocks.container.getBlockBlobClient).toHaveBeenCalledWith('upload-1/sample.csv');
        expect(mocks.blob.uploadStream.mock.calls[0][3]).toEqual({ blobHTTPHeaders: { blobContentType: 'text/csv' } });
    });

    it('creates the container on first use only', async () => {
        mocks.container.exists.mockResolvedValueOnce(false);
        const service = new AzureStorageService();

        await service.uploadFile(file('a'), 'one.csv');
        mocks.container.exists.mockResolvedValue(true);
        await service.uploadFile(file('b'), 'two.csv');

        expect(mocks.container.create).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['report.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        ['legacy.XLS', 'application/vnd.ms-excel'],
        ['notes.txt', 'text/plain'],
        ['data.unknown', 'application/octet-stream'],
    ])('labels %s as %s', async (name, contentType) => {
        await new AzureStorageService().uploadFile(file('x'), `id/${name}`);

        expect(mocks.blob.uploadStream.mock.calls[0][3].blobHTTPHeaders.blobContentType).toBe(contentType);
    });

    it('does not report success when the blob service rejects the upload', async () => {
        mocks.blob.uploadStream.mockRejectedValueOnce(new Error('storage unavailable'));

        await expect(new AzureStorageService().uploadFile(file('x'), 'id/sample.csv')).rejects.toThrow('storage unavailable');
        expect(mocks.blob.getProperties).not.toHaveBeenCalled();
    });

    it('fails when the local file cannot be read', async () => {
        await expect(new AzureStorageService().uploadFile(path.join(directory, 'missing.csv'), 'id/missing.csv'))
            .rejects.toThrow();
    });
});

describe('reading and deleting blobs', () => {
    it('opens a read stream from the requested container', async () => {
        const body = Readable.from(['data']);
        mocks.blob.download.mockResolvedValue({ readableStreamBody: body });

        const stream = await new AzureStorageService().openBlobReadStream('id/file.csv', 'reports');

        expect(stream).toBe(body);
        expect(mocks.getContainerClient).toHaveBeenCalledWith('reports');
        expect(mocks.blob.download).toHaveBeenCalledWith(0);
    });

    it('reports a download without a stream', async () => {
        mocks.blob.download.mockResolvedValue({});

        await expect(new AzureStorageService().openBlobReadStream('id/file.csv')).rejects.toThrow('no stream');
    });

    it('deletes quietly when the blob is already gone, in the default or a given container', async () => {
        const service = new AzureStorageService();

        await service.deleteBlob('id/file.csv');
        await service.deleteBlob('id/report.csv', 'reports');

        expect(mocks.blob.deleteIfExists).toHaveBeenCalledTimes(2);
        expect(mocks.getContainerClient.mock.calls.map(call => call[0])).toEqual(['uploads', 'reports']);
    });

    it('surfaces delete failures so callers can retry', async () => {
        mocks.blob.deleteIfExists.mockRejectedValueOnce(new Error('forbidden'));

        await expect(new AzureStorageService().deleteBlob('id/file.csv')).rejects.toThrow('forbidden');
    });
});
