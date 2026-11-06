import { mapValidationCheckStatus, parseValidationIssues } from '../validationIssues';
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

/** Transforms the `GET /uploads/:id` response (PascalCase or camelCase fields) into the page model. */
export const normalizeUploadDetails = (data: any): UploadDetail => {
  const upload = data.upload;
  const sheets = data.sheets || [];
  const ruleDetails = data.ruleDetails || data.validationResult?.ruleDetails || [];

  const mappedSheets: SheetSummary[] = sheets.map((sheet: any) => ({
    index: String(sheet.SheetIndex || sheet.sheetIndex || 0),
    name: sheet.SheetName || sheet.sheetName || 'Unknown',
    rows: sheet.RowCountNo || sheet.rowCountNo || 0,
    status: mapSheetStatus(sheet.Status || sheet.status),
    deliveryPath: sheet.DeliveryPath || sheet.deliveryPath || sheet.delivery_path || sheet.Path || sheet.path || '',
  })).sort((a: SheetSummary, b: SheetSummary) => Number(a.index) - Number(b.index));

  // Map validation rules - handle empty arrays
  const mappedRules: RuleResult[] = ruleDetails.map((rule: any) => {
    const status = mapValidationCheckStatus(rule.Status);
    const errors = parseValidationIssues(rule.Issues);
    const errorCount = rule.IssueCount ?? errors.length;
    const elapsedMs = rule.ElapsedMs ?? 0;

    return {
      title: rule.RuleName || 'Unknown Rule',
      type: rule.RuleType || 'Unknown',
      sheet: rule.Sheet ?? null,
      time: `${elapsedMs}ms`,
      status,
      errorCount,
      errors,
    };
  });

  const deliveryRecords: DeliveryRecordSummary[] = (data.deliveryRecords || []).map((record: any) => {
    const destinationPath = String(record.DestinationPath || record.destinationPath || '');
    return {
      id: record.Id || record.id,
      filename: destinationPath.split(/[\\/]/).pop() || 'delivered file',
      status: record.Status || record.status || '',
    };
  });

  return {
    id: upload.Id || upload.id,
    filename: upload.OriginalFilename || upload.originalFilename || 'Unknown',
    fileType: upload.FileType || upload.fileType || 'XLSX Upload',
    status: mapStatusToDisplay(upload.Status || upload.status),
    statusCode: upload.Status || upload.status,
    fileSize: formatFileSize(upload.FileSize || upload.fileSize || 0),
    rowCount: upload.RowCountNo || upload.rowCountNo || 0,
    uploaded: formatDate(upload.UploadedAt || upload.uploadedAt),
    validated: upload.ValidationCompletedAt || upload.validationCompletedAt 
      ? formatDate(upload.ValidationCompletedAt || upload.validationCompletedAt) 
      : null,
    deliveredTo: upload.DeliveredTo || upload.deliveredTo || '',
    definitionId: upload.FileDefinitionId || upload.fileDefinitionId || '',
    definitionName: upload.DefinitionName || upload.definitionName || 'Unknown definition',
    definitionVersion: data.definitionVersion?.versionNumber ?? null,
    sheets: mappedSheets,
    rules: mappedRules,
    deliveryRecords,
  };
};
