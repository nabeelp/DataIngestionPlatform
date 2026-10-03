import type { Request, Response } from 'express';
import type { DefinitionContract } from '../src/contracts/definition-contract';
import { UploadController } from '../src/controllers/upload.controller';
import { Upload } from '../src/models/Upload.model';
import { DefinitionVersionService } from '../src/services/DefinitionVersion.service';
import { RulesService } from '../src/services/RulesService.service';

describe('upload dry run', () => {
    afterEach(() => jest.restoreAllMocks());

    it('uses the definition draft contract rather than the upload-pinned contract', async () => {
        const draftContract = {
            schemaVersion: 1,
            layout: 'single',
            ignoredSheets: [],
            encoding: 'auto',
            tables: [{ sheet: null, headerRow: null, allowExtraColumns: true, minRows: null, maxRows: null, columns: [] }],
            rules: [],
            lookups: {},
        } as DefinitionContract;
        const upload = {
            Id: 'upload-id',
            FileDefinitionId: 'definition-id',
        };
        const result = { status: 'completed', validRows: 3 };
        jest.spyOn(Upload, 'hasAccessToUpload').mockResolvedValue(true);
        jest.spyOn(Upload, 'findById').mockResolvedValue(upload as Awaited<ReturnType<typeof Upload.findById>>);
        const getDraftContract = jest.spyOn(DefinitionVersionService, 'getDraftContract').mockResolvedValue(draftContract);
        const dryRun = jest.spyOn(RulesService, 'dryRun').mockResolvedValue(result);
        const req = { params: { id: 'upload-id' }, user: { userId: 'user-id' } } as unknown as Request;
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        } as unknown as Response;

        await UploadController.dryRun(req, res);

        expect(getDraftContract).toHaveBeenCalledWith('definition-id');
        expect(dryRun).toHaveBeenCalledWith(draftContract, 'upload-id');
        expect(res.json).toHaveBeenCalledWith({ success: true, ...result });
    });
});
