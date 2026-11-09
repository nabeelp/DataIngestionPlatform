import type { UploadDetail } from './types';

interface UploadDeliverySectionProps {
  deliveredTo: string;
  deliveryRecords: UploadDetail['deliveryRecords'];
  deliveryLoadingId: string | null;
  onDownloadDelivery: (deliveryId: string) => void;
}

/** Delivery destination and the downloads of delivered outputs. */
export default function UploadDeliverySection({
  deliveredTo,
  deliveryRecords,
  deliveryLoadingId,
  onDownloadDelivery,
}: UploadDeliverySectionProps) {
  return (
    <div className="mt-8 pt-6 border-t border-gray-50">
      <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide">Delivery Destination:</p>
      <p className="mt-1 text-sm font-medium text-gray-800 break-words max-w-md">
        {deliveredTo || 'Not specified'}
      </p>
      {deliveryRecords.filter(record => record.status === 'DELIVERED').map(record => (
        <button
          key={record.id}
          type="button"
          onClick={() => onDownloadDelivery(record.id)}
          disabled={deliveryLoadingId !== null}
          className="mt-3 mr-3 text-xs text-blue-600 hover:underline disabled:opacity-50"
        >
          {deliveryLoadingId === record.id ? 'Downloading...' : `Download ${record.filename}`}
        </button>
      ))}
    </div>
  );
}
