// =============================================================================
// Delivery Targets - optional per-definition file-copy delivery
// A definition may name a delivery folder (relative to DELIVERY_ROOT_PATH). When it does not,
// validated uploads finish as VALIDATED without a delivery stage.
// =============================================================================

import path from 'path';
import { appConfig } from '../config/appConfig';
import { sanitizeFilename } from './TemplateStorage.service';

export const FILE_COPY_DELIVERY = 'FileCopy';
export const AZURE_BLOB_DELIVERY = 'AzureBlob';

export interface DeliveryTarget {
    type: typeof FILE_COPY_DELIVERY | typeof AZURE_BLOB_DELIVERY;
    folder: string;
    name: string;
}

const FOLDER_PATTERN = /^[A-Za-z0-9 _.-]+(\/[A-Za-z0-9 _.-]+)*$/;

export const getDeliveryRoot = (): string => path.resolve(appConfig.delivery.rootPath);

/**
 * Validate and normalize an admin-supplied delivery folder. Returns null for "no delivery".
 */
export function normalizeDeliveryFolder(input: unknown): string | null {
    if (input === null || input === undefined) return null;
    if (typeof input !== 'string') throw new Error('Delivery folder must be text');

    const folder = input.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!folder) return null;

    if (folder.length > 200 || !FOLDER_PATTERN.test(folder) || folder.split('/').some(part => part === '.' || part === '..')) {
        throw new Error('Delivery folder must be a relative path using letters, numbers, spaces, ".", "-", "_" and "/"');
    }
    return folder;
}

/**
 * Delivery targets configured for a file definition.
 */
export function getDeliveryTargets(fileDefinition: { DeliveryFolder?: string | null }): DeliveryTarget[] {
    const folder = fileDefinition.DeliveryFolder ? normalizeDeliveryFolder(fileDefinition.DeliveryFolder) : null;
    if (!folder) return [];
    return [{
        type: appConfig.delivery.provider === 'azure' ? AZURE_BLOB_DELIVERY : FILE_COPY_DELIVERY,
        folder,
        name: folder,
    }];
}

/** Resolve a local path or deterministic blob key from a validated delivery folder. */
export function resolveDeliveryDestination(folder: string, uploadId: string, originalFilename: string): string {
    const filename = `${sanitizeFilename(uploadId)}_${sanitizeFilename(originalFilename)}`;
    if (appConfig.delivery.provider === 'azure') {
        return path.posix.join(folder, filename);
    }

    const root = getDeliveryRoot();
    const destination = path.resolve(root, folder, filename);
    assertInsideDeliveryRoot(destination);
    return destination;
}

export function assertSafeDeliveryBlobName(blobName: string): void {
    const segments = blobName.split('/');
    if (
        !blobName ||
        blobName.startsWith('/') ||
        segments.some(segment => !segment || segment === '.' || segment === '..')
    ) {
        throw new Error('Delivery blob name must be a relative path without empty or traversal segments');
    }
}

export function assertInsideDeliveryRoot(destination: string): void {
    const root = getDeliveryRoot();
    const relative = path.relative(root, path.resolve(destination));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Delivery destination is outside the configured delivery root');
    }
}
