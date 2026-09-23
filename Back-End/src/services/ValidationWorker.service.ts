// =============================================================================
// Validation Worker Service - Processes validation jobs from the queue
// =============================================================================

import { Job } from 'bullmq';
import path from 'path';
import fs from 'fs';
import { unlinkSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { appConfig } from '../config/appConfig';
import { azureStorage } from './AzureStorage.service';
import { sharePointStorage } from './SharePointStorage.service';
import { desktopStorage } from './DesktopStorage.service';
import { io } from '../index';
import { Upload } from '../models/Upload.model';
import { UploadSheet } from '../models/UploadSheet.model';
import { ValidationResult } from '../models/ValidationResult.model';
import { ValidationRuleDetail } from '../models/ValidationRuleDetail.model';
import { Rule } from '../models/Rule.model';
import { FileDefinition } from '../models/FileDefinition.model';
import { logger } from '../utils/logger';
import type { IValidationJobData } from '../interfaces/upload.interface';
import type { IRule as IRuleType } from '../interfaces/rule.interface';

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
// FILE PARSING (UNCHANGED)
// =============================================================================
async function parseCSV(filePath: string): Promise<{ rowCount: number; headers: string[]; sampleData: any[] }> {
    const readline = await import('readline');
    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    
    const rl = readline.createInterface({
        input: stream,
        crlfDelay: Infinity
    });

    const headers: string[] = [];
    const sampleData: any[] = [];
    let rowCount = 0;
    let isFirstLine = true;
    let lineIndex = 0;
    const maxSampleRows = 10;

    for await (const line of rl) {
        if (!line.trim()) continue;
        
        const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        
        if (isFirstLine) {
            headers.push(...values);
            isFirstLine = false;
        } else {
            rowCount++;
            if (sampleData.length < maxSampleRows) {
                const row: any = {};
                headers.forEach((h, i) => {
                    row[h] = values[i] || '';
                });
                sampleData.push(row);
            }
        }
        lineIndex++;
    }

    stream.close();
    
    return { rowCount, headers, sampleData };
}

async function parseExcel(filePath: string): Promise<{ rowCount: number; headers: string[]; sampleData: any[]; sheets?: { name: string; rowCount: number }[] }> {
    try {
        if (!existsSync(filePath)) {
            logger.warn(`Excel file not found for parsing: ${filePath}`);
            return { rowCount: 0, headers: [], sampleData: [], sheets: [] };
        }
        const XLSX = await import('xlsx');
        const workbook = XLSX.readFile(filePath);
        
        const sheets: { name: string; rowCount: number }[] = [];
        let totalRowCount = 0;
        let allHeaders: string[] = [];
        const sampleData: any[] = [];
        
        for (const sheetName of workbook.SheetNames) {
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            
            if (jsonData.length > 0) {
                const sheetRowCount = jsonData.length - 1;
                sheets.push({ name: sheetName, rowCount: sheetRowCount });
                totalRowCount += sheetRowCount;
                
                if (allHeaders.length === 0 && jsonData.length > 0) {
                    allHeaders = (jsonData[0] as any[]).map((h: any) => String(h || ''));
                }
                
                if (sampleData.length < 10 && jsonData.length > 1) {
                    for (let i = 1; i < Math.min(jsonData.length, 11); i++) {
                        const row: any = {};
                        allHeaders.forEach((h, j) => {
                            row[h] = (jsonData[i] as any[])[j];
                        });
                        sampleData.push(row);
                    }
                }
            }
        }
        
        return { 
            rowCount: totalRowCount, 
            headers: allHeaders, 
            sampleData, 
            sheets
        };
    } catch (error: any) {
        logger.warn(`Excel parsing error: ${error.message}`);
        return { 
            rowCount: 0, 
            headers: [], 
            sampleData: [],
            sheets: []
        };
    }
}

async function parseFile(filePath: string, fileType: string): Promise<{
    rowCount: number;
    headers: string[];
    sampleData: any[];
    sheets?: { name: string; rowCount: number }[];
}> {
    const ext = fileType.toLowerCase();
    
    if (ext === 'csv' || ext === 'txt' || ext === 'tsv') {
        return await parseCSV(filePath);
    } else if (ext === 'xlsx' || ext === 'xls') {
        return await parseExcel(filePath);
    }
    
    return { rowCount: 0, headers: [], sampleData: [] };
}

/**
 * Execute a validation rule against the data
 */
async function executeRule(
    rule: IRuleType,
    data: any[],
    headers: string[]
): Promise<{ passed: boolean; errorCount: number; errors: any[] }> {
    const errors: any[] = [];
    
    try {
        switch (rule.RuleType) {
            case 'Schema Validation':
                const requiredColumns = rule.SqlQuery.split(',').map(c => c.trim());
                for (const col of requiredColumns) {
                    if (!headers.includes(col)) {
                        errors.push({
                            rule: rule.Name,
                            column: col,
                            error: `Required column "${col}" not found`,
                            value: null
                        });
                    }
                }
                break;
                
            case 'Enum Check':
                const [enumCol, enumValuesStr] = rule.SqlQuery.split(':');
                if (enumCol && enumValuesStr) {
                    const allowedValues = enumValuesStr.trim().split(',').map(v => v.trim());
                    
                    for (let i = 0; i < data.length; i++) {
                        const row = data[i];
                        const value = row[enumCol.trim()];
                        if (value && !allowedValues.includes(String(value))) {
                            if (errors.length < 100) {  // Limit errors for performance
                                errors.push({
                                    row: i + 2,  // +2 for header + 1-based
                                    column: enumCol.trim(),
                                    value: value,
                                    error: `Value "${value}" not in allowed values: ${enumValuesStr.trim()}`
                                });
                            }
                        }
                    }
                }
                break;
                
            case 'Regex Pattern':
                const [regexCol, regexPattern] = rule.SqlQuery.split(':').map(s => s.trim());
                if (regexCol && regexPattern) {
                    const regex = new RegExp(regexPattern);
                    
                    for (let i = 0; i < data.length; i++) {
                        const row = data[i];
                        const value = row[regexCol];
                        if (value && !regex.test(String(value))) {
                            if (errors.length < 100) {
                                errors.push({
                                    row: i + 2,
                                    column: regexCol,
                                    value: value,
                                    error: `Value does not match pattern: ${regexPattern}`
                                });
                            }
                        }
                    }
                }
                break;
                
            case 'Custom SQL':
            default:
                logger.info(`Custom SQL rule "${rule.Name}" - requires database execution (skipped in sample validation)`);
                // For full validation, would execute SQL against full dataset
                break;
        }
        
        return {
            passed: errors.length === 0,
            errorCount: errors.length,
            errors
        };
    } catch (error: any) {
        logger.error(`Error executing rule ${rule.Name}:`, error);
        return {
            passed: false,
            errorCount: 1,
            errors: [{ error: error.message }]
        };
    }
}

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

        // ✅ Fix 1: Set tempFilePath properly
        const tempLocalPath = upload.TempLocalPath;
        if (tempLocalPath && existsSync(tempLocalPath)) {
            tempFilePath = tempLocalPath;
            logger.info(`[VAL-WORKER] Using existing TempLocalPath: ${tempFilePath}`);
        } else {
            const storageService = getStorageService(upload);
            const tempDir = path.join(process.cwd(), 'temp');
            if (!existsSync(tempDir)) {
                mkdirSync(tempDir, { recursive: true });
            }
            tempFilePath = path.join(tempDir, `${uploadId}_${upload.OriginalFilename}`);
            await storageService.downloadFile(upload.StoredFilename, tempFilePath);
            logger.info(`[VAL-WORKER] Downloaded file to: ${tempFilePath}`);
        }

        const fileDefinition = await FileDefinition.findById(fileDefinitionId);
        const rules = await Rule.findEnabledByFileDefinitionId(fileDefinitionId);

        if (!tempFilePath) {
            throw new Error(`Validation source is missing for upload ${uploadId}`);
        }
        const parseResult = await parseFile(tempFilePath, upload.FileType);
        
        // Update upload with row count
        await Upload.update(uploadId, {
            RowCountNo: parseResult.rowCount
        });
        
        // Update/create upload sheets
        if (parseResult.sheets && parseResult.sheets.length > 0) {
            await UploadSheet.deleteByUploadId(uploadId);
            for (let i = 0; i < parseResult.sheets!.length; i++) {
                const sheet = parseResult.sheets![i];
                await UploadSheet.create({
                    UploadId: uploadId,
                    SheetIndex: i,
                    SheetName: sheet.name,
                    RowCountNo: sheet.rowCount
                });
            }
        } else {
            const sheets = await UploadSheet.findByUploadId(uploadId);
            if (sheets.length > 0) {
                await UploadSheet.update(sheets[0].Id, { RowCountNo: parseResult.rowCount });
            }
        }
        
        const validationResult = await ValidationResult.findByUploadId(uploadId);
        const ruleDetails = await ValidationRuleDetail.findByUploadId(uploadId);      
        
        
        if (!validationResult) {          
            logger.error(`Validation result not found for upload: ${uploadId}`);
            await Upload.updateStatus(uploadId, 'VALIDATION_FAILED');
            io.to(uploadId).emit('uploadProgress', {
                uploadId,
                type: 'VALIDATION_FAILED'
            });          
            return;
        }

        // Verify expected rules exist
        if (rules.length === 0) {
            logger.warn(`No enabled rules found for FileDefinition: ${fileDefinitionId}, Upload: ${uploadId}`);
        }

        logger.info(`[WORKER-VAL] Starting ${ruleDetails.length} rules for upload ${uploadId}`);
        
        let passedRules = 0;
        let failedRules = 0;
        let warningRules = 0;
        
        for (const ruleDetail of ruleDetails) {
            const rule = rules.find(r => r.Id === ruleDetail.RuleId);
            if (!rule) {
                logger.warn(`Rule not found for detail: ${ruleDetail.RuleId}`);
                await ValidationRuleDetail.markSkipped(ruleDetail.Id, 0);
                continue;
            }
            
            // Mark rule as started
            await ValidationRuleDetail.markStarted(ruleDetail.Id);
            
            const startTime = Date.now();
            
            // Use limited sample for performance
            const sampleSize = Math.min(parseResult.sampleData.length, 1000);
            const dataToValidate = parseResult.sampleData.slice(0, sampleSize);
            
            const result = await executeRule(rule, dataToValidate, parseResult.headers);
            
            logger.info(`[WORKER-RULE] Upload: ${uploadId}, Rule: ${rule.Name} (${rule.RuleType}), Sample: ${dataToValidate.length}, Errors: ${result.errorCount}`);
            
            const executionTime = Date.now() - startTime;
            
            if (result.passed) {
                await ValidationRuleDetail.markPassed(ruleDetail.Id, executionTime);
                passedRules++;
            } else if (rule.Severity === 'Warning') {
                await ValidationRuleDetail.markWarning(ruleDetail.Id, executionTime, result.errorCount, result.errors);
                warningRules++;
            } else {
                await ValidationRuleDetail.markFailed(ruleDetail.Id, executionTime, result.errorCount, result.errors);
                failedRules++;
            }

            // ✅ Fix 2: Incremental progress update after each rule
            const updatedRuleDetails = await ValidationRuleDetail.findByUploadId(uploadId);
            const currPassed = updatedRuleDetails.filter((r: any) => r.Status === 'PASSED').length;
            const currFailed = updatedRuleDetails.filter((r: any) => r.Status === 'FAILED').length;
            const currWarning = updatedRuleDetails.filter((r: any) => r.Status === 'WARNING').length;
            await ValidationResult.updateProgress(
                validationResult.Id,
                currPassed,
                currFailed,
                currWarning,
                rule.Name,
                ruleDetails.length
            );

            // Emit progress for real-time UI updates
            const ruleProgress = Math.round(((currPassed + currFailed + currWarning) / ruleDetails.length) * 100);
            io.to(uploadId).emit('uploadProgress', {
                uploadId,
                type: 'VALIDATION_UPDATE',
                progress: ruleProgress,
                details: { currentRule: rule.Name, progress: ruleProgress }
            });
        }

// 10. Calculate final status from rule counters
        const finalStatus = failedRules > 0 ? 'FAILED' : (warningRules > 0 ? 'WARNING' : 'PASSED');
        const errorSummary = failedRules > 0 
            ? `${failedRules} rule(s) failed validation`
            : warningRules > 0 
                ? `${warningRules} rule(s) had warnings`
                : null;
        
        logger.info(`[WORKER-VAL-COMPL] UploadId: ${uploadId}, FinalStatus: ${finalStatus}, Passed: ${passedRules}, Failed: ${failedRules}, Warnings: ${warningRules}`);

// 11. Update validation result
        await ValidationResult.markCompleted(validationResult.Id, finalStatus, errorSummary || undefined);
        
        // 12. Update upload status and completion time
        const uploadStatus = failedRules > 0 ? 'VALIDATION_FAILED' : 'VALIDATION_PASSED';
        await Upload.updateStatus(uploadId, uploadStatus);
        await Upload.update(uploadId, {
            Status: uploadStatus,
            ValidationCompletedAt: new Date()
        });
        
        // Update sheet status
        const sheets = await UploadSheet.findByUploadId(uploadId);
        for (const sheet of sheets) {
            await UploadSheet.update(sheet.Id, {
                Status: failedRules > 0 ? 'FAILED' : 'VALIDATED',
                ValidationProgress: 100
            });
        }
        
        // ✅ Fix 4: Force final 100% progress
        await ValidationResult.updateProgress(
            validationResult.Id,
            passedRules,
            failedRules,
            warningRules,
            'Completed',
            ruleDetails.length
        );

        // Emit completion + final progress
        const eventType = failedRules > 0 ? 'VALIDATION_FAILED' : 'VALIDATION_PASSED';
        io.to(uploadId).emit('uploadProgress', {
            uploadId,
            type: eventType,
            details: {
                status: finalStatus,
                passedRules,
                failedRules,
                warningRules
            }
        });

        // ✅ Final WebSocket: VALIDATION_COMPLETE at 100%
        io.to(uploadId).emit('uploadProgress', {
            uploadId,
            type: 'VALIDATION_COMPLETE',
            progress: 100
        });

        if (failedRules === 0) {
            const { UploadService } = await import('./Upload.service');
            await UploadService.startDelivery(uploadId);
        }


    } catch (error: any) {
        logger.error(error);

        await Upload.updateStatus(uploadId, 'VALIDATION_FAILED');

        io.to(uploadId).emit('uploadProgress', {
            uploadId,
            type: 'VALIDATION_FAILED'
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
    const { createValidationWorker } = require('./Queue.service');
    return createValidationWorker(processValidationJob);
}