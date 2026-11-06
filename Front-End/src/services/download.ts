import { apiDownload, type DownloadOptions } from './http';

/** Hands a blob to the browser as a file download and always releases the temporary link and object URL. */
export const saveBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
};

/** Downloads an API file with the session's bearer token (a plain link could not send it) and saves it. */
export const downloadApiFile = async (path: string, options: DownloadOptions): Promise<void> => {
  const { blob, filename } = await apiDownload(path, options);
  saveBlob(blob, filename);
};
