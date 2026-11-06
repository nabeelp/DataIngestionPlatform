import { apiConfig } from '../../config/api';

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

const mapStatusToDisplay = (status: string): string => {
  const statusMap: Record<string, string> = {
    'UPLOADED': 'Pending',
    'VALIDATION_QUEUED': 'Pending',
    'VALIDATION_IN_PROGRESS': 'Validation In Progress',
    'VALIDATION_FAILED': 'Validation Failed',
    'VALIDATION_PASSED': 'Validation Passed',
    'VALIDATED': 'Validation Passed',
    'DELIVERY_QUEUED': 'Delivery Pending',
    'DELIVERY_IN_PROGRESS': 'Delivery In Progress',
    'DELIVERED': 'Delivered',
    'DELIVERY_FAILED': 'Failed',
  };
  return statusMap[status] || status;
};

export const fetchUploads = async (page: number): Promise<{ uploads: UploadRecord[]; total: number }> => {
  const baseUrl = apiConfig.getBaseUrl();
  const token = localStorage.getItem('token');
  
  const response = await fetch(`${baseUrl}/uploads?page=${page}&pageSize=20`, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
  });
  
  if (!response.ok) {
    throw new Error('Failed to fetch uploads');
  }
  
  const data = await response.json();
  
  if (data.success && data.uploads) {
    return {
      uploads: data.uploads.map((upload: any) => ({
        id: upload.Id || upload.id,
        filename: upload.OriginalFilename || upload.originalFilename,
        definitionId: upload.FileDefinitionId || upload.fileDefinitionId,
        definitionName: upload.DefinitionName || upload.definitionName || 'Unknown definition',
        definitionVersion: upload.DefinitionVersionNumber || upload.definitionVersionNumber || null,
        size: upload.FileSize || upload.fileSize || 0,
        rows: upload.RowCountNo || upload.rowCountNo || 0,
        status: mapStatusToDisplay(upload.Status || upload.status),
        uploadedAt: upload.UploadedAt || upload.uploadedAt,
        statusCode: upload.Status || upload.status,
      })),
      total: data.total ?? data.uploads.length,
    };
  }
  
  return { uploads: [], total: 0 };
};

export const uploadFile = async (file: File, definitionId: string): Promise<any> => {
  const baseUrl = apiConfig.getBaseUrl();
  const token = localStorage.getItem('token');
  
  const formData = new FormData();
  formData.append('file', file);
  formData.append('definitionId', definitionId);
  
  const response = await fetch(`${baseUrl}/uploads`, {
    method: 'POST',
    headers: {
      'Authorization': token ? `Bearer ${token}` : '',
    },
    body: formData,
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to upload file');
  }
  
  return response.json();
};
