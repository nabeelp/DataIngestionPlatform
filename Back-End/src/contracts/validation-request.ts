/* This file is generated from contracts/*.schema.json. Do not edit. */

export interface ValidationRequest {
  schemaVersion: 1;
  uploadId: string;
  definitionVersionId: string;
  blob: {
    container: string;
    name: string;
  };
  fileType: 'csv' | 'tsv' | 'txt' | 'xlsx' | 'xlsm' | 'xls' | 'xlsb';
  requestedAt: string;
  correlationId: string;
}
