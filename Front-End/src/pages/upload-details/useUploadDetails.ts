import { useCallback, useEffect, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { downloadUploadDelivery, downloadUploadReport } from '../../services/uploadApi';
import type { UploadDetail } from './types';
import { deleteUpload, fetchUploadDetails, retryValidation, startVerification } from './uploadDetailsApi';

type ActionMessageState = { type: 'success' | 'error'; text: string } | null;

interface Options {
  id: string | undefined;
  socket: Socket | null;
  navigate: NavigateFunction;
  historyBase: string;
}

/** Loads one upload (with live progress refreshes) and exposes its verify/retry/delete/download actions. */
export function useUploadDetails({ id, socket, navigate, historyBase }: Options) {
  const [upload, setUpload] = useState<UploadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<ActionMessageState>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [deliveryLoadingId, setDeliveryLoadingId] = useState<string | null>(null);

  const loadUploadDetails = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!id) return;
    
    if (!options.silent) setLoading(true);
    setError(null);
    try {
      const details = await fetchUploadDetails(id);
      setUpload(details);
    } catch (err) {
      console.error('Failed to fetch upload details');
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

  const handleDownloadReport = async () => {
    if (!id || reportLoading) return;
    setReportLoading(true);
    setActionMessage(null);
    try {
      await downloadUploadReport(id);
    } catch (err) {
      setActionMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to download issues report' });
    } finally {
      setReportLoading(false);
    }
  };

  const handleDownloadDelivery = async (deliveryId: string) => {
    if (!id || deliveryLoadingId) return;
    setDeliveryLoadingId(deliveryId);
    setActionMessage(null);
    try {
      await downloadUploadDelivery(id, deliveryId);
    } catch (err) {
      setActionMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to download delivery output' });
    } finally {
      setDeliveryLoadingId(null);
    }
  };

  return {
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
  };
}
