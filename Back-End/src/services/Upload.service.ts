// =============================================================================
// Upload Service - Upload lifecycle and Service Bus integration.
// Facade over the focused modules in ./upload; callers and mocks keep using UploadService.
// =============================================================================

import { createUpload } from './upload/uploadCreation';
import { startValidation } from './upload/validationStart';
import { handleValidationEvent } from './upload/validationEvents';
import {
    startDelivery,
    completeWithoutDelivery,
    updateDeliveryProgress,
    completeDelivery,
    failDelivery,
} from './upload/delivery';
import { getUploadDetails, getUploadProgress, getUploadsForUser } from './upload/readModels';

export class UploadService {
    static createUpload = createUpload;
    static startValidation = startValidation;
    static handleValidationEvent = handleValidationEvent;
    static startDelivery = startDelivery;
    static completeWithoutDelivery = completeWithoutDelivery;
    static updateDeliveryProgress = updateDeliveryProgress;
    static completeDelivery = completeDelivery;
    static failDelivery = failDelivery;
    static getUploadDetails = getUploadDetails;
    static getUploadProgress = getUploadProgress;
    static getUploadsForUser = getUploadsForUser;
}
