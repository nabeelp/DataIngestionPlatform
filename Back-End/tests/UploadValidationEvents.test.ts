import type { IUpload, UploadStatus } from '../src/interfaces/upload.interface';
import type { ValidationEvent } from '../src/contracts/validation-event';
import { Upload } from '../src/models/Upload.model';
import { ValidationResult } from '../src/models/ValidationResult.model';
import { cacheService } from '../src/services/MemoryCache.service';
import { UploadService } from '../src/services/Upload.service';

const makeUpload = (Status: UploadStatus): IUpload => ({
    Id: 'upload-id',
    FileDefinitionId: 'definition-id',
    FileDefinitionVersionId: null,
    UploadedBy: 'user-id',
    OriginalFilename: 'sample.csv',
    StoredFilename: 'sample.csv',
    BlobContainer: 'uploads',
    BlobName: 'upload-id/input.csv',
    FileSha256: null,
    DetectedEncoding: null,
    ValidationDate: null,
    EngineVersion: null,
    ReportBlobName: null,
    ParquetPrefix: null,
    FileSize: 1,
    FileType: 'csv',
    RetryCount: 0,
    RowCountNo: null,
    SheetCount: null,
    Status,
    UploadedAt: new Date('2026-01-01T00:00:00.000Z'),
    ValidationStartedAt: null,
    ValidationCompletedAt: null,
    DeliveryStartedAt: null,
    DeliveryCompletedAt: null,
    DeliveredTo: null,
    DeliveredAt: null,
    ErrorMessage: null,
});

const progressEvent: ValidationEvent = {
    schemaVersion: 1,
    uploadId: 'upload-id',
    type: 'progress',
    stage: 'rules',
    percent: 75,
};

describe('UploadService validation progress events', () => {
    afterEach(() => jest.restoreAllMocks());

    it('does not overwrite a completed status or leave stale progress cached', async () => {
        jest.spyOn(Upload, 'findById')
            .mockResolvedValueOnce(makeUpload('VALIDATION_IN_PROGRESS'))
            .mockResolvedValueOnce(makeUpload('VALIDATION_PASSED'));
        const update = jest.spyOn(Upload, 'update').mockResolvedValue(null);
        const transition = jest.spyOn(Upload, 'transitionStatus').mockResolvedValue(false);
        jest.spyOn(ValidationResult, 'findByUploadId').mockResolvedValue(null);
        const cacheProgress = jest.spyOn(cacheService, 'cacheUploadProgress').mockResolvedValue();
        const invalidateProgress = jest.spyOn(cacheService, 'invalidateUploadProgress').mockResolvedValue();

        await UploadService.handleValidationEvent(progressEvent);

        expect(update).not.toHaveBeenCalled();
        expect(transition).not.toHaveBeenCalled();
        expect(cacheProgress).toHaveBeenCalledTimes(1);
        expect(invalidateProgress).toHaveBeenCalledWith('upload-id');
    });

    it('ignores queued progress when the atomic transition loses a race', async () => {
        jest.spyOn(Upload, 'findById').mockResolvedValueOnce(makeUpload('VALIDATION_QUEUED'));
        const transition = jest.spyOn(Upload, 'transitionStatus').mockResolvedValue(false);
        const findValidation = jest.spyOn(ValidationResult, 'findByUploadId').mockResolvedValue(null);
        const cacheProgress = jest.spyOn(cacheService, 'cacheUploadProgress').mockResolvedValue();

        await UploadService.handleValidationEvent(progressEvent);

        expect(transition).toHaveBeenCalledWith('upload-id', 'VALIDATION_QUEUED', 'VALIDATION_IN_PROGRESS');
        expect(findValidation).not.toHaveBeenCalled();
        expect(cacheProgress).not.toHaveBeenCalled();
    });
});
