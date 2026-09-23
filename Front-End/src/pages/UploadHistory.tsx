import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, History } from 'lucide-react';
import { apiConfig } from '../config/api';
import { useAuth } from '../context/AuthContext';
import type { Socket } from 'socket.io-client';
import type { UploadUpdateEvent } from '../types/websocket';


// ============================================================================
// Types
// ============================================================================

interface Upload {
  id: string;
  filename: string;
  status: string;
  statusCode: string;
  size: number;
  uploadedAt: string;
  deliveredTo: string | null;
}

// ============================================================================
// API Functions
// ============================================================================

const fetchUploads = async (): Promise<Upload[]> => {
  const baseUrl = apiConfig.getBaseUrl();
  const token = localStorage.getItem('token');
  
  const response = await fetch(`${baseUrl}/uploads?pageSize=100`, {
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
    return data.uploads.map((upload: any) => ({
      id: upload.Id || upload.id,
      filename: upload.OriginalFilename || upload.originalFilename,
      status: mapStatusToDisplay(upload.Status || upload.status),
      statusCode: upload.Status || upload.status,
      size: upload.FileSize || upload.fileSize || 0,
      uploadedAt: upload.UploadedAt || upload.uploadedAt,
      deliveredTo: upload.DeliveredTo || upload.deliveredTo || null,
    }));
  }
  
  return [];
};

// ============================================================================
// Utility Functions
// ============================================================================

const mapStatusToDisplay = (status: string): string => {
  const statusMap: Record<string, string> = {
    'UPLOADED': 'Pending',
    'VALIDATION_QUEUED': 'Pending',
    'VALIDATION_IN_PROGRESS': 'Processing',
    'VALIDATION_FAILED': 'Validation Failed',
    'VALIDATION_PASSED': 'Validation Passed',
    'DELIVERY_QUEUED': 'Pending',
    'DELIVERY_IN_PROGRESS': 'Processing',
    'DELIVERED': 'Delivered',
    'DELIVERY_FAILED': 'Failed',
  };
  return statusMap[status] || status;
};

// ============================================================================
// Component
// ============================================================================

export default function UploadHistory() {
  const { socket } = useAuth() as { socket: Socket | null };
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // WebSocket live updates
  useEffect(() => {
    if (!socket) return;

    const handleUploadUpdate = (data: UploadUpdateEvent) => {
      console.log('[WS HISTORY] Update:', data);
      loadUploads(); // Refresh list live
    };

    socket.on('uploadUpdate', handleUploadUpdate);
    return () => {
      socket.off('uploadUpdate', handleUploadUpdate);
    };
  }, [socket]);

  const loadUploads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchUploads();
      setUploads(data);
    } catch (err) {
      console.error('Error fetching uploads:', err);
      setError(err instanceof Error ? err.message : 'Failed to load uploads');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUploads();
  }, [loadUploads]);

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
      minute: '2-digit'
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Validation Passed':
      case 'Delivered':
        return 'bg-green-100 text-green-800';
      case 'Processing':
      case 'Pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'Failed':
      case 'Validation Failed':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="w-full">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-lg text-white">
            <History className="w-6 h-6" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Upload History</h1>
        </div>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-lg text-white">
            <History className="w-6 h-6" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Upload History</h1>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          <p className="font-medium">Error loading uploads</p>
          <p className="text-sm mt-1">{error}</p>
          <button 
            onClick={loadUploads}
            className="mt-3 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm flex items-center gap-2"
          >
            <RefreshCw size={16} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-lg text-white">
            <History className="w-6 h-6" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Upload History</h1>
        </div>
        <button 
          onClick={loadUploads}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>
      
      {uploads.length === 0 ? (
        <div className="bg-white shadow rounded-lg p-8 text-center">
          <p className="text-gray-500 mb-4">No uploads found.</p>
          <Link 
            to="/upload" 
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm inline-block"
          >
            Upload your first file
          </Link>
        </div>
      ) : (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Filename</th>
                  <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
                  <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Uploaded At</th>
                  <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Destination</th>
                  <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {uploads.map((upload) => (
                  <tr key={upload.id} className="hover:bg-gray-50">
                    <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{upload.filename}</td>
                    <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(upload.status)}`}>
                        {upload.status}
                      </span>
                    </td>
                    <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatFileSize(upload.size)}</td>
                    <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatDate(upload.uploadedAt)}</td>
                    <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-500 max-w-xs truncate" title={upload.deliveredTo || undefined}>
                      {upload.deliveredTo ? upload.deliveredTo.split(',')[0] || '-' : '-'}
                    </td>
                    <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm">
                      <Link to={`/history/${upload.id}`} className="text-blue-600 hover:text-blue-900 font-medium">View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
