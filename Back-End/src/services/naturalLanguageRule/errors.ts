import { HttpError } from '../../utils/httpError';

export class RuleGenerationError extends HttpError {
    constructor(message: string, readonly statusCode: 400 | 403 | 404 | 502 | 503 | 504 = 502) {
        super(message, statusCode);
        this.name = 'RuleGenerationError';
    }
}

/** The caller stopped the review (for example, the admin closed the drawer); nothing was saved. */
export class RuleGenerationCancelledError extends Error {
    constructor() {
        super('The rule review was stopped before it finished; nothing was saved');
        this.name = 'RuleGenerationCancelledError';
    }
}

export class ModelCallError extends RuleGenerationError {
    constructor(message: string, readonly retryable: boolean, statusCode: 400 | 404 | 502 = 502) {
        super(message, statusCode);
        this.name = 'ModelCallError';
    }
}
