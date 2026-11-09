// =============================================================================
// Upload Service - Building the ValidationRequest sent to the validation service
// =============================================================================

import { v4 as uuidv4 } from 'uuid';
import type { IUpload } from '../../interfaces/upload.interface';
import type { ValidationRequest } from '../../contracts/validation-request';

const VALIDATION_FILE_TYPES = new Set<ValidationRequest['fileType']>([
    'csv', 'tsv', 'txt', 'xlsx', 'xlsm', 'xls', 'xlsb',
]);

function validationFileType(fileType: string): ValidationRequest['fileType'] {
    const normalized = fileType.toLowerCase() as ValidationRequest['fileType'];
    if (!VALIDATION_FILE_TYPES.has(normalized)) {
        throw new Error(`Unsupported validation file type: ${fileType}`);
    }
    return normalized;
}

export function buildValidationRequest(upload: IUpload, definitionVersionId: string): ValidationRequest {
    return {
        schemaVersion: 1,
        uploadId: upload.Id,
        definitionVersionId,
        blob: {
            container: upload.BlobContainer,
            name: upload.BlobName,
        },
        fileType: validationFileType(upload.FileType),
        requestedAt: new Date().toISOString(),
        correlationId: uuidv4(),
    };
}
