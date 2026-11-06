import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createLookup, deleteLookup, getLookups, updateLookup, type LookupInput } from '../lookupApi';
import { invalidateLookups, queryKeys } from '../queryKeys';

export const useLookupsQuery = (search?: string) =>
  useQuery({ queryKey: queryKeys.lookups.list(search), queryFn: () => getLookups(search) });

/** Creates a lookup, or updates it when an id is given. */
export const useSaveLookupMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: LookupInput }) =>
      id ? updateLookup(id, input) : createLookup(input),
    onSuccess: () => { void invalidateLookups(client); },
  });
};

export const useDeleteLookupMutation = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteLookup(id),
    onSuccess: () => { void invalidateLookups(client); },
  });
};
