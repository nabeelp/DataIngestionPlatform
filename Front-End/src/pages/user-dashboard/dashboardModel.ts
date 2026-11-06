import { apiRequest } from '../../services/http';

export interface FormattedUpload {
  id: string;
  filename: string;
  status: string;
  statusCode: string;
  info?: string;
  variant?: string;
  uploadedAt?: string;
}

export interface PeriodMetric {
  current: number;
  previous: number;
}

export interface DashboardData {
  periodDays: number;
  from: string;
  to: string;
  kpis: {
    totalDefinitions: number;
    activeDefinitions: number;
    uploads: PeriodMetric;
    failedUploads: PeriodMetric;
    pendingUploads: number;
    avgProcessingSeconds: PeriodMetric;
  };
  activity: { date: string; uploads: number; failed: number }[];
  topDefinitions: { id: string; name: string; uploads: number; successRate: number | null }[];
  outcomes: { successful: number; failed: number; inProgress: number };
  recentTasks: {
    id: string;
    uploadId: string;
    filename: string;
    type: 'Validation' | 'Delivery';
    status: 'Completed' | 'Processing' | 'Failed' | 'Pending';
    startedAt: string | null;
    durationSeconds: number | null;
  }[];
}

const mapStatusToDisplay = (status: string): string => {
  const statusMap: Record<string, string> = {
    'UPLOADED': 'Pending',
    'VALIDATION_QUEUED': 'Pending',
    'VALIDATION_IN_PROGRESS': 'Processing',
    'VALIDATION_FAILED': 'Failed',
    'VALIDATION_PASSED': 'Validation Passed',
    'VALIDATED': 'Completed',
    'DELIVERY_QUEUED': 'Pending',
    'DELIVERY_IN_PROGRESS': 'Processing',
    'DELIVERED': 'Completed',
    'DELIVERY_FAILED': 'Failed',
  };
  return statusMap[status] || status;
};

const getVariant = (status: string): string => {
  const failedStatuses = ['VALIDATION_FAILED', 'DELIVERY_FAILED', 'Failed'];
  return failedStatuses.includes(status) ? 'failed' : 'success';
};

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

export const formatDuration = (seconds: number | null): string => {
  if (seconds === null) return '-';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

export const percentChange = ({ current, previous }: PeriodMetric): number | null =>
  previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10;

export const formatShortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export const getGreeting = (): string => {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
};

export const formatDateTime = (dateString: string): string => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

export const exportActivityCsv = (dashboard: DashboardData) => {
  const lines = ['date,uploads,failed', ...dashboard.activity.map(day => `${day.date},${day.uploads},${day.failed}`)];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `upload-activity-${dashboard.activity[0]?.date || 'period'}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const fetchRecentUploads = async (limit: number = 5): Promise<FormattedUpload[]> => {
  const data = await apiRequest<{ uploads?: any[] }>(`/uploads/recent?limit=${limit}`);
  return (data.uploads || []).map((upload: any) => ({
    id: upload.Id || upload.id,
    filename: upload.OriginalFilename || upload.originalFilename,
    status: mapStatusToDisplay(upload.Status || upload.status),
    statusCode: upload.Status || upload.status,
    info: formatFileSize(upload.FileSize || upload.fileSize || 0) + ' • ' + formatDateTime(upload.UploadedAt || upload.uploadedAt),
    variant: getVariant(upload.Status || upload.status),
    uploadedAt: upload.UploadedAt || upload.uploadedAt,
  }));
};

export const fetchDashboard = async (days: number): Promise<DashboardData> =>
  (await apiRequest<{ dashboard: DashboardData }>(`/uploads/dashboard?days=${days}`)).dashboard;
