import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { apiConfig } from '../config/api';
import { roleBasePath } from '../config/routes';
import { useAuth } from '../context/AuthContext';
import { downloadUploadDelivery, downloadUploadReport } from '../services/uploadApi';
import { groupRulesBySheet } from './uploadRuleGroups';
import { getValidationIssueCount, mapValidationCheckStatus, parseValidationIssues, type ValidationIssue, type ValidationCheckStatus } from './validationIssues';

// ============================================================================
// Types
// ============================================================================

interface SheetSummary {
  index: string;
  name: string;
  rows: number;
  status: string;
  deliveryPath: string;
}

interface RuleResult {
  title: string;
  type: string;
  /** Sheet the check applies to; null when it applies to every sheet (or the CSV). */
  sheet: string | null;
  time?: string;
  status: ValidationCheckStatus;
  errorCount?: number;
  errors?: ValidationIssue[];
}

interface DeliveryRecordSummary {
  id: string;
  filename: string;
  status: string;
}

interface UploadDetail {
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

// ============================================================================
// API Functions
// ============================================================================

const getAuthHeaders = (): HeadersInit => {
  const token = localStorage.getItem('token');
  return {
    'Authorization': token ? `Bearer ${token}` : '',
  };
};

export const fetchUploadDetails = async (id: string): Promise<UploadDetail> => {
  const baseUrl = apiConfig.getBaseUrl();
  
  const response = await fetch(`${baseUrl}/uploads/${id}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch upload details');
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch upload details');
  }

  // Transform API response to component format
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
    const status = mapValidationCheckStatus(rule.Status || rule.status);
    const errors = parseValidationIssues(rule.Issues ?? rule.issues ?? rule.FailedRows ?? rule.failedRows);
    const errorCount = rule.IssueCount ?? rule.issueCount ?? getValidationIssueCount(
      status,
      rule.ErrorCount ?? rule.errorCount ?? errors.length,
      rule.WarningCount ?? rule.warningCount ?? errors.length,
    );
    const elapsedMs = rule.ElapsedMs ?? rule.elapsedMs ?? rule.ExecutionTimeMs ?? rule.executionTimeMs ?? 0;

    return {
      title: rule.RuleName || rule.ruleName || 'Unknown Rule',
      type: rule.RuleType || rule.ruleType || 'Unknown',
      sheet: rule.Sheet ?? rule.sheet ?? null,
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

const startVerification = async (id: string): Promise<{ success: boolean; message: string }> => {
  const baseUrl = apiConfig.getBaseUrl();
  
  const response = await fetch(`${baseUrl}/uploads/${id}/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });

  return response.json();
};

const retryValidation = async (id: string): Promise<{ success: boolean; message: string }> => {
  const baseUrl = apiConfig.getBaseUrl();
  
  const response = await fetch(`${baseUrl}/uploads/${id}/retry`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });

  return response.json();
};

const deleteUpload = async (id: string): Promise<{ success: boolean; message: string }> => {
  const baseUrl = apiConfig.getBaseUrl();
  
  const response = await fetch(`${baseUrl}/uploads/${id}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });

  return response.json();
};

// ============================================================================
// Utility Functions
// ============================================================================

const mapStatusToDisplay = (status: string): string => {
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

const mapSheetStatus = (status: string): string => {
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

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const formatDate = (dateString: string): string => {
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

const statusTextClass = (status: string): string =>
  status.includes('Failed') || status === 'Error' ? 'text-[#ef4444]' :
  status === 'Delivered' || status === 'Validated' || status.includes('Passed') ? 'text-[#22c55e]' :
  'text-[#f59e0b]';

const canVerify = (status: string): boolean => {
  return status === 'UPLOADED' || status === 'VALIDATION_FAILED';
};

const canRetry = (status: string): boolean => {
  return status === 'VALIDATION_FAILED' || status === 'DELIVERY_FAILED';
};

const canDelete = (status: string): boolean => {
  return status !== 'VALIDATION_IN_PROGRESS' && status !== 'DELIVERY_IN_PROGRESS';
};

// ============================================================================
// Component
// ============================================================================

const UploadDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [upload, setUpload] = useState<UploadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [deliveryLoadingId, setDeliveryLoadingId] = useState<string | null>(null);

  const { socket, user } = useAuth();
  const historyBase = user?.Role === 'admin' ? '/admin/history' : '/history';

  const loadUploadDetails = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!id) return;
    
    if (!options.silent) setLoading(true);
    setError(null);
    try {
      const details = await fetchUploadDetails(id);
      setUpload(details);
    } catch (err) {
      console.error('Failed to fetch upload details');
      setError(err instanceof Error ? err.message : 'Failed to load upload details');
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadUploadDetails();
  }, [loadUploadDetails]);

  // Live updates: subscribe to this upload and refresh (at most once per second) on progress events.
  useEffect(() => {
    if (!socket || !id) return;

    let pending: ReturnType<typeof setTimeout> | null = null;
    const subscribe = () => socket.emit('subscribeToUpload', id);
    const handleProgress = (event: { uploadId?: string }) => {
      if (event?.uploadId?.toLowerCase() !== id.toLowerCase() || pending) return;
      pending = setTimeout(() => {
        pending = null;
        loadUploadDetails({ silent: true });
      }, 1000);
    };

    subscribe();
    socket.on('connect', subscribe);
    socket.on('uploadProgress', handleProgress);
    return () => {
      if (pending) clearTimeout(pending);
      socket.emit('unsubscribeFromUpload', id);
      socket.off('connect', subscribe);
      socket.off('uploadProgress', handleProgress);
    };
  }, [socket, id, loadUploadDetails]);

  const handleVerify = async () => {
    if (!id || !upload) return;
    
    setActionLoading(true);
    setActionMessage(null);
    try {
      const result = await startVerification(id);
      if (result.success) {
        setActionMessage({ type: 'success', text: result.message || 'Verification started!' });
        // Reload details after a short delay
        setTimeout(() => loadUploadDetails(), 2000);
      } else {
        setActionMessage({ type: 'error', text: result.message || 'Failed to start verification' });
      }
    } catch (err) {
      setActionMessage({ type: 'error', text: 'Failed to start verification' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRetry = async () => {
    if (!id || !upload) return;
    
    setActionLoading(true);
    setActionMessage(null);
    try {
      const result = await retryValidation(id);
      if (result.success) {
        setActionMessage({ type: 'success', text: result.message || 'Retry started!' });
        // Reload details after a short delay
        setTimeout(() => loadUploadDetails(), 2000);
      } else {
        setActionMessage({ type: 'error', text: result.message || 'Failed to retry' });
      }
    } catch (err) {
      setActionMessage({ type: 'error', text: 'Failed to retry validation' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!id || !upload) return;
    
    if (!confirm('Are you sure you want to delete this upload?')) return;
    
    setActionLoading(true);
    setActionMessage(null);
    try {
      const result = await deleteUpload(id);
      if (result.success) {
        navigate(historyBase);
      } else {
        setActionMessage({ type: 'error', text: result.message || 'Failed to delete upload' });
      }
    } catch (err) {
      setActionMessage({ type: 'error', text: 'Failed to delete upload' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDownloadReport = async () => {
    if (!id || reportLoading) return;
    setReportLoading(true);
    setActionMessage(null);
    try {
      await downloadUploadReport(id);
    } catch (err) {
      setActionMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to download issues report' });
    } finally {
      setReportLoading(false);
    }
  };

  const handleDownloadDelivery = async (deliveryId: string) => {
    if (!id || deliveryLoadingId) return;
    setDeliveryLoadingId(deliveryId);
    setActionMessage(null);
    try {
      await downloadUploadDelivery(id, deliveryId);
    } catch (err) {
      setActionMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to download delivery output' });
    } finally {
      setDeliveryLoadingId(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-[1600px] mx-auto space-y-6">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  if (error || !upload) {
    return (
      <div className="max-w-[1600px] mx-auto space-y-6">
        <div className="text-center py-8">
          <p className="text-gray-500">{error || 'Upload not found'}</p>
          <Link to={historyBase} className="text-blue-600 hover:underline mt-2 inline-block">
            Back to Upload History
          </Link>
        </div>
      </div>
    );
  }

  const isFailed = upload.status === 'Failed' || upload.status === 'Validation Failed';
  const isProcessing = upload.status === 'Validation In Progress' || upload.status === 'Delivery In Progress';
  const isPending = upload.status === 'Pending';
  const validationResults = (
    <UploadValidationResults
      upload={upload}
      reportLoading={reportLoading}
      onDownloadReport={handleDownloadReport}
    />
  );

  // Render failed/validation results view
  if (isFailed) {
    return (
      <div className="max-w-[1600px] mx-auto space-y-6 p-8">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <Link to={historyBase} className="text-xs text-blue-600 hover:underline mb-2 inline-block">
              ← Back to Upload History
            </Link>
            <h2 className="text-xl font-bold text-[#1e293b]">{upload.filename}</h2>
            <p className="text-xs text-gray-400 font-medium">{upload.fileType}</p>
          </div>
          <div className="flex gap-2">
            <Link
              to={`${roleBasePath(user?.Role)}/upload?definitionId=${encodeURIComponent(upload.definitionId)}`}
              className="inline-flex min-h-11 items-center rounded border border-blue-200 px-4 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50"
            >
              Upload corrected file
            </Link>
            {canRetry(upload.statusCode) && (
              <button 
                onClick={handleRetry}
                disabled={actionLoading}
                title="Reprocess this stored file against its recorded definition version"
                className="px-4 py-1.5 bg-yellow-500 text-white text-xs font-bold rounded hover:bg-yellow-600 transition disabled:opacity-50"
              >
                {actionLoading ? 'Retrying...' : 'Retry stored file'}
              </button>
            )}
            {canDelete(upload.statusCode) && (
              <button 
                onClick={handleDelete}
                disabled={actionLoading}
                className="px-4 py-1.5 border border-red-200 text-red-500 text-xs font-bold rounded hover:bg-red-50 transition disabled:opacity-50"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {/* Action Message */}
        {actionMessage && (
          <div role="alert" className={`p-3 rounded text-sm ${
            actionMessage.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}>
            {actionMessage.text}
          </div>
        )}

        {/* Status Card */}
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-sm font-bold text-gray-800">Status</h3>
            <span className="bg-[#fef2f2] text-[#ef4444] text-[10px] px-2 py-1 rounded font-bold uppercase">
              {upload.status}
            </span>
          </div>
          
          <p className="text-xs text-gray-500 mb-6 font-medium">Validation Failed</p>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-8">
            <InfoItem label="File Size" value={upload.fileSize} />
            <InfoItem label="Row Count" value={upload.rowCount.toLocaleString()} />
            <InfoItem label="Uploaded" value={upload.uploaded} />
            <InfoItem label="Validated" value={upload.validated || '-'} />
            <InfoItem label="Definition" value={upload.definitionName} />
            <InfoItem label="Definition Version" value={upload.definitionVersion ? `v${upload.definitionVersion}` : 'Unversioned'} />
          </div>
        </section>

        {validationResults}
      </div>
    );
  }

  // Render pending/processing view
  if (isProcessing || isPending) {
    return (
      <div className="max-w-[1600px] mx-auto space-y-6 p-8">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <Link to={historyBase} className="text-xs text-blue-600 hover:underline mb-2 inline-block">
              ← Back to Upload History
            </Link>
            <h2 className="text-xl font-bold text-[#1e293b]">{upload.filename}</h2>
            <p className="text-xs text-gray-400 font-medium">{upload.fileType}</p>
          </div>
          <div className="flex gap-2">
            {canVerify(upload.statusCode) && (
              <button 
                onClick={handleVerify}
                disabled={actionLoading}
                className="px-4 py-1.5 bg-blue-600 text-white text-xs font-bold rounded hover:bg-blue-700 transition disabled:opacity-50"
              >
                {actionLoading ? 'Verifying...' : 'Verify'}
              </button>
            )}
            {canDelete(upload.statusCode) && (
              <button 
                onClick={handleDelete}
                disabled={actionLoading}
                className="px-4 py-1.5 border border-red-200 text-red-500 text-xs font-bold rounded hover:bg-red-50 transition disabled:opacity-50"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {/* Action Message */}
        {actionMessage && (
          <div role="alert" className={`p-3 rounded text-sm ${
            actionMessage.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}>
            {actionMessage.text}
          </div>
        )}

        {/* Status Card */}
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-sm font-bold text-gray-800">Status</h3>
            <span className="bg-[#fffbeb] text-[#f59e0b] text-[10px] px-2 py-1 rounded font-bold uppercase">
              {upload.status}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-8">
            <InfoItem label="File Size" value={upload.fileSize} />
            <InfoItem label="Row Count" value={upload.rowCount.toLocaleString()} />
            <InfoItem label="Uploaded" value={upload.uploaded} />
            <InfoItem label="Validated" value={upload.validated || '-'} />
            <InfoItem label="Definition" value={upload.definitionName} />
            <InfoItem label="Definition Version" value={upload.definitionVersion ? `v${upload.definitionVersion}` : 'Unversioned'} />
          </div>
        </section>
        {upload.rules.length > 0 && validationResults}
      </div>
    );
  }

  // Render success/delivered view (original code)
  const sheetCount = upload.sheets.length;

  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      {/* Header Area */}
      <div className="flex justify-between items-start">
        <div>
          <Link to={historyBase} className="text-xs text-blue-600 hover:underline mb-2 inline-block">
            ← Back to Upload History
          </Link>
          <h2 className="text-xl font-bold text-[#1e293b]">{upload.filename}</h2>
          <p className="text-xs text-gray-400 font-medium">{upload.fileType}</p>
        </div>
        <button 
          onClick={handleDelete}
          disabled={actionLoading}
          className="px-4 py-1.5 border border-red-200 text-red-500 text-xs font-bold rounded hover:bg-red-50 transition disabled:opacity-50"
        >
          Delete
        </button>
      </div>

      {actionMessage && (
        <div role="alert" className={`p-3 rounded text-sm ${
          actionMessage.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {actionMessage.text}
        </div>
      )}

      {/* Primary Status Card */}
      <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-sm font-bold text-gray-800">Status</h3>
          <span className="bg-[#f0fdf4] text-[#22c55e] text-[10px] px-2 py-1 rounded font-bold uppercase">
            {upload.status}
          </span>
        </div>
        
        <p className="text-xs text-gray-500 mb-6 font-medium">
          {upload.statusCode === 'DELIVERED' ? 'Delivered' : 'Validated'} {sheetCount} sheet(s)
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-8">
          <InfoItem label="File Size" value={upload.fileSize} />
          <InfoItem label="Row Count" value={upload.rowCount.toLocaleString()} />
          <InfoItem label="Uploaded" value={upload.uploaded} />
          <InfoItem label="Validated" value={upload.validated || '-'} />
          <InfoItem label="Definition" value={upload.definitionName} />
          <InfoItem label="Definition Version" value={upload.definitionVersion ? `v${upload.definitionVersion}` : 'Unversioned'} />
        </div>

        <div className="mt-8 pt-6 border-t border-gray-50">
          <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide">Delivery Destination:</p>
          <p className="mt-1 text-sm font-medium text-gray-800 break-words max-w-md">
            {upload.deliveredTo || 'Not specified'}
          </p>
          {upload.deliveryRecords.filter(record => record.status === 'DELIVERED').map(record => (
            <button
              key={record.id}
              type="button"
              onClick={() => handleDownloadDelivery(record.id)}
              disabled={deliveryLoadingId !== null}
              className="mt-3 mr-3 text-xs text-blue-600 hover:underline disabled:opacity-50"
            >
              {deliveryLoadingId === record.id ? 'Downloading...' : `Download ${record.filename}`}
            </button>
          ))}
        </div>

      </section>

      {/* Sheet Summary Table */}
      {sheetCount > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-gray-100">
            <h3 className="text-sm font-bold text-gray-800">Sheet Summary</h3>
          </div>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white text-[10px] uppercase tracking-wider text-gray-400 font-bold border-b border-gray-50">
                <th className="px-6 py-3">Index</th>
                <th className="px-6 py-3">Sheet Name</th>
                <th className="px-6 py-3">Rows</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Delivery Path</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {upload.sheets.map((sheet) => (
                <SheetRow 
                  key={sheet.index}
                  index={sheet.index}
                  name={sheet.name}
                  rows={sheet.rows}
                  status={sheet.status}
                  path={sheet.deliveryPath}
                />
              ))}
            </tbody>
          </table>
        </section>
      )}

      {validationResults}
    </div>
  );
};

// --- Sub-components for Clean Layout ---

const InfoItem = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-tight mb-1">{label}</p>
    <p className="text-[13px] font-bold text-gray-700">{value}</p>
  </div>
);

const SheetRow = ({ index, name, rows, status, path }: { index: string; name: string; rows: number; status: string; path: string }) => {
  const statusClass = status === 'Delivered' || status === 'Validated' ? 'bg-[#f0fdf4] text-[#22c55e]' :
                     status === 'Failed' ? 'bg-[#fef2f2] text-[#ef4444]' : 
                     'bg-[#fffbeb] text-[#f59e0b]';
  
  return (
    <tr className="text-[12px] hover:bg-gray-50">
      <td className="px-6 py-3 text-gray-400">{index}</td>
      <td className="px-6 py-3 font-semibold text-gray-700">{name}</td>
      <td className="px-6 py-3 text-gray-500">{rows.toLocaleString()}</td>
      <td className="px-6 py-3">
        <span className={`${statusClass} text-[9px] px-1.5 py-0.5 rounded font-bold uppercase`}>
          {status}
        </span>
      </td>
      <td className="px-6 py-4">
        {path ? (
          <span className="font-mono text-sm font-medium text-blue-600 break-all hover:underline cursor-pointer" title={`Copy: ${path}`}>
            {path}
          </span>
        ) : (
          <span className="text-sm font-medium text-orange-600 italic">Not Delivered</span>
        )}
      </td>

    </tr>
  );
};

export const UploadValidationResults = ({ upload, reportLoading, onDownloadReport }: {
  upload: Pick<UploadDetail, 'id' | 'rules' | 'sheets' | 'status'>;
  reportLoading: boolean;
  onDownloadReport: () => void;
}) => {
  const failedChecks = upload.rules.filter(rule => rule.status === 'Failed' || rule.status === 'Error').length;
  const warningChecks = upload.rules.filter(rule => rule.status === 'Warning').length;
  const passedChecks = upload.rules.filter(rule => rule.status === 'Passed').length;
  const affectedRows = new Set(upload.rules.flatMap(rule => rule.errors?.flatMap(issue => issue.rowNumber ?? []) ?? [])).size;

  return (
  <div className="space-y-6">
    <div className="flex justify-between items-center gap-4">
      <h2 className="text-xl font-bold text-[#1e293b]">Validation Results</h2>
      <a
        href={`${apiConfig.getBaseUrl()}/uploads/${encodeURIComponent(upload.id)}/report`}
        aria-disabled={reportLoading}
        onClick={event => {
          event.preventDefault();
          if (!reportLoading) onDownloadReport();
        }}
        className={`text-xs text-blue-600 hover:underline ${reportLoading ? 'opacity-50' : ''}`}
      >
        {reportLoading ? 'Downloading issues report...' : 'Download full issues report'}
      </a>
    </div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Validation summary">
      {[
        { label: 'Failed checks', value: failedChecks, style: 'text-red-700 bg-red-50 border-red-200' },
        { label: 'Warnings', value: warningChecks, style: 'text-amber-800 bg-amber-50 border-amber-200' },
        { label: 'Affected rows', value: affectedRows, style: 'text-slate-800 bg-slate-50 border-slate-200' },
        { label: 'Passed checks', value: passedChecks, style: 'text-emerald-800 bg-emerald-50 border-emerald-200' },
      ].map(({ label, value, style }) => (
        <div key={label} className={`rounded-lg border p-3 ${style}`}>
          <p className="text-xs font-medium">{label}</p>
          <p className="mt-1 text-2xl font-bold">{value}</p>
        </div>
      ))}
    </div>
    {groupRulesBySheet(upload.rules, upload.sheets, upload.status).map(group => (
      <section key={group.key} className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-bold text-gray-700">
            {group.label} <span className="text-xs font-normal text-gray-400">{group.rules.length} check(s)</span>
          </h3>
          <span className={`text-[10px] ${statusTextClass(group.status)} font-bold uppercase`}>{group.status}</span>
        </div>
        {group.rules.map((rule, index) => <RuleResultSection key={index} rule={rule} />)}
      </section>
    ))}
  </div>
  );
};

interface RuleResultSectionProps {
  rule: RuleResult;
}

const RuleResultSection = ({ rule }: RuleResultSectionProps) => {
  const isPassed = rule.status === 'Passed';
  const isWarning = rule.status === 'Warning';
  const isError = rule.status === 'Error';
  const samples = rule.errors?.slice(0, 10) ?? [];
  const issueCount = rule.errorCount ?? samples.length;
  const color = statusTextClass(rule.status);
  const badgeBackground = isPassed ? 'bg-[#f0fdf4]' :
    rule.status === 'Failed' || isError ? 'bg-[#fef2f2]' : 'bg-[#fffbeb]';

  if (isPassed) {
    return (
      <details className="rounded-lg border border-gray-200 bg-white px-5 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-emerald-700">
          {rule.title} <span className="ml-2 text-xs font-normal text-gray-500">{rule.type} · Passed</span>
        </summary>
        <p className="mt-2 text-xs text-gray-500">Completed in {rule.time || '0ms'} with no issues.</p>
      </details>
    );
  }

  return (
    <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-2">
          <h4 className={`text-[15px] font-bold ${color}`}>{rule.title}</h4>
          <span className="text-[11px] text-gray-400 font-medium">{rule.type}</span>
        </div>
        <span className={`${badgeBackground} ${color} text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-tight`}>
          {isError ? 'ERROR' : rule.status}
        </span>
      </div>
      {isError && (
        <p className="text-xs text-red-700 mb-2">This check could not complete. Review the issue details before retrying.</p>
      )}
      {!isPassed && (issueCount > 0 || samples.length > 0) && (
        <>
          <p className={`text-[13px] ${color} font-bold mb-1`}>{issueCount} {isWarning ? 'warning' : 'issue'}{issueCount !== 1 ? 's' : ''}</p>
          <p className="text-[11px] text-gray-400 mb-4">
            Sample {isWarning ? 'warnings' : 'issues'} (showing {samples.length} of {issueCount}):
          </p>

          <div className="overflow-x-auto border border-gray-100 rounded">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50/50 text-[11px] text-gray-500 border-b border-gray-100">
                  <th className="px-4 py-2 font-medium">column</th>
                  <th className="px-4 py-2 font-medium">error</th>
                  <th className="px-4 py-2 font-medium">row / scope</th>
                  <th className="px-4 py-2 font-medium">value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {samples.map((err, idx) => (
                  <ErrorRow key={idx} col={err.column} err={err.error} row={err.rowNumber} val={err.value} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="text-[10px] text-gray-300 mt-2">Executed in {rule.time || '0ms'}</p>
    </section>
  );
};

const ErrorRow = ({ col, err, row, val }: { col: string; err: string; row?: number; val: string }) => (
  <tr className="text-[12px] text-gray-700">
    <td className="px-4 py-2 font-medium">{col}</td>
    <td className="px-4 py-2">{err}</td>
    <td className="px-4 py-2 text-[#991b1b] font-bold">{row ?? 'File-level'}</td>
    <td className="px-4 py-2 font-mono text-[11px]">{val}</td>
  </tr>
);

export default UploadDetails;
