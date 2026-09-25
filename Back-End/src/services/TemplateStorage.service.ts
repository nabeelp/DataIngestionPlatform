// =============================================================================
// Template Storage - stores admin-uploaded definition templates via the configured provider
// Azure Blob Storage when STORAGE_PROVIDER=azure, otherwise a local folder.
// =============================================================================

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { appConfig } from '../config/appConfig';

const NAME_SEPARATOR = '__';

export const ALLOWED_TEMPLATE_EXTENSIONS = ['.xlsx', '.xls', '.csv', '.txt'];

const CONTENT_TYPES: Record<string, string> = {
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
};

export const getTemplateContentType = (name: string): string =>
    CONTENT_TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream';

/**
 * Remove path components and unsafe characters from a user-supplied filename.
 */
export function sanitizeFilename(originalName: string): string {
    const base = path.basename(originalName.replace(/\\/g, '/'));
    const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 150);
    return cleaned || 'file';
}

/**
 * Validate that a stored template name cannot escape its container/folder.
 */
export function assertSafeTemplateName(name: string): void {
    if (!name || path.basename(name) !== name || name.includes('..') || /[\\/]/.test(name)) {
        throw new Error('Invalid template filename');
    }
}

/**
 * The user-facing filename for a stored template (strips the unique prefix).
 */
export function getTemplateDisplayName(storedName: string): string {
    const index = storedName.indexOf(NAME_SEPARATOR);
    return index >= 0 ? storedName.slice(index + NAME_SEPARATOR.length) : storedName;
}

const localTemplateDir = (): string => {
    const dir = process.env.TEMPLATE_STORAGE_PATH || path.join(process.cwd(), 'uploads', 'templates');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
};

let containerClient: ContainerClient | null = null;
const getContainerClient = async (): Promise<ContainerClient> => {
    if (containerClient) return containerClient;

    const containerName = process.env.AZURE_STORAGE_TEMPLATES_CONTAINER || 'templates';
    const connectionString = appConfig.azure.storage.connectionString;
    const accountUrl = process.env.AZURE_STORAGE_ACCOUNT_URL;

    let serviceClient: BlobServiceClient;
    if (connectionString) {
        serviceClient = BlobServiceClient.fromConnectionString(connectionString);
    } else if (accountUrl) {
        serviceClient = new BlobServiceClient(accountUrl, new DefaultAzureCredential());
    } else {
        throw new Error('Azure template storage requires AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT_URL');
    }

    const client = serviceClient.getContainerClient(containerName);
    await client.createIfNotExists();
    containerClient = client;
    return client;
};

const useAzure = (): boolean => appConfig.storage.provider === 'azure';

export const TemplateStorage = {
    /**
     * Persist a template and return its stored name.
     */
    async save(buffer: Buffer, originalName: string): Promise<string> {
        const storedName = `${randomUUID()}${NAME_SEPARATOR}${sanitizeFilename(originalName)}`;

        if (useAzure()) {
            const client = await getContainerClient();
            await client.getBlockBlobClient(storedName).uploadData(buffer, {
                blobHTTPHeaders: { blobContentType: getTemplateContentType(storedName) },
            });
        } else {
            await fs.promises.writeFile(path.join(localTemplateDir(), storedName), buffer);
        }

        return storedName;
    },

    async openReadStream(storedName: string): Promise<{ stream: Readable; size?: number }> {
        assertSafeTemplateName(storedName);

        if (useAzure()) {
            const client = await getContainerClient();
            const download = await client.getBlobClient(storedName).download();
            if (!download.readableStreamBody) {
                throw new Error('Template not found');
            }
            return { stream: download.readableStreamBody as Readable, size: download.contentLength };
        }

        const filePath = path.join(localTemplateDir(), storedName);
        const stats = await fs.promises.stat(filePath).catch(() => null);
        if (!stats) {
            throw new Error('Template not found');
        }
        return { stream: fs.createReadStream(filePath), size: stats.size };
    },

    async delete(storedName: string): Promise<void> {
        assertSafeTemplateName(storedName);

        if (useAzure()) {
            const client = await getContainerClient();
            await client.getBlobClient(storedName).deleteIfExists();
            return;
        }

        await fs.promises.rm(path.join(localTemplateDir(), storedName), { force: true });
    },
};
