import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { UploadCloud, ChevronDown, ChevronLeft, ChevronRight, FileText, CheckCircle, XCircle, Clock, AlertCircle, RefreshCw } from 'lucide-react';
import { apiConfig } from '../config/api';
import { roleBasePath } from '../config/routes';
import { useAuth } from '../context/AuthContext';
import type { UploadProgressEvent } from '../types/websocket';
import DefinitionContextCard from '../components/DefinitionContextCard';
import { getFileDefinitions, type DefinitionSummary } from '../services/definitionApi';


// ============================================================================
// Types
// ============================================================================

interface UploadRecord {
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

// ============================================================================
// API Functions
// ============================================================================

const fetchUploads = async (page: number): Promise<{ uploads: UploadRecord[]; total: number }> => {
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

const uploadFile = async (file: File, definitionId: string): Promise<any> => {
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
    'VALIDATED': 'Validation Passed',
    'DELIVERY_QUEUED': 'Delivery Pending',
    'DELIVERY_IN_PROGRESS': 'Delivery In Progress',
    'DELIVERED': 'Delivered',
    'DELIVERY_FAILED': 'Failed',
  };
  return statusMap[status] || status;
};

// ============================================================================
// Component
// ============================================================================

const Upload = () => {
  const auth = useAuth();
  const socket = auth?.socket;
  const [searchParams, setSearchParams] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedDefinition, setSelectedDefinition] = useState<string>(() => searchParams.get('definitionId') ?? '');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [definitions, setDefinitions] = useState<DefinitionSummary[]>([]);
  const [uploadHistory, setUploadHistory] = useState<UploadRecord[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [latestUploadId, setLatestUploadId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDefinitions, setLoadingDefinitions] = useState(true);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  // Load definitions on mount
  useEffect(() => {
    const loadDefinitions = async () => {
      try {
        const result = await getFileDefinitions();
        setDefinitions(result.definitions);
        setSelectedDefinition(current => {
          if (result.definitions.some(definition => definition.id === current)) return current;
          return result.definitions.length === 1 ? result.definitions[0].id : '';
        });
      } catch (error) {
        console.error('Error fetching definitions:', error);
      } finally {
        setLoadingDefinitions(false);
      }
    };
    
    loadDefinitions();
  }, []);

  // Load uploads on mount
  const loadUploads = useCallback(async () => {
    try {
      const result = await fetchUploads(historyPage);
      setUploadHistory(result.uploads);
      setHistoryTotal(result.total);
    } catch (error) {
      console.error('Error fetching uploads:', error);
    } finally {
      setLoading(false);
    }
  }, [historyPage]);

  useEffect(() => {
    loadUploads();
  }, [loadUploads]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const isSupportedFile = (name: string) => /\.(csv|tsv|txt|xlsx|xls)$/i.test(name);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (isSupportedFile(file.name)) {
        setSelectedFile(file);
      } else {
        setUploadMessage({ type: 'error', text: 'Please drop a CSV, TSV, TXT, or Excel file (.xlsx, .xls)' });
      }
    }
  };

const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && isSupportedFile(file.name)) {
      setSelectedFile(file);
    } else {
      setUploadMessage({ type: 'error', text: 'Please select a CSV, TSV, TXT, or Excel file (.xlsx, .xls)' });
    }
    // Reset input
    e.target.value = '';
  };

const handleFileUpload = async (file: File) => {
    if (!selectedDefinition) {
      setUploadMessage({ type: 'error', text: 'Please select an upload definition first' });
      return;
    }

    setIsUploading(true);
    setUploadMessage(null);

    try {
      const result = await uploadFile(file, selectedDefinition);
      const uploadId = result.upload?.Id || result.uploadId || result.id;
      
      if (result.success) {
        // The backend queues validation as part of the upload; subscribe for live progress.
        if (uploadId && socket) socket.emit('subscribeToUpload', uploadId);
        setUploadMessage({ type: 'success', text: result.message || `✅ File uploaded! ID: ${uploadId || 'N/A'}` });
        setLatestUploadId(uploadId || null);
      } else {
        setUploadMessage({ type: 'error', text: result.message || 'Upload failed' });
      }
      
      await loadUploads();
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      
    } catch (error: any) {
      setUploadMessage({ type: 'error', text: error.message || 'Failed to upload file' });
    } finally {
      setIsUploading(false);
    }
  };

  // WebSocket live updates
  useEffect(() => {
  if (!socket) return;

  const handleProgress = (data: UploadProgressEvent) => {
    const label = data.type.replace(/_/g, ' ').toLowerCase();
    const failed = data.type === 'VALIDATION_FAILED' || data.type === 'DELIVERY_FAILED';
    setUploadMessage({
      type: failed ? 'error' : 'success',
      text: data.progress !== undefined ? `${data.progress}% - ${label}` : label,
    });

    // Progress updates are frequent; refresh the list only on stage changes.
    if (data.type !== 'VALIDATION_UPDATE') {
      loadUploads();
    }
  };

  socket.on('uploadProgress', handleProgress);

  return () => {
    socket.off('uploadProgress', handleProgress);
  };
}, [socket, loadUploads]);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Validation Passed':
      case 'Delivered':
        return <CheckCircle size={14} className="text-green-500" />;
      case 'Validation Failed':
      case 'Failed':
        return <XCircle size={14} className="text-red-500" />;
      case 'Pending':
      case 'Validation In Progress':
      case 'Delivery In Progress':
        return <Clock size={14} className="text-yellow-500" />;
      default:
        return <AlertCircle size={14} className="text-gray-400" />;
    }
  };

  const filteredUploads = uploadHistory.filter((item) => {
  const matchesSearch = item.filename
    .toLowerCase()
    .includes(searchTerm.toLowerCase());

  const matchesStatus =
    statusFilter === 'All' ||
    item.status === statusFilter;

  return matchesSearch && matchesStatus;
});

  const selectedDefinitionSummary = useMemo(
    () => definitions.find(definition => definition.id === selectedDefinition) ?? null,
    [definitions, selectedDefinition],
  );
  const historyPageCount = Math.max(1, Math.ceil(historyTotal / 20));

  const handleDefinitionChange = (definitionId: string) => {
    setSelectedDefinition(definitionId);
    setSelectedFile(null);
    setLatestUploadId(null);
    setUploadMessage(null);
    const next = new URLSearchParams(searchParams);
    if (definitionId) next.set('definitionId', definitionId);
    else next.delete('definitionId');
    setSearchParams(next, { replace: true });
  };

  return (
  <div className="bg-slate-50">
    <div className="flex flex-col lg:flex-row gap-6 items-start">

      {/* ========================================================= */}
      {/* LEFT PANEL */}
      {/* ========================================================= */}

      <aside className="w-full lg:w-[35%] bg-white shadow rounded-xl border border-slate-200 p-5">

        <div className="mb-5">
          <h2 className="text-lg font-semibold text-slate-900">
            Upload New File
          </h2>

          <p className="text-xs text-slate-500 mt-1">
            Choose what the file should match, then upload and validate it.
          </p>
        </div>

        {/* Definition Dropdown */}

        <div className="mb-5">
          <label className="block text-xs font-medium text-slate-600 mb-2">
            Select Upload Definition
          </label>

          <div className="relative">
            <select
              value={selectedDefinition}
              onChange={(e) => handleDefinitionChange(e.target.value)}
              disabled={loadingDefinitions}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-3 outline-none text-sm text-slate-700 appearance-none focus:border-blue-400"
            >
              <option value="">
                {loadingDefinitions
                  ? 'Loading definitions...'
                  : 'Choose a definition...'}
              </option>

              {definitions.map((def) => (
                <option key={def.id} value={def.id}>
                  {def.name}
                </option>
              ))}
            </select>

            <ChevronDown
              className="absolute right-3 top-3 text-slate-400"
              size={16}
            />
          </div>

          {selectedDefinitionSummary && (
            <div className="mb-5">
              <DefinitionContextCard definition={selectedDefinitionSummary} compact />
            </div>
          )}
        </div>

        {/* Upload Message */}

        {uploadMessage && (
          <div
            role="button"
            tabIndex={selectedDefinition ? 0 : -1}
            aria-disabled={!selectedDefinition}
            aria-label={selectedDefinition ? 'Choose a file to upload and validate' : 'Select a definition before choosing a file'}
            className={`mb-4 p-3 rounded-lg text-sm ${
              uploadMessage.type === 'success'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}
          >
            {uploadMessage.text}
          </div>
        )}

        {/* Drop Zone */}

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => selectedDefinition && fileInputRef.current?.click()}
          onKeyDown={(event) => {
            if (selectedDefinition && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          className={`relative w-full border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center text-center transition-all cursor-pointer
          ${
            isDragging
              ? 'border-blue-500 bg-blue-50'
              : 'border-slate-200 hover:border-slate-300'
          } ${selectedDefinition ? '' : 'cursor-not-allowed opacity-60'}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".csv,.tsv,.txt,.xlsx,.xls"
            onChange={handleFileSelect}
          />

          <div className="w-20 h-20 rounded-full bg-blue-600 flex items-center justify-center mb-4">
            <UploadCloud className="w-10 h-10 text-white" />
          </div>

          <p className="font-medium text-slate-800 ">
            Drop file here or click to browse
          </p>

          <div className="flex gap-2 mt-4">
            <span className="bg-blue-600 text-white px-3 py-1 rounded text-xs">
              CSV
            </span>

            <span className="bg-blue-600 text-white px-3 py-1 rounded text-xs">
              TXT
            </span>

            <span className="bg-blue-600 text-white px-3 py-1 rounded text-xs">
              XLSX
            </span>
          </div>

          {!selectedDefinition && (
            <div className="mt-6 bg-blue-600 text-white border border-blue-600 text-sm px-4 py-2 rounded-lg"> 
              Select a definition first
            </div>
          )}
        </div>

        {/* Selected File */}

        {selectedFile && (
          <div className="mt-4 space-y-3">

            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex justify-between items-center">
              <span className="text-sm truncate">
                {selectedFile.name}
              </span>

              <button
                onClick={() => setSelectedFile(null)}
              >
                <XCircle size={16} />
              </button>
            </div>

            <button
              onClick={() => handleFileUpload(selectedFile)}
              disabled={isUploading || !selectedDefinition}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-3 text-sm font-semibold"
            >
              {isUploading
                ? 'Uploading and validating...'
                : 'Upload and validate'}
            </button>

          </div>
        )}

        {latestUploadId && (
          <div role="status" className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            <p className="font-semibold">Your file was added to upload history.</p>
            <p className="mt-1">Open the result to review validation progress and any issues.</p>
            <Link
              to={`${roleBasePath(auth?.user?.Role)}/history/${latestUploadId}`}
              className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
            >
              Review validation result
            </Link>
          </div>
        )}

      </aside>

      {/* ========================================================= */}
      {/* RIGHT PANEL */}
      {/* ========================================================= */}

  <main className="w-full lg:w-[65%] bg-white rounded-xl border border-slate-200 shadow overflow-hidden">

        {/* Header */}

        <div className="p-5 border-b border-slate-100 flex justify-between items-center">

          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Upload History
            </h2>

            <p className="text-xs text-slate-500">
              Track and inspect runtime file validations.
            </p>
          </div>

          <button
            onClick={loadUploads}
            className="flex items-center gap-2 border border-blue-100 bg-white hover:bg-blue-50 rounded-lg px-4 py-2 text-sm text-blue-700 transition-colors"
          >
            <RefreshCw size={16} />
            Refresh
          </button>

        </div>

        {/* Search + Filters */}

        <div className="p-5 bg-slate-50 border-b border-slate-100 flex flex-col md:flex-row gap-4 justify-between">

          <div className="relative flex-1 max-w-md">

            <input
              type="text"
              placeholder="Search files..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full border border-slate-200 rounded-lg pl-4 pr-4 py-2 outline-none text-sm focus:border-blue-400"
            />

          </div>

          <div className="flex gap-2">

            {['All', 'Validation Passed', 'Validation Failed'].map(
              (status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium
                    ${
                      statusFilter === status
                      ? 'bg-blue-600 text-white border border-blue-600'
                      : 'bg-white border border-blue-100 text-slate-600 hover:bg-blue-50'
                    }`}
                >
                  {status === 'Validation Passed'
                    ? 'Passed'
                    : status === 'Validation Failed'
                    ? 'Failed'
                    : 'All'}
                </button>
              )
            )}

          </div>

        </div>

        {/* History List */}

        <div className="divide-y divide-slate-100">

          {loading ? (
            <div className="p-10 text-center">
              Loading uploads...
            </div>
          ) : filteredUploads.length === 0 ? (
            <div className="p-10 text-center text-slate-400">
              No upload history found
            </div>
          ) : (
            filteredUploads.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-5 hover:bg-slate-50"
              >
                {/* File */}

                <div className="w-[40%] flex items-center gap-4">

                  <div
                    className={`p-3 rounded-lg ${
                      item.filename.endsWith('.xlsx')
                        ? 'bg-green-50'
                        : 'bg-blue-50'
                    }`}
                  >
                    <FileText
                      size={20}
                      className={
                        item.filename.endsWith('.xlsx')
                          ? 'text-green-600'
                          : 'text-blue-600'
                      }
                    />
                  </div>

                  <div>
                    <p className="font-semibold text-slate-900">
                      {item.filename}
                    </p>

                    <p className="text-xs text-slate-400">
                      {formatDate(item.uploadedAt)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.definitionName}{item.definitionVersion ? ` · v${item.definitionVersion}` : ''}
                    </p>
                  </div>

                </div>

                {/* Size */}

                <div className="w-[20%] text-sm text-slate-600">
                  {formatFileSize(item.size)} • {item.rows} rows
                </div>

                {/* Status */}

                <div className="w-[25%]">

                  <span
                    className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border
                    ${
                      item.status === 'Validation Passed'
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : item.status === 'Validation Failed'
                        ? 'bg-red-50 text-red-700 border-red-200'
                        : 'bg-yellow-50 text-yellow-700 border-yellow-200'
                    }`}
                  >
                    {getStatusIcon(item.status)}
                    {item.status}
                  </span>

                </div>

                {/* Action */}

                <div className="w-[15%] text-right">
                  <Link
                    to={`${roleBasePath(auth?.user?.Role)}/history/${item.id}`}
                    className="text-blue-600 hover:text-blue-800 font-semibold"
                  >
                    View
                  </Link>
                </div>

              </div>
            ))
          )}

        </div>

        {historyTotal > 20 && (
          <nav aria-label="Upload history pages" className="flex items-center justify-between border-t border-slate-100 p-4">
            <p className="text-sm text-slate-500">Page {historyPage} of {historyPageCount} · {historyTotal} uploads</p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={historyPage === 1}
                onClick={() => setHistoryPage(page => Math.max(1, page - 1))}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium disabled:opacity-40"
              >
                <ChevronLeft size={16} /> Previous
              </button>
              <button
                type="button"
                disabled={historyPage === historyPageCount}
                onClick={() => setHistoryPage(page => Math.min(historyPageCount, page + 1))}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium disabled:opacity-40"
              >
                Next <ChevronRight size={16} />
              </button>
            </div>
          </nav>
        )}

      </main>

    </div>
  </div>
);
};

export default Upload;
