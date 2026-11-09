// =============================================================================
// Upload Service - Read models: upload details, progress and per-user listings
// =============================================================================

import { Upload } from '../../models/Upload.model';
import { UploadSheet } from '../../models/UploadSheet.model';
import { ValidationResult } from '../../models/ValidationResult.model';
import { ValidationRuleDetail } from '../../models/ValidationRuleDetail.model';
import { DeliveryRecord } from '../../models/DeliveryRecord.model';
import { FileDefinition } from '../../models/FileDefinition.model';
import { cacheService } from '../MemoryCache.service';
import { DEFINITION_SCHEMA_RULE_TYPE, schemaCheckName } from '../validation/DefinitionContract';
import { DefinitionVersionService, toVersionSummary } from '../DefinitionVersion.service';
import type {
    IUpload,
    IValidationRuleDetail,
    IUploadDetailResponse
} from '../../interfaces/upload.interface';
import type { IFileDefinitionVersion } from '../../interfaces/fileDefinition.interface';

/**
 * Attach the sheet each check applies to, from the version the upload was validated against:
 * columns checks map to their table, rules to their Table. Null means the check covers every sheet (or the CSV).
 */
const withRuleSheets = (ruleDetails: IValidationRuleDetail[], version: IFileDefinitionVersion | null): IValidationRuleDetail[] => {
    if (!version) return ruleDetails.map(detail => ({ ...detail, Sheet: null }));

    const tables = version.Contract.tables;
    const ruleTables = new Map(version.Contract.rules.map(rule => [rule.id.toLowerCase(), rule.table]));
    return ruleDetails.map(detail => ({
        ...detail,
        Sheet: detail.RuleType === DEFINITION_SCHEMA_RULE_TYPE
            ? tables.find(table => schemaCheckName(table.sheet) === detail.RuleName)?.sheet ?? null
            : ruleTables.get(String(detail.RuleId).toLowerCase()) ?? null,
    }));
};

/**
 * Get upload with full details
 */
export async function getUploadDetails(uploadId: string): Promise<IUploadDetailResponse> {
    const upload = await Upload.findById(uploadId);
    if (!upload) {
        return { success: false, upload: null as any, definitionVersion: null, sheets: [], validationResult: null, ruleDetails: [], deliveryRecords: [] };
    }

    const sheets = await UploadSheet.findByUploadId(uploadId);
    const validationResult = await ValidationResult.findByUploadId(uploadId);
    const ruleDetails = await ValidationRuleDetail.findByUploadId(uploadId);
    const deliveryRecords = await DeliveryRecord.findByUploadId(uploadId);
    const definition = await FileDefinition.findById(upload.FileDefinitionId);
    const version = upload.FileDefinitionVersionId
        ? await DefinitionVersionService.findVersion(upload.FileDefinitionVersionId)
        : null;

    return {
        success: true,
        upload: {
            ...upload,
            DefinitionName: definition?.Name,
            DefinitionVersionNumber: version?.VersionNumber ?? null,
        },
        definitionVersion: toVersionSummary(version),
        sheets,
        validationResult,
        ruleDetails: withRuleSheets(ruleDetails, version),
        deliveryRecords
    };
}

/**
 * Get upload progress
 */
export async function getUploadProgress(uploadId: string): Promise<any> {
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
export async function getUploadsForUser(
    userId: string,
    options: { page?: number; pageSize?: number; status?: string } = {}
): Promise<{ uploads: IUpload[]; total: number }> {
    const { page = 1, pageSize = 20, status } = options;

    return await Upload.findForUser(userId, { page, pageSize, status });
}
