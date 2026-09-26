import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Plus, Download } from 'lucide-react';
import { apiConfig } from '../config/api';
import { useAuth } from '../context/AuthContext';
import { downloadTemplate } from '../services/definitionApi';

//#region INTERFACES
interface Column {
  name: string;
  type: string;
  required: boolean;
}

interface Definition {
  id: string;
  name: string;
  description: string;
  columns: Column[];
  status: string;
  createdAt: string;
  hasTemplate: boolean;
  versionNumber: number | null;
  versionActivatedAt: string | null;
}
//#endregion

export default function Definitions() {
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDef, setSelectedDef] = useState<Definition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const { user } = useAuth();
  const navigate = useNavigate();

  const isAdmin = user?.Role === 'admin';

  useEffect(() => {
    fetchDefinitions();
  }, []);

  const fetchDefinitions = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const baseUrl = apiConfig.getBaseUrl();
      const url = `${baseUrl}/definitions`;

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };

      // Add auth token if available
      const storedToken = localStorage.getItem('token');
      if (storedToken) {
        headers['Authorization'] = `Bearer ${storedToken}`;
      }

      const response = await fetch(url, { headers });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to fetch definitions');
      }

      const data = await response.json();
      
      if (data.success && data.definitions) {
        // Map API response to frontend format (camelCase to match existing UI)
        const mappedDefinitions = data.definitions.map((def: any) => ({
          id: def.Id || def.id,
          name: def.Name || def.name,
          description: def.Description || def.description,
          columns: def.Columns || def.columns || [],
          status: def.Status || def.status,
          createdAt: def.CreatedAt || def.createdAt,
          hasTemplate: Boolean(def.TemplateFilename || def.templateFilename),
          versionNumber: def.ActiveVersion?.versionNumber ?? null,
          versionActivatedAt: def.ActiveVersion?.activatedAt ?? null,
        }));
        setDefinitions(mappedDefinitions);
        
        // Select first definition if available
        if (mappedDefinitions.length > 0) {
          setSelectedDef(mappedDefinitions[0]);
        }
      } else {
        throw new Error('Invalid response format');
      }
    } catch (err) {
      console.error('Error fetching definitions:', err);
      setError(err instanceof Error ? err.message : 'Failed to load definitions');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getTypeColor = (type: string): string => {
    const colors: { [key: string]: string } = {
      string: 'bg-blue-100 text-blue-800',
      decimal: 'bg-green-100 text-green-800',
      datetime: 'bg-purple-100 text-purple-800',
      integer: 'bg-yellow-100 text-yellow-800',
      boolean: 'bg-gray-100 text-gray-800'
    };
    return colors[type] || 'bg-gray-100 text-gray-800';
  };

  const handleAddDefinition = () => {
    navigate('/admin/file-definitions');
  };

  const handleDownloadTemplate = async (definitionId: string) => {
    setDownloadError(null);
    try {
      await downloadTemplate(definitionId);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Failed to download template');
    }
  };

  if (loading) {
    return (
      <div className="w-full">
       <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-lg text-white">
            <FileText className="w-6 h-6" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">File Definitions</h1>
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
            <FileText className="w-6 h-6" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">File Definitions</h1>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          <p className="font-medium">Error loading definitions</p>
          <p className="text-sm mt-1">{error}</p>
          <button 
            onClick={fetchDefinitions}
            className="mt-3 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-lg text-white">
            <FileText className="w-6 h-6" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">File Definitions</h1>
        </div>
        {isAdmin && (
          <button 
            onClick={handleAddDefinition}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm flex items-center gap-2 w-full sm:w-auto justify-center"
          >
            <Plus size={16} />
            Add Definition
          </button>
        )}
      </div>

      {downloadError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700" role="alert">
          {downloadError}
        </div>
      )}

      {definitions.length === 0 ? (
        <div className="bg-white shadow rounded-lg p-8 text-center">
          <FileText size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500 mb-4">No file definitions found.</p>
          {isAdmin ? (
            <button 
              onClick={handleAddDefinition}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
            >
              Create your first definition
            </button>
          ) : (
            <p className="text-sm text-gray-400">Contact an admin to create file definitions.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <div className="bg-white shadow rounded-lg overflow-hidden">
            <div className="p-4 border-b border-gray-200">
              <h2 className="text-base sm:text-lg font-medium text-gray-900">Data Definitions</h2>
              <p className="text-xs sm:text-sm text-gray-500">Manage your data schemas</p>
            </div>
            <div className="divide-y divide-gray-200 max-h-[500px] overflow-y-auto">
              {definitions.map((def) => (
                <div
                  key={def.id}
                  onClick={() => setSelectedDef(def)}
                  className={`p-3 sm:p-4 cursor-pointer hover:bg-gray-50 ${selectedDef?.id === def.id ? 'bg-blue-50' : ''}`}
                >
                  <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 bg-blue-50 rounded-lg flex-shrink-0">
                      <FileText size={18} className="text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium text-gray-900 truncate">
                        {def.name}
                        {def.versionNumber && <span className="ml-2 text-[10px] font-semibold text-gray-500">v{def.versionNumber}</span>}
                      </h3>
                      <p className="text-xs text-gray-500 truncate">{def.description}</p>
                    </div>
                  </div>
                  <span className={`px-2 py-1 text-xs rounded-full flex-shrink-0 ml-2 ${
                    def.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {def.status}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {def.columns.slice(0, 3).map((col, idx) => (
                    <span key={idx} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                      {col.name}
                    </span>
                  ))}
                  {def.columns.length > 3 && (
                    <span className="text-[10px] px-1.5 py-0.5 text-gray-500">
                      +{def.columns.length - 3} more
                    </span>
                  )}
                </div>
                {def.hasTemplate && (
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-gray-400">Download template:</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownloadTemplate(def.id);
                      }}
                      className="p-1 rounded hover:bg-gray-100 text-blue-600 hover:text-blue-800"
                      title="Download Template"
                      aria-label={`Download template for ${def.name}`}
                    >
                      <Download size={16} />
                    </button>
                  </div>
                )}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white shadow rounded-lg overflow-hidden">
            {selectedDef ? (
              <div>
                <div className="p-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base sm:text-lg font-medium text-gray-900">{selectedDef.name}</h2>
                      <p className="text-xs sm:text-sm text-gray-500">{selectedDef.description}</p>
                    </div>
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      selectedDef.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                      {selectedDef.status}
                    </span>
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="text-sm font-medium text-gray-900 mb-3">Columns</h3>
                  <div className="space-y-2">
                    {selectedDef.columns.map((col, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium text-gray-900 truncate">{col.name}</span>
                          {col.required && (
                            <span className="text-[10px] text-red-500 flex-shrink-0">Required</span>
                          )}
                        </div>
                        <span className={`px-2 py-0.5 text-xs rounded-full flex-shrink-0 ml-2 ${getTypeColor(col.type)}`}>
                          {col.type}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    {selectedDef.versionNumber && (
                      <p className="text-xs text-gray-500 mb-1">
                        Version v{selectedDef.versionNumber}
                        {selectedDef.versionActivatedAt ? `, active since ${formatDate(selectedDef.versionActivatedAt)}` : ''}
                      </p>
                    )}
                    <p className="text-xs text-gray-500">Created: {formatDate(selectedDef.createdAt)}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-6 sm:p-8 text-center">
                <FileText size={48} className="mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500">Select a definition to view details</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

