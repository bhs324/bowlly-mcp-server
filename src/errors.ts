/**
 * Typed Error Classes for Agent API Client
 *
 * Provides structured error handling with error codes and retryability info.
 */

/**
 * Base class for all Agent API errors
 */
export class AgentApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(message: string, code: string, retryable: boolean, statusCode?: number) {
    super(message);
    this.name = "AgentApiError";
    this.code = code;
    this.retryable = retryable;
    this.statusCode = statusCode;

    // Fix prototype chain for instanceof checks
    Object.setPrototypeOf(this, AgentApiError.prototype);
  }
}

/**
 * Network-level errors (DNS, connection refused, etc.)
 */
export class NetworkError extends AgentApiError {
  constructor(message: string, cause?: Error) {
    super(
      message,
      "NETWORK_ERROR",
      true, // Network errors are typically retryable
      undefined
    );
    this.name = "NetworkError";
    this.cause = cause;

    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

/**
 * Request timeout errors
 */
export class TimeoutError extends AgentApiError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(
      `Request timed out after ${timeoutMs}ms`,
      "TIMEOUT_ERROR",
      true, // Timeouts are typically retryable
      undefined
    );
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;

    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/**
 * 404 Not Found errors
 */
export class NotFoundError extends AgentApiError {
  readonly resource: string;

  constructor(resource: string, id?: string) {
    const message = id ? `${resource} not found: ${id}` : `${resource} not found`;

    super(
      message,
      "NOT_FOUND",
      false, // 404s are not retryable
      404
    );
    this.name = "NotFoundError";
    this.resource = resource;

    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * 429 Rate Limit errors
 */
export class RateLimitError extends AgentApiError {
  readonly retryAfterMs?: number;

  constructor(retryAfterMs?: number) {
    const message = retryAfterMs ? `Rate limit exceeded. Retry after ${retryAfterMs}ms` : "Rate limit exceeded";

    super(
      message,
      "RATE_LIMIT",
      true, // Rate limits are retryable (after delay)
      429
    );
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;

    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

/**
 * 5xx Server errors
 */
export class ServerError extends AgentApiError {
  constructor(statusCode: number, message?: string) {
    super(
      message || `Server error: ${statusCode}`,
      "SERVER_ERROR",
      true, // Server errors are typically retryable
      statusCode
    );
    this.name = "ServerError";

    Object.setPrototypeOf(this, ServerError.prototype);
  }
}

/**
 * 400 Bad Request / validation errors
 */
export class ValidationError extends AgentApiError {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(
      message,
      "VALIDATION_ERROR",
      false, // Validation errors are not retryable
      400
    );
    this.name = "ValidationError";
    this.field = field;

    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Response size exceeded error
 */
export class ResponseSizeError extends AgentApiError {
  readonly maxSizeBytes: number;
  readonly actualSizeBytes: number;

  constructor(maxSizeBytes: number, actualSizeBytes: number) {
    super(
      `Response size (${actualSizeBytes} bytes) exceeds maximum (${maxSizeBytes} bytes)`,
      "RESPONSE_SIZE_EXCEEDED",
      false, // Size errors are not retryable
      undefined
    );
    this.name = "ResponseSizeError";
    this.maxSizeBytes = maxSizeBytes;
    this.actualSizeBytes = actualSizeBytes;

    Object.setPrototypeOf(this, ResponseSizeError.prototype);
  }
}
