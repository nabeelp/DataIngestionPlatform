import type { ValidationCheckStatus, ValidationIssue } from '../validationIssues';

export interface SheetSummary {
  index: string;
  name: string;
  rows: number;
  status: string;
  deliveryPath: string;
}

export interface RuleResult {
  title: string;
  type: string;
  /** Sheet the check applies to; null when it applies to every sheet (or the CSV). */
  sheet: string | null;
  time?: string;
  status: ValidationCheckStatus;
  errorCount?: number;
  errors?: ValidationIssue[];
}

export interface DeliveryRecordSummary {
  id: string;
  filename: string;
  status: string;
}

export interface UploadDetail {
  id: string;
  filename: string;
  fileType: string;
  status: string;
  statusCode: string;
  fileSize: string;
  rowCount: number;
  uploaded: string;
  validated: string | null;
  deliveredTo: string;
  definitionId: string;
  definitionName: string;
  definitionVersion: number | null;
  sheets: SheetSummary[];
  rules: RuleResult[];
  deliveryRecords: DeliveryRecordSummary[];
}
