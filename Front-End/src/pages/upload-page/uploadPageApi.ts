import { useQuery } from '@tanstack/react-query';
import { getUploads, type IUpload, type IUploadsResponse, type UploadStatus } from '../../services/uploadApi';
import { queryKeys } from '../../services/queryKeys';

export interface UploadRecord {
  id: string;
  filename: string;
  definitionId: string;
  definitionName: string;
  definitionVersion: number | null;
  size: number;
  rows: number;
  status:
    | 'Pending'
    | 'Validation In Progress'
    | 'Validation Passed'
    | 'Validation Failed'
    | 'Delivery Pending'
    | 'Delivery In Progress'
    | 'Delivered'
    | 'Failed';
  uploadedAt: string;
  statusCode?: string;
}

const STATUS_LABELS: Record<UploadStatus, UploadRecord['status']> = {
  UPLOADED: 'Pending',
  VALIDATION_QUEUED: 'Pending',
  VALIDATION_IN_PROGRESS: 'Validation In Progress',
  VALIDATION_FAILED: 'Validation Failed',
  VALIDATION_PASSED: 'Validation Passed',
  VALIDATED: 'Validation Passed',
  DELIVERY_QUEUED: 'Delivery Pending',
  DELIVERY_IN_PROGRESS: 'Delivery In Progress',
  DELIVERED: 'Delivered',
  DELIVERY_FAILED: 'Failed',
};

export const toUploadRecord = (upload: IUpload): UploadRecord => ({
  id: upload.Id,
  filename: upload.OriginalFilename,
  definitionId: upload.FileDefinitionId,
  definitionName: upload.DefinitionName || 'Unknown definition',
  definitionVersion: upload.DefinitionVersionNumber || null,
  size: upload.FileSize || 0,
  rows: upload.RowCountNo || 0,
  status: STATUS_LABELS[upload.Status] ?? (upload.Status as UploadRecord['status']),
  uploadedAt: upload.UploadedAt,
  statusCode: upload.Status,
});

export const selectUploadRecords = (response: IUploadsResponse): { uploads: UploadRecord[]; total: number } => ({
  uploads: response.uploads.map(toUploadRecord),
  total: response.total,
});

/** One page of the user's uploads as display records; the previous page stays visible while the next loads. */
export const useUploadRecordsQuery = (page: number) =>
  useQuery({
    queryKey: queryKeys.uploads.list(page),
    queryFn: () => getUploads(page),
    select: selectUploadRecords,
    staleTime: 0,
    placeholderData: previous => previous,
  });
