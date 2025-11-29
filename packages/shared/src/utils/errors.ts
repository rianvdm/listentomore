// Centralized error handling utilities

export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number = 500,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      id ? `${resource} not found: ${id}` : `${resource} not found`,
      'NOT_FOUND',
      404
    );
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class ExternalApiError extends AppError {
  constructor(service: string, message: string, status: number = 502) {
    super(`${service} API error: ${message}`, 'EXTERNAL_API_ERROR', status);
    this.name = 'ExternalApiError';
  }
}

export class RateLimitError extends AppError {
  constructor(service: string, retryAfter?: number) {
    super(
      `Rate limit exceeded for ${service}`,
      'RATE_LIMIT_ERROR',
      429,
      retryAfter ? { retryAfter } : undefined
    );
    this.name = 'RateLimitError';
  }
}

/**
 * Type guard to check if an error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Convert unknown error to AppError
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }
  if (error instanceof Error) {
    return new AppError(error.message, 'INTERNAL_ERROR', 500);
  }
  return new AppError('An unexpected error occurred', 'INTERNAL_ERROR', 500);
}

/**
 * Create a standardized error response
 */
export function errorResponse(error: AppError): Response {
  return new Response(
    JSON.stringify({
      error: {
        message: error.message,
        code: error.code,
        ...(error.details && { details: error.details }),
      },
    }),
    {
      status: error.status,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}
