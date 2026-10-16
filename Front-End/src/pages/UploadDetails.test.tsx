import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchUploadDetails, UploadValidationResults } from './UploadDetails';
import { mapValidationCheckStatus, parseValidationIssues } from './validationIssues';

afterEach(() => vi.unstubAllGlobals());

describe('upload details mapping', () => {
  it('maps persisted engine issues and sorts sheets numerically in workbook order', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'test-token' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      upload: { Id: 'upload-1', Status: 'VALIDATION_FAILED', UploadedAt: '2026-10-03' },
      sheets: [
        { SheetIndex: 10, SheetName: 'Tenth', Status: 'VALIDATED' },
        { SheetIndex: 2, SheetName: 'Second', Status: 'FAILED' },
        { SheetIndex: 0, SheetName: 'First', Status: 'VALIDATED' },
      ],
      ruleDetails: [{
        RuleName: 'Execution error', RuleType: 'naturalLanguage', Sheet: 'Second',
        Status: 'ERROR', IssueCount: 1, ElapsedMs: 7,
        Issues: '[{"row":null,"column":null,"value":null,"message":"Check unavailable"}]',
      }, {
        RuleName: 'Range warning', RuleType: 'range', Sheet: 'Tenth',
        Status: 'WARNING', IssueCount: 1, ElapsedMs: 3,
        Issues: '[{"row":4,"column":"Total","value":0,"message":"Outside range"}]',
      }],
    })));
    vi.stubGlobal('fetch', fetchMock);
    const upload = await fetchUploadDetails('upload-1');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/uploads/upload-1', expect.objectContaining({
      method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
    }));
    expect(upload.sheets.map(sheet => sheet.name)).toEqual(['First', 'Second', 'Tenth']);
    expect(upload.rules[0]).toMatchObject({
      status: 'Error', errorCount: 1, time: '7ms',
      errors: [{ rowNumber: undefined, column: '', value: '', error: 'Check unavailable' }],
    });
    expect(upload.rules[1]).toMatchObject({ status: 'Warning', errorCount: 1, time: '3ms' });
    expect(upload.rules[1].errors?.[0].rowNumber).toBe(4);
  });

  it('preserves upload fetch access and API error handling', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    const fetchMock = vi.fn().mockResolvedValue(new Response('Access denied', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchUploadDetails('upload-1')).rejects.toThrow('Failed to fetch upload details');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: false, message: 'Upload unavailable' })));
    await expect(fetchUploadDetails('upload-1')).rejects.toThrow('Upload unavailable');
  });
});

const check = (title: string, sheet: string | null, type: string, status: string) => ({
  title, sheet, type, status: mapValidationCheckStatus(status),
});

const renderResults = (reportLoading = false) => renderToStaticMarkup(
  <UploadValidationResults
    upload={{
      id: 'upload/1',
      status: 'Validation Failed',
      sheets: [
        { index: '0', name: 'First', rows: 5, status: 'Failed', deliveryPath: '' },
        { index: '1', name: 'Second', rows: 2, status: 'Validated', deliveryPath: '' },
      ],
      rules: [
        check('Second sheet check', 'Second', 'required', 'PASSED'),
        check('Failed data check', 'First', 'range', 'FAILED'),
        {
          ...check('Structure check', null, 'structural', 'FAILED'),
          errorCount: 1,
          errors: parseValidationIssues('[{"row":null,"message":"Missing sheet"}]'),
        },
        {
          ...check('Execution error', 'First', 'naturalLanguage', 'ERROR'),
          errorCount: 4,
          errors: parseValidationIssues('[{"row":null,"message":"Check unavailable"},{"row":7,"column":"Total","value":0,"message":"Invalid total"}]'),
        },
        {
          ...check('Warning check', 'Second', 'range', 'WARNING'),
          errorCount: 12,
          errors: Array.from({ length: 12 }, (_, index) => ({
            rowNumber: index + 1, column: 'Total', value: '0', error: 'Warning sample',
          })),
        },
      ],
    }}
    reportLoading={reportLoading}
    onDownloadReport={() => {}}
  />,
);

describe('upload validation results rendering', () => {
  it('groups checks in workbook order with structural issues first', () => {
    const html = renderResults();
    expect(html.indexOf('Structure check')).toBeLessThan(html.indexOf('Failed data check'));
    expect(html.indexOf('Failed data check')).toBeLessThan(html.indexOf('Second sheet check'));
    expect(html.match(/Second sheet check/g)).toHaveLength(1);
    expect(html).toContain('All sheets');
  });

  it('renders ERROR distinctly, file-level scope and actual sample counts', () => {
    const html = renderResults();
    expect(html).toContain('>ERROR</span>');
    expect(html).toContain('This check could not complete.');
    expect(html).toContain('File-level</td>');
    expect(html).toContain('Missing sheet');
    expect(html).toContain('Check unavailable');
    expect(html).not.toContain('failed row');
    expect(html).toContain('showing 2 of 4');
    expect(html).toContain('showing 10 of 12');
    expect(html.match(/Warning sample/g)).toHaveLength(10);
    expect(html).toContain('>7</td>');
  });

  it('renders the report route without putting a token in the URL', () => {
    expect(renderResults()).toContain('href="/api/v1/uploads/upload%2F1/report"');
    expect(renderResults()).toContain('Download full issues report');
    expect(renderResults(true)).toContain('aria-disabled="true"');
    expect(renderResults(true)).toContain('Downloading issues report...');
  });
});
