import { Link, useNavigate, useParams } from 'react-router-dom';
import { roleBasePath } from '../config/routes';
import { useAuth } from '../context/AuthContext';
import SheetSummaryTable from './upload-details/SheetSummaryTable';
import UploadDeliverySection from './upload-details/UploadDeliverySection';
import { ActionMessage, DeleteButton, UploadHeader } from './upload-details/UploadHeader';
import UploadStatusCard from './upload-details/UploadStatusCard';
import { UploadValidationResults } from './upload-details/UploadValidationResults';
import { canDelete, canRetry, canVerify } from './upload-details/uploadDetailsModel';
import { useUploadDetails } from './upload-details/useUploadDetails';

export { fetchUploadDetails } from './upload-details/uploadDetailsApi';
export { UploadValidationResults } from './upload-details/UploadValidationResults';

const UploadDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { socket, user } = useAuth();
  const historyBase = user?.Role === 'admin' ? '/admin/history' : '/history';
  const {
    upload,
    loading,
    error,
    actionLoading,
    actionMessage,
    reportLoading,
    deliveryLoadingId,
    handleVerify,
    handleRetry,
    handleDelete,
    handleDownloadReport,
    handleDownloadDelivery,
  } = useUploadDetails({ id, socket, navigate, historyBase });

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
        <UploadHeader
          upload={upload}
          historyBase={historyBase}
          actions={(
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
              {canDelete(upload.statusCode) && <DeleteButton onClick={handleDelete} disabled={actionLoading} />}
            </div>
          )}
        />

        <ActionMessage message={actionMessage} />

        <UploadStatusCard
          upload={upload}
          badgeClassName="bg-[#fef2f2] text-[#ef4444]"
          caption="Validation Failed"
        />

        {validationResults}
      </div>
    );
  }

  // Render pending/processing view
  if (isProcessing || isPending) {
    return (
      <div className="max-w-[1600px] mx-auto space-y-6 p-8">
        <UploadHeader
          upload={upload}
          historyBase={historyBase}
          actions={(
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
              {canDelete(upload.statusCode) && <DeleteButton onClick={handleDelete} disabled={actionLoading} />}
            </div>
          )}
        />

        <ActionMessage message={actionMessage} />

        <UploadStatusCard upload={upload} badgeClassName="bg-[#fffbeb] text-[#f59e0b]" />
        {upload.rules.length > 0 && validationResults}
      </div>
    );
  }

  // Render success/delivered view
  const sheetCount = upload.sheets.length;

  return (
    <div className="max-w-[1600px] mx-auto space-y-6">
      <UploadHeader
        upload={upload}
        historyBase={historyBase}
        actions={<DeleteButton onClick={handleDelete} disabled={actionLoading} />}
      />

      <ActionMessage message={actionMessage} />

      <UploadStatusCard
        upload={upload}
        badgeClassName="bg-[#f0fdf4] text-[#22c55e]"
        caption={`${upload.statusCode === 'DELIVERED' ? 'Delivered' : 'Validated'} ${sheetCount} sheet(s)`}
      >
        <UploadDeliverySection
          deliveredTo={upload.deliveredTo}
          deliveryRecords={upload.deliveryRecords}
          deliveryLoadingId={deliveryLoadingId}
          onDownloadDelivery={handleDownloadDelivery}
        />
      </UploadStatusCard>

      {sheetCount > 0 && <SheetSummaryTable sheets={upload.sheets} />}

      {validationResults}
    </div>
  );
};

export default UploadDetails;
