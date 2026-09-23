export interface UploadProgressEvent {
  uploadId: string;
  progress: number;
  status: string;
  message?: string;
  currentRule?: string;
  failedRules: number;
  totalRules: number;
  rowCount: number;
  sheetCount: number;
}

export interface UploadUpdateEvent {
  uploadId: string;
  status: string;
  filename: string;
  progress: number;
  rows: number;
}

export type WebsocketEvents = 
  | 'uploadProgress'
  | 'uploadUpdate'
  | 'uploadComplete';
