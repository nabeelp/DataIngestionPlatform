import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { UploadDetail } from './types';

interface UploadHeaderProps {
  upload: Pick<UploadDetail, 'filename' | 'fileType'>;
  historyBase: string;
  actions: ReactNode;
}

/** Back link, file name and type; the page supplies the status-specific actions. */
export function UploadHeader({ upload, historyBase, actions }: UploadHeaderProps) {
  return (
    <div className="flex justify-between items-start">
      <div>
        <Link to={historyBase} className="text-xs text-blue-600 hover:underline mb-2 inline-block">
          ← Back to Upload History
        </Link>
        <h2 className="text-xl font-bold text-[#1e293b]">{upload.filename}</h2>
        <p className="text-xs text-gray-400 font-medium">{upload.fileType}</p>
      </div>
      {actions}
    </div>
  );
}

export function ActionMessage({ message }: { message: { type: 'success' | 'error'; text: string } | null }) {
  if (!message) return null;
  return (
    <div role="alert" className={`p-3 rounded text-sm ${
      message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
    }`}>
      {message.text}
    </div>
  );
}

interface DeleteButtonProps {
  onClick: () => void;
  disabled: boolean;
}

export function DeleteButton({ onClick, disabled }: DeleteButtonProps) {
  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-1.5 border border-red-200 text-red-500 text-xs font-bold rounded hover:bg-red-50 transition disabled:opacity-50"
    >
      Delete
    </button>
  );
}
