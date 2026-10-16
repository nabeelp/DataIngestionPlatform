// =============================================================================
// Azure Storage Service - Blob Storage Operations for File Management
// =============================================================================

import { createHash } from 'crypto';
import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { appConfig } from '../config/appConfig';
import { logger } from '../utils/logger';
import { pipeline } from 'stream/promises';
import { createReadStream } from 'fs';
import { Readable, Transform } from 'stream';
import path from 'path';

export interface UploadedFileInfo {
    blobUrl: string;
    containerName: string;
    blobName: string;
    size: number;
    sha256: string;
}

/**
 * Azure Storage Service class
 */
export class AzureStorageService {
    private blobServiceClient: BlobServiceClient;
    private containerName: string;

    constructor() {
        const connectionString = appConfig.azure.storage.connectionString;
        const accountUrl = appConfig.azure.storage.accountUrl;
        if (connectionString) {
            this.blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
        } else if (accountUrl) {
            this.blobServiceClient = new BlobServiceClient(accountUrl, new DefaultAzureCredential());
        } else {
            throw new Error('Configure AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT_URL.');
        }

        this.containerName = appConfig.azure.storage.containerName;
    }

    /**
     * Get or create a container
     */
    async getOrCreateContainer(containerName: string): Promise<ContainerClient> {
        const containerClient = this.blobServiceClient.getContainerClient(containerName);

        const exists = await containerClient.exists();
        if (!exists) {
            await containerClient.create();
            logger.info('Created Blob container.');
        }

        return containerClient;
    }

    /**
     * Upload a file to Azure Blob Storage, hashing it while streaming.
     */
    async uploadFile(localFilePath: string, blobName: string): Promise<UploadedFileInfo> {
        const containerClient = await this.getOrCreateContainer(this.containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        const hash = createHash('sha256');
        const hashingStream = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
                hash.update(chunk);
                callback(null, chunk);
            }
        });
        await Promise.all([
            pipeline(createReadStream(localFilePath), hashingStream),
            blockBlobClient.uploadStream(hashingStream, 4 * 1024 * 1024, 5, {
                blobHTTPHeaders: {
                    blobContentType: this.getContentType(blobName)
                }
            }),
        ]);

        const properties = await blockBlobClient.getProperties();
        const size = properties.contentLength || 0;

        logger.info(`File uploaded; bytes=${size}`);
        return {
            blobUrl: blockBlobClient.url,
            containerName: this.containerName,
            blobName,
            size,
            sha256: hash.digest('hex')
        };
    }

    async openBlobReadStream(blobName: string, containerName = this.containerName): Promise<Readable> {
        const blockBlobClient = this.blobServiceClient
            .getContainerClient(containerName)
            .getBlockBlobClient(blobName);
        const response = await blockBlobClient.download(0);
        if (!response.readableStreamBody) throw new Error('Blob download returned no stream.');
        return response.readableStreamBody as Readable;
    }

    async uploadStreamToBlob(
        stream: Readable,
        blobName: string,
        containerName: string,
    ): Promise<void> {
        const blockBlobClient = this.blobServiceClient
            .getContainerClient(containerName)
            .getBlockBlobClient(blobName);

        await blockBlobClient.uploadStream(stream, 4 * 1024 * 1024, 5, {
            blobHTTPHeaders: {
                blobContentType: this.getContentType(blobName),
            },
        });
    }

    /**
     * Delete a blob
     */
    async deleteBlob(blobName: string, containerName?: string): Promise<void> {
        const container = containerName || this.containerName;
        const containerClient = this.blobServiceClient.getContainerClient(container);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        await blockBlobClient.deleteIfExists();
        logger.info('Blob deleted.');
    }

    /**
     * Get content type based on file extension
     */
    private getContentType(filename: string): string {
        const ext = path.extname(filename).toLowerCase();
        const contentTypes: Record<string, string> = {
            '.csv': 'text/csv',
            '.tsv': 'text/tab-separated-values',
            '.txt': 'text/plain',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.xls': 'application/vnd.ms-excel',
            '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
            '.xlsb': 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
            '.json': 'application/json',
            '.xml': 'application/xml',
            '.zip': 'application/zip',
            '.gz': 'application/gzip'
        };
        return contentTypes[ext] || 'application/octet-stream';
    }
}

// Export singleton instance
let azureStorage: AzureStorageService | null = null;
try {
    azureStorage = new AzureStorageService();
} catch (error) {
    logger.warn(`AzureStorageService initialization failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
}
export { azureStorage };
