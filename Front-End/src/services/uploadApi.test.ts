import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadUploadReport } from './uploadApi';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('downloadUploadReport', () => {
  it('downloads using an authenticated GET and cleans up the object URL', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', { getItem: () => 'test-token' });
    const blob = new Blob(['rule,row,error']);
    const fetchMock = vi.fn().mockResolvedValue(new Response(blob, {
      headers: { 'Content-Disposition': 'attachment; filename="issues.csv"' },
    }));
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    const appendChild = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('document', { createElement: () => link, body: { appendChild } });
    const createObjectURL = vi.fn().mockReturnValue('blob:report');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    await downloadUploadReport('upload/1');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/uploads/upload%2F1/report', {
      method: 'GET', headers: { Authorization: 'Bearer test-token' },
    });
    expect(link.href).toBe('blob:report');
    expect(link.download).toBe('issues.csv');
    expect(appendChild).toHaveBeenCalledWith(link);
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
  });

  it.each([401, 403, 404, 500])('surfaces HTTP %s without creating a download', async status => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: 'Report unavailable' }),
      { status, headers: { 'Content-Type': 'application/json' } },
    )));
    const createElement = vi.fn();
    vi.stubGlobal('document', { createElement });
    await expect(downloadUploadReport('upload-1')).rejects.toThrow('Report unavailable');
    expect(createElement).not.toHaveBeenCalled();
  });

  it('surfaces non-JSON and network failures', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    const fetchMock = vi.fn().mockResolvedValue(new Response('Gateway unavailable', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(downloadUploadReport('upload-1')).rejects.toThrow('HTTP 502');
    fetchMock.mockRejectedValueOnce(new Error('Network unavailable'));
    await expect(downloadUploadReport('upload-1')).rejects.toThrow('Network unavailable');
  });

  it('uses a CSV fallback filename and cleans up even when the browser download fails', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', { getItem: () => null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('report')));
    const link = {
      href: '', download: '',
      click: vi.fn(() => { throw new Error('Download blocked'); }),
      remove: vi.fn(),
    };
    vi.stubGlobal('document', { createElement: () => link, body: { appendChild: vi.fn() } });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:report', revokeObjectURL });
    await expect(downloadUploadReport('upload-1')).rejects.toThrow('Download blocked');
    expect(link.download).toBe('upload-1-issues.csv');
    expect(link.remove).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
  });
});
