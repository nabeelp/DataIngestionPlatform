// =============================================================================
// Upload Controller - Validation preview (dry run) against the draft definition
// =============================================================================

import { Upload } from '../../models/Upload.model';
import { DefinitionVersionService } from '../../services/DefinitionVersion.service';
import { AuthoringInputError, buildAuthoringContract } from '../../services/RuleDraft.service';
import { RulesServiceClient, RulesServiceError } from '../../services/RulesServiceClient';
import { logger } from '../../utils/logger';
import { asyncHandler } from '../../middleware/asyncHandler';
import { BadRequestError, ForbiddenError, HttpError, NotFoundError } from '../../utils/httpError';

export const dryRun = asyncHandler(async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const userId = req.user!.userId;
    try {
        if (!await Upload.hasAccessToUpload(id, userId)) {
            throw new ForbiddenError();
        }
        const upload = await Upload.findById(id);
        if (!upload) {
            throw new NotFoundError('Upload not found');
        }
        // The definition workspace previews its unsaved structure and rules (admins only).
        const draftBody = req.body?.Contract;
        if (draftBody && req.user?.role !== 'admin') {
            throw new ForbiddenError('Admin access required');
        }
        const draftContract = draftBody
            ? await buildAuthoringContract(draftBody, req.body?.Rules)
            : await DefinitionVersionService.getDraftContract(upload.FileDefinitionId);
        const result = await RulesServiceClient.dryRun(draftContract, upload.Id);
        res.json({ success: true, ...result });
    } catch (error) {
        if (error instanceof HttpError) throw error;
        logger.error(`[UPLOAD-DRY-RUN] Failed for upload ${id}: ${error instanceof Error ? error.name : 'UnknownError'}`);
        if (error instanceof AuthoringInputError) {
            throw new BadRequestError(error.message);
        }
        if (error instanceof RulesServiceError && error.statusCode === 400) {
            throw new HttpError('The uploaded file could not be previewed.', 422);
        }
        throw new HttpError('Failed to run validation preview', 500);
    }
});
