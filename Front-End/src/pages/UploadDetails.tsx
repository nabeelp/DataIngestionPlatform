import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { apiConfig } from '../config/api';
import { useAuth } from '../context/AuthContext';
import { groupRulesBySheet } from './uploadRuleGroups';

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
  isLast?: boolean;
  status?: 'Passed' | 'Failed' | 'Warning';
  errorCount?: number;
  errors?: Array<{ column: string; error: string; row_num: number; value: string }>;
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
  definitionVersion: number | null;
  sheets: SheetSummary[];
  rules: RuleResult[];
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

const fetchUploadDetails = async (id: string): Promise<UploadDetail> => {
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
  const validationResult = data.validationResult;
  const ruleDetails = data.ruleDetails || data.validationResult?.ruleDetails || [];

  console.log('Raw sheets from API:', sheets);
  const mappedSheets: SheetSummary[] = sheets.map((sheet: any) => ({
    index: String(sheet.SheetIndex || sheet.sheetIndex || 0),
    name: sheet.SheetName || sheet.sheetName || 'Unknown',
    rows: sheet.RowCountNo || sheet.rowCountNo || 0,
    status: mapSheetStatus(sheet.Status || sheet.status),
    deliveryPath: sheet.DeliveryPath || sheet.deliveryPath || sheet.delivery_path || sheet.Path || sheet.path || '',
  }));
  console.log('Mapped sheets:', mappedSheets);

  // Map validation rules - handle empty arrays
  const mappedRules: RuleResult[] = ruleDetails.map((rule: any, idx: number, arr: any[]) => ({
    title: rule.RuleName || rule.ruleName || 'Unknown Rule',
    type: rule.RuleType || rule.ruleType || 'Unknown',
    sheet: rule.Sheet ?? rule.sheet ?? null,
    time: rule.ExecutionTimeMs ? `${rule.ExecutionTimeMs}ms` : '0ms',
    isLast: idx === arr.length - 1,
    status: mapRuleStatus(rule.Status || rule.status),
    errorCount: rule.ErrorCount || rule.errorCount || 0,
    errors: rule.FailedRows ? parseFailedRows(rule.FailedRows) : undefined,
  }));

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
    definitionVersion: data.definitionVersion?.versionNumber ?? null,
    sheets: mappedSheets,
    rules: mappedRules,
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

const mapRuleStatus = (status: string): 'Passed' | 'Failed' | 'Warning' => {
  const statusMap: Record<string, 'Passed' | 'Failed' | 'Warning'> = {
    'PASSED': 'Passed',
    'FAILED': 'Failed',
    'WARNING': 'Warning',
  };
  return statusMap[status] || 'Passed';
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

const parseFailedRows = (failedRows: string): Array<{ column: string; error: string; row_num: number; value: string }> => {
  try {
    return JSON.parse(failedRows);
  } catch {
    return [];
  }
};

const statusTextClass = (status: string): string =>
  status.includes('Failed') ? 'text-[#ef4444]' :
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
      console.error('Failed to fetch upload details:', err);
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
            {canRetry(upload.statusCode) && (
              <button 
                onClick={handleRetry}
                disabled={actionLoading}
                className="px-4 py-1.5 bg-yellow-500 text-white text-xs font-bold rounded hover:bg-yellow-600 transition disabled:opacity-50"
              >
                {actionLoading ? 'Retrying...' : 'Retry'}
              </button>
            )}
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
          <div className={`p-3 rounded text-sm ${
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

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-8">
            <InfoItem label="File Size" value={upload.fileSize} />
            <InfoItem label="Row Count" value={upload.rowCount.toLocaleString()} />
            <InfoItem label="Uploaded" value={upload.uploaded} />
            <InfoItem label="Validated" value={upload.validated || '-'} />
            <InfoItem label="Definition Version" value={upload.definitionVersion ? `v${upload.definitionVersion}` : 'Unversioned'} />
          </div>
        </section>

        <h2 className="text-xl font-bold text-[#1e293b] mb-4">Validation Results</h2>

        {/* Validation Rules with Errors */}
        {upload.rules.map((rule, idx) => (
          <RuleResultSection key={idx} rule={rule} />
        ))}
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
          <div className={`p-3 rounded text-sm ${
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

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-8">
            <InfoItem label="File Size" value={upload.fileSize} />
            <InfoItem label="Row Count" value={upload.rowCount.toLocaleString()} />
            <InfoItem label="Uploaded" value={upload.uploaded} />
            <InfoItem label="Validated" value={upload.validated || '-'} />
            <InfoItem label="Definition Version" value={upload.definitionVersion ? `v${upload.definitionVersion}` : 'Unversioned'} />
          </div>
        </section>
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

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-8">
          <InfoItem label="File Size" value={upload.fileSize} />
          <InfoItem label="Row Count" value={upload.rowCount.toLocaleString()} />
          <InfoItem label="Uploaded" value={upload.uploaded} />
          <InfoItem label="Validated" value={upload.validated || '-'} />
          <InfoItem label="Definition Version" value={upload.definitionVersion ? `v${upload.definitionVersion}` : 'Unversioned'} />
        </div>

        <div className="mt-8 pt-6 border-t border-gray-50">
          <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide">Delivery Destination:</p>
          <p className="mt-1 text-sm font-medium text-gray-800 break-words max-w-md">
            {upload.deliveredTo || 'Not specified'}
          </p>
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

      {/* Rule Results, one section per sheet */}
      {groupRulesBySheet(upload.rules, upload.sheets, upload.status).map((group) => (
        <section key={group.key} className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
          <div className="flex justify-between items-center pb-4 border-b border-gray-50 mb-6">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold text-gray-700">{group.label}</span>
              <span className="text-[10px] text-gray-400">{group.rules.length} rule(s)</span>
            </div>
            <span className={`text-[10px] ${statusTextClass(group.status)} font-bold uppercase`}>{group.status}</span>
          </div>

          <div className="space-y-4">
            {group.rules.map((ruleItem, ruleIdx) => (
              <RuleItem 
                key={ruleIdx}
                title={ruleItem.title}
                type={ruleItem.type}
                time={ruleItem.time}
                isLast={ruleIdx === group.rules.length - 1}
                status={ruleItem.status}
              />
            ))}
          </div>
        </section>
      ))}
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

const RuleItem = ({ title, type, time, isLast, status }: { title: string; type: string; time?: string; isLast?: boolean; status?: 'Passed' | 'Failed' | 'Warning' }) => {
  const titleColor = status === 'Failed' ? 'text-[#ef4444]' : 
                     status === 'Warning' ? 'text-[#f59e0b]' : 
                     'text-[#22c55e]';
  const badgeColor = status === 'Failed' ? 'text-[#ef4444]' : 
                     status === 'Warning' ? 'text-[#f59e0b]' : 
                     'text-[#22c55e]';
  const bgColor = status === 'Failed' ? 'bg-[#fef2f2]' : 
                  status === 'Warning' ? 'bg-[#fffbeb]' : 
                  'bg-[#f0fdf4]';

  return (
    <div className={`pb-4 ${!isLast ? 'border-b border-gray-50' : ''}`}>
      <div className="flex justify-between items-center mb-1">
        <div className="flex items-center gap-2">
          <h4 className={`text-[13px] font-bold ${titleColor}`}>{title}</h4>
          <span className="text-[10px] text-gray-400">{type}</span>
        </div>
        <span className={`${badgeColor} text-[10px] font-bold uppercase`}>
          {status || 'Passed'}
        </span>
      </div>
      {time && <p className="text-[10px] text-gray-400 font-medium">Executed in {time}</p>}
    </div>
  );
};

// --- Components for Failed Validation Results ---

interface RuleResultSectionProps {
  rule: RuleResult;
}

const RuleResultSection = ({ rule }: RuleResultSectionProps) => {
  const hasErrors = rule.errors && rule.errors.length > 0;
  const isPassed = !hasErrors && rule.status !== 'Failed';
  const isWarning = rule.status === 'Warning';

  if (isPassed) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 flex justify-between items-center">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-bold text-[#22c55e]">{rule.title}</h3>
            <span className="text-[11px] text-gray-400 font-medium">{rule.type}</span>
          </div>
          <p className="text-[10px] text-gray-300 mt-1">Executed in {rule.time || '0ms'}</p>
        </div>
        <span className="bg-[#f0fdf4] text-[#22c55e] text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-tight">
          Passed
        </span>
      </div>
    );
  }

  if (isWarning) {
    return (
      <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-bold text-[#f59e0b]">{rule.title}</h3>
            <span className="text-[11px] text-gray-400 font-medium">{rule.type}</span>
          </div>
          <span className="bg-[#fffbeb] text-[#f59e0b] text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-tight">
            Warning
          </span>
        </div>
        
        {rule.errorCount !== undefined && rule.errorCount > 0 && (
          <>
            <p className="text-[13px] text-[#ef4444] font-bold mb-1">{rule.errorCount} failed row{rule.errorCount > 1 ? 's' : ''}</p>
            <p className="text-[11px] text-gray-400 mb-4">Sample errors (showing {Math.min(rule.errorCount, 10)} of {rule.errorCount}):</p>

            <div className="overflow-hidden border border-gray-100 rounded">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/50 text-[11px] text-gray-500 border-b border-gray-100">
                    <th className="px-4 py-2 font-medium">column</th>
                    <th className="px-4 py-2 font-medium">error</th>
                    <th className="px-4 py-2 font-medium">row_num</th>
                    <th className="px-4 py-2 font-medium">value</th>
                  </tr>
                </thead>
                <tbody>
                  {rule.errors?.slice(0, 10).map((err, idx) => (
                    <ErrorRow key={idx} col={err.column} err={err.error} row={err.row_num} val={err.value} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="text-[10px] text-gray-300 mt-2">Executed in {rule.time || '0ms'}</p>
      </section>
    );
  }

  // Failed rule
  return (
    <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-bold text-[#ef4444]">{rule.title}</h3>
          <span className="text-[11px] text-gray-400 font-medium">{rule.type}</span>
        </div>
        <span className="bg-[#fef2f2] text-[#ef4444] text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-tight">
          Failed
        </span>
      </div>
      
      {rule.errorCount !== undefined && rule.errorCount > 0 && (
        <>
          <p className="text-[13px] text-[#ef4444] font-bold mb-1">{rule.errorCount} failed row{rule.errorCount > 1 ? 's' : ''}</p>
          <p className="text-[11px] text-gray-400 mb-4">Sample errors (showing {Math.min(rule.errorCount, 10)} of {rule.errorCount}):</p>

          <div className="overflow-hidden border border-gray-100 rounded">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50/50 text-[11px] text-gray-500 border-b border-gray-100">
                  <th className="px-4 py-2 font-medium">column</th>
                  <th className="px-4 py-2 font-medium">error</th>
                  <th className="px-4 py-2 font-medium">row_num</th>
                  <th className="px-4 py-2 font-medium">value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rule.errors?.slice(0, 10).map((err, idx) => (
                  <ErrorRow key={idx} col={err.column} err={err.error} row={err.row_num} val={err.value} />
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

const ErrorRow = ({ col, err, row, val }: { col: string; err: string; row: number; val: string }) => (
  <tr className="text-[12px] text-gray-700">
    <td className="px-4 py-2 font-medium">{col}</td>
    <td className="px-4 py-2">{err}</td>
    <td className="px-4 py-2 text-[#991b1b] font-bold">{row}</td>
    <td className="px-4 py-2 font-mono text-[11px]">{val}</td>
  </tr>
);

export default UploadDetails;
