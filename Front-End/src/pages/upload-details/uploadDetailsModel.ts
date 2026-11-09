import { mapValidationCheckStatus, parseValidationIssues } from '../validationIssues';
import type { IUploadDetailResponse } from '../../services/uploadApi';
import type { DeliveryRecordSummary, RuleResult, SheetSummary, UploadDetail } from './types';

export const mapStatusToDisplay = (status: string): string => {
  const statusMap: Record<string, string> = {
    'UPLOADED': 'Pending',
    'VALIDATION_QUEUED': 'Pending',
    'VALIDATION_IN_PROGRESS': 'Validation In Progress',
    'VALIDATION_FAILED': 'Validation Failed',
    'VALIDATION_PASSED': 'Validation Passed',
    'VALIDATED': 'Validated',
    'DELIVERY_QUEUED': 'Pending',
    'DELIVERY_IN_PROGRESS': 'Delivery In Progress',
    'DELIVERED': 'Delivered',
    'DELIVERY_FAILED': 'Failed',
  };
  return statusMap[status] || status;
};

export const mapSheetStatus = (status: string): string => {
  const statusMap: Record<string, string> = {
    'PENDING': 'Pending',
    'VALIDATING': 'Validating',
    'VALIDATED': 'Validated',
    'DELIVERING': 'Delivering',
    'DELIVERED': 'Delivered',
    'FAILED': 'Failed',
  };
  return statusMap[status] || status;
};

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

export const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

export const statusTextClass = (status: string): string =>
  status.includes('Failed') || status === 'Error' ? 'text-[#ef4444]' :
  status === 'Delivered' || status === 'Validated' || status.includes('Passed') ? 'text-[#22c55e]' :
  'text-[#f59e0b]';

export const canVerify = (status: string): boolean => {
  return status === 'UPLOADED' || status === 'VALIDATION_FAILED';
};

export const canRetry = (status: string): boolean => {
  return status === 'VALIDATION_FAILED' || status === 'DELIVERY_FAILED';
};

export const canDelete = (status: string): boolean => {
  return status !== 'VALIDATION_IN_PROGRESS' && status !== 'DELIVERY_IN_PROGRESS';
};

/** Transforms the `GET /uploads/:id` response into the page model. */
export const normalizeUploadDetails = (data: IUploadDetailResponse): UploadDetail => {
  const { upload } = data;

  const sheets: SheetSummary[] = data.sheets.map(sheet => ({
    index: String(sheet.SheetIndex),
    name: sheet.SheetName || 'Unknown',
    rows: sheet.RowCountNo ?? 0,
    status: mapSheetStatus(sheet.Status),
    deliveryPath: sheet.DeliveryPath ?? '',
  })).sort((a, b) => Number(a.index) - Number(b.index));

  const rules: RuleResult[] = data.ruleDetails.map(rule => ({
    title: rule.RuleName || 'Unknown Rule',
    type: rule.RuleType || 'Unknown',
    sheet: rule.Sheet ?? null,
    time: `${rule.ElapsedMs}ms`,
    status: mapValidationCheckStatus(rule.Status),
    errorCount: rule.IssueCount,
    errors: parseValidationIssues(rule.Issues),
  }));

  const deliveryRecords: DeliveryRecordSummary[] = data.deliveryRecords.map(record => ({
    id: record.Id,
    filename: record.DestinationPath.split(/[\\/]/).pop() || 'delivered file',
    status: record.Status,
  }));

  return {
    id: upload.Id,
    filename: upload.OriginalFilename || 'Unknown',
    fileType: upload.FileType || 'XLSX Upload',
    status: mapStatusToDisplay(upload.Status),
    statusCode: upload.Status,
    fileSize: formatFileSize(upload.FileSize),
    rowCount: upload.RowCountNo ?? 0,
    uploaded: formatDate(upload.UploadedAt),
    validated: upload.ValidationCompletedAt ? formatDate(upload.ValidationCompletedAt) : null,
    deliveredTo: upload.DeliveredTo ?? '',
    definitionId: upload.FileDefinitionId,
    definitionName: upload.DefinitionName || 'Unknown definition',
    definitionVersion: data.definitionVersion?.versionNumber ?? null,
    sheets,
    rules,
    deliveryRecords,
  };
};
