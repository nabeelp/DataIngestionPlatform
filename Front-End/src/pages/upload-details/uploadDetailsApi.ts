import { apiConfig } from '../../config/api';
import { normalizeUploadDetails } from './uploadDetailsModel';
import type { UploadDetail } from './types';

type ActionResult = { success: boolean; message: string };

const getAuthHeaders = (): HeadersInit => {
  const token = localStorage.getItem('token');
  return {
    'Authorization': token ? `Bearer ${token}` : '',
  };
};

export const fetchUploadDetails = async (id: string): Promise<UploadDetail> => {
  const baseUrl = apiConfig.getBaseUrl();
  
  const response = await fetch(`${baseUrl}/uploads/${id}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch upload details');
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch upload details');
  }

  return normalizeUploadDetails(data);
};

const postUploadAction = async (id: string, action: 'verify' | 'retry'): Promise<ActionResult> => {
  const baseUrl = apiConfig.getBaseUrl();
  
  const response = await fetch(`${baseUrl}/uploads/${id}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });

  return response.json();
};

export const startVerification = (id: string): Promise<ActionResult> => postUploadAction(id, 'verify');

export const retryValidation = (id: string): Promise<ActionResult> => postUploadAction(id, 'retry');

export const deleteUpload = async (id: string): Promise<ActionResult> => {
  const baseUrl = apiConfig.getBaseUrl();
  
  const response = await fetch(`${baseUrl}/uploads/${id}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });

  return response.json();
};
