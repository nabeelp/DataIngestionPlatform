import path from 'path';
import { normalizeDeliveryFolder, resolveDeliveryDestination, assertInsideDeliveryRoot, getDeliveryTargets, getDeliveryRoot } from '../src/services/DeliveryTargets.service';
import { sanitizeFilename, assertSafeTemplateName, getTemplateDisplayName } from '../src/services/TemplateStorage.service';

describe('delivery folders', () => {
    it('normalizes valid relative folders', () => {
        expect(normalizeDeliveryFolder(' finance\\customers/ ')).toBe('finance/customers');
        expect(normalizeDeliveryFolder('')).toBeNull();
        expect(normalizeDeliveryFolder(null)).toBeNull();
    });

    it.each(['../etc', 'a/../../b', 'C:\\Windows', 'a/./b', 'bad|name'])('rejects %p', (folder) => {
        expect(() => normalizeDeliveryFolder(folder)).toThrow();
    });

    it('builds destinations inside the delivery root', () => {
        const destination = resolveDeliveryDestination('finance', 'abc', '../../evil.csv');
        expect(destination).toBe(path.join(getDeliveryRoot(), 'finance', 'abc_evil.csv'));
        expect(() => assertInsideDeliveryRoot(path.join(getDeliveryRoot(), '..', 'x.csv'))).toThrow();
    });

    it('returns no targets when a definition has no folder', () => {
        expect(getDeliveryTargets({ DeliveryFolder: null })).toEqual([]);
        expect(getDeliveryTargets({ DeliveryFolder: 'out' })).toEqual([{ type: 'FileCopy', folder: 'out', name: 'out' }]);
    });
});

describe('template names', () => {
    it('sanitizes user filenames', () => {
        expect(sanitizeFilename('..\\..\\secret file (1).xlsx')).toBe('secret_file_1_.xlsx');
        expect(sanitizeFilename('/etc/passwd')).toBe('passwd');
        expect(sanitizeFilename('...')).toBe('file');
    });

    it('rejects stored names that could escape the folder', () => {
        expect(() => assertSafeTemplateName('../x.xlsx')).toThrow();
        expect(() => assertSafeTemplateName('a/b.xlsx')).toThrow();
        expect(() => assertSafeTemplateName('ok__template.xlsx')).not.toThrow();
    });

    it('strips the unique prefix for display', () => {
        expect(getTemplateDisplayName('1234-abcd__Customer Template.xlsx')).toBe('Customer Template.xlsx');
        expect(getTemplateDisplayName('legacy-name.xlsx')).toBe('legacy-name.xlsx');
    });
});
