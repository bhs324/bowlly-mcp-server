import type { RateLimitInfo, ToolResponse } from "./types.js";
import { createErrorResponse } from "./utils/response-helpers.js";

export interface RateLimitInfoExtended extends RateLimitInfo {
  limit: number;
  remaining: number;
  resetEpochMs: number;
}

/** Rate limit check result returned by TokenBucket.consume() */
export type RateLimitCheck = RateLimitInfo & { allowed: boolean };

/**
 * TokenBucket - Simple in-memory token bucket rate limiter
 *
 * Implements a proportional refill algorithm where tokens are added
 * based on elapsed time since last request.
 *
 * @limitations
 * - In-memory only: Rate limit state is NOT shared across server instances.
 *   Each server process maintains its own independent token count.
 * - For single-instance deployments (MVP), this provides accurate rate limiting.
 * - For distributed deployments with load balancing, clients may exceed
 *   the intended rate limit by hitting different instances.
 * - Consider Redis or DynamoDB-based rate limiting for distributed scenarios.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = 60_000
  ) {
    this.tokens = limit;
    this.lastRefill = Date.now();
  }

  get capacity(): number {
    return this.limit;
  }

  consume(): RateLimitCheck {
    const now = Date.now();
    const elapsed = now - this.lastRefill;

    // Proportional refill: add tokens based on elapsed time
    if (elapsed > 0) {
      const tokensToAdd = (elapsed / this.windowMs) * this.limit;
      this.tokens = Math.min(this.limit, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }

    const resetEpochMs = this.lastRefill + this.windowMs;

    if (this.tokens <= 0) {
      return { allowed: false, limit: this.limit, remaining: 0, resetEpochMs };
    }

    this.tokens--;
    return { allowed: true, limit: this.limit, remaining: Math.floor(this.tokens), resetEpochMs };
  }
}

export function withRateLimit<TArgs>(
  bucket: TokenBucket,
  handler: (args: TArgs, rateLimit: RateLimitInfoExtended) => Promise<ToolResponse>
): (args: TArgs) => Promise<ToolResponse>;
export function withRateLimit<TArgs>(
  bucketManager: TokenBucketManager,
  getClientId: () => string,
  handler: (args: TArgs, rateLimit: RateLimitInfoExtended) => Promise<ToolResponse>
): (args: TArgs) => Promise<ToolResponse>;
export function withRateLimit<TArgs>(
  bucketOrManager: TokenBucket | TokenBucketManager,
  handlerOrGetClientId: ((args: TArgs, rateLimit: RateLimitInfoExtended) => Promise<ToolResponse>) | (() => string),
  handler?: (args: TArgs, rateLimit: RateLimitInfoExtended) => Promise<ToolResponse>
): (args: TArgs) => Promise<ToolResponse> {
  return async (args: TArgs) => {
    let rateCheck: RateLimitCheck;
    let capacity: number;

    if (handler) {
      // TokenBucketManager overload
      const manager = bucketOrManager as TokenBucketManager;
      const getClientId = handlerOrGetClientId as () => string;
      rateCheck = manager.consume(getClientId());
      capacity = manager.capacity;
    } else {
      // TokenBucket overload
      const bucket = bucketOrManager as TokenBucket;
      const handlerFn = handlerOrGetClientId as (
        args: TArgs,
        rateLimit: RateLimitInfoExtended
      ) => Promise<ToolResponse>;
      rateCheck = bucket.consume();
      capacity = bucket.capacity;
      // Need to call handlerFn but we're in the wrapper, so we need to restructure
      // Actually, for the TokenBucket case, we need to call the handler
      if (!rateCheck.allowed) {
        const retryAfterSeconds = Math.ceil((rateCheck.resetEpochMs - Date.now()) / 1000);
        const rateLimit: RateLimitInfoExtended = {
          limit: capacity,
          remaining: 0,
          resetEpochMs: rateCheck.resetEpochMs,
        };
        return createErrorResponse("Rate limit exceeded", rateLimit, {
          retryAfterSeconds,
        });
      }

      const rateLimit: RateLimitInfoExtended = {
        limit: capacity,
        remaining: rateCheck.remaining,
        resetEpochMs: rateCheck.resetEpochMs,
      };

      return handlerFn(args, rateLimit);
    }

    if (!rateCheck.allowed) {
      const retryAfterSeconds = Math.ceil((rateCheck.resetEpochMs - Date.now()) / 1000);
      const rateLimit: RateLimitInfoExtended = {
        limit: capacity,
        remaining: 0,
        resetEpochMs: rateCheck.resetEpochMs,
      };
      return createErrorResponse("Rate limit exceeded", rateLimit, {
        retryAfterSeconds,
      });
    }

    const rateLimit: RateLimitInfoExtended = {
      limit: capacity,
      remaining: rateCheck.remaining,
      resetEpochMs: rateCheck.resetEpochMs,
    };

    if (!handler) {
      return createErrorResponse("Rate limit handler is not configured", rateLimit);
    }

    return handler(args, rateLimit);
  };
}

/**
 * TokenBucketManager - Manages per-client rate limit buckets
 *
 * Each client gets their own independent token bucket, ensuring fair
 * rate limiting across different clients/sessions.
 *
 * @limitations
 * - This is an in-memory implementation. Rate limits are NOT shared across
 *   multiple server instances or processes. Each server instance maintains
 *   its own independent set of buckets.
 * - For MVP/single-instance deployments, this is sufficient.
 * - For production with multiple instances (horizontal scaling), consider
 *   migrating to a distributed rate limiting solution (e.g., Redis-based).
 * - Buckets are lost on server restart (no persistence).
 */
export class TokenBucketManager {
  private buckets = new Map<string, TokenBucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = 60_000
  ) {}

  /**
   * Consume a token for the given client
   * Creates a new bucket for the client if one doesn't exist
   */
  consume(clientId: string): RateLimitCheck {
    if (!this.buckets.has(clientId)) {
      this.buckets.set(clientId, new TokenBucket(this.limit, this.windowMs));
    }
    const bucket = this.buckets.get(clientId);
    if (!bucket) {
      throw new Error(`Token bucket not initialized for client: ${clientId}`);
    }
    return bucket.consume();
  }

  /**
   * Get the rate limit capacity
   */
  get capacity(): number {
    return this.limit;
  }

  /**
   * Clean up old buckets to prevent memory leaks
   * Buckets older than maxAgeMs are removed
   */
  cleanup(_maxAgeMs: number = 300_000): void {
    // Note: In a production environment, you might want to track
    // last access time per bucket. For now, we provide the method
    // signature for future implementation.
    // This is a no-op for the current implementation.
  }
}
