// =============================================================================
// Upload Service - Starting validation for an upload
// =============================================================================

import { Upload } from '../../models/Upload.model';
import { UploadSheet } from '../../models/UploadSheet.model';
import { ValidationResult } from '../../models/ValidationResult.model';
import { ValidationRuleDetail } from '../../models/ValidationRuleDetail.model';
import { DeliveryRecord } from '../../models/DeliveryRecord.model';
import { FileDefinition } from '../../models/FileDefinition.model';
import { serviceBusService } from '../ServiceBus.service';
import { cacheService } from '../MemoryCache.service';
import { logger } from '../../utils/logger';
import { DEFINITION_SCHEMA_RULE_TYPE, schemaCheckName } from '../validation/DefinitionContract';
import { DefinitionVersionService } from '../DefinitionVersion.service';
import { buildValidationRequest } from './validationRequest';

/**
 * Start validation process for an upload
 */
export async function startValidation(uploadId: string): Promise<void> {
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

    // Columns and rules come from the version the upload is pinned to (retries included).
    const contract = await DefinitionVersionService.loadValidationContract(upload);
    if (!upload.FileDefinitionVersionId) {
        // Uploads from before versioning are pinned on their first (re)validation.
        await Upload.update(uploadId, { FileDefinitionVersionId: contract.version.Id });
    }
    const versionLabel = `v${contract.version.VersionNumber}`;
    logger.info(`[SERVICE-STARTVAL] UploadId: ${uploadId}, DefinitionId: ${upload.FileDefinitionId}, Version: ${versionLabel}, Bytes: ${upload.FileSize}, Rows: ${upload.RowCountNo}`);

    const rules = contract.contract.rules;
    // One columns check per table: the single table, or each sheet table of a workbook definition.
    const schemaTables = contract.contract.tables.filter(table => table.columns.length > 0);
    const totalChecks = rules.length + schemaTables.length;

    // Create validation result
    const validationResult = await ValidationResult.create({
        UploadId: uploadId,
        TotalRules: totalChecks
    });

    // The file definition's columns are always enforced first.
    for (const [index, table] of schemaTables.entries()) {
        await ValidationRuleDetail.create({
            ValidationResultId: validationResult.Id,
            UploadId: uploadId,
            RuleId: null,
            RuleName: schemaCheckName(table.sheet),
            RuleType: DEFINITION_SCHEMA_RULE_TYPE,
            RuleSeverity: 'Error',
            ExecutionOrder: index - schemaTables.length
        });
    }

    // Create validation rule details for each rule
    for (const rule of rules) {
        await ValidationRuleDetail.create({
            ValidationResultId: validationResult.Id,
            UploadId: uploadId,
            RuleId: rule.id,
            RuleName: (rule.table ? `${rule.name} (${rule.table})` : rule.name).slice(0, 255),
            RuleType: rule.type,
            RuleSeverity: rule.severity,
            ExecutionOrder: rule.executionOrder
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

    const request = buildValidationRequest(upload, contract.version.Id);
    await Upload.update(uploadId, {
        Status: 'VALIDATION_QUEUED',
        ValidationStartedAt: new Date(),
    });
    try {
        await Upload.update(uploadId, { Status: 'VALIDATION_IN_PROGRESS' });
        await ValidationResult.markStarted(validationResult.Id);
        await cacheService.cacheUploadProgress(uploadId, {
            uploadId,
            status: 'VALIDATION_IN_PROGRESS',
            validation: {
                percent: 0,
                currentRule: '',
                passedRules: 0,
                totalRules: totalChecks,
                status: 'IN_PROGRESS'
            },
            delivery: null
        });
        await serviceBusService.sendValidationRequest(request);
    } catch (error) {
        await Upload.update(uploadId, {
            Status: 'VALIDATION_FAILED',
            ErrorMessage: 'Validation could not be queued. Retry the upload validation.',
            ValidationCompletedAt: new Date(),
        });
        await cacheService.invalidateUploadProgress(uploadId);
        throw error;
    }

    logger.info(`Validation request sent for upload ${uploadId}; checks=${totalChecks}`);
}
