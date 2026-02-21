/**
 * MCP Server Configuration
 *
 * Environment variable parsing and server constants.
 * All configuration is loaded at import time and frozen.
 */

import { randomUUID } from "node:crypto";

// ============================================
// Environment Variable Parsing
// ============================================

/**
 * Parse a positive integer from an environment variable.
 * Returns the default value if the input is undefined, NaN, or non-positive.
 *
 * @param value - The environment variable value (may be undefined)
 * @param defaultValue - The default value to use if parsing fails
 * @returns The parsed positive integer or the default value
 */
function parsePositiveInt(value: string | undefined, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0) {
    console.warn(`[Config] Invalid integer value "${value}", using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

/**
 * Server configuration object.
 * All values are frozen at import time to prevent runtime modification.
 */
export const config = Object.freeze({
  // API Configuration
  apiBaseUrl: process.env.FITPICK_API_BASE_URL ?? process.env.FITPICK_API_URL ?? "https://api.bowlly.net",
  apiKey: process.env.FITPICK_API_KEY,

  // Agent Identification
  agentName: process.env.FITPICK_AGENT_NAME ?? "mcp",

  // Rate Limiting
  rateLimitPerMin: parsePositiveInt(process.env.FITPICK_RATE_LIMIT_PER_MIN, 100),

  // Session Tracking (MCP-09: crypto.randomUUID for session identification)
  sessionId: randomUUID(),

  // Server Metadata
  serverName: "Bowlly",
  serverVersion: "0.1.2",

  // Timeouts
  apiTimeoutMs: 8_000, // 8 seconds per research recommendation

  // Response size limits
  maxResponseSizeBytes: parsePositiveInt(
    process.env.FITPICK_MAX_RESPONSE_SIZE_BYTES,
    10 * 1024 * 1024 // 10MB default
  ),
});

// ============================================
// Type Exports
// ============================================

export type Config = typeof config;
