// =============================================================================
// Upload Service - Upload creation, pinned to the active definition version
// =============================================================================

import { Upload } from '../../models/Upload.model';
import { cacheService } from '../MemoryCache.service';
import { logger } from '../../utils/logger';
import { DefinitionVersionService } from '../DefinitionVersion.service';
import type { IUpload, ICreateUploadDto } from '../../interfaces/upload.interface';

/**
 * Create a new upload record and queue validation
 */
export async function createUpload(dto: ICreateUploadDto, userId: string): Promise<IUpload> {
    // Pin the upload to the version active now, so later definition changes cannot alter its outcome.
    const version = dto.FileDefinitionVersionId
        ? await DefinitionVersionService.findVersion(dto.FileDefinitionVersionId)
        : await DefinitionVersionService.ensureActiveVersion(dto.FileDefinitionId, userId);
    if (!version || version.FileDefinitionId !== dto.FileDefinitionId) {
        throw new Error('The selected file definition version is not valid for this definition.');
    }
    const upload = await Upload.create({ ...dto, FileDefinitionVersionId: version.Id }, userId);

    logger.info(`[SERVICE-CREATE] UploadId: ${upload.Id}, DefinitionId: ${dto.FileDefinitionId}, Version: ${version.VersionNumber}, UserId: ${userId}`);

    // Invalidate cache
    await cacheService.invalidateUploadProgress(upload.Id);

    return upload;
}
