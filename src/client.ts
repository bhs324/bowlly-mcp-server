/**
 * HTTP Client for FitPick Agent API
 *
 * Wraps native fetch (Node >=22) to call the FitPick Agent API.
 * Session ID in User-Agent header, API key in x-api-key header.
 */

import http from "node:http";
import https from "node:https";

import { z } from "zod";

import { config } from "./config.js";
import {
  AgentApiError,
  NetworkError,
  TimeoutError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
  ResponseSizeError,
} from "./errors.js";
import { ApiProductSchema, AgentProductsResponseSchema, AgentCompareResponseSchema } from "./schemas/agent-api.js";

// Curation response schema
const agentCurationResponseSchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  tldr: z.array(z.string()),
  criteria: z.array(z.string()),
  methodology: z.string(),
  recommendedProductIds: z.array(z.string()),
  updatedAt: z.string(),
  canonicalUrl: z.string(),
  sections: z
    .array(
      z.object({
        heading: z.string(),
        capsule: z.string(),
        content: z.string(),
      })
    )
    .optional(),
  faq: z
    .array(
      z.object({
        question: z.string(),
        answer: z.string(),
      })
    )
    .optional(),
  meta: z.object({
    apiVersion: z.string(),
    timestamp: z.string(),
  }),
});

const agentCurationListResponseSchema = z.object({
  slugs: z.array(z.string()),
  count: z.number(),
  meta: z.object({
    apiVersion: z.string(),
    timestamp: z.string(),
  }),
});

// Export inferred types
export type AgentCurationResponse = z.infer<typeof agentCurationResponseSchema>;
export type AgentCurationListResponse = z.infer<typeof agentCurationListResponseSchema>;
export type AgentProductsResponse = z.infer<typeof AgentProductsResponseSchema>;
export type AgentCompareResponse = z.infer<typeof AgentCompareResponseSchema>;
export type AgentProductDetailResponse = z.infer<typeof ApiProductSchema>;
export type AgentProductDetail = AgentProductDetailResponse["product"];

// Shared HTTP agents for connection reuse (keep-alive)
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

/**
 * Validate API key format
 * Pattern: URL-safe token, 32-128 characters
 */
function validateApiKey(apiKey: string | undefined): void {
  if (!apiKey) return; // API key is optional

  // Keys are generated as `${prefix}_${base64url}` and can include `_` and `-`.
  const pattern = /^[a-zA-Z0-9_-]{32,128}$/;
  if (!pattern.test(apiKey)) {
    throw new ValidationError(
      "Invalid API key format. Expected 32-128 URL-safe characters (a-z, A-Z, 0-9, underscore, hyphen)."
    );
  }
}

/**
 * Parse Retry-After header value (seconds or HTTP date)
 */
function parseRetryAfter(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;

  // Try parsing as seconds
  const seconds = parseInt(headerValue, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000; // Convert to ms
  }

  // Try parsing as HTTP date
  const date = new Date(headerValue);
  if (!isNaN(date.getTime())) {
    return date.getTime() - Date.now();
  }

  return undefined;
}

/**
 * Check if a URL uses HTTPS
 */
function isHttps(url: string): boolean {
  return url.startsWith("https://");
}

export class AgentApiClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly httpAgent: http.Agent;
  private readonly httpsAgent: https.Agent;

  constructor() {
    // Validate API key format
    validateApiKey(config.apiKey);

    this.baseUrl = config.apiBaseUrl;
    this.headers = {
      "User-Agent": `bowlly-mcp/${config.serverVersion} (session=${config.sessionId})`,
      "x-agent-source": config.agentName,
      "X-API-Version": "v1",
    };
    if (config.apiKey) {
      this.headers["x-api-key"] = config.apiKey;
    }

    // Use shared agents for connection reuse
    this.httpAgent = httpAgent;
    this.httpsAgent = httpsAgent;
  }

  /**
   * Cleanup method to close HTTP agents
   * Should be called when the client is no longer needed
   */
  close(): void {
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
  }

  async getProducts(params?: Record<string, string>): Promise<AgentProductsResponse> {
    // Build URL with query params
    const url = new URL("/agent/products", this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    try {
      // Check Content-Length header before fetching body
      const headResponse = await fetch(url.toString(), {
        method: "HEAD",
        headers: this.headers,
        signal: AbortSignal.timeout(config.apiTimeoutMs),
      });

      const contentLength = headResponse.headers.get("Content-Length");
      if (contentLength) {
        const size = parseInt(contentLength, 10);
        if (!isNaN(size) && size > config.maxResponseSizeBytes) {
          throw new ResponseSizeError(config.maxResponseSizeBytes, size);
        }
      }

      // Fetch with AbortSignal.timeout and connection reuse
      const fetchOptions: RequestInit & { agent?: http.Agent | https.Agent } = {
        method: "GET",
        headers: this.headers,
        signal: AbortSignal.timeout(config.apiTimeoutMs),
        agent: isHttps(url.toString()) ? this.httpsAgent : this.httpAgent,
      };
      const response = await fetch(url.toString(), fetchOptions);

      // Handle non-OK responses with typed errors
      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        console.error(`[AgentApiClient] API error ${response.status}: ${errorText}`);

        // Map HTTP status codes to typed errors
        switch (response.status) {
          case 400:
            throw new ValidationError(errorText);
          case 404:
            throw new NotFoundError("Resource");
          case 429: {
            const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
            throw new RateLimitError(retryAfter);
          }
          case 500:
          case 502:
          case 503:
          case 504:
            throw new ServerError(response.status, errorText);
          default:
            throw new AgentApiError(
              `Agent API error: ${response.status} ${response.statusText}`,
              `HTTP_${response.status}`,
              response.status >= 500, // Retryable if server error
              response.status
            );
        }
      }

      // Check response body size
      const responseSize = parseInt(response.headers.get("Content-Length") || "0", 10);
      if (responseSize > config.maxResponseSizeBytes) {
        throw new ResponseSizeError(config.maxResponseSizeBytes, responseSize);
      }

      // Parse and validate JSON
      const raw = await response.json();
      return AgentProductsResponseSchema.parse(raw);
    } catch (error) {
      // Re-throw known errors
      if (error instanceof AgentApiError) {
        throw error;
      }

      // Handle timeout errors
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new TimeoutError(config.apiTimeoutMs);
      }

      // Handle network errors
      if (
        error instanceof Error &&
        (error.message.includes("fetch failed") ||
          error.message.includes("ENOTFOUND") ||
          error.message.includes("ECONNREFUSED") ||
          error.message.includes("ECONNRESET"))
      ) {
        throw new NetworkError(error.message, error);
      }

      // Re-throw unexpected errors
      throw error;
    }
  }

  async getProductDetail(productId: string): Promise<AgentProductDetailResponse> {
    const url = new URL(`/agent/products/${encodeURIComponent(productId)}`, this.baseUrl);

    try {
      const fetchOptions: RequestInit & { agent?: http.Agent | https.Agent } = {
        headers: this.headers,
        signal: AbortSignal.timeout(config.apiTimeoutMs),
        agent: isHttps(url.toString()) ? this.httpsAgent : this.httpAgent,
      };
      const res = await fetch(url.toString(), fetchOptions);

      // Handle non-OK responses with typed errors
      if (!res.ok) {
        const errorText = await res.text().catch(() => "Unknown error");
        console.error(`[AgentApiClient] API error ${res.status}: ${errorText}`);

        switch (res.status) {
          case 400:
            throw new ValidationError(errorText);
          case 404:
            throw new NotFoundError("Product", productId);
          case 429: {
            const retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
            throw new RateLimitError(retryAfter);
          }
          case 500:
          case 502:
          case 503:
          case 504:
            throw new ServerError(res.status, errorText);
          default:
            throw new AgentApiError(
              `Agent API error: ${res.status} ${res.statusText}`,
              `HTTP_${res.status}`,
              res.status >= 500,
              res.status
            );
        }
      }

      // Check response size
      const responseSize = parseInt(res.headers.get("Content-Length") || "0", 10);
      if (responseSize > config.maxResponseSizeBytes) {
        throw new ResponseSizeError(config.maxResponseSizeBytes, responseSize);
      }

      const raw = await res.json();
      return ApiProductSchema.parse(raw);
    } catch (error) {
      // Re-throw known errors
      if (error instanceof AgentApiError) {
        throw error;
      }

      // Handle timeout errors
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new TimeoutError(config.apiTimeoutMs);
      }

      // Handle network errors
      if (
        error instanceof Error &&
        (error.message.includes("fetch failed") ||
          error.message.includes("ENOTFOUND") ||
          error.message.includes("ECONNREFUSED") ||
          error.message.includes("ECONNRESET"))
      ) {
        throw new NetworkError(error.message, error);
      }

      throw error;
    }
  }

  async compareProducts(productIds: string[]): Promise<AgentCompareResponse> {
    const url = new URL("/agent/products/compare", this.baseUrl);

    try {
      const fetchOptions: RequestInit & { agent?: http.Agent | https.Agent } = {
        method: "POST",
        headers: { ...this.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ productIds }),
        signal: AbortSignal.timeout(config.apiTimeoutMs),
        agent: isHttps(url.toString()) ? this.httpsAgent : this.httpAgent,
      };
      const res = await fetch(url.toString(), fetchOptions);

      // Handle non-OK responses with typed errors
      if (!res.ok) {
        const errorText = await res.text().catch(() => "Unknown error");
        console.error(`[AgentApiClient] API error ${res.status}: ${errorText}`);

        switch (res.status) {
          case 400:
            throw new ValidationError(errorText);
          case 404:
            throw new NotFoundError("Resource");
          case 429: {
            const retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
            throw new RateLimitError(retryAfter);
          }
          case 500:
          case 502:
          case 503:
          case 504:
            throw new ServerError(res.status, errorText);
          default:
            throw new AgentApiError(
              `Agent API error: ${res.status} ${res.statusText}`,
              `HTTP_${res.status}`,
              res.status >= 500,
              res.status
            );
        }
      }

      // Check response size
      const responseSize = parseInt(res.headers.get("Content-Length") || "0", 10);
      if (responseSize > config.maxResponseSizeBytes) {
        throw new ResponseSizeError(config.maxResponseSizeBytes, responseSize);
      }

      const raw = await res.json();
      return AgentCompareResponseSchema.parse(raw);
    } catch (error) {
      // Re-throw known errors
      if (error instanceof AgentApiError) {
        throw error;
      }

      // Handle timeout errors
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new TimeoutError(config.apiTimeoutMs);
      }

      // Handle network errors
      if (
        error instanceof Error &&
        (error.message.includes("fetch failed") ||
          error.message.includes("ENOTFOUND") ||
          error.message.includes("ECONNREFUSED") ||
          error.message.includes("ECONNRESET"))
      ) {
        throw new NetworkError(error.message, error);
      }

      throw error;
    }
  }

  async getCuration(slug: string): Promise<AgentCurationResponse> {
    const url = new URL(`/agent/curation/${encodeURIComponent(slug)}`, this.baseUrl);

    try {
      const fetchOptions: RequestInit & { agent?: http.Agent | https.Agent } = {
        method: "GET",
        headers: this.headers,
        signal: AbortSignal.timeout(config.apiTimeoutMs),
        agent: isHttps(url.toString()) ? this.httpsAgent : this.httpAgent,
      };
      const res = await fetch(url.toString(), fetchOptions);

      // Handle non-OK responses with typed errors
      if (!res.ok) {
        const errorText = await res.text().catch(() => "Unknown error");
        console.error(`[AgentApiClient] API error ${res.status}: ${errorText}`);

        switch (res.status) {
          case 400:
            throw new ValidationError(errorText);
          case 404:
            throw new NotFoundError("Curation", slug);
          case 429: {
            const retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
            throw new RateLimitError(retryAfter);
          }
          case 500:
          case 502:
          case 503:
          case 504:
            throw new ServerError(res.status, errorText);
          default:
            throw new AgentApiError(
              `Agent API error: ${res.status} ${res.statusText}`,
              `HTTP_${res.status}`,
              res.status >= 500,
              res.status
            );
        }
      }

      // Check response size
      const responseSize = parseInt(res.headers.get("Content-Length") || "0", 10);
      if (responseSize > config.maxResponseSizeBytes) {
        throw new ResponseSizeError(config.maxResponseSizeBytes, responseSize);
      }

      const raw = await res.json();
      return agentCurationResponseSchema.parse(raw);
    } catch (error) {
      // Re-throw known errors
      if (error instanceof AgentApiError) {
        throw error;
      }

      // Handle timeout errors
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new TimeoutError(config.apiTimeoutMs);
      }

      // Handle network errors
      if (
        error instanceof Error &&
        (error.message.includes("fetch failed") ||
          error.message.includes("ENOTFOUND") ||
          error.message.includes("ECONNREFUSED") ||
          error.message.includes("ECONNRESET"))
      ) {
        throw new NetworkError(error.message, error);
      }

      throw error;
    }
  }

  async listCurations(): Promise<AgentCurationListResponse> {
    const url = new URL("/agent/curation", this.baseUrl);

    try {
      const fetchOptions: RequestInit & { agent?: http.Agent | https.Agent } = {
        method: "GET",
        headers: this.headers,
        signal: AbortSignal.timeout(config.apiTimeoutMs),
        agent: isHttps(url.toString()) ? this.httpsAgent : this.httpAgent,
      };
      const res = await fetch(url.toString(), fetchOptions);

      if (!res.ok) {
        const errorText = await res.text().catch(() => "Unknown error");
        console.error(`[AgentApiClient] API error ${res.status}: ${errorText}`);

        switch (res.status) {
          case 400:
            throw new ValidationError(errorText);
          case 404:
            throw new NotFoundError("Curation list");
          case 429: {
            const retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
            throw new RateLimitError(retryAfter);
          }
          case 500:
          case 502:
          case 503:
          case 504:
            throw new ServerError(res.status, errorText);
          default:
            throw new AgentApiError(
              `Agent API error: ${res.status} ${res.statusText}`,
              `HTTP_${res.status}`,
              res.status >= 500,
              res.status
            );
        }
      }

      const responseSize = parseInt(res.headers.get("Content-Length") || "0", 10);
      if (responseSize > config.maxResponseSizeBytes) {
        throw new ResponseSizeError(config.maxResponseSizeBytes, responseSize);
      }

      const raw = await res.json();
      return agentCurationListResponseSchema.parse(raw);
    } catch (error) {
      if (error instanceof AgentApiError) {
        throw error;
      }

      if (error instanceof Error && error.name === "TimeoutError") {
        throw new TimeoutError(config.apiTimeoutMs);
      }

      if (
        error instanceof Error &&
        (error.message.includes("fetch failed") ||
          error.message.includes("ENOTFOUND") ||
          error.message.includes("ECONNREFUSED") ||
          error.message.includes("ECONNRESET"))
      ) {
        throw new NetworkError(error.message, error);
      }

      throw error;
    }
  }
}
