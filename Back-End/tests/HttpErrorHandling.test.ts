import type { NextFunction, Request, Response } from 'express';
import { asyncHandler } from '../src/middleware/asyncHandler';
import { errorHandler, toHttpFailure } from '../src/middleware/errorHandler';
import { BadRequestError, ForbiddenError, HttpError, NotFoundError } from '../src/utils/httpError';
import { RulesServiceError } from '../src/services/RulesServiceClient';
import { DefinitionVersionError } from '../src/services/DefinitionVersion.service';
import { AuthoringInputError } from '../src/services/RuleDraft.service';
import { RuleGenerationError } from '../src/services/naturalLanguageRule';

jest.mock('../src/utils/logger', () => ({
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

function mockResponse(statusCode = 200) {
    const res = { statusCode, headersSent: false } as unknown as Response & { body?: unknown };
    res.status = jest.fn((code: number) => {
        res.statusCode = code;
        return res;
    }) as unknown as Response['status'];
    res.json = jest.fn((body: unknown) => {
        res.body = body;
        return res;
    }) as unknown as Response['json'];
    return res;
}

describe('asyncHandler', () => {
    const req = {} as Request;

    it('forwards a rejected promise to next', async () => {
        const failure = new Error('boom');
        const next = jest.fn();
        await asyncHandler(async () => { throw failure; })(req, mockResponse(), next);
        expect(next).toHaveBeenCalledWith(failure);
    });

    it('forwards a synchronous throw to next', async () => {
        const failure = new Error('sync');
        const next = jest.fn();
        await asyncHandler(() => { throw failure; })(req, mockResponse(), next);
        expect(next).toHaveBeenCalledWith(failure);
    });

    it('does not call next when the handler succeeds', async () => {
        const next = jest.fn();
        const res = mockResponse();
        await asyncHandler(async (_req, response) => { response.json({ ok: true }); })(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith({ ok: true });
    });
});

describe('toHttpFailure', () => {
    it.each([
        [new BadRequestError('bad'), 400, 'bad'],
        [new ForbiddenError('Access denied to this rule'), 403, 'Access denied to this rule'],
        [new NotFoundError('Upload not found'), 404, 'Upload not found'],
        [new HttpError('teapot', 418), 418, 'teapot'],
        [new DefinitionVersionError('conflict', 409), 409, 'conflict'],
        [new AuthoringInputError('too many rules'), 400, 'too many rules'],
        [new RuleGenerationError('model unavailable', 503), 503, 'model unavailable'],
        [new RulesServiceError('invalid rule', 400), 400, 'invalid rule'],
    ])('keeps the status and message of %p', (error, statusCode, message) => {
        expect(toHttpFailure(error)).toEqual({ statusCode, message });
    });

    it('treats other rules-service failures as server errors', () => {
        expect(toHttpFailure(new RulesServiceError('upstream down', 401))).toEqual({ statusCode: 500, message: 'upstream down' });
    });

    it('keeps the message of an unexpected error and falls back for empty or non-error values', () => {
        expect(toHttpFailure(new Error('unexpected'))).toEqual({ statusCode: 500, message: 'unexpected' });
        expect(toHttpFailure(new Error(''))).toEqual({ statusCode: 500, message: 'Internal Server Error' });
        expect(toHttpFailure('text')).toEqual({ statusCode: 500, message: 'Internal Server Error' });
    });
});

describe('errorHandler', () => {
    const req = {} as Request;

    it('responds with the mapped status and a { success, message } body', () => {
        const res = mockResponse();
        errorHandler(new NotFoundError('Upload not found'), req, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.body).toMatchObject({ success: false, message: 'Upload not found' });
    });

    it('uses a status already set on the response for unclassified errors', () => {
        const res = mockResponse(422);
        errorHandler(new Error('semantic'), req, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(422);
    });

    it('delegates to the default handler once the response has started', () => {
        const res = mockResponse();
        res.headersSent = true;
        const next = jest.fn() as unknown as NextFunction;
        const failure = new Error('late');
        errorHandler(failure, req, res, next);
        expect(next).toHaveBeenCalledWith(failure);
        expect(res.status).not.toHaveBeenCalled();
    });
});
