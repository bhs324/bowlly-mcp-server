/**
 * Response Helper Utilities
 *
 * Standardized response formatting for MCP tools.
 * Ensures consistent error/success response structure with isError flag.
 */

import type { RateLimitInfo } from "../types.js";

export interface ToolResponse {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [x: string]: unknown;
}

export function createErrorResponse(
  message: string,
  rateLimit: RateLimitInfo,
  additionalData?: Record<string, unknown>
): ToolResponse {
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

export function createSuccessResponse(data: unknown, rateLimit: RateLimitInfo): ToolResponse {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          data,
          rateLimit,
        }),
      },
    ],
  };
}
