import { useQuery } from '@tanstack/react-query';
import { getUploadDetails } from '../../services/uploadApi';
import { queryKeys } from '../../services/queryKeys';
import { normalizeUploadDetails } from './uploadDetailsModel';
import type { UploadDetail } from './types';

export const fetchUploadDetails = async (id: string, signal?: AbortSignal): Promise<UploadDetail> =>
  normalizeUploadDetails(await getUploadDetails(id, signal));

/** One upload with its validation and delivery details; refreshed by the page when progress events arrive. */
export const useUploadDetailsQuery = (id: string | undefined) =>
  useQuery({
    queryKey: queryKeys.uploads.detail(id ?? ''),
    queryFn: ({ signal }) => fetchUploadDetails(id ?? '', signal),
    enabled: Boolean(id),
    staleTime: 0,
  });
