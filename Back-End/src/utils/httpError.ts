// =============================================================================
// HTTP errors - failures a client should see with a specific status code
// =============================================================================

/** An error whose message is safe to return to the client with `statusCode`. */
export class HttpError extends Error {
    constructor(message: string, readonly statusCode: number) {
        super(message);
        this.name = 'HttpError';
    }
}

export class BadRequestError extends HttpError {
    constructor(message: string) {
        super(message, 400);
        this.name = 'BadRequestError';
    }
}

export class ForbiddenError extends HttpError {
    constructor(message = 'Access denied') {
        super(message, 403);
        this.name = 'ForbiddenError';
    }
}

export class NotFoundError extends HttpError {
    constructor(message = 'Not found') {
        super(message, 404);
        this.name = 'NotFoundError';
    }
}
