// =============================================================================
// Upload Service - Complete Upload Management with Queue Integration
// =============================================================================

import { v4 as uuidv4 } from 'uuid';
import { getConnection } from '../config/database';
import { Upload } from '../models/Upload.model';
import { UploadSheet } from '../models/UploadSheet.model';
import { ValidationResult } from '../models/ValidationResult.model';
import { ValidationRuleDetail } from '../models/ValidationRuleDetail.model';
import { DeliveryRecord } from '../models/DeliveryRecord.model';
import { FileDefinition } from '../models/FileDefinition.model';
import { Rule } from '../models/Rule.model';
import { addValidationJob, addDeliveryJob, QUEUE_NAMES } from './Queue.service';
import { azureStorage } from './AzureStorage.service';
import { appConfig } from '../config/appConfig';
import { sharePointStorage } from './SharePointStorage.service';
import { cacheService } from './Cache.service';
import { logger } from '../utils/logger';
import { emitUploadEvent } from '../websocket/socketServer';
import { DEFINITION_SCHEMA_RULE_TYPE } from './validation/ValidationEngine';
import { getDeliveryTargets, resolveDeliveryDestination } from './DeliveryTargets.service';
import type { 
    IUpload, 
    IUploadSheet,
    IValidationResult,
    IValidationRuleDetail,
    IDeliveryRecord,
    ICreateUploadDto,
    IValidationJobData,
    IDeliveryJobData,
    UploadStatus,
    IUploadDetailResponse
} from '../interfaces/upload.interface';

export class UploadService {
    /**
     * Create a new upload record and queue validation
     */
    static async createUpload(
        dto: ICreateUploadDto,
        userId: string
    ): Promise<IUpload> {
        const upload = await Upload.create(dto, userId);
        
        logger.info(`[SERVICE-CREATE] UploadId: ${upload.Id}, FileDef: ${dto.FileDefinitionId}, User: ${userId}, Filename: ${dto.OriginalFilename}`);
        
        // Invalidate cache
        await cacheService.invalidateUploadProgress(upload.Id);
        
        logger.info(`Upload created: ${upload.Id} by user ${userId}`);
        return upload;
    }

    /**
     * Start validation process for an upload
     */
    static async startValidation(uploadId: string): Promise<void> {
        const upload = await Upload.findById(uploadId);
        if (!upload) {
            throw new Error('Upload not found');
        }

        // A retry starts from a clean slate: remove results and delivery records from earlier attempts.
        await DeliveryRecord.deleteByUploadId(uploadId);
        await ValidationRuleDetail.deleteByUploadId(uploadId);
        await ValidationResult.deleteByUploadId(uploadId);
        await Upload.update(uploadId, { ErrorMessage: null, ValidationCompletedAt: null, DeliveryCompletedAt: null });

        // Update status to VALIDATION_QUEUED
        await Upload.updateStatus(uploadId, 'VALIDATION_QUEUED');

        // Get file definition with rules
        const fileDefinition = await FileDefinition.findById(upload.FileDefinitionId);
        if (!fileDefinition) {
            logger.error(`[SERVICE-STARTVAL] UploadId: ${uploadId}, FileDef not found: ${upload.FileDefinitionId}`);
            throw new Error('File definition not found');
        }

        logger.info(`[SERVICE-STARTVAL] UploadId: ${uploadId}, FileDef: ${fileDefinition.Name || fileDefinition.Id} (${upload.FileDefinitionId}), Size: ${upload.FileSize}B, RowCount: ${upload.RowCountNo}`);

        // Get enabled rules for this definition
        const rules = await Rule.findEnabledByFileDefinitionId(upload.FileDefinitionId);
        const definitionColumns = Array.isArray(fileDefinition.Columns) ? fileDefinition.Columns : [];
        const checkDefinitionSchema = definitionColumns.length > 0;
        const totalChecks = rules.length + (checkDefinitionSchema ? 1 : 0);
        
        // Create validation result
        const validationResult = await ValidationResult.create({
            UploadId: uploadId,
            TotalRules: totalChecks
        });

        // The file definition's columns are always enforced as the first check.
        if (checkDefinitionSchema) {
            await ValidationRuleDetail.create({
                ValidationResultId: validationResult.Id,
                UploadId: uploadId,
                RuleId: null,
                RuleName: 'File definition columns',
                RuleType: DEFINITION_SCHEMA_RULE_TYPE,
                RuleSeverity: 'Error',
                ExecutionOrder: -1
            });
        }

        // Create validation rule details for each rule
        for (const rule of rules) {
            await ValidationRuleDetail.create({
                ValidationResultId: validationResult.Id,
                UploadId: uploadId,
                RuleId: rule.Id,
                RuleName: rule.Name,
                RuleType: rule.RuleType,
                RuleSeverity: rule.Severity,
                ExecutionOrder: rule.ExecutionOrder
            });
        }

        // Create upload sheets if it's an Excel file
        if (upload.SheetCount && upload.SheetCount > 0) {
            const sheets = await UploadSheet.findByUploadId(uploadId);
            for (const sheet of sheets) {
                await UploadSheet.update(sheet.Id, {
                    TotalRules: totalChecks,
                    Status: 'PENDING'
                });
            }
        }

        // Queue validation job
        const jobData: IValidationJobData = {
            uploadId: upload.Id,
            fileDefinitionId: upload.FileDefinitionId,
            fileUrl: upload.AzureBlobUrl || upload.CompressedBlobUrl || '',
            userId: upload.UploadedBy
        };

        const job = await addValidationJob(jobData);

        logger.info(`[SERVICE-QUEUEVAL] UploadId: ${uploadId}, ValidationJobId: ${job.id}, Rules: ${rules.length}`);
        
        // Update upload with validation job ID
        await Upload.update(uploadId, {
            ValidationJobId: job.id
        });

        // Update status to VALIDATION_IN_PROGRESS
        await Upload.updateStatus(uploadId, 'VALIDATION_IN_PROGRESS');

        // Update validation result started
        await ValidationResult.markStarted(validationResult.Id);

        await cacheService.cacheUploadProgress(uploadId, {
            uploadId,
            status: 'VALIDATION_IN_PROGRESS',
            validation: {
                percent: 0,
                currentRule: '',
                passedRules: 0,
                totalRules: rules.length,
                status: 'IN_PROGRESS'
            },
            delivery: null
        });

        logger.info(`Validation started for upload: ${uploadId}, job: ${job.id}`);
    }

    /**
     * Update validation progress
     */
    static async updateValidationProgress(
        uploadId: string,
        ruleId: string,
        status: 'PASSED' | 'FAILED' | 'WARNING',
        executionTimeMs: number,
        errorCount: number = 0,
        errors: any[] = []
    ): Promise<void> {
        // Get validation result
        const validationResult = await ValidationResult.findByUploadId(uploadId);
        if (!validationResult) {
            logger.error(`Validation result not found for upload: ${uploadId}`);
            return;
        }

        // Update rule detail
        const ruleDetails = await ValidationRuleDetail.findByUploadId(uploadId);
        const ruleDetail = ruleDetails.find(r => r.RuleId === ruleId);
        
        if (ruleDetail) {
            if (status === 'PASSED') {
                await ValidationRuleDetail.markPassed(ruleDetail.Id, executionTimeMs);
            } else if (status === 'FAILED') {
                await ValidationRuleDetail.markFailed(ruleDetail.Id, executionTimeMs, errorCount, errors);
            } else if (status === 'WARNING') {
                await ValidationRuleDetail.markWarning(ruleDetail.Id, executionTimeMs, errorCount, errors);
            }
        }

        // Update validation result progress
        const updatedDetails = await ValidationRuleDetail.findByUploadId(uploadId);
        const passedRules = updatedDetails.filter(r => r.Status === 'PASSED').length;
        const failedRules = updatedDetails.filter(r => r.Status === 'FAILED').length;
        const warningRules = updatedDetails.filter(r => r.Status === 'WARNING').length;

        const currentRule = ruleDetail?.RuleName || '';
        await ValidationResult.updateProgress(
            validationResult.Id,
            passedRules,
            failedRules,
            warningRules,
            currentRule,
            validationResult.TotalRules
        );

        // Update sheet progress if applicable
        const sheets = await UploadSheet.findByUploadId(uploadId);
        if (sheets.length > 0) {
            const validatedRules = passedRules + failedRules + warningRules;
            await UploadSheet.updateValidationProgress(
                sheets[0].Id,
                validatedRules,
                validationResult.TotalRules
            );
        }

        // Cache progress for real-time updates
        await cacheService.cacheUploadProgress(uploadId, {
            uploadId,
            status: 'VALIDATION_IN_PROGRESS',
            validation: {
                percent: validationResult.TotalRules > 0
                    ? Math.round(((passedRules + failedRules + warningRules) / validationResult.TotalRules) * 100)
                    : 100,
                currentRule,
                passedRules,
                failedRules,
                warningRules,
                totalRules: validationResult.TotalRules,
                status: 'IN_PROGRESS'
            },
            delivery: null
        });

        void emitUploadEvent(uploadId, {
            type: 'VALIDATION_UPDATE'
        });
    }

    /**
     * Get validation status from rule results (helper)
     */
    static async getValidationStatusFromRules(uploadId: string): Promise<'PASSED' | 'FAILED' | 'WARNING'> {
        const ruleDetails = await ValidationRuleDetail.findByUploadId(uploadId);
        const failedRules = ruleDetails.filter(r => r.Status === 'FAILED').length;
        const warningRules = ruleDetails.filter(r => r.Status === 'WARNING').length;
        
        if (failedRules > 0) return 'FAILED';
        if (warningRules > 0) return 'WARNING';
        return 'PASSED';
    }



    
    /**
     * Start delivery process. Definitions without a delivery target finish as VALIDATED.
     */
    static async startDelivery(uploadId: string): Promise<void> {
        const upload = await Upload.findById(uploadId);
        if (!upload) {
            throw new Error('Upload not found');
        }

        const fileDefinition = await FileDefinition.findById(upload.FileDefinitionId);
        if (!fileDefinition) {
            throw new Error('File definition not found');
        }

        const deliveryTargets = getDeliveryTargets(fileDefinition);
        if (deliveryTargets.length === 0) {
            await this.completeWithoutDelivery(uploadId);
            return;
        }

        await Upload.updateStatus(uploadId, 'DELIVERY_QUEUED');

        // One delivery per target: the whole validated file is delivered once, regardless of sheet count.
        const deliveryJobs: IDeliveryJobData[] = [];
        for (const target of deliveryTargets) {
            const destinationPath = resolveDeliveryDestination(target.folder, upload.Id, upload.OriginalFilename);
            await DeliveryRecord.create({
                UploadId: uploadId,
                DeliveryType: target.type,
                DestinationPath: destinationPath,
                DestinationName: target.name
            });
            deliveryJobs.push({
                uploadId: upload.Id,
                deliveryType: target.type,
                destinationPath,
                azureBlobUrl: upload.CompressedBlobUrl || upload.AzureBlobUrl || '',
                userId: upload.UploadedBy
            });
        }

        for (const jobData of deliveryJobs) {
            await addDeliveryJob(jobData);
        }

        await Upload.update(uploadId, { Status: 'DELIVERY_IN_PROGRESS', DeliveryStartedAt: new Date() });

        const uploadSheets = await UploadSheet.findByUploadId(uploadId);
        for (const sheet of uploadSheets) {
            await UploadSheet.update(sheet.Id, { Status: 'DELIVERING' });
        }

        await cacheService.cacheUploadProgress(uploadId, {
            uploadId,
            status: 'DELIVERY_IN_PROGRESS',
            validation: null,
            delivery: {
                percent: 0,
                recordsDelivered: 0,
                totalRecords: deliveryJobs.length,
                status: 'IN_PROGRESS'
            }
        });

        void emitUploadEvent(uploadId, { uploadId, type: 'DELIVERY_UPDATE' });
        logger.info(`Delivery started for upload: ${uploadId}, targets: ${deliveryTargets.length}`);
    }

    /**
     * Finish an upload that passed validation and has no delivery target configured.
     */
    static async completeWithoutDelivery(uploadId: string): Promise<void> {
        await Upload.update(uploadId, { Status: 'VALIDATED' });

        const sheets = await UploadSheet.findByUploadId(uploadId);
        for (const sheet of sheets) {
            await UploadSheet.update(sheet.Id, { Status: 'VALIDATED' });
        }

        await cacheService.invalidateUploadProgress(uploadId);
        void emitUploadEvent(uploadId, { uploadId, type: 'VALIDATED' });
        logger.info(`Upload ${uploadId} validated; no delivery target configured`);
    }

    /**
     * Update delivery progress
     */
    static async updateDeliveryProgress(
    deliveryRecordId: string,
    percent: number,
    recordsDelivered?: number
    ): Promise<void> {

        await DeliveryRecord.updateProgress(deliveryRecordId, percent, recordsDelivered);

        // 🔥 NEW: Emit WebSocket update
        const record = await DeliveryRecord.findById(deliveryRecordId);

        if (record) {
            void emitUploadEvent(record.UploadId, {
                uploadId: record.UploadId,
                type: 'DELIVERY_UPDATE'
            });
        }

        await cacheService.invalidateUploadProgress(record?.UploadId || '');
        if (record) {
            await this.getUploadProgress(record.UploadId);
        }
    }

    /**
     * Complete delivery
     */
    static async completeDelivery(uploadId: string): Promise<void> {
        const deliveryRecords = await DeliveryRecord.findByUploadId(uploadId);
        
        // Check if all deliveries are complete
        const allDelivered = deliveryRecords.every(r => r.Status === 'DELIVERED');
        
        if (allDelivered) {
            // Update upload status to DELIVERED
            const destinations = deliveryRecords.map(r => r.DestinationPath).join(', ');
            await Upload.update(uploadId, {
                Status: 'DELIVERED',
                DeliveredTo: destinations,
                DeliveredAt: new Date(),
                DeliveryCompletedAt: new Date()
            });

            // Update sheet status
            const sheets = await UploadSheet.findByUploadId(uploadId);
            for (const sheet of sheets) {
                await UploadSheet.update(sheet.Id, {
                    Status: 'DELIVERED',
                    DeliveredAt: new Date()
                });
            }

            // Invalidate progress cache
            await cacheService.invalidateUploadProgress(uploadId);
            void emitUploadEvent(uploadId, { type: 'DELIVERED', progress: 100 });

            logger.info(`Delivery completed for upload: ${uploadId}`);
        }
    }

    /**
     * Mark delivery as failed
     */
    static async failDelivery(uploadId: string, errorMessage: string): Promise<void> {
        const deliveryRecords = await DeliveryRecord.findByUploadId(uploadId);
        
        // Mark all pending/in-progress deliveries as failed
        for (const record of deliveryRecords) {
            if (record.Status === 'PENDING' || record.Status === 'IN_PROGRESS') {
                await DeliveryRecord.markFailed(record.Id, errorMessage);
            }
        }

        // Update upload status
        await Upload.update(uploadId, {
            Status: 'DELIVERY_FAILED',
            ErrorMessage: errorMessage,
            DeliveryCompletedAt: new Date()
        });

        // Update sheet status
        const sheets = await UploadSheet.findByUploadId(uploadId);
        for (const sheet of sheets) {
            await UploadSheet.update(sheet.Id, { Status: 'FAILED', ErrorMessage: errorMessage });
        }

        // Invalidate progress cache
        await cacheService.invalidateUploadProgress(uploadId);
        void emitUploadEvent(uploadId, { type: 'DELIVERY_FAILED', details: { error: errorMessage } });

        logger.error(`Delivery failed for upload: ${uploadId}, error: ${errorMessage}`);
    }

    /**
     * Get upload with full details
     */
    static async getUploadDetails(uploadId: string): Promise<IUploadDetailResponse> {
        const upload = await Upload.findById(uploadId);
        if (!upload) {
            return { success: false, upload: null as any, sheets: [], validationResult: null, ruleDetails: [], deliveryRecords: [] };
        }

        const sheets = await UploadSheet.findByUploadId(uploadId);
        const validationResult = await ValidationResult.findByUploadId(uploadId);
        const ruleDetails = await ValidationRuleDetail.findByUploadId(uploadId);
        const deliveryRecords = await DeliveryRecord.findByUploadId(uploadId);

        return {
            success: true,
            upload,
            sheets,
            validationResult,
            ruleDetails,
            deliveryRecords
        };
    }

    /**
     * Get upload progress
     */
    static async getUploadProgress(uploadId: string): Promise<any> {
        // Try cache first
        const cached = await cacheService.getUploadProgress(uploadId);
        if (cached) {
            return cached;
        }

        const upload = await Upload.findById(uploadId);
        if (!upload) {
            return null;
        }

        const validationResult = await ValidationResult.findByUploadId(uploadId);
        const deliveryRecords = await DeliveryRecord.findByUploadId(uploadId);

        const validationProgress = validationResult ? {
            percent: validationResult.ProgressPercent,
            currentRule: validationResult.CurrentRule,
            passedRules: validationResult.PassedRules,
            totalRules: validationResult.TotalRules,
            status: validationResult.Status
        } : null;

        const deliveryProgress = deliveryRecords.length > 0 ? {
            percent: Math.round(deliveryRecords.reduce((sum, r) => sum + (r.ProgressPercent || 0), 0) / deliveryRecords.length),
            recordsDelivered: deliveryRecords.reduce((sum, r) => sum + (r.RecordsDelivered || 0), 0),
            totalRecords: deliveryRecords.length,
            status: deliveryRecords.every(r => r.Status === 'DELIVERED') ? 'DELIVERED' : 
                    deliveryRecords.some(r => r.Status === 'FAILED') ? 'FAILED' : 'IN_PROGRESS'
        } : null;

        const progress = {
            uploadId,
            status: upload.Status,
            validation: validationProgress,
            delivery: deliveryProgress
        };

        // Cache for 1 minute
        await cacheService.cacheUploadProgress(uploadId, progress);

        return progress;
    }

    /**
     * Get uploads accessible to a user
     */
    static async getUploadsForUser(
        userId: string,
        options: { page?: number; pageSize?: number; status?: string } = {}
    ): Promise<{ uploads: IUpload[]; total: number }> {
        const { page = 1, pageSize = 20, status } = options;

        return await Upload.findForUser(userId, { page, pageSize, status });
    }

    /**
     * Handle upload failure
     */
    static async handleUploadFailure(uploadId: string, errorMessage: string): Promise<void> {
        await Upload.update(uploadId, {
            Status: 'DELIVERY_FAILED',
            ErrorMessage: errorMessage
        });

        // Invalidate cache
        await cacheService.invalidateUploadProgress(uploadId);

        logger.error(`Upload failed: ${uploadId}, error: ${errorMessage}`);
    }

    /**
     * Handle timeout failure for stuck jobs
     * Updates the upload status when a job times out
     */
    static async handleTimeoutFailure(uploadId: string, jobType: 'VALIDATION' | 'DELIVERY', stuckDurationMs: number): Promise<void> {
        const timeoutSeconds = Math.round(stuckDurationMs / 1000);
        const errorMessage = `Job timed out after ${timeoutSeconds} seconds - process was stuck`;
        
        // Get current upload to determine what status to set
        const upload = await Upload.findById(uploadId);
        if (!upload) {
            logger.error(`Cannot handle timeout: Upload not found: ${uploadId}`);
            return;
        }

        // Determine the appropriate failure status based on current status
        let newStatus: 'VALIDATION_FAILED' | 'DELIVERY_FAILED';
        
        if (upload.Status === 'VALIDATION_IN_PROGRESS' || upload.Status === 'VALIDATION_QUEUED') {
            newStatus = 'VALIDATION_FAILED';
        } else if (upload.Status === 'DELIVERY_IN_PROGRESS' || upload.Status === 'DELIVERY_QUEUED') {
            newStatus = 'DELIVERY_FAILED';
        } else {
            // Default to DELIVERY_FAILED if in unknown state
            newStatus = 'DELIVERY_FAILED';
        }

        // Update the upload status
        await Upload.update(uploadId, {
            Status: newStatus,
            ErrorMessage: errorMessage,
            ValidationCompletedAt: newStatus === 'VALIDATION_FAILED' ? new Date() : upload.ValidationCompletedAt,
            DeliveryCompletedAt: newStatus === 'DELIVERY_FAILED' ? new Date() : upload.DeliveryCompletedAt
        });

        // Update sheet statuses
        const sheets = await UploadSheet.findByUploadId(uploadId);
        for (const sheet of sheets) {
            await UploadSheet.update(sheet.Id, {
                Status: 'FAILED',
                ErrorMessage: errorMessage
            });
        }

        // Invalidate cache
        await cacheService.invalidateUploadProgress(uploadId);

        logger.error(`Upload timeout handled: ${uploadId}, job type: ${jobType}, duration: ${timeoutSeconds}s`);
    }
}

