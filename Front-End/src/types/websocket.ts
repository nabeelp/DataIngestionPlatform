/**
 * Events emitted by the backend Socket.IO server (see Back-End/src/websocket/socketServer.ts).
 */
export type UploadEventType =
  | 'VALIDATION_UPDATE'
  | 'VALIDATION_PASSED'
  | 'VALIDATION_FAILED'
  | 'VALIDATION_COMPLETE'
  | 'VALIDATED'
  | 'DELIVERY_UPDATE'
  | 'DELIVERED'
  | 'DELIVERY_FAILED';

export interface UploadProgressEvent {
  uploadId: string;
  type: UploadEventType;
  progress?: number;
  details?: {
    currentRule?: string;
    progress?: number;
    status?: string;
    passedRules?: number;
    failedRules?: number;
    warningRules?: number;
    error?: string;
  };
}

export interface UploadUpdateEvent {
  uploadId: string;
  type: UploadEventType;
  progress?: number;
}
