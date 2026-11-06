import { AlertCircle, CheckCircle, ChevronLeft, ChevronRight, Clock, FileText, RefreshCw, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { roleBasePath } from '../../config/routes';
import type { UploadRecord } from './uploadPageApi';

export const HISTORY_PAGE_SIZE = 20;

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

interface UploadHistoryPanelProps {
  uploads: UploadRecord[];
  loading: boolean;
  role: string | undefined;
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  onRefresh: () => void;
  page: number;
  total: number;
  onPageChange: (updater: (page: number) => number) => void;
}

/** The "Upload History" panel: search, status filter, list of uploads and paging. */
export default function UploadHistoryPanel({
  uploads,
  loading,
  role,
  searchTerm,
  onSearchTermChange,
  statusFilter,
  onStatusFilterChange,
  onRefresh,
  page,
  total,
  onPageChange,
}: UploadHistoryPanelProps) {
  const pageCount = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));

  return (
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
            onClick={onRefresh}
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
              onChange={(e) => onSearchTermChange(e.target.value)}
              className="w-full border border-slate-200 rounded-lg pl-4 pr-4 py-2 outline-none text-sm focus:border-blue-400"
            />

          </div>

          <div className="flex gap-2">

            {['All', 'Validation Passed', 'Validation Failed'].map(
              (status) => (
                <button
                  key={status}
                  onClick={() => onStatusFilterChange(status)}
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
          ) : uploads.length === 0 ? (
            <div className="p-10 text-center text-slate-400">
              No upload history found
            </div>
          ) : (
            uploads.map((item) => (
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
                    to={`${roleBasePath(role)}/history/${item.id}`}
                    className="text-blue-600 hover:text-blue-800 font-semibold"
                  >
                    View
                  </Link>
                </div>

              </div>
            ))
          )}

        </div>

        {total > HISTORY_PAGE_SIZE && (
          <nav aria-label="Upload history pages" className="flex items-center justify-between border-t border-slate-100 p-4">
            <p className="text-sm text-slate-500">Page {page} of {pageCount} · {total} uploads</p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page === 1}
                onClick={() => onPageChange(current => Math.max(1, current - 1))}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium disabled:opacity-40"
              >
                <ChevronLeft size={16} /> Previous
              </button>
              <button
                type="button"
                disabled={page === pageCount}
                onClick={() => onPageChange(current => Math.min(pageCount, current + 1))}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium disabled:opacity-40"
              >
                Next <ChevronRight size={16} />
              </button>
            </div>
          </nav>
        )}

      </main>
  );
}
