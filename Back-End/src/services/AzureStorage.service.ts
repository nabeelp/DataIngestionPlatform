// =============================================================================
// Azure Storage Service - Blob Storage Operations for File Management
// =============================================================================

import { createHash } from 'crypto';
import { BlobServiceClient, BlobSASPermissions, ContainerClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { appConfig } from '../config/appConfig';
import { logger } from '../utils/logger';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream } from 'fs';
import { Transform } from 'stream';
import path from 'path';
import os from 'os';

export interface UploadedFileInfo {
    blobUrl: string;
    containerName: string;
    blobName: string;
    size: number;
    compressed: boolean;
    compressedSize?: number;
    compressedBlobUrl?: string;
    sha256?: string;
}

export interface StreamOptions {
    chunkSize?: number;
    onProgress?: (bytesProcessed: number, totalBytes: number) => void;
}

/**
 * Azure Storage Service class
 */
export class AzureStorageService {
    private blobServiceClient: BlobServiceClient;
    private containerName: string;
    private compressedContainerName: string;

    constructor() {
        const connectionString = appConfig.azure.storage.connectionString;
        const accountUrl = appConfig.azure.storage.accountUrl;
        if (connectionString) {
            this.blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
        } else if (accountUrl) {
            this.blobServiceClient = new BlobServiceClient(accountUrl, new DefaultAzureCredential());
        } else {
            this.containerName = appConfig.azure.storage.containerName;
            this.compressedContainerName = appConfig.azure.storage.compressedContainerName;
            throw new Error('Configure AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT_URL.');
        }

        this.containerName = appConfig.azure.storage.containerName;
        this.compressedContainerName = appConfig.azure.storage.compressedContainerName;
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
     * Upload a file to Azure Blob Storage
     */
    async uploadFile(
        localFilePath: string, 
        blobName: string,
        options: { compress?: boolean } = {}
    ): Promise<UploadedFileInfo> {
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

        const blobUrl = blockBlobClient.url;
        const properties = await blockBlobClient.getProperties();
        const size = properties.contentLength || 0;

        let result: UploadedFileInfo = {
            blobUrl,
            containerName: this.containerName,
            blobName,
            size,
            compressed: false,
            sha256: hash.digest('hex')
        };

        // Optionally compress and upload
        if (options.compress) {
            const compressedInfo = await this.uploadCompressed(localFilePath, blobName);
            result = {
                ...result,
                compressed: true,
                compressedSize: compressedInfo.size,
                compressedBlobUrl: compressedInfo.blobUrl
            };
        }

        logger.info(`File uploaded; bytes=${size}`);
        return result;
    }

    /**
     * Upload a file from a buffer
     */
    async uploadBuffer(
        buffer: Buffer,
        blobName: string,
        options: { compress?: boolean } = {}
    ): Promise<UploadedFileInfo> {
        const containerClient = await this.getOrCreateContainer(this.containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        // Upload the buffer
        await blockBlobClient.upload(buffer, buffer.length, {
            blobHTTPHeaders: {
                blobContentType: this.getContentType(blobName)
            }
        });

        const blobUrl = blockBlobClient.url;
        
        let result: UploadedFileInfo = {
            blobUrl,
            containerName: this.containerName,
            blobName,
            size: buffer.length,
            compressed: false
        };

        // Optionally compress and upload
        if (options.compress) {
            const compressedInfo = await this.uploadBufferCompressed(buffer, blobName);
            result = {
                ...result,
                compressed: true,
                compressedSize: compressedInfo.size,
                compressedBlobUrl: compressedInfo.blobUrl
            };
        }

        logger.info(`Buffer uploaded; bytes=${buffer.length}`);
        return result;
    }

    /**
     * Compress and upload a file
     */
    private async uploadCompressed(localFilePath: string, blobName: string): Promise<UploadedFileInfo> {
        const containerClient = await this.getOrCreateContainer(this.compressedContainerName);
        const compressedBlobName = `${blobName}.gz`;
        const blockBlobClient = containerClient.getBlockBlobClient(compressedBlobName);

        // Create temp file for compressed data
        const tempFilePath = path.join(os.tmpdir(), `compressed_${Date.now()}.gz`);
        
        try {
            // Compress the file
            const gzip = createGzip();
            const source = createReadStream(localFilePath);
            const destination = createWriteStream(tempFilePath);

            await pipeline(source, gzip, destination);

            // Upload compressed file
            await blockBlobClient.uploadFile(tempFilePath, {
                blobHTTPHeaders: {
                    blobContentType: 'application/gzip'
                }
            });

            const blobUrl = blockBlobClient.url;
            const properties = await blockBlobClient.getProperties();
            const size = properties.contentLength || 0;

            logger.info(`Compressed file uploaded; bytes=${size}`);

            return {
                blobUrl,
                containerName: this.compressedContainerName,
                blobName: compressedBlobName,
                size,
                compressed: true
            };
        } finally {
            // Clean up temp file
            try {
                const fs = await import('fs');
                fs.unlinkSync(tempFilePath);
            } catch {
                // Ignore cleanup errors
            }
        }
    }

    /**
     * Compress and upload a buffer
     */
    private async uploadBufferCompressed(buffer: Buffer, blobName: string): Promise<UploadedFileInfo> {
        const zlib = await import('zlib');
        const compressedBuffer = zlib.gzipSync(buffer);
        
        const containerClient = await this.getOrCreateContainer(this.compressedContainerName);
        const compressedBlobName = `${blobName}.gz`;
        const blockBlobClient = containerClient.getBlockBlobClient(compressedBlobName);

        await blockBlobClient.upload(compressedBuffer, compressedBuffer.length, {
            blobHTTPHeaders: {
                blobContentType: 'application/gzip'
            }
        });

        const blobUrl = blockBlobClient.url;
        
        logger.info(`Compressed buffer uploaded; bytes=${compressedBuffer.length}`);

        return {
            blobUrl,
            containerName: this.compressedContainerName,
            blobName: compressedBlobName,
            size: compressedBuffer.length,
            compressed: true
        };
    }

    /**
     * Download a file from Azure Blob Storage
     */
    async downloadFile(blobName: string, localFilePath: string): Promise<void> {
        const containerClient = await this.getOrCreateContainer(this.containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        await blockBlobClient.downloadToFile(localFilePath);
        logger.info('File downloaded from Blob Storage.');
    }

    /**
     * Download a file as a stream
     */
    async downloadAsStream(
        blobName: string, 
        options: StreamOptions = {}
    ): Promise<NodeJS.ReadableStream> {
        const containerClient = await this.getOrCreateContainer(this.containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        const downloadResponse = await blockBlobClient.download(0);
        return downloadResponse.readableStreamBody as NodeJS.ReadableStream;
    }

    /**
     * Stream a blob (for large file processing)
     */
    async streamBlob(
        blobName: string,
        options: StreamOptions = {},
        containerName = this.containerName,
    ): Promise<{ stream: NodeJS.ReadableStream; size: number }> {
        const containerClient = this.blobServiceClient.getContainerClient(containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        // Get blob properties to know the size
        const properties = await blockBlobClient.getProperties();
        const size = properties.contentLength || 0;

        // Download and stream
        const downloadResponse = await blockBlobClient.download(0);
        const stream = downloadResponse.readableStreamBody as NodeJS.ReadableStream;

        return { stream, size };
    }

    async openBlobReadStream(blobName: string, containerName = this.containerName): Promise<NodeJS.ReadableStream> {
        const blockBlobClient = this.blobServiceClient
            .getContainerClient(containerName)
            .getBlockBlobClient(blobName);
        const response = await blockBlobClient.download(0);
        if (!response.readableStreamBody) throw new Error('Blob download returned no stream.');
        return response.readableStreamBody;
    }

    /**
     * Delete a blob
     */
    async deleteBlob(blobName: string, containerName?: string): Promise<void> {
        const container = containerName || this.containerName;
        const containerClient = await this.getOrCreateContainer(container);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        await blockBlobClient.deleteIfExists();
        logger.info('Blob deleted.');
    }

    /**
     * Get blob URL
     */
    getBlobUrl(blobName: string, containerName?: string): string {
        const container = containerName || this.containerName;
        const containerClient = this.blobServiceClient.getContainerClient(container);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);
        return blockBlobClient.url;
    }

    /**
     * Check if blob exists
     */
    async blobExists(blobName: string, containerName?: string): Promise<boolean> {
        const container = containerName || this.containerName;
        const containerClient = await this.getOrCreateContainer(container);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);
        return await blockBlobClient.exists();
    }

    /**
     * Get blob properties
     */
    async getBlobProperties(blobName: string, containerName?: string): Promise<any> {
        const container = containerName || this.containerName;
        const containerClient = await this.getOrCreateContainer(container);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);
        return await blockBlobClient.getProperties();
    }

    /**
     * Generate SAS token for temporary access
     */
    async generateSasToken(blobName: string, expiryMinutes: number = 60): Promise<string> {
        const containerClient = await this.getOrCreateContainer(this.containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        const sasOptions = {
            expiresOn: new Date(Date.now() + expiryMinutes * 60 * 1000),
            permissions: BlobSASPermissions.parse('r')
        };

        const sasToken = blockBlobClient.generateSasUrl(sasOptions);
        return sasToken;
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

    /**
     * List blobs in a container
     */
    async listBlobs(containerName?: string): Promise<string[]> {
        const container = containerName || this.containerName;
        const containerClient = await this.getOrCreateContainer(container);
        
        const blobs: string[] = [];
        for await (const blob of containerClient.listBlobsFlat()) {
            blobs.push(blob.name);
        }
        
        return blobs;
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
