// =============================================================================
// Validation Worker Service - Processes validation jobs from the queue
// =============================================================================

import { Job } from 'bullmq';
import path from 'path';
import { unlinkSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { appConfig } from '../config/appConfig';
import { azureStorage } from './AzureStorage.service';
import { sharePointStorage } from './SharePointStorage.service';
import { desktopStorage } from './DesktopStorage.service';
import { emitUploadEvent } from '../websocket/socketServer';
import { Upload } from '../models/Upload.model';
import { UploadSheet } from '../models/UploadSheet.model';
import { ValidationResult } from '../models/ValidationResult.model';
import { ValidationRuleDetail } from '../models/ValidationRuleDetail.model';
import { Rule } from '../models/Rule.model';
import { FileDefinition } from '../models/FileDefinition.model';
import { logger } from '../utils/logger';
import type { IValidationJobData } from '../interfaces/upload.interface';
import type { IRule as IRuleType } from '../interfaces/rule.interface';
import {
    DEFINITION_SCHEMA_RULE_TYPE,
    SUPPORTED_RULE_TYPES,
    createDefinitionSchemaEvaluator,
    createRuleEvaluator,
    type DefinitionColumn,
    type RowEvaluator,
} from './validation/ValidationEngine';
import { readRecords } from './validation/FileRecordReader';
import { createValidationWorker } from './Queue.service';

// =============================================================================
// Storage Resolver
// =============================================================================
/**
 * Get storage service with dynamic detection based on upload source (FIX)
 */
type StorageService = {
    downloadFile: (blobName: string, localFilePath: string) => Promise<void>;
    blobExists: (blobName: string) => Promise<boolean>;
};

const getStorageService = (upload: any): StorageService => {
    const tempLocalPath = upload.TempLocalPath;
    
    if (tempLocalPath && existsSync(tempLocalPath)) {
        logger.info(`[STORAGE] Using TempLocalPath: ${tempLocalPath}`);
        return {
            downloadFile: async (_blobName: string, localFilePath: string) => {
                copyFileSync(tempLocalPath, localFilePath);
                logger.info(`[STORAGE-TEMP] Copied ${tempLocalPath} → ${localFilePath}`);
            },
            blobExists: async () => true
        } as StorageService;
    }
    
    switch (appConfig.storage.provider) {
        case 'desktop':
            if (desktopStorage) return desktopStorage;
            break;
        case 'sharepoint':
            if (sharePointStorage) return sharePointStorage;
            break;
        case 'azure':
            if (azureStorage && appConfig.azure.storage.connectionString) return azureStorage;
            break;
        default:
            throw new Error(`Unsupported STORAGE_PROVIDER: ${appConfig.storage.provider}`);
    }
    throw new Error(`STORAGE_PROVIDER ${appConfig.storage.provider} is not configured`);
};

// =============================================================================
// RULE EVALUATION
// =============================================================================

interface ActiveCheck {
    detailId: string;
    name: string;
    severity: string;
    evaluator: RowEvaluator;
    elapsedNs: bigint;
}

const parseDefinitionColumns = (columns: unknown): DefinitionColumn[] => {
    if (Array.isArray(columns)) return columns as DefinitionColumn[];
    if (typeof columns === 'string' && columns.trim()) {
        try {
            const parsed = JSON.parse(columns);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
};

const timed = (check: ActiveCheck, fn: () => void): void => {
    const start = process.hrtime.bigint();
    try {
        fn();
    } finally {
        check.elapsedNs += process.hrtime.bigint() - start;
    }
};

// =============================================================================
// MAIN WORKER
// =============================================================================
export async function processValidationJob(job: Job<IValidationJobData>): Promise<void> {
    const { uploadId, fileDefinitionId } = job.data;

    let tempFilePath: string | null = null;
    let upload: any = null;

    try {
        upload = await Upload.findById(uploadId);
        if (!upload) throw new Error('Upload not found');
        await Upload.update(uploadId, { ValidationStartedAt: new Date() });

        const tempLocalPath = upload.TempLocalPath;
        if (tempLocalPath && existsSync(tempLocalPath)) {
            tempFilePath = tempLocalPath;
        } else {
            const storageService = getStorageService(upload);
            const tempDir = appConfig.upload.tempDirectory;
            if (!existsSync(tempDir)) {
                mkdirSync(tempDir, { recursive: true });
            }
            tempFilePath = path.join(tempDir, `${uploadId}_${path.basename(upload.StoredFilename || 'upload')}`);
            await storageService.downloadFile(upload.StoredFilename, tempFilePath);
        }

        const validationResult = await ValidationResult.findByUploadId(uploadId);
        if (!validationResult) {
            throw new Error(`Validation result not found for upload ${uploadId}`);
        }

        const fileDefinition = await FileDefinition.findById(fileDefinitionId);
        const rules: IRuleType[] = await Rule.findEnabledByFileDefinitionId(fileDefinitionId);
        const ruleDetails = await ValidationRuleDetail.findByUploadId(uploadId);

        // Build one evaluator per rule detail; the file is then read once for all of them.
        const checks: ActiveCheck[] = [];
        for (const ruleDetail of ruleDetails) {
            let evaluator: RowEvaluator | null = null;

            if (ruleDetail.RuleType === DEFINITION_SCHEMA_RULE_TYPE) {
                evaluator = createDefinitionSchemaEvaluator(parseDefinitionColumns(fileDefinition?.Columns));
            } else {
                const rule = rules.find(r => String(r.Id).toLowerCase() === String(ruleDetail.RuleId).toLowerCase());
                if (!rule) {
                    logger.warn(`[VAL-WORKER] Rule ${ruleDetail.RuleId} is no longer enabled; skipping for upload ${uploadId}`);
                } else if (!(SUPPORTED_RULE_TYPES as readonly string[]).includes(rule.RuleType)) {
                    logger.warn(`[VAL-WORKER] Rule "${rule.Name}" has unsupported type "${rule.RuleType}"; skipping`);
                } else {
                    evaluator = createRuleEvaluator(rule.RuleType, rule.SqlQuery);
                }
            }

            if (!evaluator) {
                await ValidationRuleDetail.markSkipped(ruleDetail.Id, 0);
                continue;
            }

            await ValidationRuleDetail.markStarted(ruleDetail.Id);
            checks.push({
                detailId: ruleDetail.Id,
                name: ruleDetail.RuleName,
                severity: ruleDetail.RuleSeverity,
                evaluator,
                elapsedNs: BigInt(0),
            });
        }

        logger.info(`[VAL-WORKER] Validating upload ${uploadId} with ${checks.length} check(s)`);

        let lastEmit = 0;
        const sourcePath = tempFilePath as string;
        const summary = await readRecords(sourcePath, upload.FileType, {
            onHeaders: (headers, sheet) => {
                for (const check of checks) timed(check, () => check.evaluator.onHeaders(headers, sheet));
            },
            onRow: (row, rowNumber, sheet) => {
                for (const check of checks) timed(check, () => check.evaluator.onRow(row, rowNumber, sheet));
            },
            onProgress: (percent) => {
                const now = Date.now();
                if (now - lastEmit < 1000) return;
                lastEmit = now;
                void emitUploadEvent(uploadId, {
                    uploadId,
                    type: 'VALIDATION_UPDATE',
                    progress: percent,
                    details: { currentRule: 'Reading file', progress: percent }
                });
            },
        });

        await Upload.update(uploadId, { RowCountNo: summary.rowCount });

        if (summary.sheets.length > 0) {
            await UploadSheet.deleteByUploadId(uploadId);
            for (let i = 0; i < summary.sheets.length; i++) {
                await UploadSheet.create({
                    UploadId: uploadId,
                    SheetIndex: i,
                    SheetName: summary.sheets[i].name,
                    RowCountNo: summary.sheets[i].rowCount
                });
            }
        } else {
            const sheets = await UploadSheet.findByUploadId(uploadId);
            if (sheets.length > 0) {
                await UploadSheet.update(sheets[0].Id, { RowCountNo: summary.rowCount });
            }
        }

        let passedRules = 0;
        let failedRules = 0;
        let warningRules = 0;

        for (const check of checks) {
            const result = check.evaluator.result();
            const executionTime = Number(check.elapsedNs / BigInt(1_000_000));

            if (result.passed) {
                await ValidationRuleDetail.markPassed(check.detailId, executionTime);
                passedRules++;
            } else if (check.severity === 'Warning') {
                await ValidationRuleDetail.markWarning(check.detailId, executionTime, result.errorCount, result.errors);
                warningRules++;
            } else {
                await ValidationRuleDetail.markFailed(check.detailId, executionTime, result.errorCount, result.errors);
                failedRules++;
            }

            logger.info(`[VAL-WORKER] Upload ${uploadId}, check "${check.name}": ${result.passed ? 'passed' : `${result.errorCount} issue(s)`}`);
        }

        const finalStatus = failedRules > 0 ? 'FAILED' : (warningRules > 0 ? 'WARNING' : 'PASSED');
        const errorSummary = failedRules > 0
            ? `${failedRules} rule(s) failed validation`
            : warningRules > 0
                ? `${warningRules} rule(s) had warnings`
                : null;

        logger.info(`[VAL-WORKER] Upload ${uploadId} validated: ${finalStatus}, rows=${summary.rowCount}, passed=${passedRules}, failed=${failedRules}, warnings=${warningRules}`);

        await ValidationResult.updateProgress(
            validationResult.Id,
            passedRules,
            failedRules,
            warningRules,
            'Completed',
            ruleDetails.length
        );
        await ValidationResult.markCompleted(validationResult.Id, finalStatus, errorSummary || undefined);

        const uploadStatus = failedRules > 0 ? 'VALIDATION_FAILED' : 'VALIDATION_PASSED';
        await Upload.update(uploadId, {
            Status: uploadStatus,
            ValidationCompletedAt: new Date()
        });

        const sheets = await UploadSheet.findByUploadId(uploadId);
        for (const sheet of sheets) {
            await UploadSheet.update(sheet.Id, {
                Status: failedRules > 0 ? 'FAILED' : 'VALIDATED',
                ValidationProgress: 100
            });
        }

        void emitUploadEvent(uploadId, {
            uploadId,
            type: failedRules > 0 ? 'VALIDATION_FAILED' : 'VALIDATION_PASSED',
            details: {
                status: finalStatus,
                passedRules,
                failedRules,
                warningRules
            }
        });
        void emitUploadEvent(uploadId, {
            uploadId,
            type: 'VALIDATION_COMPLETE',
            progress: 100
        });

        if (failedRules === 0) {
            const { UploadService } = await import('./Upload.service');
            await UploadService.startDelivery(uploadId);
        }
    } catch (error: any) {
        logger.error(`[VAL-WORKER] Validation failed for upload ${uploadId}:`, error);

        await Upload.update(uploadId, {
            Status: 'VALIDATION_FAILED',
            ErrorMessage: error?.message ? String(error.message).slice(0, 4000) : 'Validation failed',
            ValidationCompletedAt: new Date()
        }).catch(updateError => logger.error('[VAL-WORKER] Could not record validation failure', updateError));

        void emitUploadEvent(uploadId, {
            uploadId,
            type: 'VALIDATION_FAILED',
            details: { error: error?.message }
        });

        throw error;
    } finally {
        if (tempFilePath && upload?.TempLocalPath !== tempFilePath && existsSync(tempFilePath)) {
            unlinkSync(tempFilePath);
        }
    }
}

// =============================================================================
// INIT
// =============================================================================
export function initializeValidationWorker() {
    return createValidationWorker(processValidationJob);
}
