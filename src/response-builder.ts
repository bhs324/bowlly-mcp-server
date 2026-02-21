/**
 * Tool Response Builder
 *
 * Provides a fluent, type-safe builder pattern for constructing MCP tool responses.
 * Eliminates code duplication in response construction across all tools.
 */

import type { RateLimitCheck } from "./rate-limit.js";
import type { RateLimitInfo, ToolErrorType } from "./types.js";

export interface ToolResponse {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
  [x: string]: unknown;
}

/**
 * Builder class for constructing standardized MCP tool responses.
 *
 * Usage:
 * ```typescript
 * // Rate limit exceeded
 * return ToolResponseBuilder.rateLimitExceeded(rateCheck);
 *
 * // Success response
 * return ToolResponseBuilder.success(data, rateLimit);
 *
 * // Error response
 * return ToolResponseBuilder.error("Product not found", rateLimit);
 * ```
 */
export class ToolResponseBuilder {
  /**
   * Creates a rate limit exceeded error response with retry information.
   */
  static rateLimitExceeded(rateCheck: RateLimitCheck): ToolResponse {
    const retryAfterSeconds = Math.ceil((rateCheck.resetEpochMs - Date.now()) / 1000);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: {
              type: "RATE_LIMITED" as ToolErrorType,
              message: "Rate limit exceeded",
            },
            rateLimit: {
              limit: rateCheck.limit,
              remaining: 0,
              resetEpochMs: rateCheck.resetEpochMs,
            },
            retryAfterSeconds,
          }),
        },
      ],
    };
  }

  /**
   * Creates a successful response with data and rate limit info.
   */
  static success<T>(data: T, rateLimit: RateLimitInfo): ToolResponse {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ data, rateLimit }),
        },
      ],
    };
  }

  /**
   * Creates an error response with message and rate limit info.
   * Optional additional data can be included.
   */
  static error(message: string, rateLimit: RateLimitInfo, additionalData?: Record<string, unknown>): ToolResponse {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: message,
            rateLimit,
            ...additionalData,
          }),
        },
      ],
    };
  }

  /**
   * Creates a NOT_FOUND error response.
   * Use when a requested resource does not exist.
   */
  static notFound(resource: string, resourceId: string, rateLimit: RateLimitInfo): ToolResponse {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: {
              type: "NOT_FOUND" as ToolErrorType,
              message: `${resource} not found: ${resourceId}`,
            },
            rateLimit,
          }),
        },
      ],
    };
  }

  /**
   * Creates a VALIDATION error response.
   * Use when input parameters are invalid.
   */
  static validation(message: string, rateLimit: RateLimitInfo, details?: Record<string, unknown>): ToolResponse {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: {
              type: "VALIDATION" as ToolErrorType,
              message,
              details,
            },
            rateLimit,
          }),
        },
      ],
    };
  }

  /**
   * Creates an INTERNAL error response.
   * Use for unexpected server errors. Logs internally, returns safe message.
   */
  static internal(message: string, rateLimit: RateLimitInfo, logContext?: Record<string, unknown>): ToolResponse {
    // Log internal error details for debugging
    console.error("[Internal Error]", { message, ...logContext });

    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: {
              type: "INTERNAL" as ToolErrorType,
              message: "Service temporarily unavailable",
            },
            rateLimit,
          }),
        },
      ],
    };
  }
}
