import { apiRequest } from './http';

export interface Lookup {
  id: string;
  name: string;
  description: string;
  values: string[];
  createdAt: string;
  updatedAt: string;
}

export interface LookupInput {
  name: string;
  description: string;
  values: string[];
}

export const getLookups = async (search?: string): Promise<Lookup[]> => {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
  const data = await apiRequest<{ lookups: Lookup[] }>(`/lookups${query}`);
  return data.lookups;
};

export const createLookup = async (input: LookupInput): Promise<Lookup> =>
  (await apiRequest<{ lookup: Lookup }>('/lookups', { method: 'POST', body: input })).lookup;

export const updateLookup = async (id: string, input: LookupInput): Promise<Lookup> =>
  (await apiRequest<{ lookup: Lookup }>(`/lookups/${encodeURIComponent(id)}`, { method: 'PUT', body: input })).lookup;

export const deleteLookup = async (id: string): Promise<void> => {
  await apiRequest(`/lookups/${encodeURIComponent(id)}`, { method: 'DELETE' });
};
