import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadTemplate } from './definitionApi';

afterEach(() => vi.unstubAllGlobals());

describe('downloadTemplate', () => {
  it('calls the backend template route for the definition', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'tkn' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: 'No template available for this definition' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(downloadTemplate('def/1')).rejects.toThrow('No template available for this definition');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/definitions/def%2F1/template');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tkn');
  });
});
