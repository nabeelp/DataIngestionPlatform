/* This file is generated from contracts/*.schema.json. Do not edit. */

export interface ValidationEvent {
  schemaVersion: 1;
  uploadId: string;
  type: 'progress' | 'completed' | 'failed';
  stage: 'download' | 'sniff' | 'parse' | 'rules' | 'persist';
  percent: number;
  summary?: {
    status: 'PASSED' | 'WARNING' | 'FAILED';
    passed: number;
    failed: number;
    warnings: number;
    rowCount: number;
  };
  error?: string;
}
