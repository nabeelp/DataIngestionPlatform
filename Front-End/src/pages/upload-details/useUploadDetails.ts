import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { NavigateFunction } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { ApiError } from '../../services/http';
import {
  useDeleteUploadMutation,
  useRetryValidationMutation,
  useStartVerificationMutation,
} from '../../services/hooks/uploads';
import { queryKeys } from '../../services/queryKeys';
import { downloadUploadDelivery, downloadUploadReport } from '../../services/uploadApi';
import { useUploadDetailsQuery } from './uploadDetailsApi';

type ActionMessageState = { type: 'success' | 'error'; text: string } | null;

interface Options {
  id: string | undefined;
  socket: Socket | null;
  navigate: NavigateFunction;
  historyBase: string;
}

const RELOAD_AFTER_ACTION_MS = 2000;
const PROGRESS_REFRESH_MS = 1000;

const actionError = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** Loads one upload (with live progress refreshes) and exposes its verify/retry/delete/download actions. */
export function useUploadDetails({ id, socket, navigate, historyBase }: Options) {
  const queryClient = useQueryClient();
  const query = useUploadDetailsQuery(id);
  const upload = query.data ?? null;
  const loading = query.isPending;
  const error = !upload && query.isError ? query.error.message || 'Failed to load upload details' : null;
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<ActionMessageState>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [deliveryLoadingId, setDeliveryLoadingId] = useState<string | null>(null);
  const { mutateAsync: verifyUpload } = useStartVerificationMutation();
  const { mutateAsync: retryUpload } = useRetryValidationMutation();
  const { mutateAsync: removeUpload } = useDeleteUploadMutation();

  const refreshDetails = useCallback(() => {
    if (id) void queryClient.invalidateQueries({ queryKey: queryKeys.uploads.detail(id) });
  }, [id, queryClient]);

  // Live updates: subscribe to this upload and refresh (at most once per second) on progress events.
  useEffect(() => {
    if (!socket || !id) return;

    let pending: ReturnType<typeof setTimeout> | null = null;
    const subscribe = () => socket.emit('subscribeToUpload', id);
    const handleProgress = (event: { uploadId?: string }) => {
      if (event?.uploadId?.toLowerCase() !== id.toLowerCase() || pending) return;
      pending = setTimeout(() => {
        pending = null;
        refreshDetails();
      }, PROGRESS_REFRESH_MS);
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
  }, [socket, id, refreshDetails]);

  const runAction = async (
    action: (uploadId: string) => Promise<{ message: string }>,
    messages: { success: string; failure: string },
  ) => {
    if (!id || !upload) return;

    setActionLoading(true);
    setActionMessage(null);
    try {
      const result = await action(id);
      setActionMessage({ type: 'success', text: result.message || messages.success });
      setTimeout(refreshDetails, RELOAD_AFTER_ACTION_MS);
    } catch (err) {
      setActionMessage({ type: 'error', text: actionError(err, messages.failure) });
    } finally {
      setActionLoading(false);
    }
  };

  const handleVerify = () => runAction(verifyUpload, { success: 'Verification started!', failure: 'Failed to start verification' });

  const handleRetry = () => runAction(retryUpload, { success: 'Retry started!', failure: 'Failed to retry validation' });

  const handleDelete = async () => {
    if (!id || !upload) return;
    
    if (!confirm('Are you sure you want to delete this upload?')) return;
    
    setActionLoading(true);
    setActionMessage(null);
    try {
      await removeUpload(id);
      navigate(historyBase);
    } catch (err) {
      setActionMessage({ type: 'error', text: actionError(err, 'Failed to delete upload') });
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
