import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { UploadCloud, ChevronDown, XCircle } from 'lucide-react';
import { roleBasePath } from '../config/routes';
import { useAuth } from '../context/AuthContext';
import type { UploadProgressEvent } from '../types/websocket';
import DefinitionContextCard from '../components/DefinitionContextCard';
import { getFileDefinitions, type DefinitionSummary } from '../services/definitionApi';
import UploadHistoryPanel from './upload-page/UploadHistoryPanel';
import { fetchUploads, uploadFile, type UploadRecord } from './upload-page/uploadPageApi';

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

      <UploadHistoryPanel
        uploads={filteredUploads}
        loading={loading}
        role={auth?.user?.Role}
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        onRefresh={loadUploads}
        page={historyPage}
        total={historyTotal}
        onPageChange={setHistoryPage}
      />

    </div>
  </div>
);
};

export default Upload;
