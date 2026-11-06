import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatRecentUpload } from './user-dashboard/dashboardModel';
import { selectUploadRecords, toUploadRecord } from './upload-page/uploadPageApi';
import { getUploads, startVerification, uploadFile, type IUpload } from '../services/uploadApi';

const upload = (overrides: Partial<IUpload> = {}): IUpload => ({
  Id: 'u1',
  FileDefinitionId: 'd1',
  UploadedBy: 'user-1',
  OriginalFilename: 'orders.csv',
  StoredFilename: 'u1_orders.csv',
  FileSize: 1536,
  FileType: 'csv',
  RowCountNo: 40,
  SheetCount: 1,
  Status: 'VALIDATION_IN_PROGRESS',
  UploadedAt: '2026-10-03T08:00:00.000Z',
  ValidationStartedAt: null,
  ValidationCompletedAt: null,
  DeliveryStartedAt: null,
  DeliveryCompletedAt: null,
  DeliveredTo: null,
  DeliveredAt: null,
  ErrorMessage: null,
  DefinitionName: 'Orders',
  DefinitionVersionNumber: 3,
  ...overrides,
});

beforeEach(() => vi.stubGlobal('localStorage', { getItem: () => 'tkn' }));
afterEach(() => vi.unstubAllGlobals());

describe('upload records', () => {
  it('maps the list rows to display records', () => {
    expect(toUploadRecord(upload())).toEqual({
      id: 'u1', filename: 'orders.csv', definitionId: 'd1', definitionName: 'Orders', definitionVersion: 3,
      size: 1536, rows: 40, status: 'Validation In Progress', uploadedAt: '2026-10-03T08:00:00.000Z',
      statusCode: 'VALIDATION_IN_PROGRESS',
    });
  });

  it('labels unversioned uploads and the delivery states', () => {
    const record = toUploadRecord(upload({ DefinitionName: undefined, DefinitionVersionNumber: null, Status: 'DELIVERY_QUEUED', RowCountNo: null }));
    expect(record).toMatchObject({ definitionName: 'Unknown definition', definitionVersion: null, rows: 0, status: 'Delivery Pending' });
  });

  it('keeps the page total with the mapped uploads', () => {
    const page = selectUploadRecords({ success: true, uploads: [upload()], total: 41, page: 1, pageSize: 20 });
    expect(page.total).toBe(41);
    expect(page.uploads).toHaveLength(1);
  });

  it('formats a recent upload for the dashboard', () => {
    const recent = formatRecentUpload(upload({ Status: 'DELIVERY_FAILED' }));
    expect(recent).toMatchObject({ id: 'u1', filename: 'orders.csv', status: 'Failed', variant: 'failed', statusCode: 'DELIVERY_FAILED' });
    expect(recent.info).toContain('1.5 KB');
  });
});

describe('upload API calls', () => {
  it('requests one page of uploads', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, uploads: [], total: 0, page: 2, pageSize: 20 })));
    vi.stubGlobal('fetch', fetchMock);
    await getUploads(2);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/uploads?page=2&pageSize=20');
  });

  it('uploads as multipart FormData with the definition id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, upload: upload(), message: 'queued' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadFile(new File(['a,b'], 'orders.csv'), 'd1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/uploads');
    expect(init.method).toBe('POST');
    expect((init.body as FormData).get('definitionId')).toBe('d1');
    expect(init.headers).toEqual({ Authorization: 'Bearer tkn' });
    expect(result.upload.Id).toBe('u1');
  });

  it('shows the server reason when an action is refused, else a fixed message', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, message: 'Cannot start validation. Current status: DELIVERED' }), { status: 400 }))
      .mockResolvedValueOnce(new Response('oops', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(startVerification('u/1')).rejects.toThrow('Cannot start validation. Current status: DELIVERED');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/uploads/u%2F1/verify');
    await expect(startVerification('u1')).rejects.toThrow('Failed to start verification');
  });
});
