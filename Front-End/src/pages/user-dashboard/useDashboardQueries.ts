import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../services/queryKeys';
import { getRecentUploads, type IRecentUploadsResponse } from '../../services/uploadApi';
import { fetchDashboard, formatRecentUpload, type FormattedUpload } from './dashboardModel';

const selectRecentUploads = (response: IRecentUploadsResponse): FormattedUpload[] =>
  response.uploads.map(formatRecentUpload);

/** KPIs and activity for the chosen period; the previous period stays on screen while the next loads. */
export const useUserDashboardQuery = (days: number) =>
  useQuery({
    queryKey: queryKeys.dashboard.user(days),
    queryFn: () => fetchDashboard(days),
    staleTime: 0,
    placeholderData: keepPreviousData,
  });

export const useRecentUploadsListQuery = (limit: number) =>
  useQuery({
    queryKey: queryKeys.uploads.recent(limit),
    queryFn: () => getRecentUploads(limit),
    select: selectRecentUploads,
    staleTime: 0,
  });
