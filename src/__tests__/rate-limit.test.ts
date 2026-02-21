import { describe, it, expect, vi, beforeEach } from "vitest";

import { TokenBucket, TokenBucketManager } from "../rate-limit.js";

describe("TokenBucket", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("allows requests within limit", () => {
    const bucket = new TokenBucket(5, 60_000);

    for (let i = 0; i < 5; i++) {
      const result = bucket.consume();
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(5);
      expect(result.remaining).toBeGreaterThanOrEqual(0);
      expect(typeof result.resetEpochMs).toBe("number");
    }
  });

  it("rejects request when bucket empty", () => {
    const bucket = new TokenBucket(5, 60_000);

    // Consume all tokens
    for (let i = 0; i < 5; i++) {
      bucket.consume();
    }

    // 6th request should be rejected
    const result = bucket.consume();
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(typeof result.resetEpochMs).toBe("number");
  });

  it("remaining decrements correctly", () => {
    const bucket = new TokenBucket(5, 60_000);

    const result1 = bucket.consume();
    expect(result1.remaining).toBe(4);

    const result2 = bucket.consume();
    expect(result2.remaining).toBe(3);

    const result3 = bucket.consume();
    expect(result3.remaining).toBe(2);
  });

  it("refills after window elapses", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const bucket = new TokenBucket(5, 60_000);

    // Consume all tokens
    for (let i = 0; i < 5; i++) {
      bucket.consume();
    }

    // Verify bucket is empty
    const emptyResult = bucket.consume();
    expect(emptyResult.allowed).toBe(false);

    // Advance time past the window
    vi.advanceTimersByTime(60_001);

    // Next consume should be allowed with full remaining
    const refilledResult = bucket.consume();
    expect(refilledResult.allowed).toBe(true);
    expect(refilledResult.remaining).toBe(4); // After consuming 1, 4 remain

    vi.useRealTimers();
  });

  it("resetEpochMs is approximately lastRefill + windowMs", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const windowMs = 60_000;
    const bucket = new TokenBucket(5, windowMs);

    const result = bucket.consume();
    expect(result.resetEpochMs).toBe(now + windowMs);

    vi.useRealTimers();
  });

  it("handles 100 requests per minute limit (MCP-08)", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const bucket = new TokenBucket(100, 60_000);

    // 100 requests should succeed
    for (let i = 0; i < 100; i++) {
      const result = bucket.consume();
      expect(result.allowed).toBe(true);
    }

    // 101st request should be rejected
    const result101 = bucket.consume();
    expect(result101.allowed).toBe(false);
    expect(result101.remaining).toBe(0);

    vi.useRealTimers();
  });
});

describe("TokenBucketManager", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("creates independent buckets for different clients", () => {
    const manager = new TokenBucketManager(5, 60_000);

    // Client A consumes all tokens
    for (let i = 0; i < 5; i++) {
      const result = manager.consume("client-a");
      expect(result.allowed).toBe(true);
    }

    // Client A's 6th request should be rejected
    const resultA6 = manager.consume("client-a");
    expect(resultA6.allowed).toBe(false);

    // Client B should still have all tokens available
    const resultB1 = manager.consume("client-b");
    expect(resultB1.allowed).toBe(true);
    expect(resultB1.remaining).toBe(4);
  });

  it("returns correct capacity", () => {
    const manager = new TokenBucketManager(10, 60_000);
    expect(manager.capacity).toBe(10);
  });

  it("reuses existing bucket for same client", () => {
    const manager = new TokenBucketManager(5, 60_000);

    // First request for client-a
    const result1 = manager.consume("client-a");
    expect(result1.remaining).toBe(4);

    // Second request for client-a should use same bucket
    const result2 = manager.consume("client-a");
    expect(result2.remaining).toBe(3);
  });

  it("handles multiple clients independently", () => {
    const manager = new TokenBucketManager(3, 60_000);

    // Each client consumes some tokens
    manager.consume("client-1");
    manager.consume("client-1");

    manager.consume("client-2");

    manager.consume("client-3");
    manager.consume("client-3");
    manager.consume("client-3");

    // Verify remaining tokens for each
    expect(manager.consume("client-1").remaining).toBe(0); // 1 remaining, consumed -> 0
    expect(manager.consume("client-2").remaining).toBe(1); // 2 remaining, consumed -> 1
    expect(manager.consume("client-3").allowed).toBe(false); // 0 remaining, rejected
  });

  it("refills buckets independently after window", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const manager = new TokenBucketManager(5, 60_000);

    // Consume all tokens for client-a
    for (let i = 0; i < 5; i++) {
      manager.consume("client-a");
    }

    // Consume 2 tokens for client-b
    manager.consume("client-b");
    manager.consume("client-b");

    // Advance time past the window
    vi.advanceTimersByTime(60_001);

    // Client-a should have tokens again
    const resultA = manager.consume("client-a");
    expect(resultA.allowed).toBe(true);

    // Client-b should also have tokens refilled
    const resultB = manager.consume("client-b");
    expect(resultB.allowed).toBe(true);

    vi.useRealTimers();
  });
});
