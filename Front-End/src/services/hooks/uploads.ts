import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteUpload,
  getRecentUploads,
  getUploads,
  retryValidation,
  startVerification,
  uploadFile,
} from '../uploadApi';
import { invalidateUploadLists, invalidateUploads, queryKeys } from '../queryKeys';

// Upload status changes through background validation, so these are always re-read when a page mounts.
export const useUploadsQuery = (page: number) =>
  useQuery({ queryKey: queryKeys.uploads.list(page), queryFn: () => getUploads(page), staleTime: 0 });

export const useRecentUploadsQuery = (limit: number, enabled: boolean = true) =>
  useQuery({
    queryKey: queryKeys.uploads.recent(limit),
    queryFn: () => getRecentUploads(limit),
    staleTime: 0,
    enabled,
  });

export const useUploadFileMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ file, definitionId }: { file: File; definitionId: string }) => uploadFile(file, definitionId),
    onSuccess: () => { void invalidateUploads(client); },
  });
};

export const useStartVerificationMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (uploadId: string) => startVerification(uploadId),
    onSuccess: () => { void invalidateUploads(client); },
  });
};

export const useRetryValidationMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (uploadId: string) => retryValidation(uploadId),
    onSuccess: () => { void invalidateUploads(client); },
  });
};

export const useDeleteUploadMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (uploadId: string) => deleteUpload(uploadId),
    onSuccess: () => { void invalidateUploadLists(client); },
  });
};
