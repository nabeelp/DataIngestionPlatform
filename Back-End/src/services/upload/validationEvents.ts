// =============================================================================
// Upload Service - Handling validation events from the validation service
// =============================================================================

import { Upload } from '../../models/Upload.model';
import { UploadSheet } from '../../models/UploadSheet.model';
import { ValidationResult } from '../../models/ValidationResult.model';
import { cacheService } from '../MemoryCache.service';
import { logger } from '../../utils/logger';
import { emitUploadEvent } from '../../websocket/socketServer';
import type { UploadStatus } from '../../interfaces/upload.interface';
import type { ValidationEvent } from '../../contracts/validation-event';
import { startDelivery } from './delivery';

export async function handleValidationEvent(event: ValidationEvent): Promise<void> {
    const upload = await Upload.findById(event.uploadId);
    if (!upload) throw new Error(`Upload not found for validation event ${event.uploadId}.`);

    if (event.type === 'progress') {
        if (upload.Status === 'VALIDATION_QUEUED') {
            if (!await Upload.transitionStatus(event.uploadId, 'VALIDATION_QUEUED', 'VALIDATION_IN_PROGRESS')) return;
        } else if (upload.Status !== 'VALIDATION_IN_PROGRESS') {
            return;
        }

        await cacheService.cacheUploadProgress(event.uploadId, {
            uploadId: event.uploadId,
            status: 'VALIDATION_IN_PROGRESS',
            validation: {
                percent: event.percent,
                currentRule: event.stage,
                totalRules: (await ValidationResult.findByUploadId(event.uploadId))?.TotalRules ?? 0,
                status: 'IN_PROGRESS',
            },
            delivery: null,
        });
        const latestUpload = await Upload.findById(event.uploadId);
        if (!latestUpload || latestUpload.Status !== 'VALIDATION_IN_PROGRESS') {
            await cacheService.invalidateUploadProgress(event.uploadId);
            return;
        }

        void emitUploadEvent(event.uploadId, {
            uploadId: event.uploadId,
            type: 'VALIDATION_UPDATE',
            stage: event.stage,
            percent: event.percent,
        });
        return;
    }

    const completedAt = new Date();
    const failed = event.type === 'failed' || event.summary?.status === 'FAILED';
    const validationStates: UploadStatus[] = ['VALIDATION_QUEUED', 'VALIDATION_IN_PROGRESS', 'VALIDATION_PASSED', 'VALIDATION_FAILED'];
    if (!validationStates.includes(upload.Status)) return;
    if (!failed && upload.Status === 'VALIDATION_FAILED') return;
    const status: UploadStatus = failed ? 'VALIDATION_FAILED' : 'VALIDATION_PASSED';
    const errorMessage = failed ? event.error || 'Validation failed.' : null;
    await Upload.update(event.uploadId, {
        ...(failed ? { Status: status } : {}),
        ErrorMessage: errorMessage,
        ValidationCompletedAt: completedAt,
        RowCountNo: event.summary?.rowCount,
    });

    const sheets = await UploadSheet.findByUploadId(event.uploadId);
    for (const sheet of sheets) {
        await UploadSheet.update(sheet.Id, {
            Status: failed ? 'FAILED' : 'VALIDATED',
            ErrorMessage: errorMessage ?? undefined,
        });
    }

    await cacheService.invalidateUploadProgress(event.uploadId);
    if (failed) {
        void emitUploadEvent(event.uploadId, {
            uploadId: event.uploadId,
            type: 'VALIDATION_FAILED',
            details: { error: errorMessage },
        });
        logger.warn(`Validation failed for upload ${event.uploadId} at stage ${event.stage}`);
        return;
    }

    void emitUploadEvent(event.uploadId, {
        uploadId: event.uploadId,
        type: 'VALIDATION_UPDATE',
        stage: event.stage,
        percent: 100,
        status: event.summary?.status,
    });
    await startDelivery(event.uploadId);
}
