import type { ReactNode } from 'react';
import type { UploadDetail } from './types';

const InfoItem = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-tight mb-1">{label}</p>
    <p className="text-[13px] font-bold text-gray-700">{value}</p>
  </div>
);

interface UploadStatusCardProps {
  upload: UploadDetail;
  /** Colours of the status badge. */
  badgeClassName: string;
  caption?: string;
  children?: ReactNode;
}

/** The "Status" card: status badge, key facts about the upload and (optionally) the delivery section. */
export default function UploadStatusCard({ upload, badgeClassName, caption, children }: UploadStatusCardProps) {
  return (
    <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-sm font-bold text-gray-800">Status</h3>
        <span className={`${badgeClassName} text-[10px] px-2 py-1 rounded font-bold uppercase`}>
          {upload.status}
        </span>
      </div>
      
      {caption && <p className="text-xs text-gray-500 mb-6 font-medium">{caption}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-8">
        <InfoItem label="File Size" value={upload.fileSize} />
        <InfoItem label="Row Count" value={upload.rowCount.toLocaleString()} />
        <InfoItem label="Uploaded" value={upload.uploaded} />
        <InfoItem label="Validated" value={upload.validated || '-'} />
        <InfoItem label="Definition" value={upload.definitionName} />
        <InfoItem label="Definition Version" value={upload.definitionVersion ? `v${upload.definitionVersion}` : 'Unversioned'} />
      </div>

      {children}
    </section>
  );
}
